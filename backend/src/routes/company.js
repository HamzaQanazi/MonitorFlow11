// Company settings (admin/Owner only). CLAUDE.md §15 used to list "onboarding
// is one-shot with no in-app edit — change company details by direct row
// update, including turning a feature on after the fact" as a documented
// limitation to state rather than fix. Re-scoped 2026-08-22 by explicit
// decision: hand-editing a live database is not something a buyer can do, and
// three of the wizard's answers (features, logo, branches) were otherwise
// permanent. Onboarding itself stays one-shot — this edits the row afterwards,
// it does not re-run the wizard.
const express = require('express');
const pool = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { withTx, logAudit } = require('../lib/audit');
const {
  INDUSTRY_KEYS,
  SUBS_BY_INDUSTRY,
  FEATURE_KEYS,
  EMPLOYEE_RANGE_SET,
  PLAN_KEYS,
  PLANS,
} = require('../lib/onboardingOptions');

const router = express.Router();
// Gates go on the routes, NOT on the router: this router is mounted at
// /api/v1 (single-org, so the path is just /company), so a router-level
// requireRole would 403 every non-admin request to every other route mounted
// after it.
const adminOnly = [requireAuth, requireRole('admin')];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DOMAIN_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;
const str = (v) => (typeof v === 'string' ? v.trim() : '');
function bilingual(v) {
  if (!v || typeof v !== 'object') return null;
  const en = str(v.en);
  const ar = str(v.ar);
  return en && ar ? { en, ar } : null;
}

// GET /company — the current settings plus the branch list, for the Settings
// page. The logo comes back as an id only; the console already receives it
// inlined as a data URI on /auth/me (§11), so there's no second fetch here.
router.get('/company', adminOnly, async (req, res, next) => {
  try {
    const [{ rows: co }, { rows: branches }] = await Promise.all([
      pool.query(
        `SELECT id, name, address, owner_job_title, employee_range, industry, sub_industry,
                plan, email_domain, features, logo_file_id, phone, onboarding_completed
         FROM company WHERE id = $1`,
        [req.user.company_id]
      ),
      pool.query(
        `SELECT b.id, b.name,
                EXISTS (SELECT 1 FROM department d WHERE d.branch_id = b.id) AS in_use
         FROM branch b WHERE b.company_id = $1 ORDER BY b.id`,
        [req.user.company_id]
      ),
    ]);
    if (!co.length) return res.status(404).json({ error: 'Not found' });
    const c = co[0];
    res.json({
      company: {
        name: c.name,
        address: c.address,
        ownerJobTitle: c.owner_job_title,
        employeeRange: c.employee_range,
        industry: c.industry,
        subIndustry: c.sub_industry,
        plan: c.plan,
        emailDomain: c.email_domain,
        features: c.features ?? [],
        logoFileId: c.logo_file_id,
        phone: c.phone,
        onboardingCompleted: c.onboarding_completed,
        branches: branches.map((b) => ({ id: b.id, name: b.name, inUse: b.in_use })),
      },
    });
  } catch (err) {
    next(err);
  }
});

// PATCH /company — full replace of the owner-entered settings, validated
// against the same catalogue the onboarding save uses (I8). Branches are a
// full replace too: a row with an id is renamed, one without is inserted, and
// an id that isn't listed is deleted — refused if a department still points at
// it, since branch_id is a real FK.
router.patch('/company', adminOnly, async (req, res, next) => {
  const b = req.body || {};
  const errors = {};

  const name = bilingual(b.name);
  const address = bilingual(b.address);
  const ownerJobTitle = bilingual(b.ownerJobTitle);
  const phone = str(b.phone);
  const emailDomain = str(b.emailDomain).toLowerCase();

  if (!name) errors.name = 'Company name (English and Arabic) is required';
  if (!address) errors.address = 'Company address (English and Arabic) is required';
  if (!ownerJobTitle) errors.ownerJobTitle = 'Job title (English and Arabic) is required';
  if (!phone) errors.phone = 'Phone number is required';
  if (!DOMAIN_RE.test(emailDomain)) errors.emailDomain = 'Enter a valid domain, e.g. company.org';
  if (!EMPLOYEE_RANGE_SET.has(b.employeeRange)) errors.employeeRange = 'Select a valid employee range';
  if (!INDUSTRY_KEYS.has(b.industry)) errors.industry = 'Select a valid industry';
  else if (!SUBS_BY_INDUSTRY.get(b.industry).has(b.subIndustry)) errors.subIndustry = 'Select a valid sub-industry';
  if (!PLAN_KEYS.has(b.plan)) errors.plan = 'Select a valid plan';

  const features = Array.isArray(b.features) ? [...new Set(b.features)] : [];
  if (features.some((f) => !FEATURE_KEYS.has(f))) errors.features = 'Unknown feature selected';
  else if (!features.length) errors.features = 'Select at least one feature';

  if (b.logoFileId != null && b.logoFileId !== '' && !UUID_RE.test(b.logoFileId)) {
    errors.logoFileId = 'Invalid logo reference';
  }

  // Branch rows: the same flat { en, ar } the onboarding save takes, plus an
  // optional id — an id renames that branch, no id inserts a new one, and an
  // existing id left out is deleted.
  const branchRows = Array.isArray(b.branches) ? b.branches : [];
  const branches = branchRows.map((row) => ({
    id: Number.isInteger(row && row.id) ? row.id : null,
    name: bilingual(row),
  }));
  if (!branches.length || branches.some((br) => !br.name)) {
    errors.branches = 'Each branch needs a name in English and Arabic';
  }

  if (Object.keys(errors).length) return res.status(422).json({ errors });

  try {
    const result = await withTx(async (tx) => {
      const { rows: co } = await tx.query(
        'SELECT id, features, plan FROM company WHERE id = $1 FOR UPDATE',
        [req.user.company_id]
      );
      if (!co.length) return { notFound: true };

      // A plan whose cap is already below the current headcount would put the
      // company permanently over its own limit — the same check POST /employees
      // makes on hire, applied before the downgrade instead of after.
      const planRow = PLANS.find((p) => p.key === b.plan);
      const cap = planRow ? planRow.employeeCap : null;
      if (cap != null) {
        const { rows: count } = await tx.query(
          "SELECT COUNT(*)::int AS n FROM users WHERE role = 'employee' AND is_active"
        );
        if (count[0].n > cap) return { overCap: { cap, current: count[0].n } };
      }

      if (b.logoFileId) {
        const { rows: fa } = await tx.query(
          `SELECT id, mime_type FROM file_attachment
           WHERE id = $1 AND uploaded_by = $2
             AND request_id IS NULL AND task_id IS NULL AND time_entry_id IS NULL`,
          [b.logoFileId, req.user.id]
        );
        if (!fa.length) return { fieldError: { logoFileId: 'Unknown logo upload' } };
        if (!/^image\//.test(fa[0].mime_type)) {
          return { fieldError: { logoFileId: 'The logo must be a PNG or JPEG image' } };
        }
      }

      const { rows: existing } = await tx.query('SELECT id FROM branch WHERE company_id = $1', [
        req.user.company_id,
      ]);
      const existingIds = new Set(existing.map((r) => r.id));
      const keptIds = new Set(branches.filter((br) => br.id != null).map((br) => br.id));
      if ([...keptIds].some((id) => !existingIds.has(id))) {
        return { fieldError: { branches: 'Unknown branch' } };
      }

      const removed = [...existingIds].filter((id) => !keptIds.has(id));
      if (removed.length) {
        const { rows: used } = await tx.query(
          `SELECT b.name FROM branch b
           WHERE b.id = ANY($1::int[])
             AND EXISTS (SELECT 1 FROM department d WHERE d.branch_id = b.id)`,
          [removed]
        );
        if (used.length) return { branchInUse: used[0].name };
        await tx.query('DELETE FROM branch WHERE id = ANY($1::int[])', [removed]);
      }
      for (const br of branches) {
        if (br.id == null) {
          await tx.query('INSERT INTO branch (company_id, name) VALUES ($1, $2::jsonb)', [
            req.user.company_id,
            JSON.stringify(br.name),
          ]);
        } else {
          await tx.query('UPDATE branch SET name = $1::jsonb WHERE id = $2 AND company_id = $3', [
            JSON.stringify(br.name),
            br.id,
            req.user.company_id,
          ]);
        }
      }

      await tx.query(
        `UPDATE company
           SET name=$1::jsonb, address=$2::jsonb, owner_job_title=$3::jsonb, employee_range=$4,
               industry=$5, sub_industry=$6, features=$7, phone=$8, plan=$9, email_domain=$10,
               logo_file_id = COALESCE($11, logo_file_id)
         WHERE id=$12`,
        [
          JSON.stringify(name), JSON.stringify(address), JSON.stringify(ownerJobTitle),
          b.employeeRange, b.industry, b.subIndustry, features, phone, b.plan, emailDomain,
          b.logoFileId || null, req.user.company_id,
        ]
      );

      await logAudit(tx, req.user.id, 'company.updated', 'company', req.user.company_id, {
        plan: b.plan,
        features,
        featuresRemoved: (co[0].features || []).filter((f) => !features.includes(f)),
        planChanged: co[0].plan !== b.plan,
      });
      return { ok: true };
    });

    if (result.notFound) return res.status(404).json({ error: 'Not found' });
    if (result.fieldError) return res.status(422).json({ errors: result.fieldError });
    if (result.overCap) {
      return res.status(422).json({
        errors: {
          plan: `This plan allows ${result.overCap.cap} employees but you have ${result.overCap.current} active. Remove employees or pick a larger plan.`,
        },
      });
    }
    if (result.branchInUse) {
      return res.status(409).json({
        error: `A department still belongs to "${result.branchInUse.en}". Move it to another branch first.`,
      });
    }
    res.json({ updated: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;

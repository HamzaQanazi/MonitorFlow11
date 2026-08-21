// The first-login onboarding wizard's backend (pivot v7). Two endpoints:
//   GET  /onboarding/options   — the static catalogue the wizard renders (I4)
//   PATCH /company/onboarding  — the Owner saves their picks; flips the flag
// Both authenticated; the save is admin-only (the Owner). Single-org: the one
// company is the caller's company_id.
const express = require('express');
const pool = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { logAudit } = require('../lib/audit');
const {
  EMPLOYEE_RANGES,
  INDUSTRIES,
  FEATURE_GROUPS,
  PLANS,
  INDUSTRY_KEYS,
  SUBS_BY_INDUSTRY,
  FEATURE_KEYS,
  EMPLOYEE_RANGE_SET,
  PLAN_KEYS,
} = require('../lib/onboardingOptions');

const router = express.Router();
router.use(requireAuth);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const str = (v) => (typeof v === 'string' ? v.trim() : '');
// Bilingual owner-entered fields (name, address, job title, branch names) —
// both languages required, same CHECK the DB enforces (I5). Returns null if
// either half is missing so the caller can turn that into a field error.
function bilingual(v) {
  if (!v || typeof v !== 'object') return null;
  const en = str(v.en);
  const ar = str(v.ar);
  return en && ar ? { en, ar } : null;
}

// GET /onboarding/options — the wizard's catalogue (thin client, I4): employee
// ranges, industries + their sub-industries, feature groups, and plan tiers.
router.get('/onboarding/options', (req, res) => {
  res.json({
    employeeRanges: EMPLOYEE_RANGES,
    industries: INDUSTRIES,
    featureGroups: FEATURE_GROUPS,
    plans: PLANS,
  });
});

// GET /onboarding/geocode?q=… — step-1 address helper. Proxies OpenStreetMap
// Nominatim server-side (its usage policy forbids calling it directly from a
// browser and requires a descriptive User-Agent + ~1 req/sec throttling) and
// returns only { match: { city, country } | null } — never the raw response.
let lastNominatimCallAt = 0;
const NOMINATIM_MIN_INTERVAL_MS = 1000;
// Nominatim's English country name for 'ps' is 'Palestinian Territories';
// the wizard's audience expects 'Palestine'.
const COUNTRY_NAME_OVERRIDES = { ps: 'Palestine' };

router.get('/onboarding/geocode', async (req, res) => {
  const q = str(req.query.q);
  if (q.length < 3) return res.json({ match: null });

  const wait = NOMINATIM_MIN_INTERVAL_MS - (Date.now() - lastNominatimCallAt);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastNominatimCallAt = Date.now();

  try {
    const url = `https://nominatim.openstreetmap.org/search?format=json&addressdetails=1&limit=1&accept-language=en&q=${encodeURIComponent(q)}`;
    const upstream = await fetch(url, {
      headers: { 'User-Agent': 'MonitorFlow-Onboarding/1.0 (student project; graduation onboarding wizard)' },
      signal: AbortSignal.timeout(5000),
    });
    if (!upstream.ok) return res.json({ match: null });
    const [place] = await upstream.json();
    const city = place?.address?.city || place?.address?.town || place?.address?.village;
    const countryCode = place?.address?.country_code;
    const country = COUNTRY_NAME_OVERRIDES[countryCode] || place?.address?.country;
    if (!city || !country) return res.json({ match: null });
    res.json({ match: { city, country } });
  } catch {
    res.json({ match: null });
  }
});

// PATCH /company/onboarding — "Customize your app in 1 minute" save. Validates
// every pick against the catalogue server-side (I8), writes the one company row
// + its branches in a single transaction, then flips onboarding_completed. Runs
// once: a second call after completion is 409.
router.patch('/company/onboarding', requireRole('admin'), async (req, res, next) => {
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
  // Step 5: the domain suffix for generated employee login emails
  // (ha.qanazi@<emailDomain> — lib/employeeEmail.js). Same shape a browser's
  // native <input type="email"> domain part accepts.
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(emailDomain)) {
    errors.emailDomain = 'Enter a valid domain, e.g. company.org';
  }
  if (!EMPLOYEE_RANGE_SET.has(b.employeeRange)) errors.employeeRange = 'Select a valid employee range';
  if (!INDUSTRY_KEYS.has(b.industry)) errors.industry = 'Select a valid industry';
  else if (!SUBS_BY_INDUSTRY.get(b.industry).has(b.subIndustry)) {
    errors.subIndustry = 'Select a valid sub-industry';
  }
  if (!phone) errors.phone = 'Phone number is required';

  const branches = (Array.isArray(b.branches) ? b.branches : []).map(bilingual);
  if (!branches.length || branches.some((br) => !br)) {
    errors.branches = 'Each branch needs a name in English and Arabic';
  }

  const features = Array.isArray(b.features) ? [...new Set(b.features)] : [];
  if (features.some((f) => !FEATURE_KEYS.has(f))) errors.features = 'Unknown feature selected';
  // At least one module: an empty set leaves the console with no Time Clock,
  // Schedule, Checklists, Knowledge Base or Events at all (requireFeature
  // blocks every module route), and clicking straight past step 4 used to be
  // enough to ship that.
  else if (!features.length) errors.features = 'Select at least one feature';

  if (!PLAN_KEYS.has(b.plan)) errors.plan = 'Select a valid plan';

  if (b.logoFileId != null && b.logoFileId !== '' && !UUID_RE.test(b.logoFileId)) {
    errors.logoFileId = 'Invalid logo reference';
  }

  if (Object.keys(errors).length) return res.status(422).json({ errors });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Lock the company row; refuse a re-run (onboarding is one-shot).
    const { rows: co } = await client.query(
      'SELECT id, onboarding_completed FROM company WHERE id = $1 FOR UPDATE',
      [req.user.company_id]
    );
    if (!co.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Not found' });
    }
    if (co[0].onboarding_completed) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Onboarding is already complete' });
    }

    // Optional logo: must be a parentless attachment this Owner uploaded (the
    // wizard POSTs it to /files first, then sends the id here).
    let logoFileId = null;
    if (b.logoFileId) {
      const { rows: fa } = await client.query(
        `SELECT id, mime_type FROM file_attachment
         WHERE id = $1 AND uploaded_by = $2
           AND request_id IS NULL AND task_id IS NULL AND time_entry_id IS NULL`,
        [b.logoFileId, req.user.id]
      );
      if (!fa.length) {
        await client.query('ROLLBACK');
        return res.status(422).json({ errors: { logoFileId: 'Unknown logo upload' } });
      }
      // routes/auth.js inlines this as a data URI into the console wordmark's
      // <img>, so a PDF (which the general /files allowlist accepts) would
      // render as a broken image with no way to replace it.
      if (!/^image\//.test(fa[0].mime_type)) {
        await client.query('ROLLBACK');
        return res.status(422).json({ errors: { logoFileId: 'The logo must be a PNG or JPEG image' } });
      }
      logoFileId = fa[0].id;
    }

    await client.query(
      `UPDATE company
         SET name=$1, address=$2, owner_job_title=$3, employee_range=$4, industry=$5,
             sub_industry=$6, features=$7, logo_file_id=$8, phone=$9,
             plan=$10, email_domain=$11, onboarding_completed=TRUE
       WHERE id=$12`,
      [
        JSON.stringify(name), JSON.stringify(address), JSON.stringify(ownerJobTitle),
        b.employeeRange, b.industry, b.subIndustry,
        features, logoFileId, phone, b.plan, emailDomain, req.user.company_id,
      ]
    );
    const branchIds = [];
    for (const branchName of branches) {
      const { rows } = await client.query(
        'INSERT INTO branch (company_id, name) VALUES ($1, $2) RETURNING id',
        [req.user.company_id, JSON.stringify(branchName)]
      );
      branchIds.push(rows[0].id);
    }
    // seed.js creates one starter department with no branch_id, and nothing
    // else connected it — so the branches the Owner just named appeared in no
    // UI at all until they hand-edited a department. Park any unassigned
    // department in the first branch; the Departments page can move it.
    await client.query('UPDATE department SET branch_id = $1 WHERE branch_id IS NULL', [branchIds[0]]);

    // Every other config action writes an audit row (§6); this is the largest
    // one in the product and wrote none.
    await logAudit(client, req.user.id, 'company.onboarded', 'company', req.user.company_id, {
      industry: b.industry,
      subIndustry: b.subIndustry,
      plan: b.plan,
      features,
      branchCount: branchIds.length,
    });
    await client.query('COMMIT');
    res.json({ onboardingCompleted: true });
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
});

module.exports = router;

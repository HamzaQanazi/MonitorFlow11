// The first-login onboarding wizard's backend (pivot v7). Two endpoints:
//   GET  /onboarding/options   — the static catalogue the wizard renders (I4)
//   PATCH /company/onboarding  — the Owner saves their picks; flips the flag
// Both authenticated; the save is admin-only (the Owner). Single-org: the one
// company is the caller's company_id.
const express = require('express');
const pool = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');
const {
  EMPLOYEE_RANGES,
  INDUSTRIES,
  FEATURE_GROUPS,
  INDUSTRY_KEYS,
  SUBS_BY_INDUSTRY,
  FEATURE_KEYS,
  EMPLOYEE_RANGE_SET,
} = require('../lib/onboardingOptions');

const router = express.Router();
router.use(requireAuth);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const str = (v) => (typeof v === 'string' ? v.trim() : '');

// GET /onboarding/options — the wizard's catalogue (thin client, I4): employee
// ranges, industries + their sub-industries, and the feature groups.
router.get('/onboarding/options', (req, res) => {
  res.json({ employeeRanges: EMPLOYEE_RANGES, industries: INDUSTRIES, featureGroups: FEATURE_GROUPS });
});

// PATCH /company/onboarding — "Customize your app in 1 minute" save. Validates
// every pick against the catalogue server-side (I8), writes the one company row
// + its branches in a single transaction, then flips onboarding_completed. Runs
// once: a second call after completion is 409.
router.patch('/company/onboarding', requireRole('admin'), async (req, res, next) => {
  const b = req.body || {};
  const errors = {};

  const name = str(b.name);
  const address = str(b.address);
  const ownerJobTitle = str(b.ownerJobTitle);
  const website = str(b.website);
  const phone = str(b.phone);

  if (!name) errors.name = 'Company name is required';
  if (!address) errors.address = 'Company address is required';
  if (!ownerJobTitle) errors.ownerJobTitle = 'Job title is required';
  if (!EMPLOYEE_RANGE_SET.has(b.employeeRange)) errors.employeeRange = 'Select a valid employee range';
  if (!INDUSTRY_KEYS.has(b.industry)) errors.industry = 'Select a valid industry';
  else if (!SUBS_BY_INDUSTRY.get(b.industry).has(b.subIndustry)) {
    errors.subIndustry = 'Select a valid sub-industry';
  }
  if (!phone) errors.phone = 'Phone number is required';

  const branches = Array.isArray(b.branches) ? b.branches.map(str).filter(Boolean) : [];
  if (!branches.length) errors.branches = 'At least one branch is required';

  const features = Array.isArray(b.features) ? [...new Set(b.features)] : [];
  if (features.some((f) => !FEATURE_KEYS.has(f))) errors.features = 'Unknown feature selected';

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
        `SELECT id FROM file_attachment
         WHERE id = $1 AND uploaded_by = $2 AND request_id IS NULL AND task_id IS NULL`,
        [b.logoFileId, req.user.id]
      );
      if (!fa.length) {
        await client.query('ROLLBACK');
        return res.status(422).json({ errors: { logoFileId: 'Unknown logo upload' } });
      }
      logoFileId = fa[0].id;
    }

    await client.query(
      `UPDATE company
         SET name=$1, address=$2, owner_job_title=$3, employee_range=$4, industry=$5,
             sub_industry=$6, features=$7, logo_file_id=$8, website=$9, phone=$10,
             onboarding_completed=TRUE
       WHERE id=$11`,
      [
        name, address, ownerJobTitle, b.employeeRange, b.industry, b.subIndustry,
        features, logoFileId, website || null, phone, req.user.company_id,
      ]
    );
    for (const branchName of branches) {
      await client.query('INSERT INTO branch (company_id, name) VALUES ($1, $2)', [
        req.user.company_id,
        branchName,
      ]);
    }
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

// POST /translate — bilingual auto-fill assist (CLAUDE.md §13, 2026-08-21
// exception; §2 I5). Suggests the other language for a {en,ar} field pair the
// caller is authoring, from whichever side they already typed. A UX shortcut
// only, never authoritative: the caller reviews/edits the suggestion before
// it's saved anywhere, and whichever endpoint actually persists the field
// (services.js, knowledgeBase.js, events.js, company/onboarding, …) still
// validates both languages are present itself (I5, I8) exactly as before —
// this route has no write path of its own. Same authoring population as
// those endpoints' write sides: any admin/employee, not gated by a specific
// capability, since translating text has no side effect; the real save is
// what enforces who may actually author that content.
const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { translateText } = require('../lib/translate');

const router = express.Router();
router.use(requireAuth);

const MAX_LEN = 2000;

router.post('/', async (req, res, next) => {
  try {
    if (req.user.role === 'user') return res.status(403).json({ error: 'Forbidden' });

    const text = typeof req.body?.text === 'string' ? req.body.text.trim() : '';
    const target = req.body?.target;
    const errors = {};
    if (!text) errors.text = 'Text is required';
    else if (text.length > MAX_LEN) errors.text = `Must be ${MAX_LEN} characters or fewer`;
    if (target !== 'en' && target !== 'ar') errors.target = "Must be 'en' or 'ar'";
    if (Object.keys(errors).length) return res.status(422).json({ errors });

    const translation = await translateText(text, target);
    res.json({ translation });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});

module.exports = router;

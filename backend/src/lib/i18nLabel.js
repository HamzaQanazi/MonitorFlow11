// Bilingual label helper (Phase 3). Every user-facing label is stored as
// {en, ar}; clients render label[locale]. `pick` resolves one language for the
// places that must emit a plain string server-side — notification/escalation
// messages, CSV cells, and generated form-validation errors. Those stay
// single-language (English default) by design; making runtime-generated
// messages bilingual is deferred to the Phase 5 notification rework.

const LANGS = ['en', 'ar'];

// True only for a plain object carrying a non-empty string for every language.
const isBilingual = (v) =>
  v && typeof v === 'object' && !Array.isArray(v) &&
  LANGS.every((l) => typeof v[l] === 'string' && v[l].length > 0);

// Resolve a label to one language. Defensive: passes through anything that is
// already a plain string (legacy rows, keys) so callers never crash.
const pick = (label, lang = 'en') =>
  label && typeof label === 'object' ? (label[lang] ?? label.en) : label;

module.exports = { LANGS, isBilingual, pick };

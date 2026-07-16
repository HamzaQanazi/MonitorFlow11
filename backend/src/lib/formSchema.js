// Seed-time validation for FORM_DEFINITION.field_schema (CLAUDE.md Section 8).
// The API trusts stored schemas, so everything here must hold before insert.

const { isBilingual } = require('./i18nLabel');

const FIELD_TYPES = ['text', 'multiline', 'number', 'date', 'dropdown', 'radio', 'checkbox', 'photo', 'location'];
const OPTION_TYPES = ['dropdown', 'radio'];
const BOUNDED_TYPES = ['number', 'text', 'multiline'];

// Returns an array of human-readable problems; empty array means valid.
function validateFieldSchema(fields) {
  if (!Array.isArray(fields) || fields.length === 0) {
    return ['field_schema must be a non-empty array'];
  }

  const errors = [];
  const seenIds = new Set();
  let locationFieldSeen = false;

  fields.forEach((field, i) => {
    const at = `field[${i}]${field && field.id ? ` "${field.id}"` : ''}`;
    if (!field || typeof field !== 'object' || Array.isArray(field)) {
      errors.push(`${at}: must be an object`);
      return;
    }

    if (!field.id || typeof field.id !== 'string') {
      errors.push(`${at}: id must be a non-empty string`);
    } else if (seenIds.has(field.id)) {
      errors.push(`${at}: duplicate field id`);
    } else {
      seenIds.add(field.id);
    }

    if (!isBilingual(field.label)) {
      errors.push(`${at}: label must be a {en, ar} object with both languages`);
    }

    if (!FIELD_TYPES.includes(field.type)) {
      errors.push(`${at}: invalid type "${field.type}"`);
      return; // remaining checks depend on a known type
    }

    if (field.type === 'location') {
      if (locationFieldSeen) {
        errors.push(`${at}: at most one location field per form`);
      }
      locationFieldSeen = true;
    }

    if (OPTION_TYPES.includes(field.type)) {
      if (!Array.isArray(field.options) || field.options.length === 0) {
        errors.push(`${at}: options are required for type "${field.type}"`);
      } else {
        field.options.forEach((opt, j) => {
          if (!opt || typeof opt.value !== 'string' || !isBilingual(opt.label)) {
            errors.push(`${at}: options[${j}] must have string "value" and {en, ar} "label"`);
          }
        });
      }
    } else if ('options' in field) {
      errors.push(`${at}: options are forbidden for type "${field.type}"`);
    }

    for (const bound of ['min', 'max']) {
      if (bound in field) {
        if (typeof field[bound] !== 'number') {
          errors.push(`${at}: ${bound} must be a number`);
        } else if (!BOUNDED_TYPES.includes(field.type)) {
          errors.push(`${at}: ${bound} is not allowed for type "${field.type}"`);
        }
      }
    }
    if (typeof field.min === 'number' && typeof field.max === 'number' && field.min > field.max) {
      errors.push(`${at}: min must be <= max`);
    }

    for (const flag of ['required', 'visible_to_employee']) {
      if (flag in field && typeof field[flag] !== 'boolean') {
        errors.push(`${at}: ${flag} must be a boolean`);
      }
    }
  });

  return errors;
}

module.exports = { validateFieldSchema, FIELD_TYPES };

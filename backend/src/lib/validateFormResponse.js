// Runtime validation of a form_response / completion_form_response against a
// stored FORM_DEFINITION.field_schema (CLAUDE.md Section 8). One generic
// function drives every seeded service type. Messages are generated from the
// field label — custom validation messages are deliberately out of scope.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isMissing(value) {
  return value === undefined || value === null || value === '';
}

function isValidDate(value) {
  if (!DATE_RE.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

// Returns an object of errors keyed by field id (or the offending unknown
// key). Empty object means valid. `db` needs only .query() — pass the
// transaction client when validating inside one.
async function validateFormResponse(fields, response, { db, userId }) {
  if (!response || typeof response !== 'object' || Array.isArray(response)) {
    return { _form: 'Form response must be an object' };
  }

  const errors = {};
  const knownIds = new Set(fields.map((f) => f.id));
  for (const key of Object.keys(response)) {
    if (!knownIds.has(key)) errors[key] = 'Unknown field';
  }

  const photoChecks = [];

  for (const field of fields) {
    const value = response[field.id];

    if (isMissing(value)) {
      if (field.required) errors[field.id] = `${field.label} is required`;
      continue;
    }

    switch (field.type) {
      case 'text':
      case 'multiline':
        if (typeof value !== 'string') {
          errors[field.id] = `${field.label} must be text`;
        } else if (typeof field.min === 'number' && value.length < field.min) {
          errors[field.id] = `${field.label} must be at least ${field.min} characters`;
        } else if (typeof field.max === 'number' && value.length > field.max) {
          errors[field.id] = `${field.label} must be at most ${field.max} characters`;
        }
        break;

      case 'number':
        if (typeof value !== 'number' || !Number.isFinite(value)) {
          errors[field.id] = `${field.label} must be a number`;
        } else if (typeof field.min === 'number' && value < field.min) {
          errors[field.id] = `${field.label} must be at least ${field.min}`;
        } else if (typeof field.max === 'number' && value > field.max) {
          errors[field.id] = `${field.label} must be at most ${field.max}`;
        }
        break;

      case 'date':
        if (typeof value !== 'string' || !isValidDate(value)) {
          errors[field.id] = `${field.label} must be a valid date (YYYY-MM-DD)`;
        }
        break;

      case 'dropdown':
      case 'radio':
        if (!field.options.some((opt) => opt.value === value)) {
          errors[field.id] = `${field.label} must be one of the listed options`;
        }
        break;

      case 'checkbox':
        if (typeof value !== 'boolean') {
          errors[field.id] = `${field.label} must be true or false`;
        }
        break;

      case 'photo':
        if (typeof value !== 'string' || !UUID_RE.test(value)) {
          errors[field.id] = `${field.label} must be an uploaded attachment id`;
        } else {
          photoChecks.push(field);
        }
        break;

      default:
        // Seed-time validation makes this unreachable for stored schemas.
        errors[field.id] = `${field.label} has an unsupported field type`;
    }
  }

  for (const field of photoChecks) {
    const { rows } = await db.query(
      'SELECT uploaded_by FROM file_attachment WHERE id = $1',
      [response[field.id]]
    );
    if (!rows.length || rows[0].uploaded_by !== userId) {
      errors[field.id] = `${field.label} must be an uploaded attachment id`;
    }
  }

  return errors;
}

module.exports = { validateFormResponse };

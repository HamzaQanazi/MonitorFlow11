// Seed-time validation for WORKFLOW_DEFINITION (CLAUDE.md Sections 8 + 9.1).
// Enforced before insert; the workflow engine then trusts stored definitions.

const { isBilingual } = require('./i18nLabel');

const CATEGORIES = ['new', 'triage', 'in_progress', 'done', 'closed', 'terminated'];
const ACTIONS = ['accept', 'reject', 'complete', 'confirm', 'dispute'];
const ROLES = ['user', 'employee', 'monitor'];

// Returns an array of human-readable problems; empty array means valid.
function validateWorkflowDefinition({ statuses, transitions }) {
  const errors = [];

  if (!Array.isArray(statuses) || statuses.length === 0) {
    errors.push('statuses must be a non-empty array');
  }
  if (!Array.isArray(transitions) || transitions.length === 0) {
    errors.push('transitions must be a non-empty array');
  }
  if (errors.length) return errors;

  const keys = new Set();
  let initialCount = 0;
  let finalCount = 0;

  statuses.forEach((status, i) => {
    const at = `statuses[${i}]${status && status.key ? ` "${status.key}"` : ''}`;
    if (!status || typeof status !== 'object') {
      errors.push(`${at}: must be an object`);
      return;
    }
    if (!status.key || typeof status.key !== 'string') {
      errors.push(`${at}: key must be a non-empty string`);
    } else if (keys.has(status.key)) {
      errors.push(`${at}: duplicate status key`);
    } else {
      keys.add(status.key);
    }
    if (!isBilingual(status.label)) {
      errors.push(`${at}: label must be a {en, ar} object with both languages`);
    }
    if (!CATEGORIES.includes(status.category)) {
      errors.push(`${at}: invalid category "${status.category}"`);
    }
    for (const flag of ['is_initial', 'is_final']) {
      if (typeof status[flag] !== 'boolean') {
        errors.push(`${at}: ${flag} must be a boolean`);
      }
    }
    if (status.is_initial === true) initialCount += 1;
    if (status.is_final === true) finalCount += 1;
  });

  if (initialCount !== 1) {
    errors.push(`workflow must have exactly one is_initial status (found ${initialCount})`);
  }
  if (finalCount < 1) {
    errors.push('workflow must have at least one is_final status');
  }

  const seenActions = new Set();

  transitions.forEach((tr, i) => {
    const at = `transitions[${i}]${tr && tr.from && tr.to ? ` ${tr.from}->${tr.to}` : ''}`;
    if (!tr || typeof tr !== 'object') {
      errors.push(`${at}: must be an object`);
      return;
    }
    for (const end of ['from', 'to']) {
      if (!tr[end] || typeof tr[end] !== 'string') {
        errors.push(`${at}: ${end} must be a non-empty string`);
      } else if (!keys.has(tr[end])) {
        errors.push(`${at}: ${end} status "${tr[end]}" does not exist in statuses`);
      }
    }
    if (!ROLES.includes(tr.allowed_role)) {
      errors.push(`${at}: invalid allowed_role "${tr.allowed_role}"`);
    }
    if (tr.action !== null) {
      if (!ACTIONS.includes(tr.action)) {
        errors.push(`${at}: invalid action "${tr.action}"`);
      } else if (seenActions.has(tr.action)) {
        errors.push(`${at}: action "${tr.action}" appears more than once in this workflow`);
      } else {
        seenActions.add(tr.action);
      }
    }
    for (const flag of ['requires_note', 'requires_completion_form']) {
      if (typeof tr[flag] !== 'boolean') {
        errors.push(`${at}: ${flag} must be a boolean`);
      }
    }
  });

  return errors;
}

module.exports = { validateWorkflowDefinition, CATEGORIES, ACTIONS, ROLES };

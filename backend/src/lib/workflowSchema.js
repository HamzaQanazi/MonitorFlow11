// Seed-time validation for WORKFLOW_DEFINITION (CLAUDE.md Sections 8 + 9.1,
// Phase 4 model §10). Enforced before insert; the workflow engine then trusts
// stored definitions.
//
// Phase 4 shape: statuses carry `is_terminal` (category is gone); transitions
// are keyed and gated by exactly one of `required_capability` (oversight, Gate
// 1) or `actor` (the party whose turn it is). `required_form_key` replaces
// `requires_completion_form`; `action` is retired (the transition `key` binds
// the client, not a hardcoded action name).

const { isBilingual } = require('./i18nLabel');
const { CAPABILITIES } = require('./capabilities');

const ACTORS = ['requester', 'assignee'];

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
  const terminalKeys = new Set();
  let initialCount = 0;
  let terminalCount = 0;

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
    for (const flag of ['is_initial', 'is_terminal']) {
      if (typeof status[flag] !== 'boolean') {
        errors.push(`${at}: ${flag} must be a boolean`);
      }
    }
    if (status.is_initial === true) initialCount += 1;
    if (status.is_terminal === true) {
      terminalCount += 1;
      terminalKeys.add(status.key);
    }
  });

  if (initialCount !== 1) {
    errors.push(`workflow must have exactly one is_initial status (found ${initialCount})`);
  }
  if (terminalCount < 1) {
    errors.push('workflow must have at least one is_terminal status');
  }

  const seenTransitionKeys = new Set();

  transitions.forEach((tr, i) => {
    const at = `transitions[${i}]${tr && tr.key ? ` "${tr.key}"` : ''}`;
    if (!tr || typeof tr !== 'object') {
      errors.push(`${at}: must be an object`);
      return;
    }
    if (!tr.key || typeof tr.key !== 'string') {
      errors.push(`${at}: key must be a non-empty string`);
    } else if (seenTransitionKeys.has(tr.key)) {
      errors.push(`${at}: duplicate transition key`);
    } else {
      seenTransitionKeys.add(tr.key);
    }
    for (const end of ['from', 'to']) {
      if (!tr[end] || typeof tr[end] !== 'string') {
        errors.push(`${at}: ${end} must be a non-empty string`);
      } else if (!keys.has(tr[end])) {
        errors.push(`${at}: ${end} status "${tr[end]}" does not exist in statuses`);
      }
    }
    // A terminal status is final — nothing transitions out of it (this is
    // what makes is_terminal the task lock, §5).
    if (terminalKeys.has(tr.from)) {
      errors.push(`${at}: cannot transition out of terminal status "${tr.from}"`);
    }
    if (!isBilingual(tr.label)) {
      errors.push(`${at}: label must be a {en, ar} object with both languages`);
    }
    // Gate model: exactly one of required_capability / actor is set. A
    // capability-gated transition is oversight (actor null); an actor-gated
    // transition is the requester's or assignee's turn (capability null).
    const hasCap = tr.required_capability !== null && tr.required_capability !== undefined;
    const hasActor = tr.actor !== null && tr.actor !== undefined;
    if (hasCap === hasActor) {
      errors.push(`${at}: set exactly one of required_capability or actor`);
    }
    if (hasCap && !CAPABILITIES.includes(tr.required_capability)) {
      errors.push(`${at}: invalid required_capability "${tr.required_capability}"`);
    }
    if (hasActor && !ACTORS.includes(tr.actor)) {
      errors.push(`${at}: invalid actor "${tr.actor}"`);
    }
    if (
      tr.required_form_key !== null &&
      tr.required_form_key !== undefined &&
      (typeof tr.required_form_key !== 'string' || !tr.required_form_key)
    ) {
      errors.push(`${at}: required_form_key must be null or a non-empty string`);
    }
    if (typeof tr.requires_note !== 'boolean') {
      errors.push(`${at}: requires_note must be a boolean`);
    }
  });

  return errors;
}

module.exports = { validateWorkflowDefinition, ACTORS };

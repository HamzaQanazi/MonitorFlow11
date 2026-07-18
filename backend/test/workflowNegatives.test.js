// Workflow-engine must-pass negatives (CLAUDE.md §14).
//
// The engine is the one module allowed to write request.status / task.status,
// so its refusals are the load-bearing ones: an illegal transition, the wrong
// party, a locked terminal request, a stale write, a race.
//
// Nothing here hardcodes a status key. Every case is derived from the stored
// WORKFLOW_DEFINITION at runtime — which is also the thesis: the tests work
// against any seeded sector, not just this one.
const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const { setup, stopServer, api, login, loginAll, submitRequest, SEED_PASSWORD } = require('../testlib/harness');

let tok;
let requests = [];        // every request, as the org root sees them
const workflows = {};     // serviceTypeId -> { statuses, transitions }

const statusOf = (wf, key) => wf.statuses.find((s) => s.key === key);
const isTerminal = (wf, key) => !!statusOf(wf, key)?.is_terminal;
const wfOf = (r) => workflows[r.serviceTypeId];

// Requests are consumed destructively (assigning, overriding, locking), so
// each test takes a distinct one rather than sharing state.
const used = new Set();
function claim(pred, why) {
  const found = requests.find((r) => !used.has(r.id) && pred(r));
  assert.ok(found, `seed provides a request where: ${why}`);
  used.add(found.id);
  return found;
}

// A request the REQUESTER can actually act on right now, plus that transition.
// `/requests/{id}/transitions` returns actor-gated transitions for the caller's
// party only — the org root is neither requester nor assignee, so it always
// gets an empty list. Asserts rather than skipping, so this can never pass
// vacuously.
async function claimActionable() {
  for (const r of requests) {
    if (used.has(r.id) || isTerminal(wfOf(r), r.status.key)) continue;
    const legal = await api('GET', `/requests/${r.id}/transitions`, { token: tok.resident });
    if (legal.status === 200 && legal.body.transitions.length) {
      used.add(r.id);
      return { r, t: legal.body.transitions[0] };
    }
  }
  assert.fail('seed has a request the requester can act on');
}

before(async () => {
  await setup('workflow');
  tok = await loginAll();

  const list = await api('GET', '/requests?pageSize=100', { token: tok.root });
  assert.equal(list.status, 200);
  requests = list.body.requests;
  assert.ok(requests.length > 5, 'seed has a workable queue');

  for (const id of new Set(requests.map((r) => r.serviceTypeId))) {
    const wf = await api('GET', `/services/${id}/workflow`, { token: tok.root });
    assert.equal(wf.status, 200);
    workflows[id] = { statuses: wf.body.statuses, transitions: wf.body.transitions };
  }
});

after(() => stopServer());

describe('oversight override', () => {
  test('a target status that is not in the workflow is 422', async () => {
    const r = claim((x) => !isTerminal(wfOf(x), x.status.key), 'still open');
    const res = await api('PATCH', `/requests/${r.id}/status`, {
      token: tok.root,
      body: { to: 'no_such_status_in_any_workflow', note: 'test' },
    });
    assert.equal(res.status, 422, 'override target must exist in the workflow');
  });

  test('an override without a note is 422', async () => {
    const r = claim((x) => !isTerminal(wfOf(x), x.status.key), 'still open');
    const wf = wfOf(r);
    const target = wf.statuses.find((s) => s.key !== r.status.key && !s.is_initial);
    const res = await api('PATCH', `/requests/${r.id}/status`, {
      token: tok.root,
      body: { to: target.key },
    });
    assert.equal(res.status, 422, 'an override is auditable only with a note');
  });

  test('overriding to the status it is already in is 409', async () => {
    // Must not be sitting in the INITIAL status: overriding back to the initial
    // status is refused by a different rule (422), which would mask this one.
    const r = claim(
      (x) => !isTerminal(wfOf(x), x.status.key) && !statusOf(wfOf(x), x.status.key).is_initial,
      'open and past the initial status'
    );
    const res = await api('PATCH', `/requests/${r.id}/status`, {
      token: tok.root,
      body: { to: r.status.key, note: 'no-op' },
    });
    assert.equal(res.status, 409);
  });

  test('overriding back to the initial status is 422', async () => {
    const r = claim((x) => !isTerminal(wfOf(x), x.status.key), 'still open');
    const initial = wfOf(r).statuses.find((s) => s.is_initial);
    const res = await api('PATCH', `/requests/${r.id}/status`, {
      token: tok.root,
      body: { to: initial.key, note: 'rewind' },
    });
    assert.equal(res.status, 422, 'a request cannot be pushed back to the start');
  });
});

describe('transitions', () => {
  test('a transition that is not legal from the current status is 409', async () => {
    // Picked from the workflow, not from the caller's valid list — so this is
    // a real "exists, but not from here" rejection rather than an unknown key.
    const r = claim((x) => !isTerminal(wfOf(x), x.status.key), 'still open');
    const wf = wfOf(r);
    const legal = await api('GET', `/requests/${r.id}/transitions`, { token: tok.root });
    assert.equal(legal.status, 200);
    const legalKeys = new Set(legal.body.transitions.map((t) => t.key));

    const illegal = wf.transitions.find((t) => t.from !== r.status.key && !legalKeys.has(t.key));
    assert.ok(illegal, 'workflow has a transition that does not start here');

    const res = await api('POST', `/requests/${r.id}/transitions`, {
      token: tok.root,
      body: { transition_key: illegal.key, note: 'test' },
    });
    assert.equal(res.status, 409, 'legal key, wrong originating status');
  });

  test('an unknown transition key never reaches the engine', async () => {
    const r = claim(() => true, 'any request');
    const res = await api('POST', `/requests/${r.id}/transitions`, {
      token: tok.root,
      body: { transition_key: 'not_a_transition' },
    });
    assert.ok([409, 422].includes(res.status), `expected 409/422, got ${res.status}`);
  });

  test('a missing transition key is 422', async () => {
    const r = claim(() => true, 'any request');
    const res = await api('POST', `/requests/${r.id}/transitions`, {
      token: tok.root,
      body: {},
    });
    assert.equal(res.status, 422);
  });

  test('the wrong party is refused even when the transition is legal here', async () => {
    // An assignee-gated transition, fired by the requester. The engine decides
    // on `actor`, so this must fail regardless of who owns the request.
    let target = null;
    for (const r of requests) {
      const wf = wfOf(r);
      if (isTerminal(wf, r.status.key)) continue;
      const t = wf.transitions.find((x) => x.from === r.status.key && x.actor === 'assignee');
      if (t) {
        target = { r, t };
        break;
      }
    }
    assert.ok(target, 'seed has a request sitting on an assignee-gated transition');

    const res = await api('POST', `/requests/${target.r.id}/transitions`, {
      token: tok.resident,
      body: { transition_key: target.t.key, note: 'test' },
    });
    assert.ok([403, 404].includes(res.status), `requester on an assignee transition: ${res.status}`);
  });

  test('a stale expected_status loses (optimistic concurrency)', async () => {
    const { r, t } = await claimActionable();
    const other = wfOf(r).statuses.find((s) => s.key !== r.status.key);

    const res = await api('POST', `/requests/${r.id}/transitions`, {
      token: tok.resident,
      body: { transition_key: t.key, expected_status: other.key, note: 'test' },
    });
    assert.equal(res.status, 409, 'the caller was looking at a stale status');
  });

  test('two identical concurrent fires: exactly one wins', async () => {
    const { r, t } = await claimActionable();

    const fire = () =>
      api('POST', `/requests/${r.id}/transitions`, {
        token: tok.resident,
        body: { transition_key: t.key, note: 'race' },
      });
    const [a, b] = await Promise.all([fire(), fire()]);
    const codes = [a.status, b.status].sort();

    // The row lock serialises them; the loser finds the status already moved.
    assert.equal(codes.filter((c) => c === 200).length, 1, `exactly one 200, got ${codes}`);
    assert.equal(codes.filter((c) => c === 409).length, 1, `exactly one 409, got ${codes}`);
  });
});

describe('assignment', () => {
  let ziadId;
  let samiId;

  before(async () => {
    const staff = await api('GET', '/employees?pageSize=100', { token: tok.root });
    ziadId = staff.body.employees.find((e) => e.loginIdentifier === '1101').id;
    samiId = staff.body.employees.find((e) => e.loginIdentifier === '1201').id;
  });

  // Most seeded requests already carry a task, so these claim any open request
  // and drive it to a known assignee first rather than hunting for an
  // unassigned one.
  const openRequest = (why) => claim((x) => !isTerminal(wfOf(x), x.status.key), why);

  test('assigning the same employee twice is 409', async () => {
    const r = openRequest('still open');
    const first = await api('PATCH', `/requests/${r.id}/assign`, {
      token: tok.root,
      body: { employeeId: ziadId },
    });
    assert.equal(first.status, 200);

    const again = await api('PATCH', `/requests/${r.id}/assign`, {
      token: tok.root,
      body: { employeeId: ziadId },
    });
    assert.equal(again.status, 409, 'a duplicate assignment is a no-op conflict');
  });

  test('reassigning to a different employee is allowed', async () => {
    const r = openRequest('still open');
    const first = await api('PATCH', `/requests/${r.id}/assign`, {
      token: tok.root,
      body: { employeeId: ziadId },
    });
    assert.equal(first.status, 200);

    const moved = await api('PATCH', `/requests/${r.id}/assign`, {
      token: tok.root,
      body: { employeeId: samiId },
    });
    assert.equal(moved.status, 200, 'reassignment updates the one task row in place');
  });

  test('an employee holding an open task cannot be deactivated', async () => {
    const r = openRequest('still open');
    // Some seeded requests already sit with one of these two, and re-assigning
    // the same person is a 409 — so move it to whoever is not holding it.
    const holder = r.assignedEmployee ? r.assignedEmployee.id : null;
    const target = holder === ziadId ? samiId : ziadId;

    const assigned = await api('PATCH', `/requests/${r.id}/assign`, {
      token: tok.root,
      body: { employeeId: target },
    });
    assert.equal(assigned.status, 200);

    const off = await api('PATCH', `/employees/${target}/deactivate`, { token: tok.root });
    assert.equal(off.status, 409, 'reassign first, then deactivate');
  });
});

describe('cancel racing assign', () => {
  test('one wins, the other gets 409 — never both', async () => {
    // The dangerous interleave: the requester cancels while an overseer is
    // dispatching the same request. Both paths go through executeTransition,
    // which locks the REQUEST row first, so the loser re-reads a status its
    // transition no longer starts from.
    const staff = await api('GET', '/employees?pageSize=100', { token: tok.root });
    const assignee = staff.body.employees.find((e) => e.loginIdentifier === '1101');

    // Needs a status offering BOTH a requester-actor transition and an
    // assign-capability one — otherwise there is no race to lose. A fresh
    // submission puts the request in a known initial status; the seeded queue
    // has been moved on by the tests above.
    let target = null;
    for (const [serviceTypeId, wf] of Object.entries(workflows)) {
      const initial = wf.statuses.find((s) => s.is_initial);
      const here = wf.transitions.filter((t) => t.from === initial.key);
      const cancel = here.find((t) => t.actor === 'requester');
      if (cancel && here.some((t) => t.required_capability === 'assign')) {
        target = { cancel, r: await submitRequest(tok.resident, Number(serviceTypeId)) };
        break;
      }
    }
    assert.ok(target, 'a seeded workflow is both cancellable and assignable at its start');

    const [cancelled, assigned] = await Promise.all([
      api('POST', `/requests/${target.r.id}/transitions`, {
        token: tok.resident,
        body: { transition_key: target.cancel.key, note: 'race' },
      }),
      api('PATCH', `/requests/${target.r.id}/assign`, {
        token: tok.root,
        body: { employeeId: assignee.id },
      }),
    ]);

    const codes = [cancelled.status, assigned.status];
    assert.equal(codes.filter((c) => c === 200).length, 1, `exactly one winner, got ${codes}`);
    assert.equal(codes.filter((c) => c === 409).length, 1, `the loser must be 409, got ${codes}`);

    // Whoever won, the stored status is one of the two targets and nothing in
    // between — the row lock left no torn state.
    const after = await api('GET', `/requests/${target.r.id}`, { token: tok.root });
    assert.equal(after.status, 200);
    const reachable = wfOf(target.r)
      .transitions.filter((t) => t.from === target.r.status.key)
      .map((t) => t.to);
    assert.ok(
      reachable.includes(after.body.request.status.key),
      'status moved exactly one legal step'
    );
  });
});

describe('terminal requests are locked', () => {
  test('no transition fires once the request is terminal', async () => {
    const r = claim((x) => !isTerminal(wfOf(x), x.status.key), 'still open');
    const wf = wfOf(r);
    const terminal = wf.statuses.find((s) => s.is_terminal);

    const closed = await api('PATCH', `/requests/${r.id}/status`, {
      token: tok.root,
      body: { to: terminal.key, note: 'closing for the lock test' },
    });
    assert.equal(closed.status, 200);

    const after = await api('GET', `/requests/${r.id}/transitions`, { token: tok.root });
    assert.equal(after.status, 200);
    assert.equal(after.body.transitions.length, 0, 'a terminal request offers no transitions');

    // And firing one anyway is refused by the engine, not just hidden in the UI.
    const any = wf.transitions[0];
    const res = await api('POST', `/requests/${r.id}/transitions`, {
      token: tok.root,
      body: { transition_key: any.key, note: 'should not apply' },
    });
    assert.equal(res.status, 409);
  });
});

describe('deactivated accounts', () => {
  test('an already-issued token stops working at validation', async () => {
    // A brand-new hire, so this cannot collide with the seed's open tasks (the
    // deactivate guard would 409 instead). The point is that the JWT stays
    // cryptographically valid while the account behind it does not.
    const email = `temp.hire.${Date.now()}@example.test`;
    const created = await api('POST', '/employees', {
      token: tok.root,
      body: { name: 'Temp Hire', email, password: SEED_PASSWORD },
    });
    assert.equal(created.status, 201);
    const { id, loginIdentifier } = created.body.employee;

    const theirToken = await login(loginIdentifier);
    const ok = await api('GET', '/tasks', { token: theirToken });
    assert.equal(ok.status, 200, 'token works while the account is active');

    const off = await api('PATCH', `/employees/${id}/deactivate`, { token: tok.root });
    assert.equal(off.status, 200, 'no open tasks, so deactivation is allowed');

    const after = await api('GET', '/tasks', { token: theirToken });
    assert.equal(after.status, 401, 'deactivation is enforced at JWT validation, not only at login');
  });
});

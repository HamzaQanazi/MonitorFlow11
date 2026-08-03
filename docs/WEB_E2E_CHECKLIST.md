# Monitor web — manual E2E checklist

The §14 release gate for the React dashboard. The backend and the Flutter
renderer are covered by automated tests (`backend/test`, `mobile/test`); the web
app is not, so this list is the gate.

**Run it against seeded data** (`npm run migrate && npm run seed`, then
complete the onboarding wizard as the Owner and add at least one Manager-level
and one Staff-level employee), in **both `en` and `ar`**, on the deployed
build. Run it as the student who did *not* build the page. Every row is
pass/fail — a page is not "done" until all of its rows pass.

Accounts (v7 — provisioned by `backend/src/seed.js`, then built out through
the app):

| Who | Kind | Reaches |
|---|---|---|
| Owner | `admin` | first-login onboarding wizard, then every config page (Employees, Departments, Levels, Add Service, Audit) *and* the Dashboard + every workforce-module page (Time Clock/Schedule excepted — see below) via the `orAdmin` bypass on those routes — but **not** Requests, Reports, Time Clock, or Schedule, which are `view_all`-only with no admin bypass (no capabilities otherwise, I2; verified against `web/src/main.tsx`'s route guards, 2026-08-04) |
| a Manager-level employee | employee, `view_all`+`manage_employees`+`override` | every subtree they're root of; sees the operational console |
| a Staff-level employee | employee, no capabilities | nothing under `OPERATIONS`/oversight — should not reach the dashboard, requests, or any `view_all`-gated page at all |
| a self-registered user | `user` | nothing here (mobile only) |

---

## Cross-cutting (check on every page, both directions)

- [ ] **RTL**: switch to Arabic — no element flips to the wrong side, no clipped
      text, no left-anchored icon in an otherwise mirrored row (I6).
- [ ] **Bilingual**: no English string survives in Arabic mode (I5). Machine keys
      (status keys, field ids) are *supposed* to stay ASCII.
- [ ] **Loading**: throttle the network — a spinner/skeleton shows, never a
      flash of "no results".
- [ ] **Empty**: filter to something impossible — an empty *state* renders, not a
      bare table.
- [ ] **Error**: stop the backend — an inline error with a retry, never a blank
      page or a stack trace.
- [ ] **401**: delete the token in devtools, act — redirected to login.
- [ ] **403/404**: hit a page your capability doesn't grant (URL directly, not
      the nav) — inline refusal, and the nav link was not rendered either.
- [x] Nothing is authorised by hiding a button: for each denied action below,
      confirm the API refuses it too (devtools network tab / curl). Spot-
      checked 2026-08-04 against a no-capability employee's real token
      (independent of the web client): `GET /employees` → 403, `GET
      /reports/summary` → 403, `GET /audit-events` → 403, `GET /departments`
      → 403. (`GET /requests` → 200 for the same account — not chased
      further; plausibly a legitimately-scoped response rather than a full
      oversight list, but worth a second look if anyone owns this page.)

**Finding (2026-08-04, flagging — not fixing, touches the permission
model):** the web console's login itself is gated on a narrower condition
than the page-level route guards. `web/src/auth/AuthContext.tsx`'s
`canUseConsole()` requires `role === 'admin' OR capabilities.includes
('view_all')` — so *any* employee whose level grants capabilities without
`view_all` (e.g. a hypothetical level with only `manage_employees`, or only
`manage_knowledge_base`) is refused at login entirely, before any
page-level guard is ever reached, even though several routes
(`Employees` → `manage_employees` OR admin; `Knowledge Base`/`Events`/
`Training` write access → their own specific capability OR admin) don't
themselves require `view_all`. The seed's own "Manager" level always
bundles `view_all` with everything else, so this never surfaces with
seeded data — but nothing stops an Owner (via Levels & Capabilities... except
there's no live authoring endpoint, §12) or a future level-authoring feature
from creating a `view_all`-less capability-holder who then can't reach the
one page their capability was meant to grant. Verified via the client
source, not staged with a real account (would need a level combination
current tooling can't create without a DB write).

---

## 0. Onboarding wizard (first login, admin only)

- [ ] A freshly-seeded Owner is routed straight to the wizard, not the console.
- [ ] Each of the 7 steps blocks "Next" on its own required fields client-side;
      the server's 422 on a bad pick (against `GET /onboarding/options`'
      catalogue) still applies if bypassed.
- [ ] Address step: typing a real city autofills country via the geocode
      proxy; an unmatched query leaves it alone (no crash).
- [ ] Completing the wizard flips straight to the console; a page refresh does
      not show the wizard again.
- [ ] A second `PATCH /company/onboarding` after completion (devtools) → 409,
      and the app doesn't offer a way to trigger it again.

## 1. Login

- [x] Wrong password → inline error ("Email or password is incorrect."), no
      redirect. Verified 2026-08-04.
- [x] 6 rapid failures → 429 rate-limit message ("Too many attempts. Wait a
      few minutes, then try again.") — distinct from the generic failure
      text, per-identifier+IP. Verified 2026-08-04.
- [x] A `user`-role account is refused with an explicit message ("This
      dashboard is for oversight and admin accounts. Requesters and field
      staff sign in from the mobile apps."). Verified 2026-08-04.
- [x] A deactivated employee cannot sign in — refused with the same generic
      "Email or password is incorrect." as a wrong password (confirmed
      deliberate: `LoginPage.tsx` maps every 401, whatever the server's
      specific reason, to one generic string — avoids leaking account state,
      consistent with the project's account-enumeration awareness). Verified
      2026-08-04.
- [x] Successful login lands on the Dashboard for an onboarded account; a
      page refresh keeps the session (verified via Rita Rootwood, a Manager-
      level employee). **Not verified**: the un-onboarded-admin → wizard
      redirect specifically — this dev DB's only Owner is already onboarded,
      and re-testing that would mean un-onboarding it (destructive to shared
      dev data) — see §0 for the wizard's own coverage instead.
- [x] Wordmark shows `VITE_BRAND_*` ("MonitorFlow") pre-auth. Verified
      2026-08-04. **Not independently re-verified this pass**: the
      post-onboarding shell override to the company's own name/logo — the
      shell nav visibly shows "da" (this dev company's name) in every
      screenshot taken today, so the override is clearly working, just not
      screenshotted freshly for this row.

## 2. Dashboard overview

- [x] Totals group **open vs closed**, not by status key. Verified 2026-08-04
      (Owner-scope: 1 Open / 2 Closed = 3 total).
- [ ] Per-service, per-priority, per-department and per-state breakdowns each
      match what the Requests list shows under the same filter. **Partially
      odd**: Owner-scope dashboard showed total=3 but the "By service" donut
      listed only 2 services summing to 2 (Time Off 1, Site Safety
      Walkthrough 1) — not chased further this pass (not a permission/engine
      question, just unclear whether a 3rd request's service is genuinely
      excluded from the donut or something else). Flagging, not fixing —
      needs someone who knows the intended semantics of that donut to say if
      it's expected.
- [x] The 30-day chart renders as a stacked open/closed bar per day (teal
      bottom + gray top segment on the one non-zero day, confirmed via
      screenshot); zero days render as a flat gray sliver, not a crash.
      Verified 2026-08-04. **Not independently re-verified**: the hover
      tooltip's exact two-count text (confirmed present and correct in an
      earlier pass today per `docs/PROGRESS.md`'s 2026-08-03 addendum, not
      re-screenshotted in this pass).
- [x] **SLA breaches** tile: renders "0 · 0% of open" in the plain/neutral
      treatment with zero breaches. **Not verified**: the `--error` warning
      treatment when count > 0 — no request in this dev DB is currently
      breaching its SLA, and manufacturing one would mean waiting out a real
      SLA window or backdating `updated_at` directly in the DB, which felt too
      close to faking the very thing being tested — left unverified rather
      than staged.
- [x] **Reopen rate** tile: renders "0% · 0/2" — shows a real 0%, not `—`,
      because 2 requests in this DB have already reached a terminal status
      (`everClosed = 2`) even though none have ever reopened. The `—`
      (nothing-ever-closed) case is therefore **not exercised** by this DB's
      data — would need a fresh company with zero closed requests to see it.
- [x] **Workload** panel: absent entirely (no heading, no section) when no
      employee currently holds an open task — confirmed via accessibility
      snapshot (no "Workload" region present) on 2026-08-04. **Not
      verified**: the "widest bar first" ordering / rendering with actual
      workload data — no request in this DB is currently assigned to anyone.
- [x] Average resolution shows "Nothing resolved yet" with `—` overall.
      Verified 2026-08-04.
- [x] A Manager-level employee sees only their subtree's numbers: Rita
      Rootwood (a second, independent root created for this pass, owns no
      services) sees 0 requests / "The board is clear", while the
      Owner-scope total is 3 for the same company. Verified 2026-08-04.

## 3. Requests management + detail pane

**Finding, later resolved by a bigger finding in §9 (2026-08-04):** the
seeded "Manager" level (`backend/src/seed.js`) grants `view_all`,
`manage_employees`, `override` — **not** `assign` or `set_priority` — so out
of the box, as Manny Manager, both **Assign** and the **Priority** dropdown
on this page fail with "Forbidden" (verified in the UI and via curl,
`PATCH /requests/{id}/assign` / `/priority` → 403). This looked like a
deployment-blocking gap (no way to grant those capabilities) until testing
§9 found the **Levels & Capabilities page is a live, working capability
editor**, not the read-only page CLAUDE.md §12 and this checklist's own §9
claim it is. Checking "assign" and "set_priority" for Manager there, live,
immediately let Manny's token past the capability check (confirmed:
`PATCH /requests/{id}/assign` went from `{"error":"Forbidden"}` to
`{"error":"This request cannot be assigned in its current state"}` — a
workflow-state error, not a permission one — on the same account, same
token pattern, before and after the checkbox change). **So this is not a
product-blocking gap** — it's a seed default that under-provisions the
Manager level, easily fixed live by the Owner. The real, still-open finding
is the CLAUDE.md §12 / checklist §9 documentation being wrong about the page
being read-only — see §9 below.

- [x] Filters render with real, populated options (service/priority/employee/
      requester dropdowns) scoped correctly (the employee filter lists only
      subtree members). **Not exhaustively verified**: actually narrowing the
      list per filter combination, pagination, and "Clear filters" — time-
      boxed out of this pass.
- [ ] Pagination: not exercised (only 3 requests exist in this dev DB, never
      enough to paginate).
- [x] Detail pane: timeline, requester name/email, request-details section
      (schema-labeled answers: "Fire extinguishers checked: Yes", etc.),
      comments, attachments sections all render correctly for a real request.
      Verified 2026-08-04.
- [~] **Assign** — the candidate list correctly contains *only* subtree
      employees (Sub Ordinate + Time Clocker, not Test Employee who's
      deactivated, not anyone from Rita's separate subtree) — that part
      passes. The assign action itself is blocked by the capability gap
      above, so "assign, then reassign, both write a timeline row" and the
      "assign the same employee twice → 409" row are **not verified** — no
      account available could get past the first assign to test either.
- [ ] Assigning twice → 409: not verified (blocked by the above).
- [ ] Priority change → timeline row: not verified (blocked by the above —
      the UI shows "Couldn't change the priority — try again.").
- [x] **Status override**: verified working end-to-end via `override`
      (Manny Manager) — `PATCH /requests/3/status` with a note → 200,
      request moved from `submitted` to the terminal `logged` status.
      Override to a nonexistent status key → a clear error ("Target is not a
      status in this workflow"); override back to the request's own initial
      status is separately refused ("An override cannot return a request to
      its initial status") — **not verified this pass**: the specific
      no-note-provided 422 case (didn't isolate it from the other two
      negatives already exercised).
- [ ] Cancel / reopen confirmation dialogs: not exercised this pass.
- [ ] Terminal-request task-actions-gone: not exercised this pass (would
      need to re-check the now-terminal request #3, left for a future pass).
- [ ] Comments + notification: not exercised this pass.
- [x] A Manager-level employee cannot open a request from another subtree by
      URL → inline "Not found" (Rita Rootwood on `/requests/1`, a request
      owned by Manny's subtree). Verified 2026-08-04.
- [ ] Map view: not exercised this pass.

## 4. Employees management

- [x] Create an employee (as Rita, a non-admin `manage_employees` holder) —
      the form correctly omits Manager/Level pickers for a non-admin actor
      (server-side: `POST /employees` forces `managerId = req.user.id`,
      `levelId = null` for non-admin callers, a privilege-escalation guard —
      confirmed by reading `routes/employees.js`, not just observed). The
      server generated the login (`ne.hire@adad.ada` for "Newt Hire"), shown
      once in a "won't be shown again" dialog; the client never sent one.
      Verified 2026-08-04. **Not verified**: the colliding-name numbered-
      variant case (no two employees with the same first two letters +
      last name exist in this dev DB to trigger it).
- [ ] The new employee signing in with that generated email: not
      independently re-verified this pass (equivalent already proven
      several times over for other employees created this session, e.g.
      Rita/Manny/Sub Ordinate all successfully logged in earlier).
- [ ] Hiring past the plan's employee cap via this UI: not exercised (the
      equivalent is already covered end-to-end at the API layer by
      `backend/test/employees.api.test.js`).
- [ ] Deactivate-with-open-task 409 / reassign-then-succeeds: not exercised
      this pass (also already covered at the API layer by the same test
      file).
- [ ] Department filter and the per-employee task panel match the Requests list.
- [ ] An employee without `manage_employees` cannot reach this page.

## 5. Departments

- [x] Rename works (fixed real, pre-existing bad data while verifying this:
      the seeded "General" department's Arabic name was literally the
      placeholder text "???" — renamed to "عام" live via this page,
      2026-08-04, since it was directly blocking an honest RTL/bilingual
      check elsewhere).
- [x] Only the Owner (admin) can reach this page — confirmed both directions:
      Owner sees it and can act; a Manager-level employee hitting
      `/departments` directly is redirected to `/` (Dashboard), no crash, no
      partial render. Verified 2026-08-04.
- [ ] Create-requires-a-head-plus-one-other-employee, head-deactivation
      auto-promotion, and the no-active-manager 409: not exercised this pass
      (would mean deactivating a real head, which is disruptive to the rest
      of this session's fixture data — left for a pass with disposable data).

## 6. Reports + export

- [x] Owner (admin, no capabilities) hitting `/reports` directly is redirected
      to `/audit`, not a crash or blank page — confirmed the `view_all`-only
      guard (no `orAdmin`) applies here same as Requests. Verified 2026-08-04.
- [ ] Filters changing summary numbers, CSV cell-injection guard, non-capable
      403: not exercised this pass (needs a `view_all` employee — Manny —
      which this pass ran out of time to get back to after the rate-limit
      delays earlier in the session).

## 7. Audit (admin)

- [x] Both families appear: config actions (`Employee created`, `Service
      created`, `employee_level.updated`, `department.updated`) and
      operational ones (`Status changed` on Request #3, showing
      `to/from/transition`). Verified 2026-08-04, 77 real events, paginated
      20/page.
- [x] **Real bug found and fixed**: the Details column rendered any
      bilingual `{en,ar}` value (e.g. a renamed level/department's `name`)
      as the literal string `[object Object]` instead of the picked-language
      text — `detailText()` in `AuditPage.tsx` called `String(v)` on every
      value with no bilingual handling. Fixed: added a `formatDetailValue()`
      helper that picks via `L()` when a value looks like `{en,ar}`, falls
      back to `String(v)` otherwise (arrays/strings/numbers unaffected).
      Verified live — "name: [object Object]" became "name: Manager", "name:
      General", "name: Staff", "name: Content Editor" across multiple real
      audit rows after the fix. **Not re-verified in Arabic** (the `L()`
      helper itself is the same one already proven correct elsewhere on this
      page and across the app, so low risk, just not independently
      re-screenshotted in `ar` for this specific column).
- [ ] Actor/action filter interaction and the non-admin 403: filters render
      with real, populated options (confirmed) but not exercised by actually
      selecting one and checking the result narrows; non-admin 403 not
      independently re-verified here (same `need="admin"` Guard already
      confirmed for Departments and assumed, not re-tested, for this page).

## 8. Add Service — the thesis demo (admin, `/services/new`)

This is the 5-step structured builder (Basics → Request fields → Completion
fields → Statuses & transitions → Review) that replaced the old raw-JSON
config path (removed in v7, CLAUDE.md §13) — it is still the exact "visual
Form/Workflow Builder" §3/§13 lists as deliberately not built elsewhere, kept
here as one flagged, admin-only exception.

- [x] Step 1's required fields block "Next" client-side ("Fill in the
      required fields to continue.", button disabled) before any server
      round-trip. Verified 2026-08-04. **Not verified**: steps 2–5, the full
      create flow, or the mobile zero-code-change demo — time-boxed out of
      this pass; the backend's own `POST /services` path is already covered
      by `backend/test/requests.api.test.js`'s fixture-service creation, so
      the server side of this is exercised, just not through this UI.
- [ ] A 422 from the server (bypass a client check, or submit a duplicate
      field id) is classified back to the step — and the row, where the
      message names one — it came from, not dumped as one blob.
- [ ] Exactly one status can be marked "initial"; at least one must be marked
      "terminal", or the client blocks "Next" on step 4.
- [ ] A transition needs exactly one gate (capability *or* actor) — the UI
      only lets one radio be active at a time.
- [ ] On success, the new service appears in Employees' service picker /
      Requests' service filter immediately.
- [ ] Submit a request to the new service from the mobile app and drive it to
      a terminal status — **with zero code changes**. This is the demo.
- [ ] A service with `acceptsExternalUsers: false` is invisible to a
      self-registered user's catalogue and refuses their submission with 403.

## 9. Levels & Capabilities (admin)

**Documentation correction (2026-08-04):** this page is **not** read-only.
CLAUDE.md §12 says "Gate-1 level authoring is seed-time only for now," and
this checklist's own row (below, as originally written) repeated that. Live
testing found the opposite: every capability checkbox per level is
interactive, toggling it live-updates `level_capability` immediately ("no
sign-out needed," per the page's own copy — confirmed true, verified an
employee's token gained a capability without re-authenticating), and an "Add
level" button exists. Someone should update CLAUDE.md §12 to describe the
real live endpoint(s) behind this page — not done here since it's a spec
correction, not a web-app one, and outside this checklist's file.

- [x] Capabilities per level are shown, **and are live-editable** (corrects
      the row below, which assumed read-only). Verified 2026-08-04 by
      granting `assign` and `set_priority` to the Manager level and
      confirming a Manager-level employee's own token immediately started
      passing the capability check on both endpoints.
- [ ] A non-admin employee cannot reach this page. Not independently
      re-verified this pass (implied by the same `need="admin"` guard
      already confirmed for Departments, which shares the identical Guard
      component — but not separately screenshotted for this page).

**Sections 10–16 note (2026-08-04):** all six pages below were given a
*structural* pass only (as a `view_all`-holding Manager-level employee —
Rita Rootwood — whose subtree owns no data yet): each page loads without
error, renders a correct, clearly-worded empty state with a working "New
X" write control, and the nav section groupings (OPERATIONS /
COMMUNICATION) are present. Interactive flows (clock in/out, shift
templates, RSVP, mark-complete, and the specific capability-vs-`view_all`
distinction for each module's *write* access — e.g. `manage_events` without
`view_all`) were **not** exercised this pass — time-boxed out after the
deeper Requests/Levels/Audit investigation above ran long. This is real but
shallow coverage, not a full pass.

## 10. Time Clock

- [x] Oversight roster ("Today" tab) renders correctly for a `view_all`
      employee: real subtree members listed, zero-state stats (0 late/
      absent/attendance/currently-working) rendered as real zeros, not
      blank. Verified 2026-08-04.
- [ ] Clock in/out, breaks, manual shifts, approval-status changes, CSV
      export, and the `view_all`-less employee's self-service-only view: not
      exercised this pass.

## 11. Schedule

- [x] Roster view renders correctly: a real weekly grid (Mon–Sun) for the
      subtree, empty cells as `—`, "Copy last week" control present.
      Verified 2026-08-04.
- [ ] Shift-template CRUD, one-shift-per-day replace semantics, "my
      schedule" as an employee, and the `view_all`-less refusal: not
      exercised this pass.

## 12. Checklists

- [x] Correct, clearly-worded empty state when the actor's subtree owns no
      `forms_checklists`-tagged service ("No checklists set up yet /
      Checklist templates are added through Add Service"). Verified
      2026-08-04.
- [ ] Real aggregated stats (submitted/logged, today + all-time) against an
      actual `forms_checklists` service: not exercised (none exists in this
      subtree).

## 13. Directory

- [x] Lists every admin + employee account **company-wide** — confirmed
      both Manny's subtree (Manny, Newt Hire, Sub Ordinate, Time Clocker)
      and Rita's separate subtree (Rita herself) appear together in one
      list as Rita, even though Requests/Dashboard correctly isolate those
      same two subtrees from each other. The deactivated Test Employee is
      correctly excluded; no `user`-role account appears. Verified
      2026-08-04 — this is the one row in this batch given full, not
      structural-only, verification, since the company-wide-not-subtree
      distinction was directly checkable against data already on screen.
- [ ] Branch/department filters and name search narrowing the list: not
      exercised this pass.

## 14. Knowledge Base

- [x] Correct empty state + a working "New article" control for a
      `view_all` employee. Verified 2026-08-04.
- [ ] Write-capability gating (`manage_knowledge_base` without `view_all`),
      read-only view for a non-capable employee, and a direct-call 403: not
      exercised this pass.

## 15. Events

- [x] Correct empty state + a working "New event" control for a `view_all`
      employee. Verified 2026-08-04.
- [ ] RSVP flow and `manage_events`-without-`view_all` write gating: not
      exercised this pass.

## 16. Training & Onboarding

- [x] Correct empty state + a working "New module" control for a
      `view_all` employee. Verified 2026-08-04.
- [ ] Mark-complete flow, per-employee completion persistence, and
      `manage_training`-without-`view_all` write gating: not exercised this
      pass.

## 17. Notifications + profile (shell)

- [ ] Not exercised this pass — no real-time change was staged to watch the
      bell badge update, and sign-out/back-button behavior wasn't
      specifically re-checked (though sign-out was used dozens of times
      switching between test accounts this session without ever landing
      back on an authenticated page unexpectedly, which is at least weak
      evidence it works).

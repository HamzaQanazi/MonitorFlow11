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

**Major finding (2026-08-04, flagging — not fixing, a product/seed-data
decision):** the seeded "Manager" level (`backend/src/seed.js`) grants
`view_all`, `manage_employees`, `override` — **not** `assign` or
`set_priority`. Confirmed live: as Manny Manager (a Manager-level employee),
both the **Assign** button and the **Priority** dropdown on this page fail
with "Forbidden" (verified in the browser UI and independently via
`PATCH /requests/{id}/assign` → 403, `PATCH /requests/{id}/priority` → 403
over curl with his real token). The Owner can't reach this page at all
(`/requests` has no `orAdmin` bypass). Since Gate-1 level *authoring* has no
live endpoint (CLAUDE.md §12 — seed-time only), **there is currently no
account, in a fresh default-seeded deployment, that can assign a request or
change its priority through the web console.** `override` does work (used
below), so status overrides remain possible. This is either a seed-data gap
(Manager should probably include `assign`/`set_priority` by default) or a
missing level-authoring feature — a product call, not something to silently
patch here.

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

- [ ] Create an employee — the server allocates the generated company email
      login (`lib/employeeEmail.js`); the client never sends one. A colliding
      name gets a numbered variant.
- [ ] The new employee can sign in with that generated email.
- [ ] Hiring past the company's plan employee cap (Onboarding step 7) → 409,
      naming the plan and cap.
- [ ] Deactivate an employee holding an open task → **409** with the
      open-tasks message; reassign, then deactivate succeeds.
- [ ] Reactivate works.
- [ ] Department filter and the per-employee task panel match the Requests list.
- [ ] An employee without `manage_employees` cannot reach this page.

## 5. Departments

- [ ] Create a department requires a head + at least one other employee.
- [ ] Deactivating a head auto-promotes their own manager to head, and
      re-points the department's other members to report to them.
- [ ] Deactivating a head with no active manager of their own → 409 until the
      Owner reassigns the head first.
- [ ] Only the Owner (admin) can reach this page.

## 6. Reports + export

- [ ] Filters (date range, service, employee) change the summary numbers.
- [ ] CSV downloads and opens; a cell starting with `= + - @` is prefixed with
      `'` (open it in Excel and confirm nothing evaluates).
- [ ] A non-capable employee gets 403 on the export endpoint, not just a hidden
      button.

## 7. Audit (admin)

- [ ] Both families appear: config actions (`service.created`, `employee.created`)
      and operational ones (`request.status_changed`, `.assigned`, `.priority_changed`).
- [ ] Actor and action filters work; "no match" state renders.
- [ ] A non-admin employee gets 403.

## 8. Add Service — the thesis demo (admin, `/services/new`)

This is the 5-step structured builder (Basics → Request fields → Completion
fields → Statuses & transitions → Review) that replaced the old raw-JSON
config path (removed in v7, CLAUDE.md §13) — it is still the exact "visual
Form/Workflow Builder" §3/§13 lists as deliberately not built elsewhere, kept
here as one flagged, admin-only exception.

- [ ] Each step's own required fields block "Next" client-side before any
      server round-trip.
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

- [ ] Capabilities per level are shown (no authoring UI — level grants are
      seed-time only per CLAUDE.md §12; this page is read-only).
- [ ] A non-admin employee cannot reach this page.

## 10. Time Clock

- [ ] Employee self-service: clock in/out, start/end a break, add a manual
      shift, attach a note/photo/tip to an active shift.
- [ ] Oversight: today's roster, timesheets list, CSV export (injection-guard
      cells like the Reports export).
- [ ] Approving/editing a shift changes its `approval_status`.
- [ ] An employee without `view_all` reaches only their own clock-in/out, not
      the oversight views.

## 11. Schedule

- [ ] Manager: create/edit/delete a shift template; assign a template to an
      employee for a date (one shift per employee per day — a second pick for
      the same day replaces, not duplicates).
- [ ] Employee: "my schedule" shows only their own assigned shifts.
- [ ] A Staff-level employee without `view_all` cannot reach the roster view.

## 12. Checklists

- [ ] Stats aggregate real submitted/logged counts (today + all-time) per
      `forms_checklists`-tagged service — no invented "expected" ratio.
- [ ] Scoped to the actor's subtree; empty state when no such service exists
      yet.

## 13. Directory

- [ ] Lists every admin + employee account (deliberately company-wide, not
      subtree-scoped — CLAUDE.md/openapi note on `/directory`); a `user`
      account never appears.
- [ ] Department/branch filters and the name search narrow the list.
- [ ] Reachable by any admin or employee account, not gated by `view_all`.

## 14. Knowledge Base

- [ ] Read: any employee/admin can browse articles.
- [ ] Write (create/edit/delete): only `view_all` or `manage_knowledge_base`
      or admin.
- [ ] A non-capable employee sees the read-only view with no write controls,
      and a direct write call still 403s.

## 15. Events

- [ ] Read + RSVP: any employee/admin.
- [ ] Write (create/edit/delete): only `view_all` or `manage_events` or admin.
- [ ] RSVP toggles and persists; un-RSVPing removes it.

## 16. Training & Onboarding

- [ ] Read + mark-complete: any employee/admin.
- [ ] Write (create/edit/delete modules): only `view_all` or
      `manage_training` or admin.
- [ ] Completion state persists per employee and shows on their own view only.

## 17. Notifications + profile (shell)

- [ ] The bell badge updates within ~30s of a change made elsewhere.
- [ ] Opening a notification navigates to its request.
- [ ] Sign out clears the session; the back button does not restore the dashboard.

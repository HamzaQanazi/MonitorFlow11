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
| Owner | `admin` | first-login onboarding wizard, then every config page (Employees, Departments, Levels, Add Service, Audit) — **not** the operational dashboard/requests pages (no capabilities, I2) |
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
- [ ] Nothing is authorised by hiding a button: for each denied action below,
      confirm the API refuses it too (devtools network tab / curl).

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

- [ ] Wrong password → inline error, no redirect.
- [ ] 6 rapid failures → 429 rate-limit message (not a generic failure).
- [ ] A `user`-role account is refused / told to use the mobile app.
- [ ] A deactivated employee cannot sign in.
- [ ] Successful login lands on the wizard (un-onboarded admin) or the
      Dashboard (everyone else); a page refresh keeps the session.
- [ ] Wordmark shows `VITE_BRAND_*` pre-auth; once onboarded, the console
      shell prefers the company's own name/logo instead (§11).

## 2. Dashboard overview

- [ ] Totals group **open vs closed**, not by status key.
- [ ] Per-service, per-priority, per-department and per-state breakdowns each
      match what the Requests list shows under the same filter.
- [ ] The 30-day chart renders as a **stacked open/closed bar per day**; a
      date with no data is a flat zero bar, not a crash; hovering a bar shows
      both counts in the tooltip.
- [ ] **SLA breaches** tile: count + "% of open"; renders with the `--error`
      warning treatment only when count > 0, plain otherwise.
- [ ] **Reopen rate** tile: percentage + `reopened/everClosed`; shows `—` when
      nothing has ever been closed yet (not `0%`/`NaN`).
- [ ] **Workload** panel: lists employees with at least one open task, widest
      bar first; the whole panel (heading included) is absent when nobody has
      an open task — no dangling empty section.
- [ ] Average resolution shows the no-resolved-yet state on a fresh DB.
- [ ] A Manager-level employee sees only their subtree's numbers — compare
      against a second, unrelated subtree's totals for the same service.

## 3. Requests management + detail pane

- [ ] Filters (state, service, priority, employee, search, date range) each
      narrow the list; **Clear filters** restores it.
- [ ] Pagination: `pageSize` respected, next/previous correct at both ends.
- [ ] Detail pane: timeline shows every history row with actor and note; answers
      render with their schema labels; attachments download as attachments.
- [ ] **Assign** — the candidate list contains *only* subtree employees. Assign,
      then reassign; both write a timeline row.
- [ ] Assigning the same employee twice → 409 surfaced as an inline error.
- [ ] **Priority** change writes a timeline row.
- [ ] **Status override** requires a note; without one → 422 shown inline.
- [ ] **Cancel / reopen** each show a confirmation dialog first.
- [ ] Once the request is terminal, task actions are gone (not just disabled).
- [ ] Comments post and appear; the other party gets a notification.
- [ ] A Manager-level employee cannot open a request from another subtree by
      URL → 404.
- [ ] Map view: pinned requests appear; requests with no location are reported in
      the "some missing" banner, not silently dropped.

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

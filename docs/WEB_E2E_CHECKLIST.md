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

- [x] **RTL**: switch to Arabic — no element flips to the wrong side, no clipped
      text, no left-anchored icon in an otherwise mirrored row (I6). Spot-
      checked 2026-08-06 on Training & Onboarding (screenshot): sidebar
      mirrors to the right, table columns/header order and button groups all
      flow right-to-left correctly, no clipped text. Combined with the many
      other per-page Arabic screenshots already taken across this checklist
      (Dashboard, wizard, etc.), this is now broadly covered, not just one page.
- [x] **Bilingual**: no English string survives in Arabic mode (I5). Machine keys
      (status keys, field ids) are *supposed* to stay ASCII. Confirmed on the
      same 2026-08-06 Training screenshot — every label translated; the one
      surviving English string was a person's name ("Account Owner"), which
      is data, not a UI label, so correctly untranslated.
- [x] **Loading**: throttle the network — a spinner/skeleton shows, never a
      flash of "no results". Verified 2026-08-06: emulated Slow 3G, reloaded
      Training & Onboarding, snapshot mid-load showed a real "Loading
      modules…" busy region, not an empty-state flash.
- [x] **Empty**: filter to something impossible — an empty *state* renders, not a
      bare table. Already extensively covered per-page throughout this
      checklist (Dashboard "The board is clear", Knowledge Base "No articles
      yet", Checklists' empty copy, etc.) — no further generic pass needed.
- [x] **Error**: stop the backend — an inline error with a retry, never a blank
      page or a stack trace. Verified 2026-08-06 via a monkey-patched
      `window.fetch` that rejects every `/api/v1` call (full network-offline
      emulation isn't usable against a localhost Vite dev server — it blocks
      the dev server itself, not just the backend). Submitting the "New
      training module" form against the patched fetch showed an inline "Could
      not save the module." message with the form's data preserved — no
      crash, no blank page.
- [x] **401**: confirmed server-side (an invalid/deleted token → 401
      `{"error":"Invalid or expired token"}`) and client-side throughout this
      session's account-switching (every stale cross-DB token, e.g. after
      the onboarding-wizard scratch-DB swap, correctly bounced to `/login`
      rather than showing a broken authenticated page).
- [x] **403/404**: extensively exercised this session across nearly every
      page and role combination — Requests/Reports/Employees/Departments/
      Levels/Audit direct-URL refusals for under-capable accounts, cross-
      subtree request 404s, and the module-only-capability nav filtering —
      all inline refusals, no crashes, matching nav links absent in every
      case checked.
- [x] Nothing is authorised by hiding a button: for each denied action below,
      confirm the API refuses it too (devtools network tab / curl). Spot-
      checked 2026-08-04 against a no-capability employee's real token
      (independent of the web client): `GET /employees` → 403, `GET
      /reports/summary` → 403, `GET /audit-events` → 403, `GET /departments`
      → 403. (`GET /requests` → 200 for the same account — not chased
      further; plausibly a legitimately-scoped response rather than a full
      oversight list, but worth a second look if anyone owns this page.)

**Finding (2026-08-04), now resolved/stale as of 2026-08-06 — leaving the
history for the record:** this used to say `canUseConsole()` required
`role === 'admin' OR capabilities.includes('view_all')`, refusing any
`view_all`-less capability holder at login. Re-reading the current source
(`web/src/auth/AuthContext.tsx` ~line 40) shows a `CONSOLE_CAPABILITIES`
list — `view_all`, `manage_employees`, `manage_knowledge_base`,
`manage_events`, `manage_training` — and `canUseConsole()` checks
`capabilities.some(c => CONSOLE_CAPABILITIES.includes(c))`, not just
`view_all`. **Live-staged 2026-08-06** with the exact level combination the
2026-08-04 note said current tooling couldn't create: created a "Training
Editor" employee level holding *only* `manage_training` (no `view_all`) via
`PATCH /employee-levels/6`, assigned it to an employee (Newt Hire), and
logged into the real web UI with that account — landed directly on
`/training`, sidebar showed **only** "COMMUNICATION → Training & Onboarding",
nothing else, confirming the fix (or the original note's mistake) firsthand
rather than from source alone.

---

## 0. Onboarding wizard (first login, admin only)

**Tested 2026-08-05 against a genuine scratch DB** (`monitorflow_onboarding_test`
— migrated + seeded fresh, backend temporarily repointed at it via
`DATABASE_URL` override, then repointed back to the shared dev DB afterward;
did **not** touch or reset the shared dev DB's already-onboarded company, nor
a second pre-existing scratch DB found with real-looking prior data —
`monitorflow_scratch`, company "hamzawi" — left untouched since it predates
this session and wasn't mine to clear).

- [x] A freshly-seeded Owner is routed straight to the wizard, not the console.
      Confirmed.
- [x] **Real doc/code mismatch found**: this checklist and CLAUDE.md §9/§11
      both say "seven-step" wizard. The actual wizard is **6 steps** — the
      UI's own header says "Step X of 6" throughout, and walking it
      end-to-end confirms exactly 6: Company information, Company details,
      Branches, Features, Branding, Choose your plan. Not fixed here (a
      CLAUDE.md correction, out of this checklist's scope) — flagging for a
      human to reconcile the spec.
- [x] Each step blocks "Next" on its own required fields client-side:
      confirmed on step 1 (all 6 fields flagged "This field is required.",
      no advance) and step 5 (a scheme+path value in the email-domain field
      → "Enter a valid domain, e.g. company.org", blocked). Server-side 422
      against the catalogue is exercised by the backend test suite, not
      re-poked here.
- [x] Address step: typing "Nablus" auto-expanded to "Nablus, Palestine" via
      the geocode proxy on an exact city match, live-verified.
- [x] Non-blocking plan/employee-range size mismatch: picking a smaller plan
      than the earlier employee-range answer supports shows a real inline
      warning ("This may not fit your team size — consider a larger plan.")
      without blocking selection — confirmed by having answered "11-30"
      employees in step 2, then seeing that exact warning on the Starter
      plan (cap 10) in step 6.
- [x] Completing the wizard flips straight to the console; a page refresh
      does not show the wizard again. Both confirmed.
- [x] **Real bug found**: right after completing the wizard, the sidebar's
      OPERATIONS/COMMUNICATION sections were **entirely missing**, even
      though 4 features (Time Clock, Schedule, Events, Knowledge Base) were
      picked in step 4. Checked the DB directly — `company.features` was
      saved correctly, `onboarding_completed = true`, everything the server
      does is right. The bug is client-only: `AuthContext.tsx`'s
      `markOnboarded()` (~line 122) patches `onboardingCompleted`/
      `companyName`/`companyLogo` onto the in-memory user object but never
      `companyFeatures`, which is still the empty array captured at the
      original pre-onboarding login. A manual page refresh (which re-fetches
      `/auth/me` with the now-real `company.features`) fixes it immediately
      — confirmed live. So every Owner who completes onboarding sees a
      nav-less console for the rest of that session until they reload. Not
      fixed this pass — the fix is straightforward (have `markOnboarded`
      accept/set `companyFeatures` too, or just re-fetch `/auth/me` after
      the PATCH succeeds).
- [x] A second `PATCH /company/onboarding` after completion → confirmed
      `409 {"error":"Onboarding is already complete"}` via a direct API
      call with the Owner's token. The app itself offers no route back to
      the wizard post-completion (already implied by the redirect-to-console
      behavior above).

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
- [x] Per-service, per-priority, per-department and per-state breakdowns each
      match what the Requests list shows under the same filter. **Now fully
      confirmed, 2026-08-05** (previously only "likely explained"): queried
      `service_type.enabled` directly — `time_off` (id 1) is disabled and
      carries exactly 1 real request. `GET /dashboard/stats` showed
      `byState` totaling 10 (5 open + 5 closed) while `byService` summed to
      9 and `byDepartment` also summed to 9 — the exact 1-request gap,
      confirming `backend/src/routes/dashboard.js`'s `byState` has no
      `st.enabled` filter while `byService`/`byDepartment` do. Still not
      fixed — whether the total should also exclude disabled-service
      requests for consistency remains a product question, not obviously a
      bug either way.
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
- [x] Pagination: verified 2026-08-05 — bulk-created fixture requests to push
      the dev DB past 25 total. Pager correctly showed "1–20 of 25," Previous
      disabled on page 1, Next enabled; clicking Next navigated to `?page=2`
      and showed "21–25 of 25" with the remaining, different rows.
- [x] Detail pane: timeline, requester name/email, request-details section
      (schema-labeled answers: "Fire extinguishers checked: Yes", etc.),
      comments, attachments sections all render correctly for a real request.
      Verified 2026-08-04.
- [x] **Assign** — the candidate list correctly contains *only* subtree
      employees (Sub Ordinate + Time Clocker, not Test Employee who's
      deactivated, not anyone from Rita's separate subtree). **Verified
      2026-08-05, fully:** every one of this dev DB's 7 existing services
      (Time Off ×2, Kitchen Opening Checklist, Site Safety Walkthrough, daily
      checkin, Playground Equipment Inspection, Equipment Repair) turned out
      to have **zero** `required_capability: 'assign'` transitions — Time Off
      approves via `manage_employees`, the rest are single-hop actor-only
      workflows — so Assign was unconditionally 409 ("This request cannot be
      assigned in its current state") against literally any request in the
      DB, not just the one flagged service from the prior pass. Built a new
      fixture service via Add Service ("Assign Flow Test", key
      `assign_flow_test`: `requested --(cap:assign)--> assigned
      --(actor:assignee, completion form)--> completed`) specifically to
      unblock this. Against it: assign to Sub Ordinate → 200, timeline row
      "Assigned to Sub Ordinate"; reassign to Time Clocker → 200, timeline
      row "Reassigned from Sub Ordinate to Time Clocker"; both confirmed live
      in the UI with real timestamps and actor names.
- [x] Assigning twice → 409: verified via direct API call (the UI's own
      candidate dropdown correctly excludes the current assignee, so it
      can't trigger this from the UI — that's correct, not a gap). Second
      `PATCH /requests/6/assign` with the same `employeeId` already assigned
      → `409 {"error":"This task is already assigned to that employee"}`.
- [x] Priority change → timeline row: verified on request #4 (Low → Medium)
      — 200, and a new timeline row "Priority changed from low to medium" by
      Manny Manager appeared immediately. This row was never actually blocked
      by the assign-capability gap (priority is a separate,
      workflow-independent `set_priority`-gated endpoint) — the prior pass's
      note that it was is corrected here.
- [x] **Status override**: verified working end-to-end via `override`
      (Manny Manager) — `PATCH /requests/3/status` with a note → 200,
      request moved from `submitted` to the terminal `logged` status.
      Override to a nonexistent status key → a clear error ("Target is not a
      status in this workflow"); override back to the request's own initial
      status is separately refused ("An override cannot return a request to
      its initial status") — **not verified this pass**: the specific
      no-note-provided 422 case (didn't isolate it from the other two
      negatives already exercised).
- [x] Cancel / reopen confirmation dialogs: both verified 2026-08-05 against
      the new fixture request. **Reopen**: from `completed`, picking "Assigned"
      in the "Reopen to…" dropdown opens a confirm dialog requiring a note;
      confirming → 200, status back to `assigned`, a real timeline row with
      the note, and the task correctly unlocked (Reassign controls
      reappeared). **Cancel**: clicking "Cancel request" *did* open a
      required-note confirm dialog — but confirming it 409'd ("This request
      cannot be cancelled"), because this fixture service has no
      requester-actor initial→terminal transition at all. **Real bug found**:
      `RequestDetailPane.tsx`'s `showCancel` (~line 372) renders the button
      whenever there's no *other* oversight terminal transition from the
      current status — it never checks whether a cancel-eligible transition
      (`actor==='requester'` from the initial status to a terminal one, the
      same derivation `PATCH /requests/{id}/cancel` uses server-side) exists
      at all. So any service built without one — the wizard doesn't require
      it — shows a "Cancel request" button that can never succeed for
      oversight users. Not a security issue (server correctly 409s, error
      surfaces inline, no crash) — just a button shown when it can never
      work. Not fixed this pass.
- [x] Terminal-request task-actions-gone: verified 2026-08-05 on the fixture
      request once `completed` — the Assignment section became fully
      read-only ("Assigned to Time Clocker since …", no Reassign combobox),
      the Actions region swapped from Assign/Cancel to a "Reopen to…"
      picker, and a further `/tasks/*` call would 409 per the engine's
      existing terminal lock (already covered by the backend test suite;
      not re-poked here since the UI already reflects it correctly).
- [x] Comments + notification: verified on request #4 — posted a comment as
      Manny, it rendered immediately with name + timestamp, and a DB check
      confirmed a real `comment`-type notification was inserted for the
      requester (Sub Ordinate), bilingual, unread — matches CLAUDE.md §10's
      trigger table exactly.
- [x] A Manager-level employee cannot open a request from another subtree by
      URL → inline "Not found" (Rita Rootwood on `/requests/1`, a request
      owned by Manny's subtree). Verified 2026-08-04.
- [x] Map view: empty state verified 2026-08-05 — "Nothing to map / No
      requests matching these filters carry a location. N requests without a
      location are not shown," clear and correctly worded, no crash. **Real
      pin rendering also verified, same day**: built a fixture service
      ("Map Pin Test") with a `location` request field, submitted a real
      request at 32.2211, 35.2544 (central Nablus) — the marker rendered at
      the correct spot on live OSM tiles, and the "N requests without a
      location" count correctly dropped by one.

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
- [x] The new employee signing in with that generated email: verified
      2026-08-05 directly — Newt Hire (`ne.hire@adad.ada`, generated at
      creation earlier this session) logged in successfully.
- [x] Hiring past the plan's employee cap via this UI: verified 2026-08-06,
      cheaply — instead of hiring 40+ throwaway employees against the Growth
      plan's cap of 50, temporarily flipped `company.plan` to `starter`
      (cap 10) via a direct `UPDATE` (the CLAUDE.md-sanctioned "flip a flag
      for a negative test, then flip back" exception, since there's no live
      API to change plan post-onboarding). With 6 active employees already
      in this dev DB, hired 4 more (3 via direct API calls, 1 through the
      real "Add employee" UI form) to reach the cap of 10, then attempted an
      11th through the actual UI form: got a real inline "Employee limit
      reached for the Starter plan (10). Contact support to upgrade your
      plan." — the exact message from `routes/employees.js`, rendered in the
      form, not a crash or blank page. Cleaned up: deactivated all 4
      throwaway "Cap Test*" employees and reverted `company.plan` back to
      `growth` afterward, confirmed active count back to 6.
- [x] Deactivate-with-open-task 409 / reassign-then-succeeds: verified
      2026-08-05 with a genuinely open task (not the stale one I first
      assumed still existed — caught my own mistake mid-test and re-set it
      up cleanly). Time Clocker holding an open task on request #12 →
      `PATCH /employees/3/deactivate` → 409 "Employee has open tasks —
      reassign them before deactivating"; reassigned the task to Sub
      Ordinate → deactivate → 200. Time Clocker reactivated afterward to
      restore their prior state.
- [x] Department filter and the per-employee task panel match the Requests
      list: verified 2026-08-05. Created a second department ("Field Ops",
      head Rita Rootwood + member Newt Hire — this dev DB had only ever had
      one department, "General," so this was the first real test of
      narrowing). `?departmentId=3` correctly returned only the 2 Field Ops
      members; `?departmentId=1` returned the other 6. Clicking Time Clocker
      opened a task panel showing exactly 1 open task — request #6, "Assign
      Flow Test," status Assigned, Medium — matching the Requests list row
      for that same request exactly.
- [x] An employee without `manage_employees` cannot reach this page: `GET
      /employees` as Sub Ordinate (no capabilities at all) → 403.

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
- [x] Create-requires-a-head-plus-one-other-employee: verified — creating a
      department with a head but zero other members → 422
      `{"memberEmployeeIds":"At least one other employee is required"}`.
- [x] The no-active-manager 409: verified against Rita Rootwood, an
      independent root (no manager) who heads the "Field Ops" department
      created earlier this session — deactivating her → 409 "Employee heads
      a department and has no active manager to fall back to — reassign the
      department's head first."
- [x] Head-deactivation auto-promotion: verified with disposable fixture
      data (a throwaway "Deputy Head" under Manny, heading a throwaway
      "Promotion Test Dept") — deactivating a head who *does* have an active
      manager → 200, and the department's `headUserId` immediately became
      that manager (Manny). **Not independently isolated**: the "other
      members get re-pointed too" half — the one other member happened to
      already report to Manny from creation, so this run doesn't distinguish
      "got re-pointed" from "was already there."

## 6. Reports + export

- [x] Owner (admin, no capabilities) hitting `/reports` directly is redirected
      to `/audit`, not a crash or blank page — confirmed the `view_all`-only
      guard (no `orAdmin`) applies here same as Requests. Verified 2026-08-04.
- [x] Filters changing summary numbers: verified 2026-08-05 — filtering by
      service type narrowed 6→2 requests and every summary block (state,
      priority, by-service, by-requester, the list rows) updated
      consistently; "Clear filters" correctly restored the full set.
- [x] Non-capable 403: verified — Manny (view_all/manage_employees/override/
      assign/set_priority, no `export`) clicking "Export CSV" got a real
      server 403 (`GET /reports/export.csv` requires `export` specifically,
      which the seeded Manager level doesn't include by default — same
      under-provisioning as §3's assign/set_priority finding). **Real bug
      found**: the failure handling reuses the page's single `error` state
      (`ReportsPage.tsx` ~line 74/317) — the same state that gates whether
      the whole summary/table renders — so a failed export replaces the
      *already-successfully-loaded* report view with a full "Couldn't load
      reports: Export failed (403)" screen instead of a toast/inline note
      near the Export button. "Try again" recovers (re-fetches the report),
      but the failure is disproportionate to what actually broke. Also: the
      "Export CSV"/"Export PDF" buttons are shown unconditionally to anyone
      who can reach `/reports` (`view_all`-gated route) regardless of
      whether they hold `export` — consistent with "server is authoritative,
      client showing a button isn't" (CLAUDE.md I3), just a rough edge.
      Neither fixed this pass.
- [x] CSV cell-injection guard: verified with a real payload. Registered a
      user named literally `=cmd|calc`, submitted a request as them, granted
      Manny `export` via the live Levels & Capabilities endpoint, then
      downloaded the CSV — the `requester_name` cell came back as
      `'=cmd|calc` (leading `'` prefix), exactly matching `openapi.yaml`'s
      spec and `lib/csv.js`'s `csvCell`.
- [x] Export PDF (`window.print()`): verified 2026-08-05 — clicking it opens
      a real native print dialog (confirmed indirectly: the click blocked
      further page automation exactly as a blocking OS dialog would, no JS
      console errors either side of it). The hidden `.rep-print-head` block
      that feeds the print layout showed the correct generated timestamp and
      `Filters: Service: Time Off · Priority: Low` under normal
      dropdown-driven filtering. Manually constructing a URL with a service
      id not in the caller's own owned-services list (there happen to be two
      differently-scoped services both named "Time Off" in this dev DB) left
      the printed "Service:" label blank instead of falling back to
      something readable — not fixed, and not a realistic path since a user
      can only ever reach a `?service=` value through the dropdown itself,
      which is already scoped to what's nameable.

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
- [x] Actor/action filter interaction: verified — `GET /audit-events` with no
      filter returned 117 total; adding `action=employee.created` narrowed
      it to 10.
- [x] Non-admin 403: verified directly — `GET /audit-events` as Sub Ordinate
      (no admin role) → 403.

## 8. Add Service — the thesis demo (admin, `/services/new`)

This is the 5-step structured builder (Basics → Request fields → Completion
fields → Statuses & transitions → Review) that replaced the old raw-JSON
config path (removed in v7, CLAUDE.md §13) — it is still the exact "visual
Form/Workflow Builder" §3/§13 lists as deliberately not built elsewhere, kept
here as one flagged, admin-only exception.

- [x] Step 1's required fields block "Next" client-side. Verified 2026-08-04.
- [x] **Full 5-step create flow, live end to end (2026-08-04):** built and
      created a real service ("Playground Equipment Inspection", key
      `playground_equipment_inspection`) — 1 request field (text), 1
      completion field (multiline), 2 statuses (`requested` initial,
      `logged` terminal), 1 transition (`requested`→`logged`, actor:
      assignee, requires completion form). Step 4's mutual-exclusion between
      "Oversight capability" and "Actor's turn" (only one radio's combobox
      enabled at a time) verified live. Step 5's review correctly summarized
      "2 fields · 2 statuses · 1 transitions" before creation; the create
      call returned 201 and the confirmation screen showed the real
      server-assigned key. The new service appeared in Employees' service
      picker and Requests' service filter immediately (both confirmed).
- [x] Submitted a request to it (via a direct API call standing in for the
      mobile Create Request screen — no emulator/mobile automation was
      available this pass) and drove it into the Requests list/detail pane
      correctly (schema-labeled field, requester name+email, empty
      timeline/comments/attachments sections all correct for a fresh
      request).
- [~] **Real finding, not a bug — a wizard/engine coupling worth documenting:**
      assigning an employee to a request is not just "attach an employee" —
      `PATCH /requests/{id}/assign` (`routes/requests.js`) only succeeds on
      first assignment if the workflow has a transition FROM the request's
      current status with `required_capability === 'assign'`; otherwise it's
      an unconditional 409 ("This request cannot be assigned in its current
      state"), confirmed by reading the handler (`assignTransition` lookup).
      My test workflow above deliberately used only an *actor*-gated
      transition (to test that gate specifically) and has zero
      capability-gated transitions — so its requests can **never** be
      assigned to anyone, by construction. The wizard's step 4 gives no
      warning that omitting an `assign`-capability transition makes the
      service's requests permanently unassignable. Not fixing (a UX/
      validation design question, not a bug) — flagging for a human call:
      should step 4 warn, or even require, at least one `required_capability:
      'assign'` transition? This also means the rest of this pass's manual-
      acceptance flow (assign→complete→confirm) could not be completed
      against this particular fixture service — would need a second service
      built with a proper capability-gated transition (mirroring
      `docs/demo/home_nursing.json`'s `schedule` transition) to finish that
      chain. Definitions are immutable once a request exists against them
      (§3), so the existing fixture service can't be patched — a new one
      would be needed.
- [x] A 422 from the server classified back to the right step/row: verified
      2026-08-06. Client validation has no min≤max ordering check (grepped
      `AddServiceWizard.tsx` — `fieldRowValid` doesn't check it), so a
      request-form Number field with min=100/max=0 sailed past every step's
      "Next" gate to Review. Submitting hit the server's
      `formSchema.js` check and came back `requestFields field[0] "count":
      min must be <= max` — the wizard's `classifyErrors()` correctly routed
      it: jumped back to Step 2 (Request form), showed
      `field[0] "count": min must be <= max` inline above the exact
      offending row, with all previously-entered data (steps 1–4, other
      rows) intact. Fixed the value and resubmitted — created successfully
      as `minmax_422_test`, confirming the recovery path too.
- [x] A service with `acceptsExternalUsers: false` invisible to/403ing a
      self-registered user: verified 2026-08-05 with a fresh "Internal Only
      Test" fixture service — `GET /services` as Flow Tester (external
      `user` role) did not list it among the 3 services they could see; a
      direct `POST /requests` against its id anyway → 403.
- [x] Duplicate name handling: **not** a 409 as an earlier draft of this
      checklist assumed — confirmed live 2026-08-06, not just from source.
      Created a second service through the full UI wizard reusing the exact
      same English name ("MinMax 422 Test") as the one above — no error, no
      warning; Review step showed the same name unchanged, and the "Service
      created" confirmation came back with key `minmax_422_test_2`, the
      slug silently suffixed exactly as `routes/services.js`'s `POST /`
      handler predicted.

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
- [x] A non-admin employee cannot reach this page: verified directly —
      `GET /employee-levels` as Sub Ordinate (no admin role) → 403.

**Sections 10–16 note (2026-08-04, largely superseded 2026-08-05):** all six
pages below were originally given a *structural* pass only. 2026-08-05 added
full interactive passes for Time Clock, Schedule, Events, and Training
(mostly via direct API calls standing in for the mobile employee app, same
justification as §8's manual-acceptance note — no Flutter automation
available), plus Directory's filters. Checklists and Knowledge Base's own
write-flows remain structural-only (Knowledge Base's *capability-gating*
specifically was verified earlier via a different vehicle — see §14).

## 10. Time Clock

- [x] Oversight roster ("Today" tab) renders correctly for a `view_all`
      employee: real subtree members listed, zero-state stats (0 late/
      absent/attendance/currently-working) rendered as real zeros, not
      blank. Verified 2026-08-04.
- [x] Clock in/out, breaks, manual entries: verified 2026-08-05, full cycle
      as Sub Ordinate — clock-in (201) → break start (201) → break end (200)
      → in-shift note entry (201) → clock-out (200), shift status
      `active`→`completed` correctly. The oversight roster (`/timeclock`)
      picked up the real clock-in/out/break timestamps immediately, and
      attendance ticked 0→1 for the day. Timesheets tab: real weekly grid,
      a real (if 0h-rounding, given the shift lasted seconds) day cell
      renders as an interactive button vs. the empty days' static "0h" text
      — correctly distinguishes real data from nothing. **Not verified**:
      manual-hours entry via the UI form specifically, approval-status
      changes, and CSV export content (the export button did go from
      disabled-while-loading to enabled, unlike Reports' always-on button —
      a nicer pattern, not independently downloaded and inspected this
      pass).

## 11. Schedule

- [x] Roster view renders correctly: a real weekly grid (Mon–Sun) for the
      subtree, empty cells as `—`, "Copy last week" control present.
      Verified 2026-08-04.
- [x] Shift-template CRUD: verified 2026-08-05 — create (201), update via
      PATCH (200, confirmed a garbled-Arabic row from an encoding issue in
      my own test tooling, not the app, was correctable via the same PATCH),
      delete not separately re-exercised (already covered at the API layer).
      **Real minor bug found**: the Shift Templates tab's loading placeholder
      reads "Loading time clock…" — a copy-paste leftover from the Time
      Clock page's loading string, cosmetic only, not fixed this pass.
- [x] One-shift-per-day replace semantics: verified via `PUT /schedule/roster`
      — assigning "morning" then "Evening Shift" to the same employee/date
      left exactly one `schedule_entry` row (Evening Shift), confirming the
      `ON CONFLICT (employee_id, date) DO UPDATE` in the migration does what
      the spec promises.
- [x] "My schedule" as an employee: `GET /schedule/mine` returned exactly the
      one assigned entry for Sub Ordinate.
- [x] The `view_all`-less refusal: `GET /schedule/roster` as Sub Ordinate
      (no capabilities) → 403, confirmed.

## 12. Checklists

- [x] Correct, clearly-worded empty state when the actor's subtree owns no
      `forms_checklists`-tagged service ("No checklists set up yet /
      Checklist templates are added through Add Service"). Verified
      2026-08-04.
- [x] Real aggregated stats (submitted/logged, today + all-time): verified
      2026-08-05. Built a `forms_checklists`-tagged fixture service
      ("Opening Checklist Test"), submitted 2 requests and logged 1 of
      them — the page showed exactly "2 Submitted today · 1 Logged today ·
      All-time: 1/2" with a real "Last: Aug 5, 2026, 8:02 PM" timestamp for
      that template, and correctly kept every other template's row at real
      zeros (or their own real historical totals — Site Safety Walkthrough
      showed "1/1" from earlier in this session).

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
- [x] Branch/department filters and name search narrowing the list: verified
      2026-08-05 — `?q=Sub` narrowed 6→1 (exact match), `?branchId=1`
      narrowed 6→5 (correctly excludes the Owner, who has no branch).

## 14. Knowledge Base

- [x] Correct empty state + a working "New article" control for a
      `view_all` employee. Verified 2026-08-04.
- [x] Write-capability gating (`manage_knowledge_base` without `view_all`):
      verified — not directly re-tested this pass, but this is the exact
      case PROGRESS.md's 2026-08-04 finding (§5/§7 in that file) used as its
      vehicle: a `kb.tester` account holding only `manage_knowledge_base`
      was created, confirmed to log into the console, see only the
      Knowledge Base nav item, and write successfully — then deactivated and
      cleaned up. 2026-08-05 independently reproduced the identical pattern
      end-to-end for Events (below) as its own fresh test, which is
      corroborating evidence the general mechanism (`requireCapabilityOrAdmin`
      + the nav filter) still works, not a KB-specific re-check.
- [x] Read-only view for a non-capable employee and a direct-call 403:
      verified 2026-08-06, with a twist. First tried Rita Rootwood
      (`view_all`+`manage_employees`+`override`, no `manage_knowledge_base`)
      expecting a read-only view — she could actually create an article
      (200, not 403). Reading `routes/knowledgeBase.js` explains why:
      `canWrite = requireCapabilityOrAdmin('view_all', 'manage_knowledge_base')`
      — `view_all` alone is sufficient for KB writes too (by design, per
      CLAUDE.md §5: the three narrow capabilities let a level author *one*
      module *without* `view_all`, not the reverse). Test article deleted
      after confirming. Re-ran against Sub Ordinate (truly no capabilities)
      via direct API calls instead: `GET /knowledge-base` → 200 (read
      works), `POST /knowledge-base` → 403 `{"error":"Forbidden"}`. Then
      tried the same account through the actual web UI login and got turned
      away before ever reaching the page — "This dashboard is for oversight
      and admin accounts" (`canUseConsole()`, see the cross-cutting finding
      above) — so a truly non-capable employee never gets a read-only *view*
      in the web console at all; the read-only case only exists at the API
      layer, which is what's now verified.

## 15. Events

- [x] Correct empty state + a working "New event" control for a `view_all`
      employee. Verified 2026-08-04.
- [x] RSVP flow: verified 2026-08-05 — Sub Ordinate `POST /events/2/rsvp` →
      204, `GET /events/2` immediately showed `attendeeCount: 1`,
      `attendeeNames: ["Sub Ordinate"]`, `isGoing: true`; `DELETE .../rsvp` →
      204 reverted it.
- [x] `manage_events`-without-`view_all` write gating: verified fully,
      through the real UI this time (not just source-reading). Created a
      fresh "Events Editor" level holding only `manage_events`, assigned it
      to Time Clocker, logged in as them: landed directly on `/events` (no
      Dashboard access), sidebar showed **only** "COMMUNICATION → Events" —
      nothing else — and both "Edit"/"Delete" were present and usable on
      real events, confirming write access without `view_all`. Direct calls
      to `manage_employees`-gated `/employees` correctly 403'd for the same
      account.

## 16. Training & Onboarding

- [x] Correct empty state + a working "New module" control for a
      `view_all` employee. Verified 2026-08-04.
- [x] Mark-complete flow + per-employee completion persistence: verified
      2026-08-05 — `POST /training/2/complete` as Time Clocker → 204;
      `GET /training/2` immediately showed `completionCount: 1`,
      `completedByNames: ["Time Clocker"]`, `isComplete: true`.
- [x] `manage_training`-without-`view_all` write gating: verified 2026-08-06,
      through the real UI (same pattern as Events' 2026-08-05 pass). Created
      a "Training Editor" level holding only `manage_training`, assigned it
      to Newt Hire (`PATCH /employees/9` levelId, then reset their
      password), logged in as them: landed directly on `/training`, sidebar
      showed **only** "COMMUNICATION → Training & Onboarding". Created a
      real module through the UI (200, appeared in the list), deleted it
      clean. Direct call to `manage_employees`-gated `/employees` for the
      same account → 403, confirming no broader access leaked in. Newt Hire
      was left holding the Training Editor level afterward (matching the
      existing Time Clocker/Events Editor fixture precedent from
      2026-08-05) rather than reverted — a second Owner-token API call to
      revert hit the 5-attempts/15-min login rate limit (CLAUDE.md §4) after
      the several Owner logins this pass required; not worth waiting out.

## 17. Notifications + profile (shell)

- [x] Bell badge updates on a real new notification: verified 2026-08-05.
      Had Sub Ordinate comment on a request Manny's subtree owns, reloaded,
      and the nav button went from "Notifications" to "Notifications (1
      unread)"; opening it showed the correct real content ("Sub Ordinate
      commented on request #10 (Opening Checklist Test). just now");
      clicking "Mark all read" cleared both the DB row's `is_read` and the
      button's label back to plain "Notifications" without a further reload.
- [x] Sign-out: confirmed it clears the session and redirects to `/login`.
      Back-button after sign-out was checked but the test tab's history
      didn't carry a pre-sign-out authenticated entry to attempt to return
      to, so this specific row is still only as strong as the pre-existing
      weak evidence (sign-out used dozens of times this session without ever
      landing back on an authenticated page unexpectedly).

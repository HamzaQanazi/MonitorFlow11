# MonitorFlow — Progress

Tracks completed work against the CLAUDE.md Section 10 plan. Update this when a week's deliverables land.

## Done

### Week 1 (commit `a931457`)
- Monorepo scaffold, ER v3 schema + migrations (`backend/migrations/001_init.sql`, `npm run migrate`)
- Auth: `POST /auth/register`, `POST /auth/login`, `GET /auth/me` — JWT HS256 24h, bcrypt, login rate limit, deactivated accounts rejected at JWT validation

### Week 2 — backend / Student 2 (commits `8930731`, `ce9acfe`, `4247d7a`)
- **Seed script** (`npm run seed`): wipes all data and reseeds — IT + Facilities departments, Equipment Repair + Home Cleaning Visit, 4 form definitions, both Section 9.4 workflows, dev accounts. Seed-time validation in `backend/src/lib/formSchema.js` + `workflowSchema.js` runs before any insert.
- **Config read endpoints** (`backend/src/routes/services.js`): `GET /services`, `GET /services/{id}/forms/request|completion`, `GET /services/{id}/workflow`. Auth required, no role gate (decided: the Section 6 catalogue row gates the *page*, not these reads — employees need completion forms, monitors need workflow metadata).
- **Form validation function** (`backend/src/lib/validateFormResponse.js`): Section 8 rules, errors keyed by field id, photo ownership checked via injected `db`. 13 unit tests (`npm test`, node:test).

### Design context (commit `f458907`)
- `PRODUCT.md` (design strategy: product register, calm/operational/trustworthy, anti-references) + `DESIGN.md` seed (North Star "The Dispatch Board", Workwear Amber on pure white, Source Sans 3, status-categories-own-color rule). Read both before building any UI. Re-run `/impeccable document` once more web components exist to replace the seed with scanned tokens.

### Week 3 — web / Student 2, started early (commits `f7cd488`, `abdc8f6`)
- **Monitor Login** (Section 4 page): `/login` split layout, all states designed (field errors, 401, 429, network, submitting), password visibility toggle, client-side monitor-role gate (non-monitor logins are rejected and the token discarded — server still enforces per-route). Verified end-to-end in headless Edge (Playwright, `channel: 'msedge'` — no Chrome on the dev machine).
- **Reusable web plumbing**: design tokens (`web/src/styles/tokens.css`, OKLCH), typed API client (`web/src/lib/api.ts`, token in localStorage `mf.token`), auth context with session restore (`web/src/auth/AuthContext.tsx`), `RequireAuth` route guard, Vite dev proxy `/api` → `:3000` (backend deliberately has no CORS). `/` is the empty Dashboard Overview shell awaiting Week 6 content.

### Dashboard Overview (Section 4 page) — pulled forward from Week 6
- **Backend** (`backend/src/routes/dashboard.js`): `GET /dashboard/stats` (counts by status *category* via workflow JSONB join — no status keys in code, per Section 9) + `GET /dashboard/chart` (requests/day, last 30 days, zero-filled). Monitor-only via new `requireRole` in `middleware/auth.js` (403 verified for user role).
- **Seed demo data**: 22 demo requests across both services with full status-history walks (changed_by resolved from each transition's `allowed_role`), task rows where the walk passes assignment, completion forms where completed. Demo data is validated like API input (`validateDemo()` in `seed.js`).
- **Web** (`web/src/pages/DashboardPage.tsx`): queue-health category strip + stacked proportion bar (hero), 30-day activity chart (plain HTML/CSS bars, hover tooltip, sr-only data table), by-service/by-priority breakdowns. 30s polling (silent refresh). Skeleton / error+retry / zero-data empty states. Status-category palette added to `tokens.css` (`--cat-*` — the fixed six-category assignment all three apps must reuse).
- **Shell nav**: top-bar nav (Dashboard · Requests · Employees · Reports) with nested routes; unbuilt pages render a `ComingSoon` stub naming their week.
- Verified headless-Edge at 1440/834/390px; lint + build green; no console errors.

### Week 3 — requests endpoints (Section 7)
- **`POST /requests`** (`backend/src/routes/requests.js`): user role only; validates `form_response` via `validateFormResponse` (422 `{errors}` keyed by field id, matching the register convention); request starts at the workflow's `is_initial` status with the service's `default_priority`; first history row written in the same transaction. Creation is not a transition — the Week 4 workflow engine owns all later status writes.
- **`GET /requests`**: user always scoped to own (whatever the params say), monitor all, employee 403. Standard list params — page/pageSize(≤100)/status/category/serviceTypeId/priority/dateFrom/dateTo/q (q matches requester or service name); invalid values → 400. Status label/category resolved from workflow JSONB per row.
- **`GET /requests/{id}`**: user own (cross-user → **404**, the 404-over-403 rule), monitor any, employee 403 (employees use `GET /tasks/{id}`). Embeds statusHistory (with actor names), comments, attachment metadata — the Timeline page needs exactly one call.
- Smoke-tested against seed: 22/22 status-code checks (happy paths, 422 per-field/unknown-key/bad-option/out-of-range, 403 role cells, cross-user 404, filter/pagination payloads verified). Unit tests still 13/13. DB reseeded to canonical state afterwards.

### Week 3 — Requests Management, list pane (Section 4 page, web)
- **`web/src/pages/RequestsPage.tsx`**: monitor request list against `GET /requests` — category chip filters (the fixed `--cat-*` palette, chips toggle), service + priority selects (`GET /services` feeds the dropdown), 350ms-debounced search, pagination (20/page). All filters live in the URL (`useSearchParams`) so refresh/back/deep-links preserve state; any filter change resets to page 1. 30s silent polling like the dashboard. States: skeleton rows, error + retry, "board is clear" empty vs "no matching requests" empty with Clear filters. Status pills reuse the category palette, always paired with the seeded label text.
- Detail pane + assignment is Week 4 — rows are deliberately not clickable yet (no dead affordance).
- Verified headless-Edge: 15/15 checks (rows, pager both directions + disabled edge, chip/service/search filters against live data, deep-link param → UI state, 390px no body overflow, zero console errors). Lint + `tsc -b` + build green.

### Week 4 — workflow engine + assignment + task endpoints (commits `129f819`, `df99be0`)
- **Workflow engine** (`backend/src/lib/workflowEngine.js`): the one module that writes `REQUEST.status`/`TASK.status`. Order: lock request row (`FOR UPDATE`) → ownership (404-over-403) → transition exists (409) → role (403) → note (422) / completion-form (409) → statuses + history + notifications in one transaction. Pure core (`resolveTransition`, `validTransitions`) covered by 11 unit tests (24 total green). `beforeCommit` hook lets assign (and Week 5 `/complete`) join the transaction.
- **Tasks routes** (`backend/src/routes/tasks.js`, employee-only): list (standard params), detail (embeds requester name+phone — never email — and strips `visible_to_employee:false` fields), valid-transitions, accept/reject/status — all via the engine.
- **Assignment** (`PATCH /requests/{id}/assign`): no status key in code — the assign-target status is derived as the from-status of the workflow's `accept` transition. First assign / post-reject reassign execute the monitor transition into it (task upserted in the same tx); otherwise an in-place reassign (employee_id + assigned_at only, history note per §5). Cross-dept 422, duplicate no-op 409, terminated/closed 409. Approval gate emerges from data: a Submitted A request can't be assigned (409) while a Booked B request can.
- **`GET /employees`** (monitor-only read list) pulled forward from Week 6 for the assignment UI picker; writes stay in Week 6. Seed gained a second IT employee (`tech2@monitorflow.dev`) so reassignment is demoable.
- Error middleware now maps `WorkflowError.status` and express.json's 400s instead of 500.
- Smoke-tested 36/36 against seed (approval gate, cross-dept, duplicate, reassign-in-place + history note, 404 cells, field stripping, note/completion-form gates, reject→queue→task-row reuse, concurrent accepts race). Reseeded to canonical afterwards.

### Week 4 — Requests Management detail pane + assignment UI (commit `39d1367`)
- **`web/src/pages/RequestDetailPane.tsx`**: row click (or deep link `/requests/:id`, filters preserved in the query string) opens the detail pane — status pill + priority + requester, assignment block (assign/reassign with department-filtered employee picker, inline 409/422 errors), form response rendered with labels from the form schema, category-dotted timeline with notes, comments (read — posting is Week 5), attachments metadata. Detail refreshes on window focus (not a timer, per the polling rules); Esc or × closes back to the filtered list. In split mode the table drops to service/requester/status columns; under 1000px the detail takes over.
- **Backend**: `GET /requests/{id}` now embeds `task` (id, employee, assignedAt) so the pane needs no extra endpoint.
- Verified headless-Edge: 18/18 checks (assign→pill+timeline update, reassign note, approval-gate 409 inline, deep link, 404 pane, mobile takeover, no unexpected console errors). Lint + build green. Reseeded after.

### Weeks 1–3 — mobile / Student 1 (commits `c5a617b`, `e26677b`, + renderer tests, `c12a00a`)
- **Flutter scaffold + auth** (`mobile/`): single codebase, role-routed post-login (user/employee; monitor rejected to web). API client (`lib/api/api_client.dart`) with per-field 422 mapping, 401 session drop, Android-emulator-aware base URL. Session restore revalidates via `GET /auth/me`. Login/Registration with all designed states. Design tokens converted from `web/src/styles/tokens.css` incl. the shared `--cat-*` palette (`lib/theme.dart`).
- **Dynamic form renderer** (`lib/forms/`): all 8 field types from any `field_schema`, client validation mirroring `validateFormResponse` (same messages), server 422 authoritative via `applyServerErrors`, unknown type → disabled placeholder (blocks if required), photo stubbed until Week 5 files backend. 9 widget tests use both seeded schemas as fixtures — the Week 2 zero-code-differences must-pass.
- **User app pages** (`lib/user/`): Home (recent requests, 30s poll), Catalogue (`GET /services`), Create Request (dynamic form → `POST /requests`), My Requests list (30s poll, pull-to-refresh) + Details/Timeline (one `GET /requests/{id}` call, category-dotted timeline, on-resume refresh). Loading/empty/error states everywhere.
- **Week 3 gate passed:** both services submitted from the app appear in Monitor. 15 Flutter tests green. Known gap: detail "Your answers" shows prettified field ids, not schema labels — planned with Week 5 detail work.
- Dev note: mobile verification runs the Windows desktop build (requires Windows Developer Mode); Android emulator uses `10.0.2.2` automatically, or override with `--dart-define=API_BASE_URL`.

### Week 5 — backend complete (branch `hamza`, commits `fe2e37f`, `5c53c63`, `5d80c7c`, `1fc85f0`)
- **Comments** (`POST/GET /requests/{id}/comments`): user own (cross-user 404), monitor any, employee 403; posting notifies the other party (owner ↔ monitors).
- **Priority** (`PATCH /requests/{id}/priority`): monitor-only, history row ("Priority changed from X to Y") under the request row lock; repeat no-op writes nothing.
- **Files backend** (`backend/src/routes/files.js`): `POST /files` (multer memory, 5 MB → 422, MIME by magic bytes — `.exe` renamed `.jpg` → 422, UUID names in gitignored `backend/uploads/`), `GET /files/{id}` (owner / assigned employee / monitor, else 404 — must-pass #17; `Content-Disposition: attachment`, Content-Type from sniffed MIME).
- **Engine override** (`resolveOverride` in `workflowEngine.js`): monitor-only, target key must exist + category `terminated` or `triage`/`in_progress`, note always; shares the engine write path. 28 unit tests green.
- **`POST /tasks/{id}/complete`**: pre-checks the complete transition (locked task → 409 before form errors), validates against the completion form (422 per-field), stores the response via `beforeCommit` in the engine transaction.
- **`PATCH /requests/{id}/resolution`**: confirmed/unresolved → confirm/dispute actions; note required for unresolved; pre-done 409 emerges from the workflow data.
- **`PATCH /requests/{id}/cancel`**: cancel target derived from the data (the user-role transition into a terminated status — no key in code); user path 409 once a task exists, enforced inside the engine transaction (race-safe, must-pass #13); a 403 from the engine on the owner's cancel is mapped to 409 (cancel window closed ≠ permissions). Monitor path = override, any state, note required.
- **`PATCH /requests/{id}/status`**: the constrained monitor override; also carries service A's approval step (`submitted → approved` is a triage-target override). Reopen past terminated unlocks the task automatically.
- Smoke: 34/34 (comments/priority/files) + 30/30 (service B full lifecycle incl. dispute loop, task lock, reopen) + 6/6 (service A E2E submit→confirmed through the approval gate). DB reseeded to canonical after.

### Week 5 — web complete (commit `dce156d`): detail pane actions
- **Actions section** in `RequestDetailPane.tsx`, derived entirely from the workflow data: buttons for monitor transitions from the current status (assign-target excluded — Assignment owns that move; e.g. Approve/Reject on a Submitted A request), standalone **Cancel request** when no workflow button already terminates (covers in_progress states via `PATCH /cancel`), **Reopen** select (triage/in_progress targets, assign-target excluded when no task) when terminated.
- Every action runs through one **confirm dialog with a required note** (Section 4 UI-state rule); Esc closes the dialog before the pane; inline server-error display.
- **Priority select** (PATCHes, timeline note appears) and **comment posting** (clears on success, notifies owner) wired in.
- Verified 16/16 headless-Edge (approve flow incl. note-required block, Esc behavior, priority, comment, cancel→reopen round trip, zero console errors). Lint + `tsc -b` + build green. Reseeded after.

**Week 5 is complete** — both gates pass: both services E2E submit→confirmed; PATCH on a cancelled task 409.

### Week 6 — backend complete (branch `hamza`, commits `e0a9542`, `af59244`, `c97e947`, `ee75775`)
- **Notifications read** (`backend/src/routes/notifications.js`): `GET /notifications?userId=me` (own-only every role, page/pageSize + unread count), `PATCH /{id}/read` (cross-user 404, idempotent), `PATCH /read-all` (declared before `/:id/read` so the literal path wins). Triggers already existed (engine + comments) — this is the read/mark surface. Smoke 9/9 + 7/7 live (comment→notify→read round trip, cross-user 404).
- **Users profile** (`backend/src/routes/users.js`): `GET/PATCH /users/me` (name+phone; email/role immutable), `PATCH /users/me/password` (current password required, bcrypt 10, wrong-current → 422 field-keyed). Own-only, any role.
- **Departments** (`backend/src/routes/departments.js`): `GET /departments` monitor-only read (Employees Mgmt picker). Users smoke 14/14 (incl. password change + revert, dept 403 for user/employee).
- **Employees writes** (`backend/src/routes/employees.js`): `POST` (monitor sets initial password, dup email 422), `PATCH /{id}` (name/phone/dept), `/activate`, `/deactivate` (**409 when the employee holds any non-final task — finality read from workflow `statuses` JSONB, no status key in code**), `/reset-password` (server-generated temp password returned once, no forced-change flow), `GET /{id}/tasks`. Non-employee ids 404 on this surface. Smoke 16/16 (incl. deactivate-with-open-task 409, deactivated fresh-login 401).
- **Reports + CSV** (`backend/src/routes/reports.js` + `backend/src/lib/requestQuery.js`): extracted the ONE request-query builder (`buildRequestFilter`) and refactored `GET /requests` onto it (behavior-preserving) so reports reuses it, not a second engine. `GET /reports` = filtered list + aggregate counts (by category/priority/service); `GET /reports/export.csv` = same filters, frozen columns, `completed_at` derived from the first done-category history row, CSV-injection guard (`'`-prefix on `=+-@`). Monitor-only. Smoke 17/17 (must-pass #11 non-monitor export 403, injection escaped, `GET /requests` regression clean). Unit suite 28/28.

### Week 6 — web complete (commit `a3d60d8`): Employees Management + Basic Reports
- **`web/src/pages/EmployeesPage.tsx`** (Section 4 page): monitor list against `GET /employees` — department filter (`GET /departments`), debounced name/email search, pagination, all in the URL. Add/Edit dialogs (create sends initial password, edit is name/phone/department), Activate/Deactivate, Reset password. Deactivate is a confirm dialog; a **409 (open tasks) renders inline** ("reassign them first"). Reset-password reveals the server temp password once. 422 `{errors}` render per-field (via a new `body` on `ApiError`). Skeleton / error+retry / empty states. No polling — admin surface, reloads after each write.
- **`web/src/pages/ReportsPage.tsx`** (Section 4 page): monitor view against `GET /reports` — category chips + service/priority selects + date range + search (the shared RequestsPage vocabulary), aggregate cards (total, by category/priority/service), filtered read-only table. **Export CSV** button downloads `GET /reports/export.csv` via an authed blob (can't be a plain link — needs the bearer header).
- Removed the now-dead `ComingSoon` stub — all 5 Monitor web pages exist. `ApiError.body` carries the parsed 422 body for per-field errors.
- Verified headless-Edge 9/9 functional (create validation, created row appears, deactivate-409 inline, reset-temp shown once, 4 aggregate cards, category filter narrows breakdown, CSV downloads). tsc + lint + build green. Reseeded after.

**Week 6 is complete.** MVP backend + Monitor web are done; both Week 6 gates pass (file IDOR/bad-upload from W5; CSV opens + injection escaped). Remaining across the project is Student 1's Flutter surface (Employee app, Notifications/Profile, photo upload — form renderer + Create Request landed above). DB reseeded to canonical after each feature.

### Week 4 — mobile / Student 1 (commit `bd2df5e`): Employee app
- **Employee Home + My Tasks** (merged Section 4 page, `mobile/lib/employee/`): task queue from `GET /tasks` — status pills, high-priority marker, 30s polling, pull-to-refresh, loading/empty/error states.
- **Task Details**: the limited `GET /tasks/{id}` view (requester name+phone, never email; `visible_to_employee:false` fields arrive pre-stripped). Action buttons driven entirely by `GET /tasks/{id}/valid-transitions` — no status keys in code.
- **Accept / Reject**: accept confirms; reject requires a note (dialog, button disabled until typed) and returns the request to the monitor queue. Concurrent-change 409s surface the server message and reload.
- Verified on Windows against seed: accept flow, Monitor-assign → appears in queue ≤30s, reject → note in Monitor timeline, gate-code stripping for the Facilities employee. 15 Flutter tests green.
- **Week 4 Student 1 is done.** Deferred to Week 5: generic status updates + Complete Task (detail shows an honest "next build" note past accept).

### Week 5 — mobile / Student 1 (commit `df9471e`): lifecycle closes
- **Update Task Status**: generic workflow moves as buttons on Task Details (note dialog when `requires_note`), via `PATCH /tasks/{id}/status`.
- **Complete Task** (Section 4 page): completion FORM_DEFINITION rendered through the same dynamic form engine, confirm dialog, `POST /tasks/{id}/complete` with per-field 422; 409 (task moved under us) surfaces and reloads.
- **User resolution + cancel** on Request Details: confirm/dispute card from a done-category status, cancel only while no task exists — all derived from `GET /services/{id}/workflow` (categories + actions, no status keys in code; `WorkflowDef` unit-tested).
- **Schema-labelled answers**: shared `FormResponseView` (option labels, Yes/No booleans, photo marker) on both detail screens — closes the prettified-ids gap.
- Verified on Windows against seed: awaiting-parts hold loop, complete → dispute → re-complete → confirm, cancel-with-note, no-cancel-once-assigned, both services. 19 Flutter tests green.
- **Week 5 Student 1 is done.** Remaining Student 1: Notifications + Profile (shared component), photo upload.

### Week 6 — mobile / Student 1 (commits `d142735`, `8ec7c17`): MVP mobile complete
- **Notifications** (shared Section 4 component, both apps): bell + unread badge in both app bars (30s poll), list with type icons, mark-read on tap, read-all; tap-through opens the request (User) or the matching task (Employee).
- **Profile** (shared): name/phone edit (`PATCH /users/me`), password change (`PATCH /users/me/password`, per-field 422); email/role immutable.
- **Photo upload**: renderer photo field is real where an upload target exists — Complete Task uploads via `POST /files` (taskId) and puts the attachment id in the response (two-step contract). Verified E2E: technician's photo downloadable by the monitor.
- **Cross-surface fix** (`d142735`, touches Student 2's files — flagged): `GET /requests/{id}` now embeds task-linked attachments (completion photos were invisible to the Monitor pane); web attachment filenames are authed-blob download links.
- **✓ Contract gap resolved — Option A** (commits `d7e3f85`, `cf13cfa`, decided by Student 1; touches Student 2's backend — review welcome): migration `002_pending_uploads.sql` allows parentless "pending" attachments (user-role uploads only, uploader-only visibility until linked); `POST /requests` links photo-field ids inside its transaction with an atomic owner+unlinked re-check (reuse/steal → 422). Request-form photos now work end-to-end from mobile. Smoke 9/9, unit tests 28/28.
- **All 14 Section 4 pages now exist.** 19 Flutter tests green.

### Web polish — Student 1's React contribution (4 features, decided by both students)
- **Attachment provenance badges** (`96441e9`…): request detail attachments carry `source`/`taskId`; the Monitor pane badges each file "Before" or "Task N · After" (neutral pills — status categories keep exclusive claim on color).
- **Employee workload summary**: employee names in Employees Management open a dialog — per-category count pills + scrollable task table, consuming the previously-unused `GET /employees/{id}/tasks`.
- **Reports by employee**: `employeeId` added to the shared query builder (additive extension of the frozen Section 7 params — flagged), so `GET /reports`, the CSV export, and `GET /requests` all accept it; Reports gains an employee dropdown (inactive staff marked) that carries into Export CSV.
- **Web notifications bell**: shell-bar sibling of the mobile shared component — unread badge (30s poll), dropdown with mark-read → deep-link to the request pane, mark-all-read.
- All verified live in the browser; tsc + lint + build green; backend unit tests 28/28.

### Spec v4 slice 1 — admin role + monitors surface + audit writes (backend)

Per `docs/spec_v4_amendment.md` (DRAFT — supervisor-requested; built first because every variant of the sign-off wants it). Service JSON-import is deliberately held until sign-off (open question #3 could reshape it).

- **Migration `003_admin.sql`**: `admin` in the role check, 3 nullable escalation-threshold columns on `service_type` (W5 sweep), `audit_event` table + index.
- **`requireRole(...roles)`** (varargs, backward compatible); `GET /departments` now monitor+admin.
- **Admin lockout**: router-level allowlist on `/requests` (`user`/`employee`/`monitor`) — without it admin fell through the per-route "employee → 403" checks to monitor-level visibility (v4 must-pass #20). Dashboard/employees/reports/tasks already 403 via their single-role gates.
- **`backend/src/routes/monitors.js`** (admin-only): list/create/edit/activate/deactivate/reset-password, mirroring the employees surface; non-monitor ids 404; **last-active-monitor deactivate → 409** (v4 must-pass #23).
- **Audit trail** (`backend/src/lib/audit.js`): `logAudit` inside `withTx` — every monitors/employees write commits its `audit_event` row atomically; details carry emails/changed fields, never passwords. Read endpoint (`GET /audit-events`) is W4.
- Seed: `admin@monitorflow.dev` account; `audit_event` in the truncate list.
- Smoke 39/39 (role cells incl. must-pass #19/#20/#23, created-monitor login + operational access, temp-password round trip, 404 shaping, deactivated-JWT 401, audit rows for all 7 action types). Unit tests 28/28. Reseeded to canonical after.

### Spec v4 slice 2 — Monitors Management page + admin shell routing (web, commit `351a1a6`)
- Admin uses the web console: `AuthContext` accepts monitor+admin, `RoleRoute` in `main.tsx` role-gates every page (admin ↔ monitor deep links redirect), shell nav is role-dependent, bell hidden for admin (no triggers target it). `MonitorsPage.tsx` = Employees Management clone (create/edit/activate/deactivate/reset-password, last-monitor 409 inline). Verified live in headless Edge; tsc + lint + build green.

### Spec v4 slice 3 — department-scoped monitors (amendment Section J)
- **Every monitor belongs to a department**; scope = requests whose service type is in it, everything else 404. Enforced at: `buildRequestFilter` (list/reports/CSV in one place), the engine's post-lock check (all transitions/overrides/cancel/assign), request detail/comments/priority, file downloads, dashboard stats+chart.
- **Employees management scoped**: monitor manages own-department staff only (cross-dept ids 404, cross-dept create/move 422). `GET /departments`: monitor sees own only; admin all — keeps every web picker correct with zero client-side filtering.
- **Notifications scoped**: task_rejected + comment fan-out to the request's department's monitors only.
- **Monitors surface**: `departmentId` required on create, editable, embedded in responses; MonitorsPage gains the department column + picker.
- Seed: `monitor@` → IT, `monitor2@` (Malak) → Facilities; demo history actors per department. Smoke 31/31 (cross-dept 404 cells, scoped dashboard/reports/CSV totals, notification fan-out checks, file IDOR across departments, regressions). Unit 28/28. tsc/lint/build green. Reseeded after.

### Spec v4 slice 4 — Audit Log (amendment Sections C/D)
- **`GET /audit-events`** (`backend/src/routes/auditEvents.js`, admin-only): pagination + `action`/`actorId`/`dateFrom`/`dateTo` filters, actor + entity names joined in (entity name resolves for `entity_type = 'user'`; the services slice extends the join). Non-admin 403 (must-pass #25).
- **Seeded audit trail**: seed now writes `audit_event` rows matching how accounts really enter the system — admin created the monitors, each department's monitor created its employees — so the page has honest demo data from a fresh seed.
- **`web/src/pages/AuditPage.tsx`** (Section 4 page #17): read-only table (When/Actor/Action/Target/Details), closed-list action select + native date range, URL-backed filters, skeleton/error/empty states, pager. Admin nav gains "Audit Log".
- Smoke 12/12 (shape, all filters, 400s, pagination, 403/401 cells). Unit 28/28. tsc/lint/build green.

### Spec v4 slice 5 — smart notifications (amendment Section E)
- **Escalation sweep** (`backend/src/lib/escalation.js` + interval in `index.js`, default 5 min, `ESCALATION_SWEEP_MS=0` disables): three category-driven rules per service-type thresholds (NULL = off) — unassigned too long → department monitors; stale `in_progress` → department monitors; `done` awaiting confirmation → the request owner. Dedup without schema: skip while an `escalation` notification newer than `updated_at` exists (one alert per stagnation period; any status change re-arms). Migration `004` adds the `escalation` notification type. First run 3s after boot so a fresh seed escalates visibly.
- **Seed**: demo-friendly thresholds on both services (unassigned 4h / stale 20h / confirm 24h) — the seeded queue fires all three rules on first sweep (3 unassigned, 4 stale, 2 confirm).
- **Assignment suggestions**: `GET /employees` gains `openTaskCount` (non-final tasks, finality from workflow JSONB); the detail-pane picker sorts least-loaded-first and marks the top option "Suggested" — advisory only, server does not enforce.
- Mobile notifications list renders the `escalation` type with its own icon (fallback already existed — no crash risk).
- Smoke 10/10 (all three rules fire, department/owner recipients verified, dedup, re-arm after a status change, openTaskCount). Unit 28/28. tsc/lint/build green. Reseeded after.

### Pre-freeze polish — five small features (decided by Student 1, W7 Monday)
- **Requests Management: Age column** (`9851f8f`): relative time since `updated_at` (m/h/d, exact time on hover) — the board-level view of the escalation story. Hidden in split mode.
- **Audit Log: actor filter** (`b3906e2`): URL-backed actor select over the existing `actorId` param; options from `GET /monitors` + the signed-in admin; inactive monitors listed.
- **Task Details: tap-to-call** (`e9271fd`, `57c4b09`): requester phone is a `tel:` button (url_launcher); seed accounts gained phone numbers so it's demoable.
- **My Requests: category chips** (`f2187d1`): the employee-queue chips extracted to shared `widgets/category_chips.dart` (counts-map API) and reused; toggle-to-filter with clear-filter empty state.
- **Request Details: "Request again"** (`52c681a`): on a closed/terminated request, reopens Create Request prefilled from the old `form_response` via new renderer `initialValues` (photo ids deliberately dropped — server rejects reuse); catalogue re-checked in case the service was disabled. Renderer widget test added (20 green).
- Verified: web features live in headless Chromium (tsc/lint green); mobile via analyze + 20 widget tests + Windows release build. **Manual on-device pass of the three mobile features still worthwhile before freeze** (tap-to-call especially — tel: behavior differs per device).

### Guard hardening — department-scoped last-monitor rule (`9bb04f3`, `76c13f9`)
- Deactivating or moving (`departmentId` edit) the last active monitor **of a department** → 409. An orphaned department was a silent outage: requests invisible to every monitor, all monitor-facing notifications (incl. the escalation sweep) inserting zero rows. Strengthens v4 must-pass #23 from global to per-department. Seed gains a second IT monitor (Majed, `monitor3@monitorflow.dev`) so a successful deactivation stays demoable.

### Week 7 — Android release build check (Student 1)
- `flutter build apk --release` builds green (50.1 MB). First run failed on a corrupted (empty) local NDK 28.2.13676358 — deleted per Flutter's fix note and Gradle re-downloaded it cleanly.
- **Release-blocker manifest fixes** (verified inside the APK via `aapt dump badging`): `INTERNET` permission added to the main manifest (release doesn't inherit the debug/profile overlays — a release APK had zero API access); `tel:` package-visibility `<queries>` entry so tap-to-call resolves the dialer on Android 11+; app label `monitorflow_mobile` → `MonitorFlow`.
- **Demo note:** a release APK on a *physical* device defaults to `http://10.0.2.2:3000` (emulator-only). Build device demos with `--dart-define=API_BASE_URL=http://<host>/api/v1`.

### Spec v5 — map feature (amendment `docs/spec_v5_map_amendment.md`, plan `docs/map_feature_plan.md`)

- **Slice 0 — decision record**: amendment doc written; CLAUDE.md Sections 2/8/12 carry inline pointers (narrow reversal of the map-picker cut; GPS tracking stays removed; `location` = 9th field type; no new pages; matrix/triggers unchanged). Freeze slips to next Monday — agreed by both students 2026-07-07.

## Seeded dev accounts

All password `Password123!` (re-run `npm run seed` to reset):

| Email | Role |
|---|---|
| admin@monitorflow.dev | admin (spec v4) |
| monitor@monitorflow.dev | monitor (IT) |
| monitor2@monitorflow.dev | monitor (Facilities) |
| tech@monitorflow.dev | employee (IT) |
| tech2@monitorflow.dev | employee (IT) |
| cleaner@monitorflow.dev | employee (Facilities) |
| user@monitorflow.dev | user |

## Next

- **MVP is feature-complete across all three surfaces.** Merge `student1/flutter-form-renderer` to `main`.
- **Decide the request-form-photo contract gap** (see Week 6 mobile ⚠) — both students, before the W7 Wednesday freeze.
- **Week 7:** freeze Wednesday · Section 13 test suites (S1: renderer widget tests exist, add API/permission suite support; each student attacks the other's surface — S1 probes the API with curl/Postman, S2 tries to break the apps) · Android release build check · deploy (Render/Railway; localhost fallback decision by Friday).
- **Week 8:** two timed demo rehearsals on the deployed system, fresh seed, backup screenshots/video, report.
- **Branch discipline:** Student 2 on `hamza`, Student 1 on `student1/flutter-form-renderer`; merge to `main` per verified feature (or at least twice a week), keep `main` green.

## Future work (post-MVP, for the report)

- **Internal monitor↔technician note channel.** Today comments are a customer-facing channel only (requesting user ↔ monitors; employees are excluded server-side per Section 6, and the completion photo is the only tech→everyone artifact). In a real field-ops deployment a monitor needs to relay info to the assigned technician ("customer says the gate code changed", "bring extra RAM"). This is a genuine gap but **deliberately out of the MVP** (Section 12 scope was cut twice; adding it touches the Section 6 permission matrix + its test suite, the Section 7 notification-trigger table, and the employee Task Details UI).
  - **Design note:** the clean version is a *separate* internal channel, **not** opening the existing customer comment thread to the technician — merging the tech into that thread would expose customer messages to the tech and vice versa. Model it as its own note type (e.g. monitor→employee) with its own notification trigger.
  - **Interim mitigation (already works):** monitor→tech intent flows via assignment/reassignment notes, status-change notes, and rejection notes — all recorded in the timeline and pushed as notifications.

## Local setup reminders

- Postgres 18 local service, DB `monitorflow`, creds in `backend/.env`
- Run order for a fresh start: `npm run migrate` → `npm run seed` → `npm start`
- Web: `cd web && pnpm dev` → http://localhost:5173 (backend must be on :3000 for the proxy). Browser checks use Playwright with installed Edge (`channel: 'msedge'`); there is no Chrome on the dev machine.

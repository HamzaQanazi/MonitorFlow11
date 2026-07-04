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

**Week 6 backend is complete.** Remaining Week 6 items are the two React pages (Employees Management, Basic Reports — Section 11 Student 1) and Student 1's Flutter Notifications/Profile + photo upload. Backend for all of these is now live. DB reseeded to canonical after each feature.

## Seeded dev accounts

All password `Password123!` (re-run `npm run seed` to reset):

| Email | Role |
|---|---|
| monitor@monitorflow.dev | monitor |
| tech@monitorflow.dev | employee (IT) |
| tech2@monitorflow.dev | employee (IT) |
| cleaner@monitorflow.dev | employee (Facilities) |
| user@monitorflow.dev | user |

## Next

- **Week 2, Student 1:** Flutter dynamic form renderer (all 8 field types) against `GET /services/{id}/forms/request`. Week 2 must-pass: renderer draws both request forms with zero code differences.
- **Week 3 gate:** vertical slice v1 — phone submits → appears in Monitor. Backend + Monitor side is done; the gate now waits on Student 1's Create Request flow.
- **Week 6 (Student 2):** notifications read endpoints, employees writes (create/edit/activate/deactivate/reset-password/tasks), users profile routes, `GET /departments`, reports + CSV export (reuse the requests query engine).
- **Branch discipline:** work happens on `hamza`; merge to `main` per verified feature (or at least twice a week), keep `main` green.
- **Student 1 (unchanged):** Flutter form renderer + Create Request (Week 3 gate), then Employee app pages on the new `/tasks` endpoints.

## Local setup reminders

- Postgres 18 local service, DB `monitorflow`, creds in `backend/.env`
- Run order for a fresh start: `npm run migrate` → `npm run seed` → `npm start`
- Web: `cd web && pnpm dev` → http://localhost:5173 (backend must be on :3000 for the proxy). Browser checks use Playwright with installed Edge (`channel: 'msedge'`); there is no Chrome on the dev machine.

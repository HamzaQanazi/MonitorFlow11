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
- **Week 4 (Student 2, remaining):** Requests Management detail pane + assignment UI (web) on the new endpoints.
- **Week 5:** `POST /tasks/{id}/complete` (via the engine's `beforeCommit`), `PATCH /requests/{id}/resolution`, monitor override + cancel, comments, files backend.

## Local setup reminders

- Postgres 18 local service, DB `monitorflow`, creds in `backend/.env`
- Run order for a fresh start: `npm run migrate` → `npm run seed` → `npm start`
- Web: `cd web && pnpm dev` → http://localhost:5173 (backend must be on :3000 for the proxy). Browser checks use Playwright with installed Edge (`channel: 'msedge'`); there is no Chrome on the dev machine.

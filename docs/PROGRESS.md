# MonitorFlow

Configuration-driven service-request and field-operations platform: two Flutter mobile apps (User, Employee) and one React web console on one Node/Express + Postgres backend.

**The thesis:** structurally different service sectors — different form fields, different workflow shapes, different approval rules — run through the *same* code via JSON configuration. Two engines make this true: a **dynamic form engine** (forms rendered and validated from a JSON `field_schema`) and a **dynamic workflow engine** (transitions validated against a JSON workflow). No status key is ever hardcoded in application code — code reasons only about `is_terminal`, capabilities, and actors.

`CLAUDE.md` is the authoritative spec. `openapi.yaml` is the frozen API contract. This file is the feature/status reference and operator guide, and is written against the **shipped code**, not the spec drafts.

---

## Status

**Feature-complete across all three surfaces.** The Operiva migration (Phases 1–7) is done, and the current model is the one described throughout this file: three account kinds, capability + subtree permissions, `is_terminal` instead of status categories.

Automated checks, last run 2026-07-19:

| Suite | Result |
|---|---|
| Backend, unit + API (`cd backend && npm test`) | 98/98 |
| Flutter widget (`cd mobile && flutter test`) | 22/22 |
| Web build (`cd web && npm run build`) | green |

**Not done, and required before submission:**

1. **The automated release gate is closed.** Every §14 must-pass negative now has a test (98 backend, 22 Flutter). What remains is human, and only on the web app, which has no automated coverage. Its **happy path is verified** — every page was walked through by hand against seeded data (English, local build, as of 2026-07-19) and behaved correctly. What that pass does *not* reach, and `docs/WEB_E2E_CHECKLIST.md` exists to cover: **Arabic / RTL** on every page (I6), **server-side refusals** for each denied action (a hidden button is not authorisation — I3), and the **loading / empty / error** states, which a seeded database and a running backend never show. *Why this matters, concretely: on 2026-07-18 a change shipped that made the web console impossible to log into for every employee (`type="email"` rejecting a numeric login). The page looked fine; it was found by eye during unrelated work.*
2. **Not deployed.** No host configuration exists (`render.yaml` / `Procfile` / `Dockerfile` — none). CLAUDE.md §4 asks for one free-tier cloud host; §14 wants manual acceptance run on the deployed build.
3. **Manual acceptance not recorded.** §14 asks that the core flows be run on every seeded service by the student who did *not* write that layer. No record of that run exists.

Known demo residue: `Root Operator` (user id 12) is left over from testing `POST /config/employees` and appears on the Org page as a second all-capability root. There is no delete, so deactivate it before a demo.

---

## Tech stack

- **Mobile:** Flutter, single codebase, role-routed after login (`user` / `employee`; admins are web-only).
- **Web:** React + Vite + TypeScript. Design tokens in `web/src/styles/tokens.css` (OKLCH). Dev proxy `/api` → `:3000` (the backend has no CORS by design).
- **Backend:** Node.js + Express, plain JavaScript, REST under `/api/v1`. Raw SQL via `pg` — no ORM. JWT HS256 24h, bcrypt cost 10, login rate limit, deactivated accounts rejected at JWT validation.
- **Database:** PostgreSQL + PostGIS. JSONB for form/workflow definitions and responses; `SELECT … FOR UPDATE` on every status-mutating operation; the request pin is `GEOGRAPHY(Point,4326)` (reads alias `ST_Y`/`ST_X` back to `lat`/`lng`, so the API shape and both map clients are unchanged).
- **Migrations:** 11 plain `.sql` files in `backend/migrations/`, applied in filename order by `src/migrate.js`.
- **Files:** local disk under gitignored `backend/uploads/`, UUID names, DB stores metadata only.

---

## Roles and the two-gate permission model

Three account kinds only — `admin`, `employee`, `user`. **There is no "monitor" role.** Oversight is an employee whose level grants oversight capabilities.

- **Gate 1 — capability.** Fixed catalogue in `backend/src/lib/capabilities.js`: `view_all · assign · set_priority · override · manage_employees · export`. An `employee_level` grants a subset through `level_capability`.
- **Gate 2 — subtree scope.** `users.manager_id` is a self-reference; a recursive CTE (`lib/scope.js`) yields self + all descendants. An employee sees the requests whose service `owner_id` sits in their subtree, and can assign only to employees in it. Assignment is therefore downward-only.

Admins gate by role (`requireRole('admin')`) and hold **no** capabilities — they configure, they do not work the queue. Both gates are enforced server-side on every guarded action. "Own only" resources add an ownership check, and a valid ID owned by someone else returns **404**, not 403, so IDs cannot be probed.

---

## The seeded deployment (the thesis, proven)

The seed sets up a **municipality**: one City Manager over three departments, seven services, three structurally different workflows. This is *data*, not spec — the engine is agnostic to it.

| Department | Services | Workflow shape | Statuses / transitions |
|---|---|---|---|
| Public Works | `pothole`, `streetlight`, `water_leak` | dispatch + hold loop | 9 / 13 |
| Sanitation | `bulky_waste`, `missed_collection` | lean scheduled pickup | 6 / 9 |
| Licensing | `building_permit`, `business_license` | approval gate + reject terminal | 9 / 14 |

The structural differences are what the demo points at: Licensing has a third terminal status (`rejected`) that the others do not; Sanitation has no hold loop and three fewer statuses; Public Works has an `awaiting_materials` hold. Same code, different JSON.

All seven accept external users. A service with `accepts_external_users = false` is hidden from the `user` catalogue and rejects a `user` submission with 403.

---

## Features

### Auth
- `POST /auth/register` (creates the `user` kind only), `POST /auth/login`, `GET /auth/me`. No API path creates an admin.
- **One login column, one lookup, one flow.** `login_identifier` holds an email (admins, external users) or a **4-digit employee number**. Employees are numbered `1000 + department_id × 100` plus the lowest free offset — a block of 100 per department, `1000–1099` for employees with no department. The server allocates it (`lib/employeeNumber.js`, advisory lock per block, 409 when a block is full); a client never supplies one. Migration 011 renumbered accounts in place.
- Standard list params on every list endpoint: `page` / `pageSize` (≤100) / `status` / `state` / `serviceTypeId` / `priority` / `dateFrom` / `dateTo` / `q`. **`state` is `open|closed`, derived from `is_terminal`** — the old six-way `category` enum is gone.

### Dynamic form engine
- 9 field types: `text`, `multiline`, `number`, `date`, `dropdown`, `radio`, `checkbox`, `photo`, `location`.
- One generic backend validator (`lib/validateFormResponse.js`): required / type / min-max / option-membership, rejects unknown keys, errors keyed by field `id` (422). `photo` verifies attachment ownership; `location` must be exactly `{lat, lng}` in range.
- The Flutter renderer draws any schema with zero per-service code. Client validation mirrors the server; the server's 422 is authoritative. An unknown field type renders a disabled placeholder and blocks submit if required.
- Seed-time validation (`lib/formSchema.js`) runs before any insert: unique ids, valid types, options present exactly when required, min ≤ max, bilingual labels, at most one location field per form.

### Dynamic workflow engine
- **One module** (`lib/workflowEngine.js`) writes every `request.status` / `task.status`. Order: lock the request row → transition exists from the current status → Gate 1 (capability) and/or Gate 2 + ownership (actor) → note / completion-form requirements → write both statuses and a history row in one transaction → commit → fire notifications and webhooks.
- A transition is gated by **exactly one** of `required_capability` (oversight) or `actor` (`requester` | `assignee`). Transitions are one-way; a reassign or reopen is just another transition row. The engine has no concept of a loop.
- All cross-service logic — dashboard open/closed grouping, filters, the task lock, cancel gating — reads **`is_terminal`**, never a status key. While the current status is terminal the task is locked (409); a reopen transition unlocks it.
- Generic `GET`/`POST /requests/{id}/transitions` serve actor-gated transitions with `expected_status` for optimistic concurrency (409 on stale — exactly one concurrent fire wins). Oversight actions use `PATCH /requests/{id}/assign` · `/priority` · `/status`.

### User app (Flutter)
Login/registration · Home · Service catalogue · Create Request (dynamic form, map pin picker) · My Requests · Request Details with timeline, comments, attachments, cancel, confirm/dispute. 30s polling on lists; detail pages refresh on focus.

### Employee app (Flutter)
Home + My Tasks (list ⇄ map toggle) · Task Details · workflow transitions · Complete Task (completion form through the same renderer). `GET /tasks/{id}` embeds the requester's name and phone but **never their email**, and strips every `form_response` field whose schema sets `visible_to_employee: false`.

### Web console (React)
`LoginPage` · `DashboardPage` (open vs closed grouping, per-service and per-priority totals, 30-day chart) · `RequestsPage` + `RequestDetailPane` + `RequestsMapView` (filters, timeline, comments, assign/reassign, priority, status override) · `EmployeesPage` (list, add/edit/activate/deactivate/reset password, workload dialog, employee number column) · `ReportsPage` (+ CSV export, injection guard on `= + - @`) · `AuditPage` · `ServicesPage` · `OrgPage` · `LevelsPage` · `WebhooksPage`.

### Config API, webhooks, external users
- **`POST /config/services`** (admin) onboards a whole sector from one JSON body — service + workflow + both forms. It reuses the seed-time validators **verbatim**, creates or reuses the department, resolves an optional owner by login, and 409s a duplicate `service.key`. This is the thesis in one call: a new sector with zero code change. `GET /config/services` lists them; `PATCH` sets `enabled` / `owner`.
- **Outbound signed webhooks** (`lib/webhooks.js`): `request_created · status_changed · assigned · sla_breached`, fired after commit, fire-and-forget, HMAC-SHA256 in `X-MonitorFlow-Signature`. `assigned` is derived from a transition's `notify` containing `assigned_to` — no status key hardcoded. Secrets are write-only.
- `POST /config/employees` creates a root employee (`manager_id NULL`), which breaks the bootstrap deadlock on a clean handover where nobody holds `manage_employees` yet.

### Notifications and SLA
- Triggers: task assigned/reassigned → assignee; any status change → request owner; task completed → owner; employee rejected task → assignee's manager; comment added → the other party. Targets are **relationships** on the transition data (`created_by` / `assigned_to` / `assignee_manager`), resolved at fire time. Messages are bilingual.
- **Escalation sweep** (`lib/escalation.js`, `ESCALATION_SWEEP_MS`, default 5 min, `0` disables): a request sitting past its status's `sla_minutes` escalates **up the manager tree** and fires the `sla_breached` webhook.

### Files
`POST /files` (multipart, `requestId` XOR `taskId`, ≤5 MB → 422, MIME by magic bytes so `.exe` renamed `.jpg` is rejected, UUID names outside web root). `GET /files/{id}` is authorized per the download rules, else 404. Two-step photo contract: upload, then put the returned id into `form_response`.

### Map
`location` field type picked on an OpenStreetMap map in the User app (`flutter_map`, tap to pin). Employee My Tasks and web Requests both have list ⇄ map toggles (`react-leaflet` + clustering on web). OSM tiles, no API keys. Map views render one `pageSize=100` page under the current filters. **Continuous GPS tracking is deliberately out of scope** (CLAUDE.md I10 — outcomes are measured, never behaviour).

### Branding
Build-time, per deployment (`web/src/brand.ts`, `web/.env.example`). Company name `{en, ar}` and an optional logo come from `VITE_BRAND_*` at build time, rendered by one `<Wordmark>` component (shell + login) and used for the tab title and favicon. This deployment ships as **Municipality of Nablus / بلدية نابلس** with the municipal crest. Mobile app name and icon are build-time too (`pubspec.yaml` / `AndroidManifest.xml` / `Info.plist`). **`X-MonitorFlow-Signature` is never rebranded** — it is a wire protocol subscribers verify, not a company name.

### Bilingual + RTL
Every user-facing label is `{en, ar}`, enforced by a DB `CHECK` on both keys. The web console flips between LTR and RTL from CSS logical properties; Flutter uses directional insets and alignments. Machine keys (status keys, field ids, option values, capability keys) stay plain ASCII.

---

## Seeded accounts

`npm run seed` (re-run to reset). Password for every account: `Password123!`

| Login | Name | Kind | Level / department |
|---|---|---|---|
| `admin@city.gov` | Adam Admin | admin | — (configures; holds no capabilities) |
| `1000` | Maya Manager | employee | Manager · no department (org root) |
| `1100` | Rami Roads | employee | Manager · Public Works |
| `1101` | Ziad Field | employee | Field Officer · Public Works |
| `1102` | Zaid Field | employee | Field Officer · Public Works |
| `1200` | Widad Waste | employee | Manager · Sanitation |
| `1201` | Sami Collector | employee | Field Officer · Sanitation |
| `1300` | Peter Permits | employee | Manager · Licensing |
| `1301` | Lina Inspector | employee | Field Officer · Licensing |
| `resident@city.gov` | Rania Resident | user | — |

Two levels are seeded: **Manager** (every capability) and **Field Officer** (none). Employees sign in with the number, not the email — the email column is contact information only.

---

## Local setup

- Postgres running locally, database `monitorflow`, credentials in `backend/.env`.
- Fresh start, from `backend/`: `npm run migrate` → `npm run seed` → `npm start`.
- Web: `cd web && npm run dev` → http://localhost:5173 (backend must be on `:3000` for the proxy).
- Mobile: a Windows desktop build needs Developer Mode; the Android emulator uses `10.0.2.2` automatically. A release APK on a physical device needs `--dart-define=API_BASE_URL=http://<host>/api/v1`.

The seed refuses to run against a database that already has users, because it TRUNCATEs every table. Override with `SEED_FORCE=true` when you really mean it.

### New-company handover

1. Edit `backend/src/company-config.js` — the company's departments and services. *(Or onboard sectors through `POST /config/services` after deployment.)*
2. Change `adminAccount` and the passwords in `seed.js`.
3. Set the branding in `web/.env` (see `web/.env.example`) and rebuild the web app.
4. `SEED_DEMO_DATA=false npm run seed` — seeds departments, services, and the admin only.
5. The admin creates the first root employee through `POST /config/employees`; that person builds the rest of the tree in-app.

### Verifying a handover on a scratch database

Rehearse against a throwaway database, never the dev one. Verified 2026-07-18: migrations 001–011 apply from scratch and the seed allocates the same employee numbers as the in-place migration.

```bash
# from backend/ — create, migrate, seed a scratch DB
node -e "require('dotenv').config();const {Client}=require('pg');const u=new URL(process.env.DATABASE_URL);u.pathname='/postgres';const c=new Client({connectionString:u.toString()});c.connect().then(()=>c.query('CREATE DATABASE monitorflow_scratch')).then(()=>process.exit(0))"
DB=$(node -e "require('dotenv').config();const u=new URL(process.env.DATABASE_URL);u.pathname='/monitorflow_scratch';console.log(u.toString())")
DATABASE_URL="$DB" npm run migrate
DATABASE_URL="$DB" SEED_DEMO_DATA=false npm run seed
```

Expected clean-handover state: 3 departments, 7 services (14 form definitions + 7 workflows), **1 user — the admin only**, 0 requests / tasks / audit rows.

---

## Testing

- **Backend unit** (`npm test`, `node:test`): form validation, workflow transition resolution, form/workflow schema validation, webhook signing, employee-number allocation. Part of the **98/98** total.
- **Flutter widget** (`flutter test`): the dynamic renderer (schema → widgets, required blocking, server-error application) and the login screen. **22/22.**
- **Web:** build + lint only — no component or E2E tests at this scale, so `docs/WEB_E2E_CHECKLIST.md` is the gate instead: a per-page pass/fail list covering the cross-cutting rules (RTL, bilingual, loading/empty/error, 401/403/404) and each page's own actions. **Happy path walked by hand 2026-07-19** (English, local, seeded data) — every page correct. The checklist's negatives, Arabic/RTL, and failure states are still open.
- **API / permission suite** (`test/permissions.test.js`, harness in `testlib/harness.js`): **14/14, started 2026-07-18.** Runs against a spawned server on a throwaway `monitorflow_test` database — created, migrated and seeded per run, so the dev database is never touched. No new dependency: the server is spawned as a subprocess and driven with built-in `fetch`, which also exercises the real error middleware.
  - **Covered:** unauthenticated and malformed-token 401 · Gate 1 (a Field Officer inside the subtree is refused assign / priority / override / employee management / CSV export, with a positive control proving the endpoint works for a capable level) · Gate 2 (a fully capable head is 404 on another subtree's request for both read and write; each head sees only their own; the org root reaches every subtree; an out-of-subtree assignee is 422 while the same call with an in-subtree assignee is 200) · admins refused on every operational endpoint and the only kind allowed on config · cross-user request 404-not-403, and a fresh user's list scoped to them.
- **Workflow-engine negatives** (`test/workflowNegatives.test.js`): **15/15, added 2026-07-18.** Every case is derived from the stored `workflow_definition` at runtime — no status key is hardcoded, so the suite works against any seeded sector, not just this one.
  - **Covered:** override to a status not in the workflow 422 · override with no note 422 · override to the status it already holds 409 · override back to the initial status 422 · a transition that exists but not from the current status 409 · unknown transition key · missing transition key 422 · wrong party on an assignee-gated transition · stale `expected_status` 409 · **two concurrent identical fires — exactly one 200 and one 409** · duplicate assign 409 · reassignment to a different employee 200 · deactivating an employee who holds an open task 409 · a terminal request offers no transitions and refuses one fired anyway 409 · a deactivated account's already-issued JWT 401.
  - Later additions to the same file: the cancel-vs-assign race (one wins, the other 409) and confirm-before-done 409.
- **Submission, upload and file-access negatives** (`test/submissionNegatives.test.js`): **added 2026-07-19.** Dynamic-form negatives through the API (unknown field id, missing required, out-of-range — all 422 field-keyed, with a positive control) · an employee cannot submit · an internal-only service is hidden from the external catalogue and 403s a user submission · duplicate `service.key` 409 with no second row · `.exe` renamed `.jpg` rejected by magic bytes · upload >5 MB rejected · a genuine JPEG accepted · downloading another user's file 404, and a non-existent id the same 404 so ids cannot be probed · CSV export refused for a field employee and for a user, allowed for a capable head.
- **Every §14 must-pass negative now has a test.** The automated gate is closed; what remains is manual.

  Suites get their own database and port (derived from the name passed to `setup()`), because `node --test` runs test files in parallel and they would otherwise drop each other's data mid-run.
- **Manual acceptance: not recorded.** §14 asks for the core flows on every seeded service, on the deployed build, run by the student who did not write that layer.

---

## Documented limitations (state these in the report; do not "fix" them)

Redundant `task.status` (intentional denormalization) · immutable definitions, no versioning — changing a live service means adding a new one and disabling the old · reassignment overwrites `employee_id` (the history row is the audit) · polling latency, no WebSockets or push · 24h JWT, no refresh or revocation · email enumeration on register · temporary passwords not force-changed · no self-service password reset · no automated frontend E2E · webhooks are at-most-once with no retry or delivery log · map views cap at 100 rows per filtered view · single organisation per deployment.

## Deliberately not built

Visual Form Builder or Workflow Config UI · standalone operations-monitor page · WebSocket live refresh · push notifications · automatic assignment (the server returns a subtree-scoped candidate list; a human chooses) · live GPS tracking, location history, behavioural monitoring · signature capture · draft saving · satisfaction ratings · multi-tenancy · payments · advanced BI · named vendor integrations (MonitorFlow emits webhooks; the deployer wires them) · request deadlines · form/workflow versioning · refresh tokens.

---

## Proposed extensions (approved in principle, none built)

These were drafted **before** the Operiva migration, so their original wording used the retired "monitor" role and status categories; the summaries below are restated in the current model. None has a start date. Each would need a deliberate both-students re-scope, and the release gate above should close first.

- **AI layer.** One shared module and one env var; every feature's output passes through a validator that already exists. Form auto-fill (draft a `form_response` from a sentence, guarded by `validateFormResponse.js`), triage suggestion (advisory only — never writes status or priority), and a seed-time config generator (LLM emits a form + workflow pair, piped through the existing seed-time validators, human reviews and commits). Adds no page and no runtime config endpoint.
- **Crew + internal chat.** One task with a lead plus a `task_assignee` set — chosen so `request 1—1 task`, the task lock, and the workflow engine stay untouched; the lead drives the workflow, crew members read/comment/upload. Then a `visibility` column on `request_comment` (`customer` | `internal`) for an internal oversight↔crew thread that users never see. The main cost is the permission matrix changes, each of which needs a test.
- **Ops analytics + PDF report.** Mine `request_status_history`, which already captures every transition with a timestamp and actor: time to resolution, time in status, first-response time, per-employee throughput. One read-only endpoint, cards on the existing dashboard, and a client-side PDF beside the existing CSV. *Caveat: the seed can insert rows near one instant, collapsing durations to ~0 — stagger `created_at` and `changed_at` before demoing time metrics.*

---

## Design language

Strategy and system live in `PRODUCT.md` (register, audience, principles, accessibility) and `DESIGN.md` (North Star, the Restrained Rule, Status-Owns-Color, typography, elevation). Exact OKLCH tokens, type scale, and components live in code (`web/src/styles/tokens.css`, `mobile/lib/theme.dart`) — the source of truth for values.

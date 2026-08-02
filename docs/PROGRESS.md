# MonitorFlow

Single-company workforce and field-operations platform: two Flutter mobile apps (User, Employee) and one React web console on one Node/Express + Postgres backend. One deployment = one company.

> **v7 (current).** MonitorFlow moved from a multi-sector, config-API-driven platform to a single-company workforce app provisioned with an Owner who runs a first-login onboarding wizard. **Shipped:** the JSON config API and outbound webhooks are **removed**; the municipality seed is replaced by an **Owner-provisioning seed** (`backend/src/seed.js` — one empty company + one Owner, nothing else); a `company`/`branch` schema and the **onboarding wizard** (backend + React) are in; and the **workforce feature modules** the wizard lets an Owner select — Time Clock, Schedule, Checklists, Directory, Knowledge Base, Events, Training — have since shipped (web + mobile + backend for all seven). See `CLAUDE.md` for the authoritative spec.

**The engine's thesis (still true):** structurally different service sectors — different form fields, different workflow shapes, different approval rules — run through the *same* code via JSON configuration. Two engines make this true: a **dynamic form engine** (forms rendered and validated from a JSON `field_schema`) and a **dynamic workflow engine** (transitions validated against a JSON workflow). No status key is ever hardcoded in application code — code reasons only about `is_terminal`, capabilities, and actors. The demo of that thesis no longer lives in seed data (the v7 seed ships zero services) — it's the **Add Service** wizard (`web/src/pages/AddServiceWizard.tsx`, admin-only, `POST /services`), which builds a service + both forms + a workflow through the same seed-time validators the old config API used, with a live 5-step UI instead of a JSON body.

`CLAUDE.md` is the authoritative spec. `openapi.yaml` is the API contract. This file is the feature/status reference and operator guide, written against the **shipped code**.

---

## Status

**Operational engine feature-complete; v7 workforce pivot shipped.** Three account kinds, capability + subtree permissions, `is_terminal` instead of status categories — all unchanged. v7 added first-login onboarding, removed the config API/webhooks, and shipped seven workforce feature modules beyond the original request/task engine.

Automated checks, current as of 2026-08-03:

| Suite | Result |
|---|---|
| Backend, unit + API/permission (`cd backend && npm test`) | **92/92** |
| Flutter widget (`cd mobile && flutter test` / `flutter analyze`) | **22/22**, 0 analyze issues |
| Web build + lint (`cd web && npm run build && npm run lint`) | green |
| CI | `.github/workflows/test.yml` runs all three on push/PR |

**Not done, and worth doing before submission:**

1. **The web app's manual E2E checklist is only partially run.** `docs/WEB_E2E_CHECKLIST.md` was reconciled to v7 (2026-08-03: removed the config/webhooks sections, fixed the account matrix, added sections for every page that had none — Onboarding Wizard, Departments, Time Clock, Schedule, Checklists, Directory, Knowledge Base, Events, Training). A partial live pass ran the same day: Dashboard (all panels, English + Arabic) — pass; Directory (admin happy path) — pass; one permission negative (a Staff-level employee is refused **at the login page itself**, not bounced from a gated page) — pass. Every other page, every other negative, and RTL beyond Dashboard are still unrun. *Why this matters, concretely: on 2026-07-18 a change shipped that made the web console impossible to log into for every employee (`type="email"` rejecting a numeric login). The page looked fine; it was found by eye during unrelated work — automated checks would not have caught it.*
2. **Not deployed.** No host configuration exists (`render.yaml` / `Procfile` / `Dockerfile` — none). CLAUDE.md §4 asks for one free-tier cloud host; §14 wants manual acceptance run on the deployed build.
3. **Manual acceptance not recorded.** §14 asks that the core flows be run on every seeded service by the student who did *not* write that layer. No record of that run exists — and there's no seeded service to run it against until one is created via the Add Service wizard (see below).
4. **The onboarding wizard's feature-module selection doesn't gate access.** `company.features` (the Owner's step-4 picks) is stored but never checked — every module route/page is reachable by capability alone, regardless of what was selected in the wizard (CLAUDE.md §15).

---

## Tech stack

- **Mobile:** Flutter, single codebase, role-routed after login (`user` / `employee`; admins are web-only).
- **Web:** React + Vite + TypeScript. Design tokens in `web/src/styles/tokens.css` (OKLCH). Dev proxy `/api` → `:3000` (the backend has no CORS by design).
- **Backend:** Node.js + Express, plain JavaScript, REST under `/api/v1`. Raw SQL via `pg` — no ORM. JWT HS256 24h, bcrypt cost 10, login rate limit, deactivated accounts rejected at JWT validation.
- **Database:** PostgreSQL + PostGIS. JSONB for form/workflow definitions and responses; `SELECT … FOR UPDATE` on every status-mutating operation; the request pin is `GEOGRAPHY(Point,4326)`.
- **Migrations:** 26 plain `.sql` files in `backend/migrations/`, applied in filename order by `src/migrate.js` — spanning the original engine through the v7 pivot (company/onboarding, employee generated-email logins, department heads/branches) and the seven workforce modules (time clock, schedule, knowledge base, events, training, module capabilities).
- **Files:** local disk under gitignored `backend/uploads/`, UUID names, DB stores metadata only.

---

## Roles and the two-gate permission model

Three account kinds only — `admin`, `employee`, `user`. **There is no "monitor" role.** Oversight is an employee whose level grants oversight capabilities.

- **Gate 1 — capability.** Fixed catalogue in `backend/src/lib/capabilities.js`: `view_all · assign · set_priority · override · manage_employees · export · manage_events · manage_knowledge_base · manage_training`. The last three let a level author one workforce module without also holding `view_all`'s general oversight. An `employee_level` grants a subset through `level_capability`.
- **Gate 2 — subtree scope.** `users.manager_id` is a self-reference; a recursive CTE (`lib/scope.js`) yields self + all descendants. An employee sees the requests whose service `owner_id` sits in their subtree, and can assign only to employees in it. Assignment is therefore downward-only.

Admins gate by role (`requireRole('admin')`) and hold **no** capabilities — they configure, they do not work the queue. Both gates are enforced server-side on every guarded action. "Own only" resources add an ownership check, and a valid ID owned by someone else returns **404**, not 403, so IDs cannot be probed.

---

## How a deployment comes online (v7)

`backend/src/seed.js`, run once per sale (`SEED_OWNER_EMAIL` / `SEED_OWNER_PASSWORD` env vars, defaults `owner@company.com` / `Password123!`): TRUNCATEs, inserts the fixed capability catalogue, one starter "General" department, two starter employee levels (**Staff** — no capabilities; **Manager** — `view_all` / `manage_employees` / `override`), one empty `company` row (`onboarding_completed = false`), and the Owner (`role: admin`). Nothing else — no employees, no services, no requests.

The Owner logs in, the "Customize your app in 1 minute" wizard appears (`OnboardingWizard.tsx`, gated on `onboardingCompleted`), and `PATCH /company/onboarding` (one-shot — a second call 409s) fills in company name/address/industry/branches/features/plan/branding. From there the console is live: the Owner hires staff (`POST /employees`, generated login email per `lib/employeeEmail.js`) and, if the demo needs a working service, builds one through **Add Service** (`POST /services`) — see `docs/demo/home_nursing.json` for a proven-valid form+workflow shape to adapt.

---

## Features

### Auth
- `POST /auth/register` (creates the `user` kind only), `POST /auth/login` (body: `identifier` + `password` — accepts either an email or a generated employee login), `GET /auth/me`. No API path creates an admin outside the seed.
- **One login column, one lookup, one flow.** `login_identifier` holds an email (admins, external users) or a **generated company email** for employees: two letters of the first name + `.` + last name + `@` + the company's wizard-set `email_domain` (e.g. `ha.qanazi@company.org`; a colliding name gets a number inserted, `ha2.qanazi@...`, via an advisory-lock retry — `lib/employeeEmail.js`). The server generates it; a client never supplies one. *(A legacy 4-digit-number allocator, `lib/employeeNumber.js`, is superseded and unused by `POST /employees` — pre-pivot rows keep their number.)*
- Standard list params on every list endpoint: `page` / `pageSize` (≤100) / `status` / `state` / `serviceTypeId` / `priority` / `dateFrom` / `dateTo` / `q`. **`state` is `open|closed`, derived from `is_terminal`.**

### Dynamic form engine
- 9 field types: `text`, `multiline`, `number`, `date`, `dropdown`, `radio`, `checkbox`, `photo`, `location`.
- One generic backend validator (`lib/validateFormResponse.js`): required / type / min-max / option-membership, rejects unknown keys, errors keyed by field `id` (422). `photo` verifies attachment ownership; `location` must be exactly `{lat, lng}` in range.
- The Flutter renderer (`mobile/lib/forms/dynamic_form.dart`) draws any schema with zero per-service code. Client validation mirrors the server; the server's 422 is authoritative. An unknown field type renders a disabled placeholder and blocks submit if required.
- Seed-time validation (`lib/formSchema.js`) runs before any insert: unique ids, valid types, options present exactly when required, min ≤ max, bilingual labels, at most one location field per form.

### Dynamic workflow engine
- **One module** (`lib/workflowEngine.js`) writes every `request.status` / `task.status`. Order: lock the request row → transition exists from the current status → Gate 1 (capability) and/or Gate 2 + ownership (actor) → note / completion-form requirements → write both statuses and a history row in one transaction → commit → fire notifications.
- A transition is gated by **exactly one** of `required_capability` (oversight) or `actor` (`requester` | `assignee`). Transitions are one-way; a reassign or reopen is just another transition row. The engine has no concept of a loop.
- All cross-service logic — dashboard open/closed grouping, filters, the task lock, cancel gating, SLA escalation — reads **`is_terminal`**, never a status key. While the current status is terminal the task is locked (409); a reopen transition unlocks it.
- Generic `GET`/`POST /requests/{id}/transitions` serve actor-gated transitions with `expected_status` for optimistic concurrency (409 on stale — exactly one concurrent fire wins). Oversight actions use `PATCH /requests/{id}/assign` · `/priority` · `/status`.

### User app (Flutter)
Login/registration · Home · Service catalogue · Create Request (dynamic form, map pin picker) · My Requests · Request Details with timeline, comments, attachments, cancel, confirm/dispute. 30s polling on lists; detail pages refresh on focus.

### Employee app (Flutter)
Home + My Tasks · Task Details · workflow transitions · Complete Task (completion form through the same renderer) · plus the seven workforce modules: Time Clock, Schedule, Time Off (a normal service type through the request engine, themed as its own screen — not a special case, I1), Checklists, Directory, Knowledge Base, Events, Training. `GET /tasks/{id}` embeds the requester's name and phone but **never their email**, and strips every `form_response` field whose schema sets `visible_to_employee: false`.

### Web console (React)
`LoginPage` · `OnboardingWizard` (first-login gate) · `DashboardPage` (open vs closed grouping, per-service/priority/department totals, 30-day activity chart with an open/closed stacked split, SLA-breach and reopen-rate tiles, per-employee open-workload panel) · `RequestsPage` + `RequestDetailPane` + `RequestsMapView` · `EmployeesPage` · `DepartmentsPage` · `LevelsPage` · `ReportsPage` (+ CSV export, injection guard on `= + - @`) · `AuditPage` · `AddServiceWizard` · `TimeClockPage` · `SchedulePage` · `ChecklistsPage` · `DirectoryPage` · `KnowledgeBasePage` · `EventsPage` · `TrainingPage`.

### Notifications and SLA
- Triggers: task assigned/reassigned → assignee; any status change → request owner; task completed → owner; employee rejected task → assignee's manager; comment added → the other party. Targets are **relationships** on the transition data (`created_by` / `assigned_to` / `assignee_manager`), resolved at fire time. Messages are bilingual.
- **Escalation sweep** (`lib/escalation.js`, `ESCALATION_SWEEP_MS`, default 5 min, `0` disables in tests): a request sitting past its status's `sla_minutes` escalates **up the manager tree**.

### Files
`POST /files` (multipart, ≤5 MB → 422, MIME by magic bytes so `.exe` renamed `.jpg` is rejected, UUID names outside web root). `GET /files/{id}` is authorized per the download rules, else 404. Two-step photo contract: upload, then put the returned id into `form_response`.

### Map
`location` field type picked on an OpenStreetMap map in the User app (`flutter_map`, tap to pin). Employee task views and web Requests both have list ⇄ map toggles. OSM tiles, no API keys. **Continuous GPS tracking is deliberately out of scope** (CLAUDE.md I10 — outcomes are measured, never behaviour).

### Branding
Build-time default + a scoped runtime override post-onboarding. The generic "MonitorFlow" name/mark come from `VITE_BRAND_*` at build time, used pre-auth (login page, tab title) since those render before any company is known. Once an Owner completes onboarding, `<Wordmark>` **in the console shell only** prefers the company's own name and uploaded logo, riding the authenticated `/auth/login` / `/auth/me` payload. Mobile app name/icon stay build-time only.

### Bilingual + RTL
Every user-facing label is `{en, ar}`, enforced by a DB `CHECK` on both keys. The web console flips between LTR and RTL from CSS logical properties; Flutter uses directional insets and alignments. Machine keys (status keys, field ids, option values, capability keys) stay plain ASCII.

---

## Seeded accounts

`npm run seed` (re-run to reset; refuses a database that already has users unless `SEED_FORCE=true`, since it TRUNCATEs every table).

| Login | Kind | Notes |
|---|---|---|
| `owner@company.com` (or `SEED_OWNER_EMAIL`) | admin | Password `Password123!` (or `SEED_OWNER_PASSWORD`). Configures; holds no capabilities. First login opens the onboarding wizard. |

That's the entire seed — no employees, no services, no requests. Everything else is created live: complete onboarding as the Owner, then hire staff (`POST /employees`, they log in with their generated company email) and, if a demo needs one, build a service through Add Service.

The backend test suite builds its own richer fixture org (a two-subtree hierarchy + one working service) through the same live API — see "Testing" below.

---

## Local setup

- Postgres running locally, database `monitorflow`, credentials in `backend/.env`.
- Fresh start, from `backend/`: `npm run migrate` → `npm run seed` → `npm start`.
- Web: `cd web && npm run dev` → http://localhost:5173 (backend must be on `:3000` for the proxy).
- Mobile: a Windows desktop build needs Developer Mode; the Android emulator uses `10.0.2.2` automatically. A release APK on a physical device needs `--dart-define=API_BASE_URL=http://<host>/api/v1`.

---

## Testing

- **Backend unit** (`backend/test/*.test.js`, `node:test`, no server/DB needed): form validation, workflow transition resolution, form/workflow schema validation, time-clock attendance math, employee-number allocation. 5 files, 60 tests.
- **Backend API-integration + permission suite** (`backend/test/*.api.test.js` + the harness smoke test, `node:test`, real spawned server + throwaway Postgres DB per suite): 8 files, 32 tests, covering CLAUDE.md §14's must-pass negatives — own-resource 404, wrong-capability 403, cross-subtree assign refusal, concurrent-transition and cancel-vs-assign races, duplicate assign, deactivate-with-open-task 409, deactivated JWT rejected on next call (not just login), employee-cap hire refusal, file upload/download negatives, non-capable CSV export 403, onboarding catalogue validation + one-shot 409.
  - Harness: `backend/testlib/harness.js`. Each suite gets its own database and port (derived from the name passed to `setup()`, since `node --test` runs files in parallel) and its own fixture org built through the live API (onboarding → a two-subtree employee hierarchy → one real service with a form + workflow), because v7's seed ships none of that.
  - **`npm test` runs both sets together: 92/92.**
- **Flutter widget** (`mobile/test/`): the dynamic renderer (`dynamic_form_test.dart` — schema → widgets, required blocking, bounds, prefill, the location field, server-error application) and the login screen (`login_screen_test.dart`). **22/22**, `flutter analyze` clean.
- **Web:** build + lint only — no component or E2E tests at this scale, so `docs/WEB_E2E_CHECKLIST.md` is the gate instead: a per-page pass/fail list covering the cross-cutting rules (RTL, bilingual, loading/empty/error, 401/403/404) and each page's own actions. Reconciled to v7 and partially live-verified 2026-08-03 (see "Status" above) — most rows are still open.
- **CI** (`.github/workflows/test.yml`, push/PR to `main`): backend job (Postgres+PostGIS service container, `npm test`), web job (`npm run build && npm run lint`), mobile job (`flutter analyze && flutter test`).
- **Manual acceptance: not recorded.** §14 asks for the core flows on every seeded service, on the deployed build, run by the student who did not write that layer — blocked on both a deployment and a seeded/created service existing to run it against.

---

## Documented limitations (state these in the report; do not "fix" them)

Redundant `task.status` (intentional denormalization) · immutable definitions, no versioning — changing a live service means adding a new one and disabling the old · reassignment overwrites `employee_id` (the history row is the audit) · polling latency, no WebSockets or push · 24h JWT, no refresh or revocation · email enumeration on register · temporary passwords not force-changed · no self-service password reset · no automated frontend E2E · map views cap at 100 rows per filtered view · single organisation per deployment · onboarding is one-shot with no in-app edit · the wizard's feature-module selection doesn't gate module access (every module is reachable by capability alone regardless of what was selected).

## Deliberately not built

Visual Form Builder or Workflow Config UI · standalone operations-monitor page · WebSocket live refresh · push notifications · automatic assignment (the server returns a subtree-scoped candidate list; a human chooses) · live GPS tracking, location history, behavioural monitoring · signature capture · draft saving · satisfaction ratings · multi-tenancy · payments · advanced BI · named vendor integrations (the onboarding wizard's server-side Nominatim geocode proxy is the one deliberate exception) · self-service forgot/reset password · request deadlines · form/workflow versioning · refresh tokens.

---

## Proposed extensions (approved in principle, none built)

None has a start date. Each would need a deliberate both-students re-scope, and the release gate above should close first.

- **AI layer.** One shared module and one env var; every feature's output passes through a validator that already exists. Form auto-fill (draft a `form_response` from a sentence, guarded by `validateFormResponse.js`), triage suggestion (advisory only — never writes status or priority), and a seed-time config generator (LLM emits a form + workflow pair, piped through the existing seed-time validators, human reviews and commits). Adds no page and no runtime config endpoint.
- **Crew + internal chat.** One task with a lead plus a `task_assignee` set — chosen so `request 1—1 task`, the task lock, and the workflow engine stay untouched; the lead drives the workflow, crew members read/comment/upload. Then a `visibility` column on `request_comment` (`customer` | `internal`) for an internal oversight↔crew thread that users never see. The main cost is the permission matrix changes, each of which needs a test.
- **Ops analytics + PDF report.** Mine `request_status_history`, which already captures every transition with a timestamp and actor: time to resolution, time in status, first-response time, per-employee throughput — the dashboard's new SLA-breach/reopen-rate/workload panels (2026-08-03) are a first step in this direction. A client-side PDF beside the existing CSV would round it out.

---

## Design language

Strategy and system live in `PRODUCT.md` (register, audience, principles, accessibility) and `DESIGN.md` (North Star, the Restrained Rule, Status-Owns-Color, typography, elevation). Exact OKLCH tokens, type scale, and components live in code (`web/src/styles/tokens.css`, `mobile/lib/theme.dart`) — the source of truth for values.

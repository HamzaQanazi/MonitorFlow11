# MonitorFlow

Configurable, multi-sector service-request and field-operations platform: two Flutter mobile apps (User, Employee) and one React web dashboard (Monitor) on one Node/Express + Postgres backend.

**The thesis:** structurally different service types — different form fields, different workflow states — run through the *same* code via seeded JSON configuration. Two engines make this true: a **dynamic form engine** (forms rendered/validated from a JSON `field_schema`) and a **dynamic workflow engine** (status transitions validated against a JSON workflow). No status key is ever hardcoded in application code — code reasons only about status **categories** and transition **actions**.

`CLAUDE.md` is the authoritative spec. This file is the feature/status reference and operator guide.

---

## Status

**MVP complete across all three surfaces.** All 14 frozen pages exist. Two later amendments are shipped:
- **Admin role (spec v4):** a fourth role that manages monitor accounts + configuration, department-scoped monitors, an audit log, and escalation/staleness alerts.
- **Map feature (spec v5):** a `location` field type picked on a map, plus read-only map views on the Employee and Monitor apps.

Two amendments are **approved but not yet built:**
- **AI layer (spec v6 — proposed):** three features on a shared "LLM output is never trusted, always re-validated" spine — form auto-fill, triage suggestion, and a seed-time config generator. See the AI layer section under Features.
- **Crew & internal chat (spec v7 — proposed):** more than one employee per request (one task, a lead + a crew set) plus a request-scoped internal monitor↔crew chat thread. See the Crew & internal chat section under Features.

Backend `node --test` at 38/38; Flutter `flutter test` at 26/26; web builds/lints green. The two seeded services flow end-to-end (submit → assign → complete → confirm) on both apps.

---

## Tech stack

- **Mobile:** Flutter, single codebase, role-routed after login (user/employee; monitor+admin rejected to web).
- **Web:** React + Vite + TypeScript. Design tokens in `web/src/styles/tokens.css` (OKLCH). Dev proxy `/api` → `:3000` (backend has no CORS by design).
- **Backend:** Node.js + Express, REST under `/api/v1`, JWT HS256 24h, bcrypt (cost 10), login rate limit, deactivated accounts rejected at JWT validation.
- **Database:** PostgreSQL. JSONB for form/workflow definitions; `SELECT … FOR UPDATE` row locking on every status-mutating operation.
- **Files:** local disk under gitignored `backend/uploads/`, UUID names, DB stores metadata only.

---

## The two seeded services (the thesis, proven)

Same engine, same code, different JSON — the structural differences are what the demo points at.

| | **Equipment Repair** (IT) | **Home Cleaning Visit** (Facilities) |
|---|---|---|
| Gate | approval gate (Submitted → Approved by monitor) | none — booked goes straight to assignable |
| Loop | `awaiting_parts` hold loop | — |
| Terminals | `rejected` **and** `cancelled` | `cancelled` only |
| Field-visit states | — | `en_route`, `in_service` |
| Request form | dropdown, text, multiline, photo, checkbox, optional `location` | date, radio, number, checkbox, address (employee-visible), gate code (employee-hidden), **required** `location` |

---

## Features

### Auth & permissions
- `POST /auth/register` (creates `user` role only), `POST /auth/login`, `GET /auth/me`. Monitors are admin-created; admin is seed-only. No API path creates an admin.
- Every permission rule enforced **server-side**, never only in the UI. Role checks are always paired with ownership checks for "own only" resources.
- **404-over-403:** a valid ID owned by someone else returns 404, so IDs can't be probed.
- Standard list params on every list endpoint: `page`/`pageSize`(≤100)/`status`/`category`/`serviceTypeId`/`priority`/`dateFrom`/`dateTo`/`q`.

### Dynamic form engine
- 8 base field types + `location` (9th, v5): `text`, `multiline`, `number`, `date`, `dropdown`, `radio`, `checkbox`, `photo`, `location`.
- One generic backend validator (`backend/src/lib/validateFormResponse.js`): required/type/min-max/option-membership, rejects unknown keys, errors keyed by field `id` (422). `photo` verifies attachment ownership; `location` = exactly `{lat, lng}` within bounds.
- Flutter renderer draws any schema with zero per-service code; client validation mirrors the server, server 422 is authoritative. Unknown type → disabled placeholder (blocks submit if required).
- Seed-time validation runs before any insert (`formSchema.js`): unique ids, valid types, options present exactly when required, min ≤ max, one location field per form.

### Dynamic workflow engine
- **One module** (`backend/src/lib/workflowEngine.js`) writes every `REQUEST.status`/`TASK.status`. Order: lock request row → ownership (404-over-403) → transition exists (409) → role (403) → note (422) / completion-form (409) → write both statuses + a history row + notifications, all in one transaction. A `beforeCommit` hook lets assign/complete join the transaction.
- Endpoints bind to transitions by **action** flag, not status key: `accept`/`reject`/`complete`/`confirm`/`dispute`. Cross-service logic (dashboard, reports, filters, task lock, cancel window, resolution gating) operates on **categories** only (`new`/`triage`/`in_progress`/`done`/`closed`/`terminated`).
- Monitor override is constrained: target must exist in the workflow and be `terminated` (reject/cancel) or `triage`/`in_progress` (reopen); arbitrary jumps 422; note always required. Reopen past `terminated` unlocks the task automatically.
- Pure core (`resolveTransition`, `validTransitions`, `resolveOverride`) unit-tested.

### Requests (User app)
- Create Request (dynamic form → `POST /requests`, starts at `is_initial` status), Catalogue (`GET /services`), Home + My Requests (30s poll), Details/Timeline (one `GET /requests/{id}` — category-dotted timeline, comments, attachments, resolution card, cancel).
- Cancel allowed only while category is `new`/`triage` **and** no task exists (enforced race-safe inside the engine transaction). Resolution (confirm/dispute) only from a `done`-category status.
- "Request again" on closed/terminated requests reopens Create Request prefilled from the old response (photo ids dropped — server rejects reuse).

### Tasks (Employee app)
- Employee Home + My Tasks (`GET /tasks`, 30s poll, list⇄map toggle), Task Details (`GET /tasks/{id}` — requester name+phone, **never email**; `visible_to_employee:false` fields pre-stripped), Update Task Status, Complete Task (completion form through the same renderer).
- Action buttons driven entirely by `GET /tasks/{id}/valid-transitions` — no status keys in code. Accept/reject (reject requires a note, returns the request to the monitor queue). Tap-to-call on requester phone (`tel:`).

### Assignment (Monitor)
- `PATCH /requests/{id}/assign` creates the task on first call, updates `employee_id` in place on reassign (one task row per request, ever). Same-department only (422 cross-dept), duplicate no-op 409, terminated/closed 409. The approval gate emerges from data — a Submitted A request can't be assigned; a Booked B request can.
- Assignment picker sorts same-department employees by `openTaskCount` (least-loaded first, top marked "Suggested" — advisory, not enforced).

### Monitor web dashboard
- **Dashboard Overview:** category strip + proportion bar, 30-day activity chart, by-service/by-priority breakdowns. Counts grouped by **category** via workflow JSONB join. 30s silent polling.
- **Requests Management:** list pane (category-chip filters, service/priority selects, debounced search, pagination, all URL-backed) + detail pane (status/priority/requester, assignment block, schema-labelled form response, category-dotted timeline, comments, attachments with Before/After provenance badges, actions derived from workflow data). Age column shows time since `updated_at`. **List⇄map view toggle** + employee filter apply to both views.
- **Employees Management:** list (department filter, search, pagination), add/edit/activate/deactivate/reset-password, deactivate-with-open-tasks → inline 409, reset reveals temp password once. Employee name opens a workload dialog (per-category counts + task table).
- **Basic Reports:** filtered read-only table + aggregate cards (by category/priority/service/employee), **Export CSV** (authed blob, frozen columns, CSV-injection guard on `=+-@`).

### Admin console (spec v4)
- Fourth role `admin` (seed-only, web-only). Router-level allowlist keeps admin out of operational endpoints (must-pass #20). Admin shell role-routes; monitor↔admin deep links redirect.
- **Monitors Management:** create/edit/activate/deactivate/reset-password (mirrors Employees). `departmentId` required — **every monitor belongs to a department**. Last-active-monitor-of-a-department deactivate/move → 409 (orphaned department = silent outage).
- **Department-scoped monitors:** a monitor sees/manages only requests whose service type is in their department; everything else 404. Enforced in the shared query builder, the engine's post-lock check, request detail/comments/priority, file downloads, dashboard, employees management, and notification fan-out.
- **Audit Log:** `audit_event` table + `GET /audit-events` (admin-only, filterable) + `AuditPage.tsx`. Covers account/configuration events only; request lifecycle stays in `REQUEST_STATUS_HISTORY`.

> **Not built (deliberately, per v4):** no visual Form/Workflow Builder UI. Service definitions enter only via the seed path (`company-config.js`). The v4 draft's admin JSON-import endpoint was never built — the per-company handover model below replaces that need.

### Notifications & escalation
- `GET /notifications?userId=me` (own-only, unread count), mark-read, read-all. Triggers: assigned/reassigned → employee; status changed → owner; completed → owner; task rejected → department monitors; comment → the other party. Bell + unread badge on both mobile apps and the web shell (30s poll).
- **Escalation sweep** (`backend/src/lib/escalation.js`, interval in `index.js`, default 5 min, `ESCALATION_SWEEP_MS=0` disables): three category-driven rules per service-type thresholds (NULL = off) — unassigned too long → department monitors; stale `in_progress` → department monitors; `done` awaiting confirmation → owner. Deduped (one alert per stagnation period; any status change re-arms). `escalation` notification type.

### Files & photos
- `POST /files` (multipart, `requestId` XOR `taskId`, 5 MB max → 422, MIME by magic bytes — `.exe` renamed `.jpg` → 422, UUID names). `GET /files/{id}` authorized per the download rules (owner / assigned employee / monitor, else 404).
- Two-step photo contract: upload → put the returned attachment id into `form_response`. Request-form photos use parentless "pending" attachments linked atomically inside `POST /requests`.

### Map (spec v5)
- `location` field type (`{lat, lng}`), picked on an OpenStreetMap map in the User app (`flutter_map`, tap-to-pin). Read-only display rows are tappable → `geo:` with OSM-website fallback.
- **Employee map:** My Tasks list⇄map toggle; pins = active tasks only, category-colored, tap → bottom sheet → Task Details. Location visibility guarded server-side by the form's `visible_to_employee`.
- **Monitor map:** Requests Management list⇄map toggle; `react-leaflet` + clustering, category-colored pins with tooltips, employee filter, marker → detail pane.
- Stack uses OSM tiles (no API keys/billing). Continuous GPS tracking / route optimization stays out of scope.
- **Limits:** map views render one `pageSize=100` page under the current filters (banner when total exceeds it); OSM tiles need internet on demo day (fallback: list views + backup screenshots); old app builds render `location` as the unsupported-type placeholder.

### Per-company config & handover
- **`backend/src/company-config.js`** is the single file edited per deployment: the company's departments + services (form fields, workflows, escalation thresholds). `seed.js` imports `{ services }` from it and validates everything before writing. There is no write API — config enters only through the seed path.
- **`SEED_DEMO_DATA=false`** seeds only departments + services + the admin account (clean client handover); the admin then creates monitors → employees in-app. Unset/default seeds the full demo state (accounts + demo request queue). Verified on a scratch DB (see below).

### AI layer (spec v6 — proposed, not yet built)

Three AI features on **one principle: the LLM is never trusted — its output always passes through a validator that already exists.** One shared module (`backend/src/ai.js`), one env var (`LLM_API_KEY`, never committed, reuses the JWT-secret env pattern), one function (prompt + expected JSON schema → parsed JSON). Every feature reuses that spine; no per-feature AI plumbing. All three are outside the frozen v3/v5 spec and were approved as a deliberate both-students re-scope; none adds a new page or a hardcoded status key.

**Two directions, one story:** features 1–2 read the dynamic schemas at runtime (fill the config); feature 3 writes them at build time (author the config). Same schemas, same validators, both ways — the config-driven engine is clean enough that AI can both fill it and author it. That is the v6 thesis line.

- **1. Form auto-fill (User app, Create Request).** `POST /services/{id}/forms/request/suggest` `{text}` → a draft `form_response` built from the service's `field_schema` + the user's sentence. Pre-fills the dynamic renderer; user reviews/edits; real submit is the unchanged `POST /requests`. **Guardrail:** the existing form validator (`validateFormResponse.js`) — bad LLM output → 422, user corrects. No new page.
- **2. Triage suggestion (Monitor, Requests Management detail).** `POST /requests/suggest-triage` `{text}` → `{serviceTypeId, priority, reason}`, shown as an advisory hint. **Guardrail:** advisory only — the monitor still assigns/sets priority through the existing endpoints, so the workflow engine and permission matrix stay authoritative. Never writes status/priority itself.
- **3. Config generator (seed-time CLI, the wow).** `node scripts/ai-seed.js "<service description>"` → LLM emits a `FORM_DEFINITION` + `WORKFLOW_DEFINITION` pair → piped straight through the **existing seed-time validator** (`formSchema.js` + workflow checks) → on pass, printed / offered for append to `company-config.js`; human reviews and commits. **Respects the hard constraints:** no runtime API, no builder UI, definitions stay seed-only, human-in-the-loop — it is an authoring aid for the seed path, not a config endpoint. The validator (one initial / ≥1 final, action-at-most-once, from/to existence, valid categories) rejects anything the LLM gets wrong.

**Build order when implemented:** `ai.js` spine + feature 1 (smallest, proves the pattern) → feature 2 (near-free after 1) → feature 3 (biggest — the prompt must teach the workflow rules, but the seed-time validator is the backstop). Adds one dependency (an LLM SDK). Log the re-scope decision date here when work starts.

### Crew & internal chat (spec v7 — proposed, not yet built)

Two composed features. Outside the frozen spec — approved as a deliberate both-students re-scope; log the decision date here when work starts. **Guiding rule: preserve the workflow engine's one-status-machine-per-request invariant (§5) untouched.** Neither feature adds a new page or a hardcoded status key.

**Crew (more than one employee per request) — one task, a lead + a set.** The supervisor's "same service done by more than one employee" = a *crew on one job*, not independent sub-jobs. Modeled as **one TASK row (one status, one completion) with a set of assignees beside it** — the cheap fit that keeps `REQUEST 1—1 TASK`, the `TASK.request_id` UNIQUE constraint, the `TASK.status`↔`REQUEST.status` sync, the task lock, and the workflow engine all unchanged.
- **Schema:** new join table **`TASK_ASSIGNEE (task_id, employee_id, assigned_at)`**. `TASK.employee_id` stays as the **lead**.
- **Roles within a task:** the **lead drives the workflow** (accept / reject / status / complete / submits the single completion form). **Crew members are view + comment + upload only** — this keeps the engine's single-actor assumption, so no "two employees both complete" race beyond the existing row lock.
- **Ownership widens, doesn't multiply:** read/comment/upload checks become `me ∈ {lead} ∪ assignees`; workflow-mutating actions stay lead-only.
- **Assignment:** the assign endpoint gains add/remove-crew (same-department 422 applies per member, as today). Rejected: the *expensive* N-tasks-per-request model — it forces per-task status machines that contradict §5, breaks completion/reject/valid-transitions, and buys no extra crew behavior. Only revisit if the real requirement turns out to be independent sub-jobs (a different feature).
- **Touches:** `+1` table · assign endpoint (crew add/remove) · task ownership checks · deactivation rule (removing a crew member is fine; deactivating the **lead** of an open task → 409, reassign lead first) · `assigned` notification fan-out to each new member · Employee Task Details + Monitor detail pane show the crew. No new page, no WebSockets, engine untouched.

**Internal chat (monitor ↔ crew, request-scoped) — reuses `REQUEST_COMMENT`.** Promotes the "internal monitor↔technician note channel" from Future work. Not a global chat room (that would need a new page + WebSockets — both hard-cut); an internal thread scoped to a request, riding the existing 30s comment poll.
- **Schema:** add **`visibility`** to `REQUEST_COMMENT` — `customer` (existing user↔monitors thread, unchanged) vs `internal` (new monitor↔crew thread). One column, one enum. No second comments system.
- **Permissions (the real change — edits the §6 matrix):** on `internal` comments the **crew (lead + assignees)** and **department-scoped monitors** read + write; **users never see them**. The "Employee comments/reads = ❌" cells flip to ✅ **for internal visibility only**. Every flipped cell needs a permission test (per the testing rule).
- **The "group" is free:** it's "the monitors + the request's crew" — defined by department + assignment, no membership table, no invites/rooms. Composes directly with the crew feature above.
- **Live-ish, no WebSockets:** the internal thread rides the comment views' existing 30s poll. "Polling latency" limitation, same as everything else.
- **Notifications:** reuse the `comment` type; an internal comment fans out to the crew + monitors, never the user. Keep the two audiences firewalled — a separate internal thread, not the customer thread opened to employees.
- **Touches:** `REQUEST_COMMENT` schema · comment endpoints (filter by visibility + who's allowed) · notification fan-out · §6 matrix + its tests · Employee Task Details + Monitor detail pane (render/tab the internal thread). No new page.

**Build order:** crew first (it defines who's in the chat group), then the internal thread on top. Both changes to the §6 permission matrix are the main cost — each new ✅/❌ gets a test.

---

## Design language

Design strategy and system live in **`PRODUCT.md`** (register, audience, principles, accessibility) and **`DESIGN.md`** (North Star "The Dispatch Board", the Restrained Rule, the Status-Owns-Color rule, typography, elevation). Read both before building any UI. Exact OKLCH tokens, type scale, and components live in code (`web/src/styles/tokens.css`, `mobile/lib/theme.dart`) — the source of truth for values.

---

## Seeded dev accounts

All password `Password123!` (re-run `npm run seed` to reset):

| Email | Role |
|---|---|
| admin@monitorflow.dev | admin |
| monitor@monitorflow.dev | monitor (IT) |
| monitor2@monitorflow.dev | monitor (Facilities) |
| monitor3@monitorflow.dev | monitor (IT) |
| tech@monitorflow.dev | employee (IT) |
| tech2@monitorflow.dev | employee (IT) |
| cleaner@monitorflow.dev | employee (Facilities) |
| user@monitorflow.dev | user |

---

## Local setup

- Postgres local service, DB `monitorflow`, creds in `backend/.env`.
- Fresh start: `npm run migrate` → `npm run seed` → `npm start` (from `backend/`).
- Web: `cd web && npm run dev` → http://localhost:5173 (backend must be on `:3000` for the proxy). Browser checks use Playwright with installed Edge (`channel: 'msedge'` — no Chrome on the dev machine).
- Mobile: Windows desktop build needs Developer Mode; Android emulator uses `10.0.2.2` automatically. A release APK on a physical device needs `--dart-define=API_BASE_URL=http://<host>/api/v1` (defaults to the emulator address).

### New-company handover

1. Edit `backend/src/company-config.js` — the company's departments + services.
2. Change `adminAccount` / `DEV_PASSWORD` in `seed.js`.
3. `SEED_DEMO_DATA=false npm run seed` — clean start, no demo data.

### Verifying a handover on a scratch DB

Rehearse a clean handover against a throwaway database (never the dev DB). Run from `backend/`; `BASE` points at local postgres (creds in `.env`):

```bash
BASE="postgresql://<user>:<pass>@localhost:5432"

# 1. create scratch db
node -e "const {Client}=require('pg');(async()=>{const c=new Client({connectionString:'$BASE/postgres'});await c.connect();await c.query('DROP DATABASE IF EXISTS monitorflow_scratch');await c.query('CREATE DATABASE monitorflow_scratch');await c.end()})()"

# 2. migrate + seed with demo data OFF (the handover path)
DATABASE_URL="$BASE/monitorflow_scratch" node src/migrate.js
DATABASE_URL="$BASE/monitorflow_scratch" SEED_DEMO_DATA=false node src/seed.js

# 3. drop it when done
node -e "const {Client}=require('pg');(async()=>{const c=new Client({connectionString:'$BASE/postgres'});await c.connect();await c.query(\"SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='monitorflow_scratch' AND pid<>pg_backend_pid()\");await c.query('DROP DATABASE IF EXISTS monitorflow_scratch');await c.end()})()"
```

Expected clean-handover state: 2 departments, 2 services (4 form defs + 2 workflows), **1 user — admin only**, 0 requests/tasks/audit rows. The seed prints *"Admin account seeded; add monitors via the app."* (Verified 2026-07-08; default demo-on seed on the same scratch DB produces 8 users / 22 requests / 14 tasks.)

---

## Testing

- **Backend unit** (`npm test`, node:test): form-validation function and workflow transition validator (valid/invalid/wrong-role/final/terminated-locked). 38/38.
- **API integration / permission suite:** per-endpoint happy + negative smokes against a test DB; the Section 6 permission matrix is the test plan (one check per ✅/❌ cell). Reseed to canonical after each run.
- **Flutter:** widget tests for the dynamic renderer (schema → widgets, required blocking). 26/26.
- **Web:** manual E2E checklist per page (headless Edge), no component tests at this scale.
- **Must-pass negatives** (CLAUDE.md Section 13): cross-user 404, invalid/terminated transition 409, role 403, unknown/invalid form field 422, `.exe`-as-`.jpg` reject, oversize upload 422, non-monitor CSV 403, concurrent-PATCH race, cancel-vs-assign race, deactivated-JWT 401, cross-department 422, file IDOR 404, override-to-nonexistent-key 422, plus the v4 admin cells.

---

## Documented limitations (say these in the report; do not "fix" them)

Redundant `TASK.status` (intentional denormalization) · immutable definitions, no versioning (change a live service = add a new one, disable the old) · reassignment overwrites `employee_id` (history note is the audit) · polling latency, no WebSockets/push · 24h JWT, no refresh/revocation · email enumeration on register · temporary passwords not force-changed · no self-service password reset · no automated frontend E2E · map views cap at 100 rows per filtered view · single Postgres deployment per company (multi-tenant is out of scope — each company gets its own deployment, configured via `company-config.js`).

---

## Future work (post-MVP, for the report)

- **Internal monitor↔technician note channel.** *(Promoted to spec v7 — see the Crew & internal chat section under Features.)* Comments today are customer-facing only (user ↔ monitors; employees excluded server-side). A real field-ops deployment needs a monitor→technician relay ("gate code changed", "bring extra RAM"). The v7 design is a *separate* internal note type (not opening the customer thread to the technician). Interim mitigation already works: monitor→tech intent flows via assignment/reassignment/status/rejection notes, all in the timeline and pushed as notifications.

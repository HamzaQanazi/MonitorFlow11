# MonitorFlow — Project Context for Claude Code

This file is the **single source of truth** for this project. Read it before
implementing anything. These are **invariants**, not preferences — design
skills, style guides, and `DESIGN.md` are subordinate to this file. If a request
contradicts a rule here, **flag the contradiction** instead of silently
resolving it either way.

**Spec version: v7 (current) — pivot in progress.** v7 begins the pivot from a
multi-sector, config-API-driven platform to a **single-company workforce app
provisioned with an Owner who runs a first-login onboarding wizard**. What has
already shipped in v7: the old JSON **config API and outbound webhooks are
removed**; the municipality seed (`company-config.js`) is gone, replaced by a seed
that provisions **one empty company + one Owner** (§9); a `company`/`branch` schema
and the **onboarding wizard** (backend + React) are in.

**The operational engine underneath is unchanged and still live** — the dynamic
form engine, the dynamic workflow engine, the two-gate permission model, requests/
tasks/audit. Invariants I2–I10 (§2) still hold for that layer. The workforce
features (time clock, schedule, etc.) the wizard lets an Owner *select* are, so
far, **selections stored on the company** — the feature modules themselves are the
next increment, not yet built. Where this file still describes the old
config-driven surface, treat §1/§9/§13 as the current truth and flag any conflict.

Supersedes the old ER v3 / API v2 spec. The API contract lives in `openapi.yaml`
(§12); note it has **drifted** from the code during the pivot and is being
reconciled (see §12).

---

## 1. What this project is

MonitorFlow is a **single-company workforce and field-operations platform**. Two
mobile apps (User, Employee — Flutter) and one web dashboard (React) share one
backend and one database. **One deployment = one company** (§13).

**How a company comes online (v7):** the buyer is **provisioned an Owner account
at purchase** (seed/CLI — no self-registration for the Owner). On first login the
Owner runs the **"Customize your app in 1 minute" onboarding wizard** (§9): company
info, industry + sub-industry, branches, the **feature modules** they want, branding,
contact. That fills the one `company` row and flips `onboarding_completed`; from
then on the console is live and staff are added through the employee flow.

**The engine underneath stays configuration-driven and generic** — no file, table,
route, or component is specific to any one industry (I1 still holds). It runs on two
engines:

- **Dynamic form engine** — forms render from a `field_schema` JSON stored per
  service type (`validateFormResponse.js`, `formSchema.js`, the Flutter
  renderer). No per-sector form code.
- **Dynamic workflow engine** — status transitions validate against a
  `WORKFLOW_DEFINITION` (statuses + capability/actor-gated transitions) stored
  per service type (`workflowEngine.js`). No status key ever hardcoded in app
  code — code reasons about `is_terminal`, `required_capability`, and `actor`
  only (§8).

The onboarding **feature selections** (`time_clock`, `schedule`, …) are stored on
the company as data; the feature modules themselves are the next build increment.
The catalogue the wizard offers — employee ranges, industries + sub-industries,
features — lives in one backend file (`lib/onboardingOptions.js`), the single
source of truth the wizard fetches (thin client, I4).

**Context:** graduation project, 2 students, built with heavy Claude Code
assistance. The MVP shipped, the Operiva migration completed, and v7 began the
workforce pivot. Do not re-add anything from the "removed" list (§13) without a
deliberate, explicit decision by both students.

---

## 2. THE INVARIANTS — violating one invalidates the thesis, it is not "a bug"

### I1. Nothing is service-specific. Ever.
No file, class, table, route, component, or `if` may mention a specific sector.
```
BANNED                            CORRECT
/api/maintenance/requests         /api/requests?serviceTypeId=…
class MaintenanceRequest {}        class Request {}
if (service === 'pothole')         (drive it from config)
PermitForm.tsx                     DynamicForm.tsx
```
No `if (industry === 'healthcare')` branch may ever exist. The onboarding
catalogue (`lib/onboardingOptions.js`) *lists* industries and features as **data**
— a picklist, like a country dropdown — and the feature list is identical for every
industry (product rule). Listing an option is fine; branching behaviour on it is
the violation.

### I2. "Monitor" is not a role. Exactly three account kinds.
```
admin     configures the platform. OUTSIDE the reporting tree. Seed/admin-created.
employee  operational. INSIDE the tree. Created by an admin/manager.
user      external submitter. OPTIONAL per service. Self-registers.
```
An overseer ("monitor") is just an **employee at a level that holds oversight
capabilities**. Never write `role === 'monitor'`, `isManager(user)`, or a
`MonitorGuard`. Authority comes from the two gates below, never a hardcoded role.

### I3. The two-gate permission model — check BOTH, server-side, every time.
```
GATE 1 (actions)  Does the actor's LEVEL grant the required capability?
                  → level_capability table (lib/capabilities.js, requireCapability)
GATE 2 (scope)    Is the target inside the actor's SUBTREE?
                  → recursive CTE on users.manager_id (lib/scope.js, ownerInScope)
```
Both gates, on every guarded action, on the server. A client showing a button is
**not** authorisation. Assignment is therefore **downward-only** — you assign to
anyone below you in the tree, never sideways. A root employee
(`manager_id IS NULL`) reaches the whole organisation by sitting at the top, not
by a special case.

### I4. Clients are THIN RENDERERS.
Frontends never hardcode a field name, a status key, or a role.
```
To draw a form   GET the form definition → render each field by its `type`
To draw buttons  GET /requests/{id}/transitions → render exactly what returns
```
`/requests/{id}/transitions` returns only what is legal from the current status
**and** permitted to this caller — both gates already applied. Render that list,
nothing more. One defensive rule in the renderer: unknown field `type` → disabled
"unsupported field" placeholder; block submission if it is `required`; never
crash.

### I5. Every user-facing label is bilingual. No bare strings.
```ts
type LocalizedText = { en: string; ar: string };   // both keys REQUIRED
```
The DB physically rejects a label missing either key (`CHECK (x ? 'en' AND x ?
'ar')`). Applies to: service names, field labels, status labels, transition
labels, department names, level names, notification messages. Machine keys
(status keys, field ids, option values, capability keys) stay plain ASCII.

### I6. RTL from the first line. Never left/right.
Arabic is a requirement, not an afterthought.
```
BANNED                       CORRECT
margin-left: 8px             margin-inline-start: 8px
text-align: left             text-align: start
EdgeInsets.only(left: 8)     EdgeInsetsDirectional.only(start: 8)
Alignment.centerLeft         AlignmentDirectional.centerStart
```
Tailwind/CSS: `ms-*`/`me-*`/`ps-*`/`pe-*`/`text-start`/`text-end`, never the
`l`/`r` variants. **Test both directions on every screen** — English-only layout
is not finished.

### I7. The API contract is the source of truth.
`openapi.yaml` is **frozen**. Two developers build against it in parallel; a
unilateral change silently breaks the other's half. Do not invent an endpoint not
in the spec; do not change a response shape without changing the spec first;
changes require both developers to agree.

### I8. Validation is server-side. Client validation is UX only.
Forms are dynamic, so data off the wire is never trusted. Every payload is
validated on the server against the stored form definition. Client validation
mirrors the schema for kindness; the server's 422 (per-field, keyed by field
`id`) is authoritative.

### I9. The audit trail is immutable and transactional.
`request_status_history` and `audit_event` are **never updated, never deleted**.
A status change and its history row are written in the **same DB transaction** —
if they can diverge, the timeline can contradict the current status. One
`request_status_history` table powers the submitter's timeline, each employee's
activity history (filter by `changed_by`), and all outcome metrics.

### I10. Measure outcomes. Never behaviour.
This system does **not** track people.
```
YES   completed count, time-to-completion, reopen rate, open workload, SLA breaches
NO    live GPS, location history, idle time, "what are they doing right now"
```
An ethical, GDPR, and product position: a buyer wants an operations tool, not a
surveillance tool. Do not add behavioural tracking, even if asked casually.

---

## 3. Hard constraints (in addition to the invariants)

- **No visual Form Builder UI and no visual Workflow Config UI.** Form/workflow
  definitions enter only via the seed script (`seed.js` + `formSchema.js`/
  `workflowSchema.js` validators). There is no authoring UI and no per-field write
  endpoint. (The onboarding wizard configures the *company*, not forms/workflows.)
  The old JSON config API that onboarded whole sectors is **removed** (§9, §13).
- **Definitions are immutable once any request exists** for their service type.
  No versioning system; changing a live definition means adding a new service and
  disabling the old (documented MVP limitation).
- **No WebSockets, no push.** All "live" updates poll: notifications 30s,
  task/request lists 30s, detail pages on-focus refresh only.
- **No draft saving, no signature capture, no self-service password reset** — cut
  for MVP. If asked to build one, say so instead of proceeding.
- **Every permission rule (§5) is enforced server-side**, never only hidden in
  the UI. Ownership checks are required *in addition to* capability checks.
- **No status keys hardcoded in application code** (§8). If a feature seems to
  need one, flag it.
- **Do not create abstractions, config layers, or helpers beyond what a task
  needs.** Match existing structure and patterns exactly.

---

## 4. Tech stack (decided — do not relitigate) & security baseline

- **Backend:** Node.js + **Express**, **JavaScript** (not TypeScript). REST under
  `/api/v1`. Data access is **node-postgres (`pg`) with raw SQL** — **no ORM,
  no Prisma**. Migrations are plain `.sql` files in `backend/migrations/`, run by
  `src/migrate.js`.
- **Database:** PostgreSQL + **PostGIS**. JSONB for form/workflow definitions and
  form responses; `GEOGRAPHY(Point,4326)` for request pins; row locking via
  `SELECT … FOR UPDATE`.
- **Web (Monitor dashboard):** React + **TypeScript** + Vite.
- **Mobile (User + Employee apps):** Flutter/Dart, single codebase with shared
  components (auth, dynamic form renderer, notifications, profile).
- **Auth:** JWT (jsonwebtoken); bcrypt (bcryptjs) password hashing.
- **File storage:** local disk under a non-web-root uploads dir, server-generated
  UUID filenames; DB stores metadata (§6).
- **Deployment:** one free-tier cloud host (Render/Railway) for backend + Postgres
  + web build; localhost demo is the always-available fallback.
- **Repo:** monorepo — `/mobile`, `/web`, `/backend`, `/docs`.

**Security baseline (backend):**
- JWT HS256, 24h expiry, secret from env var only (never committed). No refresh
  tokens (documented MVP limitation).
- Passwords: bcrypt, cost ≥ 10.
- Login rate limit: 5 attempts / 15 min per identifier+IP (in-memory is fine).
- Never log request bodies on `/auth/*` or `/requests` (passwords / personal
  data).
- Deactivated accounts (`is_active = false`) are rejected at JWT validation, not
  only at login.
- `login_identifier` is deliberately generic: an external `user` logs in with
  their email; an employee logs in with a **generated company email**
  (`lib/employeeEmail.js`: two letters of their first name + `.` + last name +
  `@` + the company's wizard-set `email_domain`, e.g. `ha.qanazi@company.org`;
  a colliding name gets a number inserted after the first-name part —
  `ha2.qanazi@...` — via an advisory-lock retry, same safety shape as the
  legacy allocator below). One column, one lookup, one flow — do not split
  into two auth paths; this only changes what value populates that one column
  for a new employee, not the lookup itself. Server-generated always — a
  client never supplies one. **Superseded (2026, this deviation flagged for
  Student 2's awareness — auth is their owned surface, §11):** employees were
  previously allocated a 4-digit number instead (`1000 + department_id × 100`
  plus the lowest free offset per department, `lib/employeeNumber.js`,
  exhausted block → 409). That allocator is left in place but unused by
  `POST /employees` — existing employee rows keep their number, only new
  hires get the generated email. Monitor/admin accounts are seed- or
  admin-created; `POST /auth/register` creates `user` role only.

---

## 5. Roles & the two-gate permission model (enforce every rule server-side)

Three account kinds (I2): `admin`, `employee`, `user`. Admins gate by **role**
(`requireRole('admin')`) and hold **no** capabilities — they configure, they do
not operate the queue. Every operational authority is an **employee** decision
resolved by the two gates (I3):

- **Gate 1 — capability.** The fixed catalogue (`lib/capabilities.js`):
  `view_all · assign · set_priority · override · manage_employees · export`. A
  `employee_level` grants a subset via `level_capability`. An "oversight" employee
  is one whose level grants `view_all`.
- **Gate 2 — subtree scope.** `users.manager_id` self-reference; a recursive CTE
  (`lib/scope.js` `subtreeIds` / `ownerInScope`) yields self + all descendants.
  Request visibility for an employee = requests whose **service `owner_id` is in
  the actor's subtree**. Assignment candidates = subtree employees only.

**Ownership + 404-over-403:** "own only" resources (`request.user_id ==
me`, `task.employee_id == me`) require an ownership check on top of the gates. A
valid ID owned by someone else returns **404**, not 403, so IDs can't be probed.

**Employee limited task view:** `GET /tasks/{id}` embeds the requester's `name`
and `phone` but **not** `email`, and strips every `form_response` field whose
schema has `visible_to_employee: false`. That is the only field-filtering
mechanism.

**Deactivation rule:** deactivating an employee who still holds a task in a
non-terminal status returns **409** — reassign first, then deactivate.

**Locking rule:** every status-mutating operation locks the REQUEST row
(`SELECT … FOR UPDATE`) inside its transaction; all validation happens after the
lock. This closes check-then-act races (concurrent transitions, cancel-vs-assign).

**Testing rule:** the permission model is the test plan — every allowed/denied
combination gets at least one automated API test (§14).

---

## 6. Database schema (current — authoritative source is `backend/migrations/*.sql`)

Bilingual columns are JSONB `{en,ar}` with a DB `CHECK` on both keys (I5).

- **company** (v7) — id, name, address, owner_job_title, employee_range, industry,
  sub_industry, plan, email_domain (all owner-entered plain TEXT — tenant data, not
  system labels, so I5's `{en,ar}` rule does not apply; plan is step 7, record-only —
  see §9; email_domain is step 5, the domain suffix generated employee login emails
  use — see §4), features
  (`TEXT[]` of selected feature keys), logo_file_id (FK → file_attachment, nullable),
  website, phone, **onboarding_completed**
  (bool, default false — the first-login gate), created_at. At most one row per
  deployment (single-org, §13); a table not a singleton so branches/features get
  clean FKs and can grow to multi-tenant later.
- **branch** (v7) — id, company_id (FK, cascade), name, created_at. One row per
  branch the Owner names in the wizard.
- **department** — id, name `{en,ar}`.
- **users** — id, name (computed `${firstName} ${lastName}` for employees created
  through the extended Add Employee form — see §5's login_identifier note), email
  (nullable, unique), password_hash, role
  (`admin`/`employee`/`user`), phone (nullable), department_id (FK, nullable),
  **login_identifier** (unique — an email, a generated employee login email, or a
  legacy 4-digit employee number — see §4), first_name, last_name, birthdate (date,
  nullable), gender, worker_type (both plain TEXT machine keys, i18n-translated
  client-side like `priority` — not a bilingual JSONB catalogue, since I5 doesn't
  require one for small fixed system enums), **manager_id** (self-FK,
  nullable — the reporting tree), **level_id** (FK → employee_level, nullable),
  **company_id** (FK → company, nullable — the account's company; nullable so the
  Owner, created before the company row, and self-registered users stay valid),
  is_active (default true), created_at.
- **capability** — key (PK; the fixed catalogue).
- **employee_level** — id, name `{en,ar}`.
- **level_capability** — (level_id, capability_key). Gate 1 grants.
- **service_type** — id, **key** (unique string handle), name `{en,ar}`,
  department_id (FK), default_priority, enabled, **owner_id** (FK → users; the
  visibility anchor, Gate 2), **accepts_external_users** (bool).
- **form_definition** — id, service_type_id (FK), form_type
  (`request`/`completion`), field_schema (JSONB, §7). Unique (service_type_id,
  form_type) — exactly two rows per service.
- **workflow_definition** — id, service_type_id (FK, unique 1:1), statuses
  (JSONB), transitions (JSONB). Semantics in §8.
- **request** — id, user_id (FK), service_type_id (FK), form_response (JSONB),
  status (a status key), priority (`low`/`medium`/`high`), created_at, updated_at,
  **location** (`GEOGRAPHY(Point,4326)`, nullable — denormalized from the form's
  `location` field).
- **request_status_history** — id, request_id (FK), status, changed_by (FK),
  changed_at, note (nullable; required when the transition sets `requires_note`
  and for oversight overrides). Reassignments/priority changes also write a row.
- **task** — id, request_id (FK, **unique** — one task per request, updated in
  place on reassignment), employee_id (FK), status, completion_form_response
  (JSONB, nullable), assigned_at. `TASK.status` is intentional denormalization
  kept in sync with `REQUEST.status` in the same transaction.
- **request_comment** — id, request_id (FK), user_id (FK), body, created_at.
- **notification** — id, user_id (FK), request_id (FK, nullable), type, message
  `{en,ar}`, is_read, created_at.
- **file_attachment** — id (UUID), request_id XOR task_id (CHECK: exactly one
  non-null), original_filename, mime_type, size_bytes, storage_path (never
  exposed), uploaded_by (FK), uploaded_at.
- **audit_event** — actor_id, action, entity_type, entity_id, detail (JSONB),
  created_at. Two families, both written via `logAudit` in the same transaction
  as the change (I9): config/admin actions (service.created, employee.created, …)
  and operational actions (request.status_changed, request.assigned,
  request.priority_changed) written by the workflow engine and the
  assign/priority handlers. The operational family deliberately duplicates the
  `request_status_history` timeline so the admin audit page is one feed.

Location is a real geography column, not a string in JSONB — spatial analysis
later needs new *queries*, not a migration.

---

## 7. Dynamic form engine

Field schema (`FORM_DEFINITION.field_schema` — JSONB array; array order = display
order):
```jsonc
{
  "id": "stable key used in form_response",
  "label": {"en":"…","ar":"…"},
  "type": "text | multiline | number | date | dropdown | radio | checkbox | photo | location",
  "required": true,
  "options": [{"value":"k","label":{"en":"…","ar":"…"}}],  // dropdown/radio only
  "min": 0, "max": 100,
  "visible_to_employee": true
}
```
- `options`: required for `dropdown`/`radio`, forbidden otherwise.
- `min`/`max`: numeric bounds for `number`; length bounds for `text`/`multiline`.
- `checkbox` = single boolean. `photo` = a FILE_ATTACHMENT id (two-step upload:
  `POST /files` first, then put the returned id into `form_response` under the
  field's `id`; backend verifies the attachment exists and belongs to the caller).
- `location` = `{lat,lng}` (lat ∈ [-90,90], lng ∈ [-180,180], exactly two keys);
  max one location field per form (seed-time check); no options/min/max.
- **Deliberately excluded** (not a form-builder platform): default values,
  conditional/branching fields, regex, custom messages, multi-file, sections,
  computed fields.

**Backend validation** (`validateFormResponse.js`, one generic function): validate
against the stored schema; reject unknown keys → 422; enforce
required/type/min-max/option-membership → 422 per-field keyed by `id`; for
`photo`, the attachment must exist and belong to the caller.

**Seed-time validation** (`formSchema.js` / `workflowSchema.js`, enforced before
insert; the API then trusts stored schemas): unique field ids · valid types ·
options present exactly when required · min ≤ max · bilingual labels · exactly one
`is_initial`, ≥1 `is_terminal` · all transition `from`/`to` exist · exactly one of
`required_capability`/`actor` per transition · valid `notify` targets.

---

## 8. Dynamic workflow engine (Phase 4 model)

```
statuses:    { key, label:{en,ar}, is_initial, is_terminal, sla_minutes }
transitions: { key, from, to, label:{en,ar}, required_capability, actor,
               required_form_key, requires_note, notify:[…] }
```
- **`is_terminal`** replaced the old category enum. All cross-service logic —
  dashboard "open vs closed" grouping, filters, the task lock, cancel gating —
  operates on `is_terminal`, never on status keys.
- A transition is gated by **exactly one** of `required_capability` (Gate-1
  oversight, `actor:null`) or **`actor`** (`requester` | `assignee`, whose turn it
  is; `capability:null`).
- `required_form_key` names a FORM_DEFINITION the transition requires (e.g.
  `completion`) — the transition only executes with a valid form for it.
- `requires_note` → history row must include a note (422 without).
- `notify` = relationships resolved at fire time: `created_by`, `assigned_to`,
  `assignee_manager` (never user ids / roles). This keeps notifications generic.
- `sla_minutes` = minutes a request may sit in this status before the escalation
  sweep fires (§10).

**Transitions are ONE-WAY.** A backward edge (reassign) and a reopen are just
extra transition rows. The engine has **no concept of a loop** — do not add one.

**Engine rules** (`workflowEngine.js`, the ONE module that writes
`REQUEST.status`/`TASK.status`): lock REQUEST row → check the transition exists
from current status → check Gate 1 (capability) and/or Gate 2 + ownership (actor)
→ check note/form requirements → write both statuses + a history row → commit →
fire notifications (§10). Nothing else may write status. While the
current status is `is_terminal`, the task is locked (409 on further task calls);
a reopen transition unlocks it automatically.

**Endpoints** (see `openapi.yaml`): the generic
`GET`/`POST /requests/{id}/transitions` serves all **actor**-gated transitions,
with `expected_status` for optimistic concurrency (**409** on stale — exactly one
concurrent fire wins). Oversight (capability-gated) transitions fire via the
dedicated `PATCH /requests/{id}/assign` · `/priority` · `/status`. Employee task
actions go through `/tasks/{id}` + `/tasks/{id}/transitions`.

The engine still proves the config-driven thesis: three structurally different
workflow shapes — **dispatch + hold loop**, **lean scheduled pickup**, **approval
gate + reject terminal** — run on one unchanged engine, same code, different JSON.
(The v7 seed no longer ships these municipal workflows; they live in the git
history and the demo fixtures under `docs/demo/`.)

---

## 9. Onboarding wizard & Owner provisioning (v7)

The old JSON config API (`POST /config/services`) and outbound webhooks are
**removed** (§13). Sector onboarding-as-a-JSON-body is gone; a deployment is one
company, brought online by provisioning + a wizard.

**Owner provisioning** (`seed.js`, run once per sale): TRUNCATEs, inserts the fixed
capability catalogue, one **empty `company`** (`onboarding_completed = false`), and
one **Owner** (`role 'admin'`, `login_identifier` = their email, `company_id` set).
Credentials come from `SEED_OWNER_*` env vars; it refuses to run against a database
that already has users unless `SEED_FORCE=true`. The Owner is `admin` (I2):
configures, sits outside the reporting tree, holds no capabilities.

**Onboarding endpoints** (`routes/onboarding.js`, both `requireAuth`; the save is
`requireRole('admin')`):
- **`GET /onboarding/options`** — the static wizard catalogue from
  `lib/onboardingOptions.js`: employee ranges, industries + their sub-industries,
  feature groups, and plan tiers (all `{en,ar}` labels). Thin client renders it (I4).
- **`GET /onboarding/geocode?q=…`** — step-1 address helper. Server-side proxy to
  OpenStreetMap Nominatim (its usage policy forbids calling it from a browser and
  requires a descriptive User-Agent + ~1 req/sec throttling, both enforced here);
  returns only `{ match: { city, country } | null }`, never the raw upstream
  response. The wizard debounces on the address field and auto-appends the
  country on an exact city match. **This is the one deliberate exception to "no
  named vendor integrations" (§13)** — flagged and agreed as a one-off, not a
  precedent for adding others without the same conversation.
- **`PATCH /company/onboarding`** — the wizard's one save. Validates every pick
  **server-side against the catalogue** (I8), writes the `company` row + its
  `branch` rows in **one transaction**, then flips `onboarding_completed` (one-shot:
  a second call after completion is **409**). Optional logo is a parentless
  `file_attachment` the Owner POSTed to `/files` first (admins may create the
  parentless company-logo upload). Step 5's `emailDomain` is validated as a bare
  domain (no scheme/path) and is what `lib/employeeEmail.js` appends to every
  generated employee login. Step 7's `plan` pick is **record-only** — the
  employee cap and feature-group access shown on each plan card are descriptive
  text, not server-enforced limits, same status as the step-4 feature selections
  (the modules and any real gating are a future increment). No pricing, checkout,
  or billing of any kind — that stays on the "deliberately NOT built" list (§13).

**The first-login gate:** `onboardingCompleted` rides on the `/auth/login` and
`/auth/me` user payloads (joined from the Owner's company). The React app routes an
`admin` whose company is not yet onboarded to the wizard instead of the console;
`markOnboarded()` drops the gate on save. Other account kinds never see it.

*(Ponytail ceiling: single-org, one-shot onboarding, no re-run/edit UI — changing
company details later is a direct row update for now.)*

---

## 10. Notifications & SLA / escalation

**Notification triggers (complete list — do not invent others):** task
assigned/reassigned → assignee; any status change → request owner; task completed
→ owner; employee rejected task → assignee's manager; comment added → the other
party. Targets are the relationships in §8, resolved at fire time.

**SLA / escalation** (`lib/escalation.js`, a periodic sweep, `ESCALATION_SWEEP_MS`,
default 5 min): a request sitting in a status past its `sla_minutes` escalates
**up the manager tree** (to the assignee's manager), not to a hardcoded
department overseer. Reuses the existing sweep worker. (The `sla_breached` webhook
it once fired is removed — §9.)

---

## 11. The apps (frozen scope)

**User mobile:** Login/Registration · Home · Service Catalogue · Create Request
(dynamic form) · My Requests + Details/Timeline (list, detail, timeline, comments,
cancel, confirm/dispute resolution, attachments, map pin).

**Employee mobile:** Home + My Tasks · Task Details · workflow transitions ·
Complete Task (dynamic completion form).

**Monitor web:** Login · **First-login onboarding wizard** (v7 — the seven-step
"Customize your app in 1 minute", gated on an un-onboarded Owner) · Dashboard
Overview (stats grouped **open vs closed**, per-service + per-priority totals,
30-day chart) · Requests Management + Assignment (list/filters + detail pane,
timeline, comments, assign/reassign, priority, status override, map view) ·
Employees Management · Reports + CSV export · Audit.

**Shared component:** Notifications + Profile, reused by both mobile apps.

**Branding is build-time, per deployment** (`web/src/brand.ts`, `web/.env.example`):
the company name `{en,ar}` and an optional logo come from `VITE_BRAND_*` at build
time, rendered by the one `<Wordmark>` component (shell + login) and used for the
tab title. Consistent with one organisation per deployment (§13) — there is no
branding API and no runtime lookup. Mobile app name and icon are build-time too,
in `pubspec.yaml` / `AndroidManifest.xml` / `Info.plist`. **Never rebrand
`X-MonitorFlow-Signature`** — that is a wire protocol subscribers verify, not a
company name.

**UI-state rule (every page):** loading + empty states on every list; a
confirmation dialog on every destructive/terminal action, with a note field where
the workflow requires one; 401 → login; 403/404 → inline error. No page is "done"
without these.

**Work division:** *Student 1* — Flutter User + Employee apps, shared mobile
components, the seed/demo-data script, the Employees + Reports web pages, mobile
testing. *Student 2* — schema + migrations, API, auth + permission middleware,
form/workflow engines, file + notification services, the onboarding wizard
(backend + React), the React scaffold + Login + Dashboard + Requests Management,
deployment.

---

## 12. API contract

`openapi.yaml` (repo root) is the contract (I7) — the authoritative list of every
endpoint, request/response shape, and status code. Do not duplicate it here and do
not let this file contradict it. **v7 reconciliation:** the pivot removed the
`/config/*` surface and added `/onboarding/options` + `/company/onboarding`.
Employee management is fully reconciled to the live routes — all under
`/employees` (people tag, `manage_employees` capability); the old `/config/{org,
levels,capabilities,employees}` paths are gone (org/capabilities have no live
endpoint post-pivot — Gate-1 level *authoring* is seed-time only for now, but
`GET /employee-levels` reads the catalogue, backing the Add Employee "role"
picker). Still undocumented in the contract: `GET /departments`,
`GET /employee-levels` (same read-only reference-data shape as departments),
and `/users/me*`. When in doubt,
the mounted routes in `backend/src/index.js` are ground truth. Key conventions it
encodes: base
path `/api/v1`; Bearer JWT on every route except register/login; standard list
params `?page&pageSize(≤100)&status&state&serviceTypeId&priority&dateFrom&dateTo&q`;
status codes 200/201/204/400/401/403/404/409/422/429/500 used exactly; dynamic-form
errors are 422 keyed by field `id`; CSV export prefixes any cell starting with
`= + - @` with `'` (injection guard). Files: allowlist `jpg/jpeg/png/pdf`, ≤5 MB,
MIME validated by magic bytes, UUID name outside web root, served
`Content-Disposition: attachment`.

---

## 13. Deliberately NOT built (do not add without a deliberate re-scoping decision)

Visual Form Builder / Workflow Config UI · standalone Operations Monitor page ·
WebSocket live refresh · push notifications · **automatic assignment** (assignment
is manual; the server returns a subtree-scoped candidate list, a human chooses —
no ranking, no auto-select) · **live/continuous GPS tracking, location history,
behavioural monitoring** (I10) · signature capture · draft saving · satisfaction
ratings · multi-organization / true multi-tenancy (single-org per deployment;
"many companies" = one deployment each) · payments · advanced BI · **named vendor
integrations** · self-service forgot/reset password · request deadlines ·
form/workflow versioning · refresh tokens / server-side logout.

**Removed in v7 (do not re-add without a deliberate decision):** the JSON **config
API** (`POST /config/services` — sector-as-data onboarding) and **outbound signed
webhooks** (`/config/webhooks`, `lib/webhooks.js`, the `X-MonitorFlow-Signature`
delivery). The municipality seed (`company-config.js`) went with them.

**IN:** the **first-login onboarding wizard** (v7, §9) · the interactive **map pin
picker** (v5) · **operational audit rows** (status/assign/priority write
`audit_event`). GPS tracking stays out (I10).

---

## 14. Testing (release gate)

- **Unit (backend):** form-validation (each type × required/bounds/options/unknown
  key) · workflow transition validator (valid/invalid/wrong-capability/wrong-actor/
  terminal-locked/stale) · onboarding-save validation (each pick against the
  catalogue; one-shot 409).
- **API integration (most of the budget):** happy path + negatives per endpoint
  against a test DB.
- **Permission suite:** one test per allowed/denied combination — a capable actor
  outside their subtree is refused; a subtree member without the capability is
  refused.
- **Flutter:** widget tests for the dynamic renderer only (schema → widgets;
  required blocking).
- **React:** manual E2E checklist per page.
- **Manual acceptance:** the core flows (register→login, submit, review+assign,
  accept/reject, status updates, complete, confirm, dispute, cancel/reopen,
  reports+CSV) on **all** seeded services, on the deployed build, run by the
  student who didn't write that layer.

**Must-pass negatives:** own-resource of another user → 404 · transition not in
valid set → 409 · wrong-capability transition → 403 · duplicate assign → 409 ·
task action under a terminal request → 409 · unknown field id → 422 · missing/bad/
out-of-range/invalid-option → 422 field-keyed · `.exe` renamed `.jpg` → rejected
(magic bytes) · upload >5 MB → 422 · non-admin config/CSV → 403 · concurrent
transitions → exactly one wins · cancel-vs-assign race → one wins other 409 ·
deactivated JWT → 401 · deactivate employee holding an open task → 409 · confirm
before done → 409 · cross-subtree assign → refused · override to nonexistent
status → 422 · download another user's file → 404 · user submit to internal-only
service → 403.

---

## 15. Documented MVP limitations (state these in the report; do not "fix" them)

Redundant `TASK.status` (intentional denormalization) · immutable definitions, no
versioning · reassignment overwrites `employee_id` (history note is the audit) ·
polling latency · 24h JWT, no refresh/revocation · email enumeration on register ·
single organization per deployment · temporary passwords not force-changed · no
automated frontend E2E · onboarding is one-shot with no in-app edit (change company
details by direct row update).

---

## 16. How to work on this project

- Scope every task to one feature or one page — never "build the app" as one task.
- For anything touching the **form engine, workflow engine, permission
  middleware, or config API**: outline your approach and the files you'll touch
  first, wait for confirmation, then implement. These are the highest-risk
  modules.
- For straightforward CRUD/UI following an established pattern: implement directly.
- Every feature is **run and manually verified against seeded data** before it is
  "done" — not just read.
- Commit after each verified feature, naming the page or endpoint it implements —
  never batch features into one commit.
- Never create test data by hand or via ad-hoc SQL — extend the seed script
  (`seed.js`) so every developer and demo starts identical. (Exception:
  temporarily flipping a flag for a negative test, then flipping back.)
- No status keys in application code — `is_terminal`, capabilities, and actors
  only. If a task seems to need one, **flag it**.
- If a request conflicts with the invariants (§2) or any constraint here, **say so
  explicitly** instead of quietly complying or refusing.

**Before you commit — stop if any is true:**
- [ ] A file names a specific sector.
- [ ] A check reads `role === '…'` (other than `requireRole('admin')`).
- [ ] A permission is enforced only on the client.
- [ ] A `margin-left` / `text-align:left` / `EdgeInsets.only(left:)`.
- [ ] A user-facing string that isn't `{en,ar}`.
- [ ] A status change without its history row in the same transaction.
- [ ] An endpoint not in `openapi.yaml`.

**The one-sentence test:** *If onboarding a new sector would require changing
code, the project is broken.*

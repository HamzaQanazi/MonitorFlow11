# MonitorFlow — Project Context for Claude Code

This file is the single source of truth for this project. Read this before implementing any feature. If anything you're asked to build contradicts this file, flag the contradiction instead of silently resolving it in either direction.

**Spec version: v3** (revised after architecture/security review — supersedes ER v2 and API v1).

---

## 1. What this project is

MonitorFlow is a configurable, multi-sector service-request and field-operations platform. It has two mobile apps (User, Employee — Flutter) and one web dashboard (Monitor — React), sharing one backend and one database.

The core architectural claim the project must prove: the same codebase can support structurally different service types (different form fields, different workflow states) purely through backend configuration — no per-sector app code. This is achieved through two engines:
- **Dynamic form engine**: forms are rendered from a `FORM_DEFINITION` JSON schema stored per service type, not hardcoded per screen.
- **Dynamic workflow engine**: status transitions are validated against a `WORKFLOW_DEFINITION` (statuses + role-gated transitions) stored per service type, not hardcoded per screen. No status key may ever be hardcoded in application code — code may only reference status **categories** and transition **actions** (Section 9).

Two seeded service configurations (different fields, structurally different workflows — Section 9.4) must work end-to-end on the same deployment to demonstrate this.

**Context:** graduation project, 2 students, 8-week timeline, built with heavy Claude Code assistance. Scope has already been through two rounds of critical reduction — do not re-add anything from the "removed" list (Section 12) without an explicit, deliberate decision by both students.

---

## 2. Hard constraints — do not violate these

- **No visual Form Builder UI.** Forms are seeded directly to the database via a seed script. There is no authoring UI, and no API write endpoint for `FORM_DEFINITION`.
- **No visual Workflow Configuration UI.** Same rule — `WORKFLOW_DEFINITION` is seed-only.
- **Form and workflow definitions are immutable once any request exists for their service type.** No versioning system is built; changing a definition requires wiping that service type's request data via the seed script. This is a documented MVP limitation, not a bug.
- **No WebSockets.** All "live" updates use polling. Intervals: notifications 30s, task/request lists 30s, detail pages on-focus refresh only.
- **No push notifications, no draft saving, no signature capture, no self-service password reset** — explicitly cut for MVP. If asked to build one, say so instead of proceeding. *(The interactive map picker was cut here in v3 and deliberately reinstated by the v5 amendment — see the Map feature in `docs/PROGRESS.md`.)*
- **No new pages beyond the 14 listed in Section 4.** If a task seems to need a new page, say so — don't add one silently.
- **Every permission rule in Section 6 must be enforced server-side**, never only hidden in the UI.
- **No status keys hardcoded in application code.** Code reasons about statuses only via `category` and transition `action` flags (Section 9). If a feature seems to need a hardcoded status key, flag it.
- **Do not create new abstractions, config layers, or helper files beyond what a specific task needs.** Match existing project structure and patterns exactly.

---

## 3. Tech stack (decided — do not relitigate)

- **Mobile (User + Employee apps):** Flutter, single codebase with shared components (auth screens, dynamic form renderer widget, notifications list, profile)
- **Web (Monitor dashboard):** React
- **Backend:** Node.js + Express, REST API, JWT auth (jsonwebtoken), bcrypt password hashing
- **Database:** PostgreSQL (JSONB for form/workflow JSON; row locking via `SELECT … FOR UPDATE`)
- **File storage:** local disk under a non-web-root uploads directory, server-generated UUID filenames; DB stores metadata (Section 5)
- **Deployment:** one free-tier cloud host (Render or Railway — pick in Week 1, Day 1) for backend + Postgres + web build. Fallback if hosting fights back in Week 7: demo runs on a laptop (localhost) — decide by end of Week 7, never burn Week 8 on it.
- **Repo:** monorepo — `/mobile`, `/web`, `/backend`, `/docs`

**Security baseline (backend):**
- JWT: HS256, 24h expiry, secret from env var only (never committed). No refresh tokens (documented MVP limitation).
- Passwords: bcrypt, cost ≥ 10.
- Login rate limit: 5 attempts / 15 min per email+IP (in-memory limiter is fine).
- Never log request bodies on `/auth/*` or `/requests` routes (they contain passwords / personal data).
- Deactivated accounts (`is_active = false`) are rejected at JWT validation, not just at login.

---

## 4. The 14 frozen pages

**User mobile (5):** Login/Registration · User Home · Service Catalogue · Create Request (dynamic form) · My Requests + Request Details/Timeline (merged — list, detail, status timeline, comments, cancel, confirm/dispute resolution, attachments)

**Employee mobile (4):** Employee Home + My Tasks (merged) · Task Details · Update Task Status · Complete Task (dynamic form)

**Monitor web (5):** Monitor Login · Dashboard Overview · Requests Management + Assignment (merged; internally a list-pane + detail-pane — list/filters, request detail, timeline, comments, assign/reassign, priority, status override; budget this as two pages of effort) · Employees Management · Basic Reports

**Shared cross-app component (not a standalone page):** Notifications + Profile — reused by both mobile apps.

**UI-state rule (applies to every page):** every list has loading and empty states; every destructive or terminal action (cancel, reject, override, complete, deactivate) shows a confirmation dialog, with a note field where the workflow requires a note; 401 → redirect to login; 403/404 → inline error message. No page is "done" without these.

Full feature bullet points per page are in `/docs/page_features.md` if present; ask if you need them and they aren't in the repo.

---

## 5. Database schema (ER v3 — frozen)

### Entities

**DEPARTMENT** — id (PK), name

**USER** — id (PK), name, email (unique), password_hash, role (`user` / `employee` / `monitor`), phone (nullable), department_id (FK → DEPARTMENT, nullable, set for employees only), is_active (bool, default true), created_at

**SERVICE_TYPE** — id (PK), name, department_id (FK → DEPARTMENT), default_priority, enabled (bool)

**FORM_DEFINITION** — id (PK), service_type_id (FK → SERVICE_TYPE), form_type (`request` / `completion`), field_schema (JSONB — schema in Section 8). **Unique constraint on (service_type_id, form_type)** — exactly two rows per service type, enforced by the DB, not prose.

**WORKFLOW_DEFINITION** — id (PK), service_type_id (FK → SERVICE_TYPE, unique — one-to-one), statuses (JSONB array of `{key, label, category, is_initial, is_final}`), transitions (JSONB array of `{from, to, allowed_role, action, requires_note, requires_completion_form}`). Semantics in Section 9.

**REQUEST** — id (PK), user_id (FK → USER), service_type_id (FK → SERVICE_TYPE), form_response (JSONB), status (string — a status key from this service type's workflow), priority (enum: `low` / `medium` / `high`), created_at, updated_at

**REQUEST_STATUS_HISTORY** — id (PK), request_id (FK → REQUEST), status, changed_by (FK → USER), changed_at, note (nullable — required when the transition has `requires_note: true`, and for all monitor overrides). Reassignments and priority changes also write a history row with a descriptive note (e.g., "reassigned from X to Y") so the timeline is a complete audit trail.

**TASK** — id (PK), request_id (FK → REQUEST, **unique** — one task row per request, ever), employee_id (FK → USER), status (string), completion_form_response (JSONB, nullable until completed), assigned_at

**REQUEST_COMMENT** — id (PK), request_id (FK → REQUEST), user_id (FK → USER), body (text), created_at

**NOTIFICATION** — id (PK), user_id (FK → USER), request_id (FK → REQUEST, nullable), type (enum: `assigned` / `status_changed` / `completed` / `task_rejected` / `comment`), message, is_read (bool), created_at

**FILE_ATTACHMENT** — id (PK, UUID), request_id (FK → REQUEST, nullable), task_id (FK → TASK, nullable), original_filename, mime_type, size_bytes, storage_path (server-side, never exposed to clients), uploaded_by (FK → USER), uploaded_at. **CHECK constraint: exactly one of request_id / task_id is non-null.**

### Indexes (create with the schema, they're trivial)
`REQUEST(user_id)` · `REQUEST(service_type_id, status)` · `TASK(employee_id)` · `NOTIFICATION(user_id, is_read)` · `REQUEST_STATUS_HISTORY(request_id)` · `REQUEST_COMMENT(request_id)`

### Relationships
- DEPARTMENT 1—* USER (employees only) · DEPARTMENT 1—* SERVICE_TYPE
- USER 1—* REQUEST (submits) · USER 1—* TASK (assigned to) · USER 1—* NOTIFICATION · USER 1—* FILE_ATTACHMENT · USER 1—* REQUEST_COMMENT
- SERVICE_TYPE 1—* REQUEST · SERVICE_TYPE 1—* FORM_DEFINITION (request + completion) · SERVICE_TYPE 1—1 WORKFLOW_DEFINITION
- REQUEST 1—* REQUEST_STATUS_HISTORY · REQUEST 1—1 TASK (created at first assignment) · REQUEST 1—* FILE_ATTACHMENT · REQUEST 1—* NOTIFICATION · REQUEST 1—* REQUEST_COMMENT
- TASK 1—* FILE_ATTACHMENT

### Key design decisions (do not relitigate without discussion)

- `form_response` and `completion_form_response` are JSONB payloads validated server-side against the matching `FORM_DEFINITION.field_schema` (rules in Section 8) — this is what makes one table support every seeded service type.
- All status transitions (request and task) are validated by **one module: the workflow engine**. Nothing else may write `REQUEST.status` or `TASK.status`. `TASK.status` is intentional denormalization kept in sync with `REQUEST.status` in the same transaction; Monitor reads progress through `REQUEST.status` — there is no separate Monitor-facing task list endpoint.
- Every write to `REQUEST.status` / `TASK.status` inserts a `REQUEST_STATUS_HISTORY` row in the same transaction — including monitor overrides.
- **Locking rule:** every status-mutating operation (transition, override, cancel, assign, accept, reject, complete, resolution) begins by locking the REQUEST row (`SELECT … FOR UPDATE`) inside its transaction; all validation happens after the lock. This closes the check-then-act races (monitor cancels while employee completes; user cancels while monitor assigns).
- **Task lock is a function of status category, not a sticky flag:** while the request's current status has category `terminated` (Section 9), all `PATCH /tasks/{id}/status`, `/accept`, `/reject`, and `/complete` calls return `409 Conflict`, and `GET /tasks/{id}/valid-transitions` returns empty. If a Monitor override moves the request back to a non-terminated status (reopen), the task unlocks automatically.
- **Reassignment updates the existing TASK row in place** (`employee_id`, `assigned_at` reset) — never a second task row. The previous assignment is preserved as a `REQUEST_STATUS_HISTORY` note. Per-assignment audit granularity is a documented MVP limitation.
- **Employee task rejection:** requires a note; the workflow engine moves the request back to the transition's target status (a `triage`-category status — see seeded workflows), the task row is retained for reuse on reassignment, and the Monitor receives a `task_rejected` notification.
- **Department rule:** assignment is restricted server-side to employees whose `department_id` matches the request's service type's `department_id`. Assigning across departments returns 422.
- **Deactivation rule:** deactivating an employee with a task in any non-final status returns 409. Reassign first, then deactivate.
- **Monitor accounts are seed-only.** `POST /auth/register` creates `user` role only; employees are created via `POST /employees`; there is no API path that creates a monitor.

---

## 6. Permission matrix (enforce every row server-side)

| Action | User | Employee | Monitor |
|---|---|---|---|
| Register / log in | ✅ self | ✅ self | ✅ self (account is seed-only) |
| View/edit own profile | ✅ own only | ✅ own only | ✅ own only |
| View service catalogue | ✅ | ❌ | ❌ |
| Submit a request | ✅ | ❌ | ❌ |
| View own requests | ✅ own only | ❌ | ✅ all |
| Cancel a request | ✅ own, only while unassigned (pre-task) | ❌ | ✅ any state |
| Comment on a request | ✅ own | ❌ | ✅ any |
| Read comments on a request | ✅ own | ❌ | ✅ any |
| Confirm resolution / report unresolved | ✅ own, only from a `done`-category status | ❌ | ❌ |
| View all requests | ❌ | ❌ | ✅ |
| Assign / reassign employee | ❌ | ❌ | ✅ (same-department only) |
| Change priority | ❌ | ❌ | ✅ |
| Reject / cancel / reopen request (override) | ❌ | ❌ | ✅ (constrained — Section 7, Requests) |
| View own assigned tasks | ❌ | ✅ own only | ✅ read-only via `REQUEST.status` |
| Accept / reject a task | ❌ | ✅ own only | ❌ |
| Update task status | ❌ | ✅ own only, valid transitions only | ❌ |
| Submit completion form | ❌ | ✅ own only | ❌ |
| Upload file/photo | ✅ own request | ✅ own task | ❌ |
| Download file | ✅ if owns parent request | ✅ if assigned to parent task | ✅ any |
| View request contact info | — | ✅ limited (see below) | ✅ full |
| View dashboard / reports | ❌ | ❌ | ✅ |
| Export CSV | ❌ | ❌ | ✅ |
| Manage employee accounts | ❌ | ❌ | ✅ |
| Reset employee password | ❌ | ❌ | ✅ |
| View/mark own notifications | ✅ own only | ✅ own only | ✅ own only |
| Manage service types / forms / workflows | ❌ | ❌ | ❌ (seed script only, no in-app UI for anyone) |

**"Limited fields" for employees, precisely:** `GET /tasks/{id}` embeds the requester's `name` and `phone` but **not** `email`; and it strips every `form_response` field whose schema has `visible_to_employee: false` (Section 8). This is the only mechanism — there is no other filtering rule.

**Ownership checks** (`request.user_id == current_user.id`, `task.employee_id == current_user.id`) are required in addition to role checks — a role check alone is never sufficient for any "own only" row.

**404-over-403 rule:** for "own only" resources, a valid ID owned by someone else returns **404** (not 403), so users cannot probe which IDs exist.

**Testing rule:** the permission matrix is the test plan — every ✅/❌ cell gets at least one automated API test (Section 13).

---

## 7. API specification (v2, frozen contract)

Base path: `/api/v1`. Bearer JWT on every route except `POST /auth/register` and `POST /auth/login`.

**Auth:** `POST /auth/register` (creates `user` role only) · `POST /auth/login` · `GET /auth/me`
*Removed:* forgot/reset-password (out of scope — Section 12); logout is client-side token discard, no endpoint.

**Users:** `GET /users/me` · `PATCH /users/me` · `PATCH /users/me/password` (requires current password)

**Departments:** `GET /departments` (monitor; read-only, seed-only writes)

**Service types / forms (read-only):** `GET /services` (enabled only) · `GET /services/{id}/forms/request` · `GET /services/{id}/forms/completion` · `GET /services/{id}/workflow`

**Requests:**
- `POST /requests` — validates `form_response` per Section 8; request starts at the workflow's `is_initial` status
- `GET /requests?userId=me` (user) · `GET /requests` (monitor, all) — both support the standard list params below
- `GET /requests/{id}` (user own / monitor any — **not** called by employee); embeds status history, comments, and attachment metadata (the Timeline page needs exactly one call)
- `PATCH /requests/{id}/cancel` — user: only while no task exists; monitor: any state; note required
- `POST /requests/{id}/comments` · `GET /requests/{id}/comments`
- `PATCH /requests/{id}/resolution` — body `{outcome: "confirmed" | "unresolved", note}` (note required for `unresolved`); executes the workflow transition marked `action: confirm` or `action: dispute` (Section 9)
- `PATCH /requests/{id}/assign` — creates the task on first call, updates `employee_id` in place on reassign; same-department employees only (422 otherwise); duplicate no-op assign to the same employee → 409
- `PATCH /requests/{id}/priority`
- `PATCH /requests/{id}/status` — **monitor override, constrained:** target must be a status key that exists in this service type's workflow AND have category `terminated` (reject/cancel) **or** be used to reopen (target category `triage` or `in_progress`). Arbitrary status jumps are rejected with 422. Note always required. Writes history like any transition.

**Tasks:**
- `GET /tasks?employeeId=me` (standard list params)
- `GET /tasks/{id}` — embeds limited request data per Section 6 (this is what Task Details calls; employees never call `GET /requests/{id}`)
- `PATCH /tasks/{id}/accept` — executes the transition marked `action: accept`
- `PATCH /tasks/{id}/reject` — executes `action: reject`; note required; see Section 5 rejection semantics
- `GET /tasks/{id}/valid-transitions` — transitions from current status where `allowed_role` matches, empty while terminated
- `PATCH /tasks/{id}/status` — body `{to, note?}`; generic workflow transition
- `POST /tasks/{id}/complete` — executes the transition marked `action: complete`; validates `completion_form_response` against the completion FORM_DEFINITION (422 on failure)

**Notifications:** `GET /notifications?userId=me` · `PATCH /notifications/{id}/read` · `PATCH /notifications/read-all`

**Notification triggers (complete list — do not invent others):**
| Event | Notify |
|---|---|
| Task assigned/reassigned | employee (`assigned`) |
| Request status changed (any transition or override) | request owner (`status_changed`) |
| Task completed | request owner (`completed`) |
| Employee rejected task | all monitors (`task_rejected`) |
| Comment added | the other party (owner ↔ monitors) (`comment`) |

**Files:**
- `POST /files` (multipart; `requestId` XOR `taskId`) — allowlist `jpg/jpeg/png/pdf`; max 5 MB; MIME validated server-side by magic bytes, not extension; stored under UUID name outside web root; returns attachment `id`
- `GET /files/{id}` — authorization per Section 6 download row; served with `Content-Disposition: attachment`
- **Photo form fields (two-step contract):** the client uploads via `POST /files` first, then puts the returned attachment `id` into `form_response` under the field's `id`. The backend verifies the attachment exists and was uploaded by the caller.

**Employees (monitor only):** `GET /employees?departmentId=&q=` · `POST /employees` (monitor sets initial password) · `PATCH /employees/{id}` · `PATCH /employees/{id}/activate` · `PATCH /employees/{id}/deactivate` (409 if open tasks) · `PATCH /employees/{id}/reset-password` (monitor sets a new temporary password, returned once in the response; no forced-change flow — documented MVP limitation) · `GET /employees/{id}/tasks`

**Dashboard/Reports (monitor only):**
- `GET /dashboard/stats` — counts grouped by status **category** (never by raw status key), plus totals per service type and per priority
- `GET /dashboard/chart` — one chart: requests created per day, last 30 days
- `GET /reports` — same query engine as `GET /requests` (do not build a second one) + aggregate counts
- `GET /reports/export.csv` — same filters; columns: id, service type, status label, category, priority, requester name, employee name, created_at, completed_at. **CSV-injection guard:** any cell starting with `= + - @` is prefixed with `'`.

**Standard list params (all list endpoints):** `?page=1&pageSize=20` (max 100) `&status=&category=&serviceTypeId=&priority=&dateFrom=&dateTo=&q=` (params irrelevant to an endpoint are ignored).

**HTTP status codes (use exactly these):**
| Code | Use |
|---|---|
| 200 | Successful GET/PATCH with body |
| 201 | POST created (register, request, comment, file, employee) |
| 204 | Success, no body (mark read/read-all) |
| 400 | Malformed JSON / invalid query params |
| 401 | Missing/invalid/expired JWT; deactivated account |
| 403 | Valid token, role check failed |
| 404 | Not found — **also** for "own only" resources owned by someone else |
| 409 | Invalid/locked workflow transition; cancel-after-assignment; duplicate assignment; deactivate-with-open-tasks |
| 422 | Well-formed body failing validation — dynamic-form errors return per-field messages keyed by field `id` |
| 429 | Login rate limit exceeded (Section 3 security baseline) |
| 500 | Unhandled — generic message, never a stack trace |

**Rule:** `GET /requests/{id}` and `GET /tasks/{id}` are not interchangeable — each page calls exactly one of them, never both, to avoid ambiguous data ownership.

---

## 8. Dynamic form engine (spec)

### Field schema (`FORM_DEFINITION.field_schema` — JSONB array; array order = display order)

```json
{
  "id": "string — unique within the form, stable key used in form_response",
  "label": "string",
  "type": "text | multiline | number | date | dropdown | radio | checkbox | photo | location",
  "required": true,
  "options": [{"value": "k", "label": "Label"}],
  "min": 0,
  "max": 100,
  "visible_to_employee": true
}
```

- `options`: required for `dropdown`/`radio`, forbidden for other types.
- `min`/`max`: for `number` = value bounds; for `text`/`multiline` = length bounds; omit when unused.
- `checkbox` = single boolean. `photo` = stores a FILE_ATTACHMENT id (two-step contract, Section 7).
- `location` (v5 amendment — see `docs/PROGRESS.md`) = `{lat, lng}` object, lat ∈ [-90,90], lng ∈ [-180,180], exactly two keys; max one location field per form (seed-time check); no options/min/max.
- **Deliberately excluded** (do not add — this is not a form-builder platform): default values, conditional/branching fields, regex patterns, custom validation messages (generate generic ones from `label`), multi-file fields, sections/pages, computed fields.

### Backend validation (one generic function, driven entirely by the schema)
1. Validate against the stored `field_schema` of the matching FORM_DEFINITION.
2. **Reject unknown keys** in `form_response` → 422.
3. Enforce required, type, min/max, option membership → 422 with per-field errors keyed by field `id`.
4. For `photo`: attachment id must exist and belong to the caller.

### Seed-time validation (the seed script must enforce; the API then trusts stored schemas)
Unique field ids · valid types · options present exactly when required · min ≤ max · every workflow has exactly one `is_initial`, ≥ 1 `is_final`, valid categories, and all transition `from`/`to` keys exist in `statuses` · each `action` value appears at most once per workflow.

### Flutter renderer
Renders from the schema with zero per-service code. One defensive rule only: unknown `type` → disabled "unsupported field" placeholder; block submission if that field is `required`; never crash. Client-side validation mirrors the schema for UX, but the server's 422 is authoritative — render its per-field errors.

---

## 9. Dynamic workflow engine (spec)

### 9.1 Representation

```
statuses:    {key, label, category, is_initial, is_final}
transitions: {from, to, allowed_role, action, requires_note, requires_completion_form}
```

- `category` (closed enum): `new | triage | in_progress | done | closed | terminated`. **All cross-service logic — dashboard stats, report grouping, filters, the task lock, cancel-while-unassigned, resolution gating — operates on categories only.** Status keys are free-form per service type and never appear in code.
- `action` (nullable enum): `accept | reject | complete | confirm | dispute`. Binds the dedicated endpoints (`/accept`, `/reject`, `/complete`, `/resolution`) to whichever transition the seeded workflow marks. Each action appears at most once per workflow. This is what keeps those endpoints data-driven instead of hardcoded.
- `allowed_role`: `user | employee | monitor`. Role check is in addition to ownership checks (Section 6).
- `requires_note`: history row must include a note (422 without one).
- `requires_completion_form`: transition only executes via `POST /tasks/{id}/complete` with a valid completion form.

### 9.2 Engine rules
- One module validates and executes every transition: lock REQUEST row → check transition exists from current status → check role + ownership → check note/completion-form requirements → write both statuses + history row → commit.
- Monitor overrides go through the same module with the constraint in Section 7.
- `GET /tasks/{id}/valid-transitions` = transitions from current status with `allowed_role: employee`, empty while category is `terminated`.

### 9.3 Lifecycle conventions
- New request → the workflow's `is_initial` status.
- User cancel allowed only while the current status category is `new` or `triage` **and** no task exists.
- Resolution (`confirm`/`dispute`) allowed only from a `done`-category status.
- Reopen = monitor override to a `triage`/`in_progress` status; unlocks the task automatically (Section 5).

### 9.4 The two seeded workflows (frozen — these prove the thesis)

**Service A: "Equipment Repair" (IT department) — approval-gated, hold loop, rejectable:**

| Key | Label | Category | Flags | Transitions out (role, extras) |
|---|---|---|---|---|
| submitted | Submitted | new | initial | → approved (monitor) · → rejected (monitor, note) · → cancelled (user/monitor, note) |
| approved | Approved | triage | | → assigned (monitor) · → cancelled (monitor, note) |
| assigned | Assigned | triage | | → accepted (employee, action:accept) · → approved (employee, action:reject, note) · → cancelled (monitor, note) |
| accepted | Accepted | in_progress | | → in_progress (employee) |
| in_progress | In Progress | in_progress | | → awaiting_parts (employee, note) · → completed (employee, action:complete, completion form) |
| awaiting_parts | Awaiting Parts | in_progress | | → in_progress (employee) |
| completed | Completed | done | | → confirmed (user, action:confirm) · → in_progress (user, action:dispute, note) |
| confirmed | Resolved | closed | final | — |
| rejected | Rejected | terminated | final | — |
| cancelled | Cancelled | terminated | final | — |

**Service B: "Home Cleaning Visit" (Facilities department) — no approval gate, field-visit states, no reject terminal:**

| Key | Label | Category | Flags | Transitions out (role, extras) |
|---|---|---|---|---|
| booked | Booked | new | initial | → assigned (monitor) · → cancelled (user/monitor, note) |
| assigned | Assigned | triage | | → accepted (employee, action:accept) · → booked (employee, action:reject, note) · → cancelled (monitor, note) |
| accepted | Scheduled | in_progress | | → en_route (employee) |
| en_route | On the Way | in_progress | | → in_service (employee) |
| in_service | Service in Progress | in_progress | | → completed (employee, action:complete, completion form) |
| completed | Completed | done | | → confirmed (user, action:confirm) · → in_service (user, action:dispute, note) |
| confirmed | Closed | closed | final | — |
| cancelled | Cancelled | terminated | final | — |

Structural differences the demo points at: A has an approval gate, a hold loop-back, and a rejected terminal; B has none of those but has two field-visit states A lacks. Same engine, same code, different JSON.

**Seeded request forms (indicative — final wording in the seed script):**
- A: equipment type (dropdown) · room/location (text, max 100) · problem description (multiline, required, max 1000) · photo (optional) · urgent? (checkbox)
- B: preferred date (date, required) · package (radio: standard/deep) · number of rooms (number, 1–20) · has pets (checkbox) · address (text, required, `visible_to_employee: true`) · gate code (text, optional, `visible_to_employee: false` — demonstrates field-level filtering)

---

## 10. Development plan (8 weeks — respect the gates)

**Gates:** vertical slice v1 — end of **W3** · MVP complete — end of **W6** · code freeze — **W7 Wednesday** · deployed — end of **W7** · W8 = demo prep only.

| Wk | Deliverables | Student 1 | Student 2 | Must pass |
|---|---|---|---|---|
| 1 | Host picked; schema + migrations; auth | Flutter scaffold, auth screens, API client vs mock JSON | Express scaffold, schema, register/login/me, JWT + permission middleware skeleton | Login returns JWT; wrong password 401; inactive user 401 |
| 2 | Seeded config; form engine (read) | Dynamic form renderer (all 8 types) | Seed script (2 services, 4 forms, 2 workflows, seed-time validation); services/forms/workflow GETs; form validation function | Seed validates; renderer draws both request forms with zero code differences |
| 3 | **Vertical slice v1** | Create Request (real submit), My Requests, Home + Catalogue | `POST /requests` (422 per-field), `GET /requests` both modes, React scaffold + Monitor login + requests list | Phone submits → appears in Monitor. Missing required field 422; cross-user GET 404 |
| 4 | Workflow engine + assignment | Employee Home+Tasks, Task Details (via `GET /tasks/{id}`), accept/reject | Workflow engine (locking, history, sync), assign + task creation, valid-transitions, Requests Mgmt detail + assignment UI | Invalid transition 409; wrong role 403; reject returns request to queue; both workflows drive from data |
| 5 | Lifecycle closes | Update Task Status, Complete Task, user confirm/dispute + timeline | `/complete` validation, `/resolution`, monitor override + lock, comments, files backend | Both services E2E submit→confirmed; PATCH on cancelled task 409 |
| 6 | **MVP complete** | Notifications UI + Profile, photo upload both apps, React Employees Mgmt + Basic Reports pages | Notification triggers, files auth, dashboard stats/chart (category-based), reports + CSV | File IDOR blocked; bad upload rejected; CSV opens, injection escaped |
| 7 | Freeze Wed; test + deploy | Mobile fixes; renderer widget tests; release builds | API/permission test suite green; deploy | Full Section 13 checklist, each student testing the other's layer |
| 8 | Demo-ready | Two timed rehearsals on deployed system; fresh seed; backup screenshots/video of every step; report | | No new code after Monday except demo blockers |

Fallbacks: slice slips → W4 becomes slice-completion, cut `awaiting_parts`/`en_route`; W5 overrun → comments slip to W6, dispute flow to W6; W6 overrun → chart becomes number cards; deploy fails → localhost demo, decided by Friday W7.

Steps within weeks follow the dependency chain: schema → auth → permission middleware → seeded config → form engine → request submission → assignment → workflow engine → completion → resolution. Once Section 7 is frozen, mobile/web UI shells proceed in parallel against mocks.

---

## 11. Work division

- **Student 1:** Flutter User app, Flutter Employee app, shared mobile components (auth screens, dynamic form renderer, notifications list, profile), **the seed/demo-data script** (forces fluency in the schemas being rendered), **two React CRUD pages** (Employees Management, Basic Reports — built on Student 2's scaffold), mobile-side testing.
- **Student 2:** ER/schema + migrations, API implementation, auth + permission middleware, dynamic form engine (validation), workflow engine, file service, notification service, React scaffold + Monitor Login + Dashboard Overview + Requests Management, deployment.
- **Both, explicitly scheduled:** Week-1 contract pair-session; integration days at end of W3 and W5; W7 permission-matrix audit where **each student attacks the other's surface** (S1 probes the API with curl/Postman; S2 tries to break the apps).

---

## 12. Explicitly removed from scope (do not build without a deliberate re-scoping decision)

Visual Form Builder UI · Visual Workflow Configuration UI · standalone Operations Monitor page · WebSocket live refresh · push notifications · ~~interactive map pin picker~~ (reinstated by the v5 amendment — see `docs/PROGRESS.md`; GPS tracking stays removed) · signature capture · draft saving on Create Request · user satisfaction ratings · multi-organization administration · payments · advanced report design/BI analytics · continuous GPS tracking / route optimization · **self-service forgot/reset password (email flow)** · **request deadlines** · **form/workflow versioning** · **refresh tokens / server-side logout** · **per-assignment task audit rows** (history notes suffice).

---

## 13. Testing requirements (release gate)

- **Unit (backend):** form-validation function (each type × required/bounds/options/unknown-key) · workflow transition validator (valid, invalid, wrong role, final, terminated-locked).
- **API integration (most of the budget):** happy path + negatives per endpoint against a test DB.
- **Permission suite:** one automated test per ✅/❌ cell of the Section 6 matrix. The matrix is the test plan.
- **Flutter:** widget tests for the dynamic renderer only (schema → correct widgets; required blocking).
- **React:** manual E2E checklist per page (no component tests at this scale).
- **Manual acceptance:** the 10 core flows (register→login, submit, review+assign, accept/reject, status updates, complete, confirm, dispute, cancel/reopen, reports+CSV) on **both** seeded services, on the deployed build, executed by the student who didn't write that layer.

**Must-pass negative list:**

| # | Test | Expect |
|---|---|---|
| 1 | User A GETs user B's request | 404 |
| 2 | Employee GETs another employee's task | 404 |
| 3 | Status PATCH not in valid-transitions | 409 |
| 4 | Employee performs monitor-only transition | 403 |
| 5 | Assign already-tasked request to same employee | 409 |
| 6 | Status/complete on task under terminated request | 409 |
| 7 | `form_response` with unknown field id | 422 |
| 8 | Missing required / bad type / out-of-range / invalid option | 422, field-keyed |
| 9 | Upload `.exe` renamed `.jpg` | rejected (magic bytes) |
| 10 | Upload > 5 MB | 422 |
| 11 | Non-monitor calls CSV export | 403 |
| 12 | Concurrent status PATCHes on one task | exactly one succeeds |
| 13 | User cancel vs monitor assign race | one wins, other 409 |
| 14 | Deactivated employee's old JWT | 401 |
| 15 | Confirm resolution before `done` category | 409 |
| 16 | Cross-department assignment | 422 |
| 17 | Download another user's file | 404 |
| 18 | Monitor override to nonexistent status key | 422 |

---

## 14. Documented MVP limitations (say these in the report; do not "fix" them)

Redundant `TASK.status` (intentional denormalization) · immutable definitions, no versioning · reassignment overwrites `employee_id` (history note is the audit) · polling latency · 24h JWT, no refresh/revocation · email enumeration on register · single organization, broad Monitor role · temporary passwords not force-changed · no automated frontend E2E.

---

## 15. How to work on this project

- Scope every task to one feature or one page from Section 4 — never "build the app" as one task.
- For anything touching the dynamic form engine, workflow engine, or permission middleware: outline your approach and the files you'll touch first, wait for confirmation, then implement. These are the highest-risk modules.
- For straightforward CRUD endpoints or UI screens following an established pattern: implement directly.
- Every generated feature must be run and manually verified against seeded test data before being considered done — not just reviewed by reading.
- Commit after each verified feature, with a message naming the Section 4 page or Section 7 endpoint it implements — never batch multiple features into one commit.
- Never create test data by hand or via ad-hoc SQL — extend the seed script instead, so every developer and every demo starts from identical state. (Exception: temporarily flipping a flag to exercise a negative test, e.g. `is_active = false`, is fine — flip it back.)
- No status keys in application code — categories and actions only (Sections 2, 9). If a task seems to need one, flag it.
- If a request conflicts with anything in Sections 2, 5, 6, 7, 9, or 12 of this file, say so explicitly instead of quietly complying or quietly refusing.

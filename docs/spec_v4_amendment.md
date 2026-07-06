# Spec v4 Amendment — DRAFT (pending sign-off)

**Status: DRAFT.** Not in force until both students and the supervisor confirm. Once approved, fold these changes into `CLAUDE.md` (bump header to "Spec version: v4") and delete this file. Until then, v3 rules stand.

**Why:** supervisor-requested scope additions, feasible because the project is ~3 weeks ahead of the Section 10 plan (Week 6 deliverables done in calendar Week 3).

**What v4 adds, in one line each:**
1. A fourth role, `admin` (web-only, seed-only account), that manages monitor accounts and service configurations.
2. Service creation moves from seed-script-only to an admin JSON-import endpoint — **still no visual Form/Workflow Builder UI**.
3. An admin Audit Log (new `AUDIT_EVENT` table + page) for account/configuration events.
4. Smart notifications: escalation/staleness alerts (background sweep, category-driven, thresholds configurable per service type) + workload-based assignment suggestions.

---

## A. New role: `admin`

- `USER.role` enum gains `admin`. Exactly one admin account, **seed-only** (the "seed-only account" boundary moves up one level: v3 said monitors are seed-only; v4 says monitors are admin-created and *admin* is seed-only). No API path creates an admin.
- Admin uses the existing web login page; the web shell role-routes: admin sees only the three admin pages (Section D), monitor sees the existing five. Mobile apps reject admin logins the same way they reject monitor.
- Admin is **configuration-and-accounts only**. Admin has ❌ on every operational row of the Section 6 matrix (view requests, assign, dashboard, reports, comments, files…). Rationale: keeps the matrix churn small and the role story clean — admin configures the platform, monitors run operations.

### Section 6 permission matrix — new rows (all enforced server-side)

| Action | User | Employee | Monitor | Admin |
|---|---|---|---|---|
| Manage monitor accounts (create/edit/activate/deactivate/reset password) | ❌ | ❌ | ❌ | ✅ |
| Create service (JSON import: metadata + 2 forms + workflow) | ❌ | ❌ | ❌ | ✅ |
| Edit service metadata (name, enabled, escalation thresholds) | ❌ | ❌ | ❌ | ✅ |
| View audit log | ❌ | ❌ | ❌ | ✅ |
| View departments | ❌ | ❌ | ✅ | ✅ (was monitor-only; admin needs it for service creation) |

All existing rows: Admin gets ❌. Every new cell gets an automated test (the matrix is still the test plan).

---

## B. Service management (the JSON-import path — NOT a form builder)

**Section 2's "No visual Form Builder / Workflow Configuration UI" stays in force.** What changes: the *seed path* becomes callable by the admin at runtime.

- `POST /admin/services` — body: `{name, departmentId, defaultPriority, enabled, requestForm, completionForm, workflow}` where the last three are the same JSON shapes the seed script uses. Validated by the **existing** seed-time validators (`formSchema.js`, `workflowSchema.js`) — no new validation logic; 422 with the validators' errors on failure. Creates SERVICE_TYPE + both FORM_DEFINITIONs + WORKFLOW_DEFINITION in one transaction.
- `PATCH /admin/services/{id}` — metadata only: `name`, `enabled`, escalation thresholds (Section E). `departmentId` editable only while the service has zero requests (it drives assignment) → 409 otherwise.
- **Definitions are write-once at creation. There is no re-import or definition-edit endpoint.** The v3 immutability rule ("definitions immutable once any request exists, no versioning") is preserved with zero new enforcement code: to change a definition, create a new service and disable the old one. Documented workflow, not a bug.
- No service delete — disable only (requests reference it forever).
- The web page gives the admin two big JSON textareas (request form, completion form) + one for the workflow, a metadata form, and renders the validators' per-field 422 errors inline. Paste JSON, submit, done. This is deliberately austere — the demo line is "a third service goes live without touching code," which *strengthens* the project thesis.
- Seed script continues to exist unchanged (fresh-start and demo-reset path).

---

## C. Audit log

- **New table `AUDIT_EVENT`** — id (PK), actor_id (FK → USER), action (string, e.g. `monitor.created`, `employee.deactivated`, `service.created`, `service.updated`), entity_type (string), entity_id, detail (JSONB, nullable), created_at. Index on `created_at`.
- **Scope rule (keep one source of truth):** request lifecycle stays audited in `REQUEST_STATUS_HISTORY` (already complete per v3). `AUDIT_EVENT` covers **account and configuration events only**: employee CRUD/activate/deactivate/reset-password, monitor CRUD/activate/deactivate/reset-password, service create/update. No login events (noise, and the rate limiter already guards auth).
- Writes happen inline in the existing employees routes + new monitors/services routes (same transaction). No new abstraction — it's one INSERT per mutating handler.
- `GET /audit-events` (admin-only): standard pagination + filters `action=`, `actorId=`, `dateFrom=`, `dateTo=`.

---

## D. Pages: 14 → 17 (web 5 → 8)

New web pages, admin-only, all following the Employees Management pattern (list + dialogs, no polling, reload after write, all Section 4 UI-state rules apply):

1. **Monitors Management** — clone of Employees Management one level up: list, add (admin sets initial password), edit, activate/deactivate, reset password (temp password shown once). Guard: deactivating the **last active monitor** → 409.
2. **Services Management** — service list (enabled toggle, request counts), create-via-JSON dialog (Section B), metadata/threshold editing.
3. **Audit Log** — filterable read-only table over `GET /audit-events`.

The Section 2 "no new pages beyond the 14" rule is amended to "beyond the 17". Everything else in the freeze holds.

---

## E. Smart notifications

### E1. Escalation / staleness alerts

- **Three nullable integer columns on SERVICE_TYPE** (null = rule off for that service): `escalate_unassigned_hours`, `escalate_stale_hours`, `escalate_confirm_hours`. Admin-editable via `PATCH /admin/services/{id}`.
- **Background sweep** in the backend process (`setInterval`, every 5 min, interval from env): one query per rule, **category-driven only — no status keys in code** (Section 9 rule fully applies):
  - *Unassigned:* category `new`/`triage`, no task row, `updated_at` older than `escalate_unassigned_hours` → notify **all monitors**.
  - *Stale:* category `in_progress`, `updated_at` older than `escalate_stale_hours` → notify **all monitors**.
  - *Awaiting confirmation:* category `done`, `updated_at` older than `escalate_confirm_hours` → notify the **request owner** (nudge to confirm/dispute).
- **New NOTIFICATION type: `escalation`** (added to the Section 7 trigger table). Message names the request, the rule, and the age.
- **Dedup, no schema change:** skip a request if an `escalation` notification for it exists with `created_at > request.updated_at`. One alert per stagnation period; any status change resets eligibility.
- Delivery is the existing 30s polling — **push notifications remain removed** (Sections 2/12 unchanged).
- Mobile User app renders the new type with its own icon (owner nudge lands there); monitors see it in the web bell. Employee app never receives escalations.
- Seed: set demo-friendly thresholds on both services and include at least one over-threshold demo request so the sweep fires visibly in the demo.

### E2. Assignment suggestions (workload-based)

- `GET /employees` gains `openTaskCount` (tasks in non-final status, finality read from workflow JSONB — same mechanism as the deactivate guard). No new endpoint.
- The assignment picker in Requests Management sorts same-department employees by `openTaskCount` ascending and badges the lowest "Suggested". Server does not enforce the suggestion — monitor stays free to pick anyone (same-department rule unchanged).

### Section 7 notification-trigger table — amended (complete list)

| Event | Notify |
|---|---|
| *(existing five rows unchanged)* | |
| Escalation rule fires (unassigned / stale) | all monitors (`escalation`) |
| Escalation rule fires (awaiting confirmation) | request owner (`escalation`) |

---

## F. API additions (base `/api/v1`, all bearer-JWT)

**Monitors (admin only, mirrors the employees surface):** `GET /monitors` · `POST /monitors` · `PATCH /monitors/{id}` · `PATCH /monitors/{id}/activate` · `PATCH /monitors/{id}/deactivate` (last-active-monitor → 409) · `PATCH /monitors/{id}/reset-password`

**Admin services:** `POST /admin/services` · `PATCH /admin/services/{id}` (per Section B)

**Audit:** `GET /audit-events` (per Section C)

**Changed:** `GET /departments` monitor+admin · `GET /employees` adds `openTaskCount`

HTTP codes: existing table unchanged; the new 409s (last monitor, department-edit-with-requests) and 422s (JSON import validation) fit the existing rows.

---

## G. Schema changes (migration `003_admin.sql`)

- `USER.role` check constraint gains `admin`.
- `SERVICE_TYPE` + 3 nullable int columns (Section E1).
- New `AUDIT_EVENT` table + index (Section C).
- Seed: `admin@monitorflow.dev` / `Password123!`, thresholds on both services, one over-threshold demo request.

---

## H. Section 12 (removed list) — v4 status

- ~~Monitor accounts seed-only~~ → **reversed**: admin-created; admin is seed-only.
- ~~No API write for FORM_DEFINITION / WORKFLOW_DEFINITION~~ → **reversed, narrowly**: one admin-only create-time import endpoint, seed validators, write-once.
- **Everything else stays removed** — explicitly including: Visual Form Builder UI, Visual Workflow Config UI, definition versioning/editing, push notifications, WebSockets, request deadlines (escalation thresholds are per-service staleness rules, not per-request deadlines), self-service password reset, refresh tokens.

---

## I. Revised plan (calendar weeks; today = Mon of W3)

| Wk | Deliverables | Student 1 | Student 2 | Must pass |
|---|---|---|---|---|
| 3 | Spec-v4 sign-off (supervisor + both) · migration 003 · admin role | Monitors Management page (vs. mock, then live) | Migration, admin auth/routing, monitors endpoints + audit writes | Admin login routes to admin shell; monitor hitting `POST /monitors` → 403; create monitor → monitor logs in |
| 4 | Service management + audit log | Audit Log page · mobile `escalation` type rendering | `POST/PATCH /admin/services` (JSON import, seed validators) · `GET /audit-events` · Services Management page | Invalid workflow JSON → 422 with validator errors; third service created via UI is submittable from mobile with zero code changes; dept-edit-with-requests → 409 |
| 5 | Smart notifications · integration day | Verify escalation E2E on mobile (owner nudge) · picker "Suggested" badge UX check | Escalation sweep + thresholds · `openTaskCount` + picker sort | Sweep fires on over-threshold seed request; second sweep inserts no duplicate; status change re-arms; suggestion = least-loaded same-dept employee |
| 6 | Full Section 13 suite incl. all new matrix cells; cross-attack audit (each student attacks the other's surface) | Renderer/widget tests + probe API | API/permission suite green | Every new ✅/❌ cell tested; new must-pass list below green |
| 7 | **Freeze Wednesday** · deploy (Render/Railway; localhost fallback decided Friday) | Release builds, mobile fixes | Deploy | Deployed system passes the 10-flow manual acceptance + admin flows |
| 8 | Demo prep only | Two timed rehearsals, fresh seed, backup screenshots/video, report | | No new code after Monday except demo blockers |

Buffer note: this schedule re-lands us on the original W7/W8 endgame with the same protection for testing and deployment. If anything slips, the cut order is: E2 suggestions → Audit Log page (keep the table + endpoint, page becomes report material) → escalation goes threshold-hardcoded instead of admin-editable.

### New must-pass negatives (append to Section 13)

| # | Test | Expect |
|---|---|---|
| 19 | Monitor calls `POST /monitors` | 403 |
| 20 | Admin calls `GET /requests` (or any operational endpoint) | 403 |
| 21 | Service import with invalid workflow (e.g. two `is_initial`) | 422, validator message |
| 22 | Change `departmentId` on a service with requests | 409 |
| 23 | Deactivate the last active monitor | 409 |
| 24 | Second sweep pass on an already-escalated request | no duplicate notification |
| 25 | Non-admin calls `GET /audit-events` | 403 |

---

## Open questions for the sign-off session

1. **Audit event list** — is account+configuration scope enough, or does the supervisor expect login events too? (Draft says no — noise.)
2. **Default thresholds** — proposed: unassigned 4h, stale 48h, confirm 72h (seed values; admin-editable).
3. **Admin visibility** — confirm admin really shouldn't see requests/dashboard. If the supervisor wants admin ⊇ monitor, that's a bigger matrix change — flag before building.

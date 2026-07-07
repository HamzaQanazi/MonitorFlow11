# MonitorFlow — Feature Catalogue

This document lists every feature of the platform, page by page, across the three client applications and the shared backend. It is the `docs/page_features.md` referenced by `CLAUDE.md` Section 4.

MonitorFlow is a configurable, multi-sector service-request and field-operations platform: a **User mobile app** (request services), an **Employee mobile app** (execute field tasks), and a **Monitor web dashboard** (dispatch and oversee), backed by one Node.js/Express REST API and one PostgreSQL database. Its central architectural claim: structurally different service types run on the same code purely through backend configuration, proven by two seeded services (Equipment Repair, Home Cleaning Visit) with different forms and different workflows.

## Platform foundations (used by every page)

- **Dynamic form engine** — request and completion forms render from a per-service JSON schema (8 field types: text, multiline, number, date, dropdown, radio, checkbox, photo), with one generic server-side validator returning per-field errors; the mobile renderer mirrors validation client-side and degrades gracefully on unknown types.
- **Dynamic workflow engine** — statuses and role-gated transitions are per-service data; one backend module executes every status change under a row lock, writing an audit history row in the same transaction. Application code references only status *categories* (new/triage/in_progress/done/closed/terminated) and transition *actions* (accept/reject/complete/confirm/dispute) — never raw status keys.
- **Permission model** — every rule enforced server-side: role checks plus ownership checks; resources owned by someone else return 404 (not 403) so IDs cannot be probed; monitors are department-scoped (spec v4).
- **Notifications** — polling-based (30s): task assigned/reassigned, status changed, task completed, task rejected, comment added, plus escalation alerts (unassigned too long, stale work, awaiting confirmation) driven by per-service thresholds.
- **Files** — photo/PDF attachments with server-side magic-byte MIME validation, 5 MB cap, UUID storage outside the web root, download authorization by ownership/assignment/role.
- **Security baseline** — JWT (HS256, 24h), bcrypt passwords, login rate limiting, deactivated accounts rejected at token validation, CSV-injection guard on exports, no stack traces to clients.

## User mobile app (Flutter)

### 1. Login / Registration
Self-registration (always `user` role), login with per-field validation errors, 401/429 states, session restore with server revalidation, role-based post-login routing (monitors are directed to the web app).

### 2. User Home
Recent requests at a glance (30s auto-refresh), entry points to the catalogue and full request list, notifications bell with unread badge, profile access.

### 3. Service Catalogue
Lists enabled services with department context; entry point to Create Request. Re-checked when reusing an old request in case a service has been disabled.

### 4. Create Request (dynamic form)
The renderer draws whichever form the selected service defines — zero per-service code. Client-side validation mirrors the server; the server's per-field 422 responses are rendered inline. Photo fields use the two-step upload contract (upload, then submit the returned attachment id). Supports prefilling from a previous request ("Request again"), dropping non-reusable photo ids.

### 5. My Requests + Request Details / Timeline
List with status-category filter chips, pull-to-refresh, 30s polling, loading/empty/error states. Detail view (one API call): status timeline with actor names and notes, schema-labelled answers (option labels, Yes/No, photo markers), comments (read + post), attachments, **cancel** (only while unassigned, note required, confirmation dialog), **confirm / dispute resolution** from a done-category status (note required to dispute), and "Request again".

## Employee mobile app (Flutter)

### 6. Employee Home + My Tasks
Task queue grouped by actionability (needs response / in progress / history), status-category chips (shared widget), high-priority markers, request ids and relative times, 30s polling and pull-to-refresh.

### 7. Task Details
The employee's limited view: requester name and phone (never email), form answers with `visible_to_employee: false` fields stripped server-side, tap-to-call the requester. Action buttons come entirely from the server's valid-transitions endpoint — **accept** (confirm dialog) and **reject** (mandatory note; returns the request to the monitor queue) included.

### 8. Update Task Status
Generic workflow moves as buttons (e.g. hold loops like "awaiting parts", field-visit states like "on the way"), each with a note dialog when the transition requires one; concurrent-change 409s surface the server message and reload.

### 9. Complete Task (dynamic form)
The service's completion form rendered by the same engine, including photo evidence upload; confirmation dialog; per-field 422 and stale-task 409 handling.

## Shared mobile components (both apps)

- **Notifications** — bell + unread badge in every app bar (30s poll), type-iconed list, mark-read on tap, mark-all-read, tap-through to the related request (User) or task (Employee).
- **Profile** — edit name/phone, change password (current password required, per-field errors); email and role immutable.

## Monitor / Admin web dashboard (React)

### 10. Monitor Login
Split-layout login with full state design (field errors, 401, 429, network, submitting), password visibility toggle, monitor/admin role gate with token discard on rejection.

### 11. Dashboard Overview
Queue-health strip and stacked proportion bar by status category, 30-day activity chart with accessible data table, by-service and by-priority breakdowns, 30s silent refresh — all computed over categories, never raw status keys, so it works for any seeded service.

### 12. Requests Management + Assignment
List pane: category chips, service/priority filters, debounced search, pagination, age-since-update column — all filter state in the URL (deep-linkable), 30s polling. Detail pane (row click or deep link): full timeline with notes, form answers with schema labels, attachments with provenance badges ("Before" / "Task · After"), comments (read + post), **assign/reassign** with a department-filtered, least-loaded-first employee picker ("Suggested"), **priority change**, **workflow action buttons derived from the data** (e.g. approve/reject on gated services), **cancel** and **reopen** overrides — every destructive action behind a confirmation dialog with a required note; inline 409/422 error display.

### 13. Employees Management
Department-scoped list with search and filters; create (initial password set by monitor), edit, activate/deactivate (blocked with an inline explanation while the employee holds open tasks), reset password (temporary password revealed once), per-employee workload dialog (category counts + task table).

### 14. Basic Reports
The same filter vocabulary as Requests Management plus date range and per-employee filter; aggregate cards (total, by category/priority/service); filtered table; **CSV export** honoring all filters, with formula-injection escaping.

### 15. Monitors Management (admin, spec v4)
Admin-only management of monitor accounts mirroring the employees surface: create with department, edit, activate/deactivate, reset password — guarded so a department can never lose its last active monitor.

### 16. Audit Log (admin, spec v4)
Read-only audit trail of every administrative write (who did what to whom, when), with action/actor/date filters, all URL-backed; populated honestly from seed onward.

## Cross-cutting operational features

- **Department scoping (spec v4)** — monitors see and act on only their department's requests, employees, files, and notifications; admins manage accounts but are locked out of operational data.
- **Smart notifications (spec v4)** — a background escalation sweep alerts monitors to unassigned/stale work and nudges users awaiting confirmation, deduplicated per stagnation period; assignment suggestions rank employees by open workload.
- **Complete audit trail** — every status change, reassignment, priority change, and override writes a timeline row; administrative writes additionally log audit events.

## Planned (spec v5, in progress)

- **Map feature** — location picking on request creation (new `location` form field type), an employee map of their active tasks, and a monitor map with zoom-dependent marker clustering and employee/task filters; OpenStreetMap-based, no employee GPS tracking. Full plan: `docs/map_feature_plan.md`.

## The two seeded services (the configurability proof)

| | Equipment Repair (IT) | Home Cleaning Visit (Facilities) |
|---|---|---|
| Approval gate | Yes (monitor approves before assignment) | No (straight to assignment) |
| Hold loop | Awaiting Parts ⇄ In Progress | — |
| Field-visit states | — | On the Way → Service in Progress |
| Reject terminal | Yes | No |
| Form | equipment type, room, problem description, photo, urgency | date, package, rooms, pets, address, gate code (hidden from employees) |

Same engine, same code — different JSON.

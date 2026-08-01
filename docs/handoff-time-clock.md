# Handoff — Time Clock + Schedule (shipped), Time Off (planned) — 2026-08-01

## Where things stand

**Time Clock** and **Schedule** are fully built, shipped, committed, and
pushed to `main`: backend (self-service + manager API for both), web console
(Time Clock's Today + Timesheets tabs, Schedule's Roster + Templates tabs),
and mobile (employee clock in/out screen, employee read-only "My Schedule").

**Time Off** is fully planned but **not started** — no code written yet. Full
plan below under "Next up: Time Off." This is the very next task.

Dropped from scope (deliberate, discussed with the user):
- **NFC clock-in** — hardware-dependent, no testable path in this environment.
- **Mobile shift extras** (in-shift notes/photos/tips) — task-completion
  photos already cover "proof of work done"; the backend endpoint
  (`POST /timeclock/shifts/:id/entries`) still exists and is tested,
  just has no mobile UI. Safe to leave or wire up later.
- **Schedule recurrence** — the Roster is a flat, date-by-date grid a manager
  re-fills a week at a time (with a "Copy last week" convenience). No
  recurring-pattern-plus-exceptions engine — discussed with the user and
  deliberately scoped out as unnecessary complexity for a 2-student project.

## What was built (Time Clock + Schedule)

**Time Clock backend** (`backend/src/routes/timeclock.js`, `lib/timeClock.js`, `lib/csv.js`, migration `017_time_clock.sql`):
- Self-service: `GET /timeclock/shifts/active`, `POST clock-in`,
  `POST clock-out`, `POST breaks/start`, `POST breaks/end`,
  `POST shifts/manual`, `POST shifts/:id/entries`.
- Manager (Gate 1 `view_all`/`manage_employees`, Gate 2 subtree-scoped):
  `GET today`, `GET timesheets`, `PATCH shifts/:id`,
  `POST shifts/:id/approve`, `GET timesheets/export.csv`.

**Schedule backend** (`backend/src/routes/schedule.js`, migration `018_schedule.sql`):
- Manager (`view_all` to read, `manage_employees` to write, subtree-scoped):
  `GET/POST/PATCH/DELETE /schedule/templates`, `GET/PUT /schedule/roster`
  (bulk upsert, `templateId: null` clears a day).
- Self-service: `GET /schedule/mine`.
- Replaced `employee_default_shift` (a single fixed per-employee weekday
  baseline, no authoring UI) with `schedule_entry` — Time Clock's
  late/absent/overtime math (`lib/timeClock.js`) now reads the actual
  per-date schedule entry instead of a static pattern.
- `openapi.yaml` updated to match (I7) for both feature areas.
- 58/58 backend tests passing (`npm test` in `backend/`).

**Web**:
- `TimeClockPage.tsx`/`.css`: Today tab (attendance table + 5 clickable
  counters) and Timesheets tab (weekly grid, day-detail dialog with
  edit/approve, CSV export).
- `SchedulePage.tsx`/`.css`: Templates tab (bilingual-name CRUD) and Roster
  tab (week grid, click-a-cell template picker, Clear day, Copy last week).
  Both nav items gated on `view_all`.

**Mobile**:
- `mobile/lib/employee/time_clock_screen.dart` + `manual_hours_screen.dart`:
  clock in/out, start/end break, manual hours entry.
- `mobile/lib/employee/schedule_screen.dart`: read-only 14-day upcoming
  schedule list. Both reached via app-bar icons on Employee Home.

## Known limitations / things to watch (Time Clock + Schedule)

1. **UTC day-bucketing, not company-local.** The DB session runs in
   `Asia/Gaza` (UTC+3). Time Clock's Today/Timesheets SQL queries force
   `AT TIME ZONE 'UTC'` explicitly so they agree with the JS-side math —
   but this means a shift near midnight buckets by UTC calendar day, not
   local calendar day. No `company.timezone` column exists to do better.
   Schedule dates are plain `DATE` values (no timezone ambiguity), so this
   only affects Time Clock's shift timestamps.
2. **Neither mobile screen was click-tested live in a real browser/emulator.**
   No Android emulator available; Windows desktop build fails (no Visual
   Studio toolchain installed). It does run in Chrome via
   `flutter run -d chrome` (verified working — see "How to run everything"
   below) but wasn't clicked through interactively this session (Chrome
   DevTools MCP tools were unavailable). Verified instead via:
   `flutter analyze` (clean) and `flutter build web` (succeeds) for both
   screens, plus every endpoint each screen calls independently
   live-verified against the real backend. **Click through both screens once
   in the running Chrome instance before calling this fully done** —
   especially Schedule's Roster grid interactions and RTL layout.
3. `employee_default_shift` is gone (dropped in `018_schedule.sql`) — fully
   replaced by `schedule_entry`. If you're reading old context that
   mentions it, it's stale.

## Test accounts (local dev DB)

All passwords: `Password123!`

| Login | Role | Notes |
|---|---|---|
| `owner@company.com` | admin (Owner) | seeded, onboarding already completed (company "da"/"dasd", plan `growth`) |
| `ma.manager@adad.ada` | employee, level "Manager" (`view_all`+`manage_employees`) | web console access; manages Sub Ordinate |
| `su.ordinate@adad.ada` | plain employee | mobile-only; has real Time Clock history (clocked shifts, an edited shift, an approved manual entry) |
| `ti.clocker@adad.ada` | plain employee | earlier test account, no manager assigned |

Local backend: `DATABASE_URL` in `backend/.env` → Postgres at
`localhost:5432/monitorflow`. Reseed with `SEED_FORCE=true npm run seed`
if needed (resets everything — the accounts above won't exist until
re-created through the app).

## How to run everything (verified working commands, this session)

```
cd backend && node src/index.js        # API on :3000
cd web && npm run dev                  # console on :5173
cd mobile && flutter run -d chrome --web-port=8765   # mobile app in Chrome
```
`flutter devices` on this machine only ever offers Windows desktop (broken —
no VS toolchain) and Chrome/Edge web — no Android emulator. Chrome is the
only working target here.

## Next up: Time Off

**Step 1 (engine change) is DONE, committed.** Steps 2–4 (seed the service,
mobile screens) are still not started — see the checklist below, now trimmed
to what's left.

### Step 1 — done: employees can now own/submit requests

The original two-bullet finding undersold the scope — tracing every
`req.user.role` branch in `requests.js` plus `workflowEngine.js` (not just the
two spots first flagged) turned up a second, deeper hardcode: `partyOf(user)`
in `workflowEngine.js` resolved *any* non-`user` caller to `'assignee'`, and
`resolveTransition`'s ownership check only ever compared a non-oversight
employee against `taskEmployeeId` — never `requestUserId`. An employee-owned,
task-less request (exactly Time Off's shape) would have 404'd immediately.
That engine function is the real chokepoint (`PATCH /:id/cancel` and the
generic `POST /:id/transitions` both route through it), so the fix landed
there, not per-caller. Also fixed, all necessary once employees can own a
request: the blanket "non-oversight employee → 403" checks in `GET /`,
`GET /:id`, `PATCH /:id/cancel`, and `loadCommentableRequest` (they pre-date
employees ever owning anything and would have wrongly blocked a Time-Off
submitter viewing/commenting on their own request); `buildRequestFilter` in
`lib/requestQuery.js` (an employee's list is now `own rows OR subtree-owned
rows`, so an oversight employee who *also* submitted their own Time Off still
sees it); and the cancel handler's oversight/override branch (an oversight
employee cancelling their *own* submitted request now cancels as the
requester, not as an override requiring the `override` capability).

Two new unit tests added to `workflowEngine.test.js` covering the
employee-requester path (owns-the-request-with-no-task passes; owns neither
request nor task → 404). Full suite: 60/60 passing. Migration
`019_employee_submitters.sql` adds `service_type.accepts_employee_submitters`
(default false); `routes/services.js` (Add Service builder) and
`openapi.yaml` updated to match. `lib/formSchema.js`/`workflowSchema.js`
needed no change — they validate field/workflow shapes, not the
`accepts_*` flags (those are validated directly in the route, same as
`acceptsExternalUsers` already was — the original checklist's guess here was
wrong).

**Not yet live-verified end-to-end against a running server** — local dev DB
login (`su.ordinate@adad.ada` / `owner@company.com`, `Password123!` per the
table below) returned "Invalid credentials" this session, which predates
these changes (auth.js wasn't touched) and wasn't chased down. Confirmed
correct instead via 60/60 unit tests exercising the exact ownership/party
logic that changed. **Verify logins before the next session assumes they
work** — if they're still broken, check whether the accounts were re-seeded
with different values since this doc was last written.

### Original finding (context for the above, still accurate)

`routes/requests.js` hardcoded requester = `role === 'user'` in two places:
`POST /` (`if (req.user.role !== 'user') return res.status(403)`) and
`loadTransitionContext` (only `role === 'user'` was ever assigned
`party: 'requester'`). **Employees could not submit or own a request at
all.** This was core-engine territory (CLAUDE.md §16) — the change is
role-generic, not Time-Off-specific (I1 is not violated).

Also useful context already confirmed:
- `GET /services` already returns every enabled service to staff
  (employees/admins) with no filtering beyond the `user`-only
  `accepts_external_users` gate — no change needed there.
- Web Requests Management already renders any service generically — no new
  web work needed at all for the manager-review side.
- The workflow shape Time Off needs (submit → oversight approve/reject →
  terminal, no task) is already proven: see the since-removed
  `docs/demo/home_nursing.json` fixture for the JSON shape to copy from
  (it uses a similar but not identical shape — home_nursing has a dispatch/
  complete/confirm loop; Time Off is simpler, see below).

### Decided: `accepts_employee_submitters` flag (not "any employee, any service")

Discussed with the user — went with the safer, more precedented option:
add `accepts_employee_submitters BOOLEAN NOT NULL DEFAULT FALSE` to
`service_type`, mirroring the existing `accepts_external_users` column
exactly. Time Off gets `true`; every other service defaults `false`, so a
field employee can't accidentally submit e.g. a Home Nursing Visit just
because the role check got relaxed.

### Engine change checklist — ALL DONE (see "Step 1 — done" above)

Migration, `requests.js` (both spots plus the three extra ones the tracing
turned up), `workflowEngine.js`'s `partyOf`/ownership check, `requestQuery.js`,
`routes/services.js`, `openapi.yaml`, and the full test suite (60/60) are all
committed. Next up is seeding the Time Off service itself (below), then mobile.

### Time Off definition (seed it, same as every other service)

- New department: **"Human Resources"**.
- `service_type`: key `time_off`, `accepts_employee_submitters: true`,
  `accepts_external_users: false`, `owner_id` = whichever employee should
  centrally review requests. Visibility then radiates *up* from that owner
  to the root (Gate 2's existing rule — "owner_id in actor's subtree" means
  actor is at-or-above owner in the tree) — same mechanism every other
  service already uses, not a new one. This is centralized-HR-review by
  design, not "your own direct manager only" — that's consistent with how
  the whole system already works, not a limitation specific to Time Off.
- **Request form** (no completion form — no task/assignee, pure approval
  decision):
  - `start_date` — type `date`, required
  - `end_date` — type `date`, required
  - `type` — type `dropdown`, required, options: vacation / sick / unpaid
  - `reason` — type `multiline`, optional
- **Workflow** ("approval gate + reject terminal" shape):
  - `pending` (initial) → `approved` (terminal): `required_capability:
    manage_employees`
  - `pending` → `rejected` (terminal): `required_capability:
    manage_employees`, `requires_note: true`
  - `pending` → `cancelled` (terminal): `actor: requester`
  - `manage_employees` was chosen (over `override` or `assign`) to keep
    "people-ops" capability coherent across Time Off/Schedule/Time Clock
    manager actions — all the same capability gates all three.
- Authored via `seed.js`, like every other service — keeps demo data
  reproducible on reseed (CLAUDE.md's "never hand-create test data" rule).
  **Bonus option, not required**: the live Add Service Wizard
  (`POST /services`, `web/src/pages/AddServiceWizard.tsx`, admin-only, same
  seed-time validators) already exists and is nav-linked
  (`nav_add_service`) — you could demo adding Time Off live instead of/in
  addition to seeding it, since it's genuinely built for exactly this.
  Decide later; not blocking.

**Known gap, won't be fixed as part of this**: the dynamic form engine has
no cross-field validation (a documented exclusion, not a bug) — nothing
stops a submitted `end_date` before `start_date`. The approver just sees a
nonsensical range and rejects it manually.

### Mobile (Employee app) — new screens needed

No generic multi-service catalogue needed since Time Off is the only thing
employees submit — smaller than porting the User app's full flow:
- One **"Request Time Off"** screen reusing the existing shared
  `mobile/lib/forms/dynamic_form.dart` widget (already used by both
  `user/create_request_screen.dart` and `employee/complete_task_screen.dart`
  — this is real, already-proven reuse, not aspirational).
- One **"My Time Off"** list + detail/timeline screen, trimmed down from
  `user/my_requests_screen.dart` + `user/request_detail_screen.dart` (don't
  port the full generic multi-service version — Time Off is the only
  service in scope, keep it single-purpose).
- Reached via an app-bar icon on Employee Home, same pattern as Time
  Clock/Schedule (`mobile/lib/employee/employee_home.dart`).

### Web

Nothing new. Requests Management already renders any service generically —
whoever holds `owner_id` (or is above them) just uses the page that already
exists.

### Optional follow-up (separate, smaller, after the base flow ships)

Wire an approved Time Off day into Time Clock: suppress the `absent` flag in
`lib/timeClock.js` for a date covered by an approved request. Real
value-add, not required for a working first cut — don't bundle it into the
same PR/commit as the base Time Off flow.

### Suggested build order (matches how Time Clock/Schedule were built)

1. ~~Engine change~~ — **done, committed** (see "Step 1 — done" above).
2. Seed the Time Off service/form/workflow + Human Resources department.
   Verify live against the backend (submit as an employee, approve/reject
   as the owner) before moving on. **First fix/confirm dev-DB login** (see
   the "not yet live-verified" note above) — you'll need a working session
   to do this verification at all.
3. Web: nothing to build, just verify Requests Management renders it
   correctly.
4. Mobile: Request Time Off screen, then My Time Off list/detail screen.
5. Commit separately per layer (seed data / mobile), never batched — same
   discipline as Time Clock and Schedule's commits.
6. Optional: the Time Clock absence-suppression follow-up, as its own
   commit, only if there's time.

Chat/Directory/Events/Knowledge Base/Hiring/Training/Recognitions were
recommended **against** in an earlier session — separate product domains,
some (chat) conflict with the "no WebSockets/push" hard constraint, low
payoff for a 2-student grad project.

## If you're picking this up cold

1. Read `CLAUDE.md` in the repo root first — it's the single source of
   truth for invariants (two-gate permission model, bilingual/RTL,
   no status keys in code, etc.) and overrides any instinct to
   "improve" something that looks unusual. §6 documents the Time Clock and
   Schedule tables.
2. `backend/migrations/017_time_clock.sql` + `018_schedule.sql` and their
   route files are the most-commented if you need a design decision (UTC
   bucketing, the "first break only" simplification on the Today tab, why
   Schedule's roster is a flat grid with no recurrence engine).
3. Time Off is the committed next step (see plan above) — start there
   unless the user says otherwise. This doc is a snapshot, not a
   commitment; confirm before touching `routes/requests.js`.

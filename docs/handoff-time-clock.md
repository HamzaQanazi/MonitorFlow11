# Handoff — Time Clock + Schedule (shipped), Time Off (engine + service live, mobile next) — 2026-08-01

## Where things stand

**Time Clock** and **Schedule** are fully built, shipped, committed, and
pushed to `main`: backend (self-service + manager API for both), web console
(Time Clock's Today + Timesheets tabs, Schedule's Roster + Templates tabs),
and mobile (employee clock in/out screen, employee read-only "My Schedule").

**Time Off**: the engine change is committed, and the service itself is
seeded and live-verified end-to-end (submit → approve, via the same calls
the web console makes). **Mobile screens are the only thing left** — see
"Next up: Time Off" below. Nothing has been committed for the service data
itself yet (it was created live through the admin API, not via seed.js —
see "How Time Off was actually seeded" below) — decide whether that matters
before the next session.

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

**Steps 1–2 are done.** Step 1 (engine change) is committed. Step 2 (the
Time Off service itself) is live in the dev DB and verified end-to-end —
but **not committed anywhere**, because it was created live through the
admin API rather than seed.js (see "How Time Off was actually seeded"
below). **Step 3 (mobile) is the only thing left, not started.**

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

**Correction to the previous version of this doc**: it claimed dev-DB login
was broken ("Invalid credentials"). That was a testing mistake, not a real
bug — `POST /auth/login` takes `identifier` (or legacy `email`), not
`loginIdentifier`; the curl command used the wrong field name. Logins work
fine; verified this session by actually logging in as
`owner@company.com`/`ma.manager@adad.ada`/`su.ordinate@adad.ada`, all
`Password123!`.

Full end-to-end live verification done this session: employee submits →
appears in their own `GET /requests` and `GET /requests/{id}` → `GET
/requests/{id}/transitions` correctly offers `cancel` to the requester →
manager (oversight) sees it in their `GET /requests` → manager approves.
See "How Time Off was actually seeded" below for the one wrinkle this
surfaced (a capability mismatch with the web console's button wiring).

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
- Web Requests Management renders any service generically — confirmed live,
  no new web code, **but only once approve/reject are `override`-gated**
  (see "How Time Off was actually seeded" below for why).
- The workflow shape Time Off needs (submit → oversight approve/reject →
  terminal, no task) is already proven: `docs/demo/home_nursing.json` is
  still in the repo (this doc previously said it was removed — it wasn't)
  and shows the JSON shape, though it's the old nested `service`/`workflow`/
  `forms` config-API body shape, not what `POST /services` actually expects
  today (flat `name`/`departmentId`/`requestFields`/`statuses`/... —
  see the real payload used, below).

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

### How Time Off was actually seeded

Not via `seed.js` — the plan's original assumption ("author it in seed.js,
same as every other service") ran into a hard fact: **post-pivot, seed.js
seeds zero services** (the old municipal seed was removed in v7) and only
TRUNCATE-reseeds an empty company + Owner. The current dev DB has real
state built live through the app across the last two feature sessions (an
onboarded company, 4 employee accounts, real Time Clock/Schedule history) —
running `SEED_FORCE=true npm run seed` to add Time Off "properly" would
have destroyed all of it. Discussed with the user: created Time Off live
through the existing admin-only **Add Service Wizard** (`POST /services`,
same seed-time validators `formSchema.js`/`workflowSchema.js` run) instead.
Consequence: **Time Off's service/form/workflow definition is dev-DB-only
data, not in any commit.** If this DB is ever reseeded from scratch, Time
Off needs to be recreated (either re-run the same `POST /services` call, or
decide to actually port it into `seed.js` at that point).

- Department: **reused the existing "General"** department, not a new
  "Human Resources" one — there is no live `POST /departments` endpoint
  (department authoring is seed-time only), and creating one via direct SQL
  would have been exactly the "ad-hoc test data" CLAUDE.md forbids.
- Two service rows exist in the dev DB because of a live discovery (below):
  - `service_type_id 1`, key `time_off` — **disabled**, has one test
    request (id 1, now approved). Left in place rather than deleted:
    deleting would violate the immutable-audit-trail invariant (I9), and
    "disable + create a new one" is the documented pattern for fixing a
    live definition (CLAUDE.md §3 — definitions are immutable once any
    request exists).
  - `service_type_id 2`, key `time_off_2` — **the real one**, enabled,
    `owner_id` = employee 4 (Manny Manager, the only oversight-capable
    employee seeded so far). Has one live-verified test request (id 2,
    submitted by `su.ordinate`, approved by `ma.manager`).
- **Request form** (no completion form — no task/assignee, pure approval
  decision; note a `form_definition` row is required per form_type either
  way — §6's "exactly two rows per service" — so the completion form got a
  single unused placeholder field, `notes`/text, never referenced by any
  transition's `required_form_key`):
  - `start_date` — type `date`, required
  - `end_date` — type `date`, required
  - `type` — type `dropdown`, required, options: vacation / sick / unpaid
  - `reason` — type `multiline`, optional
- **Workflow** ("approval gate + reject terminal" shape):
  - `pending` (initial) → `approved` (terminal): `required_capability: override`
  - `pending` → `rejected` (terminal): `required_capability: override`, `requires_note: true`
  - `pending` → `cancelled` (terminal): `actor: requester`

**The `manage_employees` vs `override` finding (this changed the plan):**
the original plan picked `manage_employees` for approve/reject "to keep
people-ops capability coherent." Live-testing found this doesn't work with
the existing web console: `RequestDetailPane.tsx`'s oversight action
buttons (`monitorMoves`) always call `PATCH /:id/status` — the dedicated
override endpoint — for *any* capability-gated transition, regardless of
which capability that transition actually declares. That endpoint
hardcodes `requireCapability('override')` and `resolveOverride()` checks
`user.capabilities.has('override')` specifically. A `manage_employees`-gated
transition fires fine through the generic `POST /:id/transitions` (verified
live), but 403s when clicked in the actual web UI. Fix, decided with the
user: **use `required_capability: 'override'`** (zero web changes needed —
matches the existing button wiring) and grant the Manager level `override`
too. Applied both in `seed.js` (for future installs) and as a direct
`level_capability` insert on the live dev DB (no live endpoint exists for
granting a level a capability — Gate-1 authoring is seed-time only per
CLAUDE.md §12). **Tradeoff to be aware of**: `override` is a strong,
generic capability (forces *any* status on *any* in-scope request, not just
Time Off approvals) — a Manager can now also override Time Clock/Schedule-
adjacent requests or any other future service's status outside its normal
flow. If that's too broad, the real fix is teaching `RequestDetailPane.tsx`
to route each `monitorMove` through `POST /:id/transitions` with its own
declared capability instead of always calling `/status` — flagged as
future work, not done here.

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

Nothing new, confirmed live — Requests Management already renders Time Off
correctly for whoever holds `owner_id` (or is above them).

### Optional follow-up (separate, smaller, after the base flow ships)

Wire an approved Time Off day into Time Clock: suppress the `absent` flag in
`lib/timeClock.js` for a date covered by an approved request. Real
value-add, not required for a working first cut — don't bundle it into the
same PR/commit as the base Time Off flow.

### Suggested build order (matches how Time Clock/Schedule were built)

1. ~~Engine change~~ — **done, committed** (see "Step 1 — done" above).
2. ~~Seed the Time Off service~~ — **done, live-verified, but not
   committed** (it's dev-DB-only data — see "How Time Off was actually
   seeded" above). Decide before the next session whether to port it into
   `seed.js` for real, or leave it as a one-off demo artifact.
3. ~~Web~~ — **confirmed, nothing to build.**
4. Mobile: Request Time Off screen, then My Time Off list/detail screen.
   This is the only remaining work.
5. Commit the mobile screens as their own commit, never batched — same
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
3. Time Off's engine change and service are done and live-verified; only
   the mobile screens are left (see "Suggested build order" above). Note
   the service data lives only in the dev DB, not in a migration or
   seed.js — check it's still there (`GET /services` as any staff account)
   before assuming it exists on whatever DB you're pointed at.

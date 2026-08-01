# Handoff — Time Clock + Schedule (2026-08-01)

## Where things stand

Both **Time Clock** and **Schedule** are fully built and shipped: backend
(self-service + manager API for both), web console (Time Clock's Today +
Timesheets tabs, Schedule's Roster + Templates tabs), and mobile (employee
clock in/out screen, employee read-only "My Schedule").

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

## What was built

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

## Known limitations / things to watch

1. **UTC day-bucketing, not company-local.** The DB session runs in
   `Asia/Gaza` (UTC+3). Time Clock's Today/Timesheets SQL queries force
   `AT TIME ZONE 'UTC'` explicitly so they agree with the JS-side math —
   but this means a shift near midnight buckets by UTC calendar day, not
   local calendar day. No `company.timezone` column exists to do better.
   Schedule dates are plain `DATE` values (no timezone ambiguity), so this
   only affects Time Clock's shift timestamps.
2. **Neither mobile screen was click-tested live in a real browser/emulator.**
   No Android emulator, and the Chrome DevTools MCP tools were unavailable
   this session (disconnected mid-session, in fact — Time Clock had them for
   part of its build, Schedule's mobile screen didn't). Verified instead via:
   `flutter analyze` (clean) and `flutter build web` (succeeds) for both
   screens, plus every endpoint each screen calls independently
   live-verified against the real backend (including through the actual
   Vite dev-server proxy for the web console). **If you have a device,
   emulator, or working browser automation, click through both screens
   once before calling this fully done** — especially Schedule's Roster
   grid interactions and RTL layout on both new pages.
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

## Recommended next step: Time Off

Discussed with the user, not started. Nearly free to build since it's just a
new `service_type` on the existing dynamic form/workflow engine — a good
demonstration of the engine's genericity (the thesis statement): a request
form (dates, type, reason), a workflow (submit → manager approve/reject →
terminal), no new tables beyond what `service_type`/`form_definition`/
`workflow_definition` already provide.

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
3. Ask whether to build Time Off next, or something else — this doc is a
   snapshot, not a commitment.

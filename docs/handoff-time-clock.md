# Handoff — Time Clock feature (2026-08-01)

## Where things stand

Time Clock is **fully built and shipped**: backend (self-service +
manager API), web console (Today + Timesheets tabs), and the mobile
employee clock in/out screen. Pushed to `main` as 4 commits:

```
985cab6 fix(employees): populate company_id on hire
5dcc80b feat(timeclock): backend API — self-service + manager endpoints
ca051a8 feat(web): Time Clock console — Today + Timesheets tabs
31f868c feat(mobile): employee Time Clock — clock in/out, breaks, manual hours
```

Dropped from scope (deliberate, discussed with the user):
- **NFC clock-in** — hardware-dependent, no testable path in this environment.
- **Mobile shift extras** (in-shift notes/photos/tips) — task-completion
  photos already cover "proof of work done"; the backend endpoint
  (`POST /timeclock/shifts/:id/entries`) still exists and is tested,
  just has no mobile UI. Safe to leave or wire up later.

## What was built

**Backend** (`backend/src/routes/timeclock.js`, `lib/timeClock.js`, `lib/csv.js`, migration `017_time_clock.sql`):
- Self-service: `GET /timeclock/shifts/active`, `POST clock-in`,
  `POST clock-out`, `POST breaks/start`, `POST breaks/end`,
  `POST shifts/manual`, `POST shifts/:id/entries`.
- Manager (Gate 1 `view_all`/`manage_employees`, Gate 2 subtree-scoped):
  `GET today`, `GET timesheets`, `PATCH shifts/:id`,
  `POST shifts/:id/approve`, `GET timesheets/export.csv`.
- 59/59 backend tests passing (`npm test` in `backend/`).
- `openapi.yaml` updated to match (I7).

**Web** (`web/src/pages/TimeClockPage.tsx` + `.css`): Today tab
(attendance table + 5 clickable counters) and Timesheets tab (weekly
grid, day-detail dialog with edit/approve, CSV export). Nav item gated
on `view_all`.

**Mobile** (`mobile/lib/employee/time_clock_screen.dart`,
`manual_hours_screen.dart`, `models/time_shift.dart`): clock in/out,
start/end break, manual hours entry. Reached via an app-bar icon on
Employee Home.

## Known limitations / things to watch

1. **UTC day-bucketing, not company-local.** The DB session runs in
   `Asia/Gaza` (UTC+3). Both the Today and Timesheets SQL queries force
   `AT TIME ZONE 'UTC'` explicitly so they agree with the JS-side math —
   but this means a shift near midnight buckets by UTC calendar day, not
   local calendar day. No `company.timezone` column exists to do better.
   Documented as a known simplification, not fixed.
2. **Mobile UI was not click-tested live.** No Android emulator is
   available in this environment, and Flutter web renders to a canvas
   that doesn't accept synthetic browser-automation clicks without
   trusted OS-level input. Verified instead via: `flutter analyze`
   (clean), `flutter build web` (succeeds, app boots with no console
   errors), and the fact that every endpoint the screens call was
   already live-verified against the real backend. **If you have a
   device or emulator, click through Clock In → Start Break → End
   Break → Clock Out once before calling this fully done.**
3. `employee_default_shift` (the late/absent baseline) has **no
   authoring UI or API** — it can only be set via direct DB write. Late
   clock-in, late clock-out, overtime, and absent all silently stay
   "not flagged" for every employee until this exists. This is the main
   reason the **Schedule** feature (below) matters.

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

## Recommended next step: Schedule

Discussed with the user, not started. The `schedule` onboarding feature
key exists but has no module. Concept (not yet planned/implemented):

- Manager defines named shift templates (e.g. "Morning 9–5") and builds
  a forward-looking weekly roster (who's expected to work which shift,
  which day) — visually similar to the Timesheets grid but planning
  instead of reviewing.
- Employees get a "My Schedule" view on mobile.
- This would replace `employee_default_shift`'s single fixed
  start/end/weekday stub with real per-day plans, making Time Clock's
  late/absent/overtime flags actually meaningful (currently they never
  fire for anyone because nothing sets the baseline).

Second candidate raised: **Time Off** — nearly free to build since it's
just a new `service_type` on the existing dynamic form/workflow engine,
and it's a good demonstration of the engine's genericity (the thesis
statement). Chat/Directory/Events/Knowledge Base/Hiring/Training/
Recognitions were recommended **against** — separate product domains,
some (chat) conflict with the "no WebSockets/push" hard constraint,
low payoff for a 2-student grad project.

## If you're picking this up cold

1. Read `CLAUDE.md` in the repo root first — it's the single source of
   truth for invariants (two-gate permission model, bilingual/RTL,
   no status keys in code, etc.) and overrides any instinct to
   "improve" something that looks unusual.
2. `backend/migrations/017_time_clock.sql` + `backend/src/routes/timeclock.js`
   are the most-commented files if you need to understand a design
   decision (UTC bucketing, the "first break only" simplification on
   the Today tab, why `employee_default_shift` exists at all).
3. Ask whether to build Schedule or Time Off next, or something else —
   this doc is a snapshot, not a commitment.

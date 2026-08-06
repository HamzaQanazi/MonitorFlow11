# Mobile (Flutter) — manual E2E checklist

The §14 release gate for the User and Employee apps, on a real device or
emulator — the thing `docs/WEB_E2E_CHECKLIST.md` did for the web console, not
yet done for mobile. Automated coverage today is limited to
`mobile/test/dynamic_form_test.dart` + `login_screen_test.dart` (22/22,
`flutter analyze` clean) — widget tests for the dynamic form renderer and
login screen only, per CLAUDE.md §14. Everywhere the web checklist says
"standing in for the mobile screen with a direct API call," that's the gap
this doc closes: driving the actual Flutter UI, not the endpoint behind it.

**Not started.** This is the plan — every row below is unchecked. Run it
later, on the deployed build, as the student who didn't build the mobile
layer (mirrors the web checklist's own rule).

## Setup

- [ ] Backend running and reachable from the device/emulator:
      Android emulator → `10.0.2.2:3000` automatic (`mobile/lib/api/api_client.dart`);
      a physical device needs `--dart-define=API_BASE_URL=http://<host-ip>:3000/api/v1`;
      Windows desktop build needs Developer Mode enabled.
- [ ] `npm run migrate && npm run seed` against a DB the mobile pass can freely
      mutate (submitting real requests, clocking in/out, RSVPing — don't reuse
      a DB someone else's manual pass depends on).
- [ ] Complete the onboarding wizard as the seeded Owner (web) first — the
      mobile apps have no onboarding UI of their own; a company that hasn't
      onboarded won't have the feature set mobile screens depend on.
- [ ] At least one Manager-level employee, one Staff-level (no capabilities)
      employee, and one self-registered `user` account — reuse the same
      accounts table as `WEB_E2E_CHECKLIST.md` where the role matches.
- [ ] Run every section twice: once in `en`, once in `ar` (device locale or
      the app's in-app language switch, whichever exists — confirm which
      during setup and note it here).
- [ ] `flutter run` on both a phone-sized emulator/device — these are the two
      real targets; don't substitute a resized desktop window for a phone
      layout check.

## Cross-cutting (check on every screen, both directions — mirrors the web checklist)

- [ ] **RTL**: Arabic mirrors layout correctly — `EdgeInsetsDirectional`/
      `AlignmentDirectional` used throughout per CLAUDE.md I6, no
      left-anchored icon or clipped text in a mirrored row.
- [ ] **Bilingual**: no bare English string survives in Arabic mode (I5).
      Machine keys (status keys, field ids) are supposed to stay ASCII.
- [ ] **Loading**: every list/detail screen shows a real loading state on a
      throttled connection, never a flash of empty content.
- [ ] **Empty**: an empty list (no requests, no tasks, no events, …) renders a
      real empty state, not a bare blank screen.
- [ ] **Error**: kill the backend mid-session — an inline error with retry,
      never a crash or a stuck spinner.
- [ ] **401**: an expired/invalid token bounces to Login, no stuck
      authenticated screen.
- [ ] **403/404**: a `user` account can't reach anything employee-only and
      vice versa; requesting another user's request/task by id fails cleanly
      (I3's 404-over-403 rule).
- [ ] **Offline/poll behavior**: CLAUDE.md §3 — no WebSockets, no push;
      confirm notification/list screens actually poll (≈30s) rather than
      requiring a manual pull-to-refresh to ever see new data.

## User app

Screens: `user_home.dart`, `catalogue_screen.dart`,
`create_request_screen.dart` (+ `forms/dynamic_form.dart`),
`my_requests_screen.dart`, `request_detail_screen.dart`.

- [ ] **Register + login**: register a new `user`, confirm the generic
      `login_identifier` = email flow (CLAUDE.md §4), then log in with it.
- [ ] **Home**: lands correctly post-login; no admin/employee nav leaks in.
- [ ] **Service catalogue**: lists only `acceptsExternalUsers: true` services;
      an internal-only service is invisible here (mirrors the web checklist's
      §8 "Internal Only Test" finding — confirm the same holds on mobile).
- [ ] **Create Request (dynamic form)**: for at least one service exercising
      each field `type` (text, multiline, number, date, dropdown, radio,
      checkbox, photo, location) — required-field blocking client-side,
      server 422 surfaced per-field on a bad value, photo two-step upload
      (`POST /files` then attach the id), location field opens the map
      picker and pins correctly (`flutter_map`, OSM tiles).
- [ ] **My Requests list**: real data, correct empty state with zero
      requests, pagination if the seeded data has enough rows.
- [ ] **Request detail + timeline**: status history renders, comments
      section works (post one, see it appear), attachments open/download,
      map pin shows for a location-bearing request.
- [ ] **Cancel**: a request on a service with a real requester-cancel
      transition cancels with a confirmation dialog; one without (see the
      web checklist's §3 finding — not every service has one) — confirm the
      mobile UI's own cancel-button logic doesn't hit the same
      dead-end-button bug just fixed in `RequestDetailPane.tsx`.
- [ ] **Confirm / dispute**: drive a request through assign → complete
      (coordinate with an Employee-app session or direct API calls for the
      other side) to reach the requester's confirm/dispute step; verify both
      outcomes.

## Employee app

Screens: `employee_home.dart`, `task_detail_screen.dart`,
`complete_task_screen.dart`, plus the seven workforce modules.

- [ ] **Home + My Tasks**: real subtree-scoped task list; empty state with
      zero tasks.
- [ ] **Task detail**: requester `name`+`phone` shown, `email` and any
      `visible_to_employee: false` field hidden (CLAUDE.md §5's field-filter
      rule) — confirm by comparing the same request's web detail pane (which
      shows more) against this screen (which should show less).
- [ ] **Workflow transitions**: fire at least one actor-gated transition from
      this screen; confirm `expected_status` optimistic-concurrency 409 on a
      stale attempt (open the same task in two sessions, transition one,
      then try the other).
- [ ] **Complete Task (dynamic completion form)**: same per-field-type pass
      as Create Request above, against a service with a `completion` form.
- [ ] **Terminal-task lock**: once a task's request is terminal, task actions
      are gone/disabled, not just failing silently on tap.
- [ ] **Time Clock**: clock in → break start → break end → manual note/photo/
      tip entry → clock out, full cycle; confirm the "one active shift"
      constraint refuses a second clock-in while already clocked in.
- [ ] **Schedule**: "My schedule" shows only this employee's
      `schedule_entry` rows for the week; no roster/authoring controls
      (that's the web-only oversight view).
- [ ] **Checklists**: submit against a `forms_checklists`-tagged service via
      this screen's own entry point (not the generic catalogue, if it
      differs) and confirm it lands in the aggregated stats the web
      Checklists page shows.
- [ ] **Directory**: company-wide list (not subtree-scoped — mirrors the web
      checklist's §13 finding), search/filter narrows correctly.
- [ ] **Knowledge Base**: read-only list renders for a no-`manage_knowledge_base`
      employee; nothing implies write ability that isn't there.
- [ ] **Events**: list, RSVP toggle on/off, attendee count updates.
- [ ] **Training**: list, mark-complete flow, completion persists across a
      reopen of the screen.
- [ ] **Feature gate**: an employee whose company hasn't selected a given
      module (`company.features`) sees that module's nav entry absent
      entirely, not present-but-erroring (mirrors `requireFeature()` on the
      backend — confirm the mobile nav filters the same list the `/auth/me`
      payload's `companyFeatures` carries).

## Shared (both apps)

- [ ] **Notifications**: badge/count updates on a real new notification
      within one poll interval; opening it shows correct bilingual content;
      mark-as-read clears it.
- [ ] **Profile**: view own info; whatever's editable here actually persists
      (reopen the screen, confirm the change stuck).

## Manual acceptance (CLAUDE.md §14, cross-app, run last)

The full chain, this time through the real mobile screens end to end instead
of standing in with API calls (as the web checklist's §8/§16 notes had to):
register → login → submit (User app) → review + assign (web) → accept/reject
(Employee app) → status updates → complete (Employee app) → confirm/dispute
(User app) → cancel/reopen → reports + CSV (web). Use a service with a real
`required_capability: 'assign'` transition (the web checklist's §8 fixture
service lacked one and got stuck — don't repeat that mistake here; check
service's `workflow_definition` before starting the chain).

## Notes for whoever runs this

- No Flutter UI automation tool was available as of 2026-08-06 — this is a
  fully manual pass, same constraint the web checklist's authors hit for the
  mobile-standing-in gaps it left behind. If a driver (integration_test,
  Appium, etc.) gets set up before this is run, prefer it for the repeatable
  parts (login, form fill) and keep manual eyes on visual/RTL checks.
- Log findings in this file the same way `WEB_E2E_CHECKLIST.md` does: `[x]`
  per verified row, `[~]` for a real-but-not-fixed finding with a short
  writeup, don't silently fix things found mid-pass — flag them the way the
  web checklist did, so fixes stay their own reviewable commits.

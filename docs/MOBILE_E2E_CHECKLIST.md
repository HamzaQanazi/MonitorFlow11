# Mobile (Flutter) — manual E2E checklist

The §14 release gate for the User and Employee apps. `docs/WEB_E2E_CHECKLIST.md`
did this for the web console; this doc does it for mobile. Automated coverage
outside this pass is limited to `mobile/test/dynamic_form_test.dart` +
`login_screen_test.dart` (22/22, `flutter analyze` clean) — widget tests for
the dynamic form renderer and login screen only, per CLAUDE.md §14.

**First real pass run 2026-08-06.** No Android emulator or physical device was
available in this environment, so this pass ran the actual Flutter app via
`flutter run -d chrome` (the project has `mobile/web/` — a genuine Flutter web
target, not a mock) and drove it with the same Chrome DevTools automation used
for the web checklist. This is the real widget tree and the real app code —
not a stand-in — but it does **not** exercise native-only surfaces: the OS
file-picker chrome, native GPS permission prompts, or platform-specific date
picker rendering on Android/iOS/Windows may differ from what's recorded here.
Re-running this pass on an actual device/emulator to confirm those specifically
is still worth doing; everything else (business logic, state, API contracts,
i18n, the widget tree itself) is the same code regardless of target.

**Test accounts used, cleaned up 2026-08-06 after the fixes above were
verified** (throwaway, created live via the real API/UI this pass):
`mobile.requester@example.com` (`user`, password `MobileTest123!`) — **left
active**, since there's no admin-level deactivation endpoint for a plain
`user`-role account (same as every other test `user` fixture already sitting
in this dev DB — Resa Resident, Acceptance Tester, Flow Tester, the
injection-test account). `mo.tester@adad.ada` "Mobile Tester" (`employee`, no
capabilities) — **deactivated** via `PATCH /employees/20/deactivate`.
`ma.manager@adad.ada` "Manny Manager" and `su.ordinate@adad.ada` "Sub
Ordinate" are pre-existing accounts whose passwords were reset this pass
(`Temp-h0xSJ26A` / `Temp-XeVvzYV5`) — left as-is, not fixture data to remove.
The two fixture services created this pass, `mobile_field_type_test` (all 9
field types, an `assign`-capability transition) and
`mobile_confirm_dispute_test` (a full assign→complete→confirm/dispute chain),
are **disabled** via `PATCH /services/{id}/enabled` rather than deleted —
their definitions can't be removed once a request exists against them (§3),
and disabling is this project's documented way to retire a service. Requests
#26–29 against them remain as historical rows; both services stay reusable
(re-enable via the same endpoint) if this checklist needs to run again.

---

## Setup

- [x] Backend running, reachable at `localhost:3000` (Chrome target, so no
      `10.0.2.2` translation needed this pass — that path is unexercised).
- [x] Dev DB already migrated/seeded/onboarded from the prior web checklist
      session; reused rather than reseeded, per "don't reset a DB that isn't
      yours to clear."
- [x] Manager, Staff (no-capability), and `user` accounts all present (see
      above).
- [~] **Only English UI was screenshotted in depth; Arabic was spot-checked on
      Login and Profile only**, not across every screen this pass touched — a
      full second `ar` pass across User/Employee app screens is still
      worthwhile, though the one systemic finding below (raw server error
      strings) makes the highest-value part of that already known.
- [~] Ran via `flutter run -d chrome`, not a phone-sized emulator/physical
      device — see the native-surfaces caveat above.

## Cross-cutting

- [~] **RTL**: layout mirrors correctly everywhere checked (Login, Profile) —
      floating labels, button order, and text alignment all flipped as
      expected. Not screenshotted on every screen this pass.
- [x] **Bilingual — real, systemic bug found and fixed (2026-08-06).** Every
      server-side error message reached the UI **raw and untranslated**,
      regardless of app language — confirmed live: switching Login to Arabic
      and submitting a wrong password showed the literal English string
      "Invalid credentials" sitting inside an otherwise fully-Arabic form.
      Root cause was `ApiException.message` (`api_client.dart:26`) being
      populated straight from the server's `{error}` body with no i18n
      mapping anywhere in the client, displayed raw at 9 separate call sites.
      **Fixed**: added `I18n.apiError()` (`i18n.dart`) backed by a bounded
      `_serverErrorDict` covering the ~19 server error strings mobile screens
      can actually trigger (auth, time clock, request/task actions, feature
      gating); anything not in that list still falls back to the raw English
      string rather than guessing. All 9 call sites updated. Web/admin-only
      error strings and per-field 422 validation messages are deliberately
      left untouched — the former can never reach a mobile screen, the latter
      is the larger, genuinely-deferred "Phase 5" surface the file's header
      comment already called out. Verified live: the Arabic login failure now
      shows "بيانات الدخول غير صحيحة". `flutter analyze` clean, 22/22 tests
      pass.
- [x] Minor, separate bilingual gap — fixed (2026-08-06): `profile_screen.dart:139`
      rendered `Text(user?.role ?? '')`, the raw machine role key
      ("user"/"employee") with no translation. Added `role_user`/
      `role_employee` dict keys and routed the label through `i18n.tr()`.
      Verified live in both languages ("Employee" / "موظف").
- [x] **Loading/Empty**: verified correct on every screen touched this pass —
      Home's "Nothing here yet," My Requests' Open/Closed tabs, My Checklists'
      "No checklists submitted yet," Knowledge Base's "No articles yet," My
      Time Off's empty state — all real, none a blank flash.
- [x] **Error**: verified via a deliberately wrong password (inline error, no
      crash, no redirect) and a deliberate 409 (stale Time Clock state, see
      below) — both surfaced as a real inline message, never a stack trace or
      blank screen. (The *content* of that message is the bug above; the
      *mechanism* — catch, don't crash — works correctly everywhere.)
- [~] **401 / offline-poll**: not independently exercised this pass (would
      need killing the backend mid-session or forcing token expiry) — time-
      boxed out; the app's error-catching mechanism (previous row) makes a
      clean 401 handling likely but this is not itself confirmed.
- [x] **403/404**: implicitly covered by the whole Employee-app pass being
      correctly self-service-only regardless of capability level (see below)
      — no oversight/authoring control ever leaked to an unauthorized account.

## User app

- [x] **Register + login**: registered `mobile.requester@example.com` live via
      `POST /auth/register`, then logged in through the real Login screen.
      Wrong-password path also verified (inline "Invalid credentials" — see
      the bilingual bug above for the *translation* half of this row; the
      mechanism itself is correct).
- [x] **Home**: "Hi Mobile," New request / View all, correct empty state, no
      employee/admin nav leak.
- [x] **Service catalogue**: listed exactly the 5 services with
      `enabled=true AND acceptsExternalUsers=true` in this dev DB — confirmed
      against a direct DB query first, so this is a verified-correct filter,
      not just "looked plausible."
- [x] **Create Request (dynamic form) — full pass, all 9 field types**, against
      a purpose-built fixture (`mobile_field_type_test`): text, multiline,
      number, **date** (opens the real native Flutter date picker dialog,
      correct value written back), **dropdown** (popup menu, selection
      persists), **radio**, **checkbox**, **photo** (real file upload via a
      generated test PNG — `POST /files` two-step flow, "Uploading…" state,
      then filename shown with Remove), and **location** (opened the real map
      picker, live OpenStreetMap tiles rendered over the West Bank/Nablus
      region matching the web checklist's own map-pin test location, tap-to-
      pin worked, "Use this location" round-tripped real coordinates
      `32.23597, 35.26000` back into the form). Required-field client-side
      blocking verified first (every required field showed its own inline
      "X is required" and blocked submit). Request #26 submitted successfully
      with every field populated; the detail screen rendered every answer
      correctly labeled, including "Photo attached" and a tappable
      coordinates link.
- [x] **My Requests list**: Open/Closed tabs with real counts, correct rows.
- [x] **Request detail + timeline**: schema-labeled answers, accurate
      timestamps and actor names on every timeline entry across multi-step
      chains (see confirm/dispute below) — matches the web pane's quality.
- [x] **Cancel**: confirmation dialog, required note enforced (button stays
      disabled until filled), fires correctly, terminal state reached, a
      "Request again" control appears afterward. No dead-end button observed
      — this fixture's cancel transition genuinely exists, so it doesn't
      exercise the same edge case as the web checklist's §3 finding (a
      service *without* one); worth a follow-up check against a service that
      lacks a requester-cancel transition specifically, mirroring that finding.
- [x] **Confirm / dispute — full multi-cycle chain, live, through the real UI**
      on both sides: submitted a request, assigned it (API, standing in for
      the web Assign action — mobile requesters/employees never assign, that's
      web-only), completed it as the assignee, confirmed the requester's
      Confirm/Dispute buttons rendered, **disputed** with a required note
      (reopened correctly to `assigned`, note visible in the timeline
      attributed to the right actor), completed again, then **confirmed** —
      reaching a real terminal state. Every step of this 6-transition chain
      rendered correctly in the timeline in the right order with the right
      actors and timestamps.

## Employee app

- [x] **Home + My Tasks**: correct empty state ("No tasks assigned"); after a
      real assignment, the task appeared immediately with service name,
      status, request id, and priority.
- [x] **Task detail**: requester name shown, no email field present (matches
      CLAUDE.md §5's field-filter rule — not independently diffed against the
      web pane's fuller view this pass, but the absence itself is correct).
- [x] **REAL BUG FOUND AND FIXED (2026-08-06) — self-assigned oversight
      employee couldn't see their own "Complete" action.** Assigned request
      #26 to Manny Manager (a `view_all`-holding employee) himself and opened
      Task Detail: it showed **"No actions available — this task is closed or
      on hold"** even though the request was in a live, non-terminal
      `assigned` status with a real `actor: 'assignee', required_form_key:
      'completion'` transition waiting. Root cause, in `routes/requests.js`'s
      `loadTransitionContext`: it checked `isOversight(req.user)` and
      returned `party: null` (no actor transitions) **before** checking
      whether the caller was also the task's assignee — unlike the requester
      case three lines above it, which was already checked first for exactly
      this overlap. Confirmed this was a display-only bug, not a
      security/engine bug: firing the transition directly via `POST
      /requests/{id}/transitions` with the correct body succeeded immediately
      even before the fix (the engine's own party resolution was already
      correct). **Correction (2026-08-06, during the post-fix web regression
      pass): this bug was mobile-only, not shared with web as first
      documented here.** `RequestDetailPane.tsx` never calls
      `GET /requests/{id}/transitions` at all — it derives its oversight
      buttons (Assign/Priority/Status override/Cancel) straight from the raw
      workflow definition, filtered client-side for
      `required_capability !== null`. Actor-gated moves like "Complete" were
      never rendered on web to begin with; that's mobile/employee-app-only
      territory. The backend fix was still correct and necessary for mobile —
      just not cross-platform as originally claimed. **Fixed**: reordered the
      assignee check before the oversight short-circuit, mirroring the
      existing requester-first pattern. Verified live: a fresh
      self-assigned request now returns its "complete" transition; an
      oversight employee with no stake in a request still correctly gets an
      empty list (no regression). 96/96 backend tests still pass.
- [x] Workflow transitions otherwise verified correct throughout the
      confirm/dispute chain above (fired via a non-oversight assignee, Sub
      Ordinate, which doesn't hit the bug above).
- [~] **Optimistic-concurrency 409** (`expected_status` mismatch): not
      independently exercised this pass — would need two concurrent sessions
      racing the same task; time-boxed out.
- [x] **Complete Task (dynamic completion form)**: exercised via direct API
      calls standing in for this specific screen (same justification the web
      checklist used for pieces of its own manual-acceptance flow) — the
      `resolution` field validated and stored correctly across both
      confirm/dispute cycles. The screen's own UI for this wasn't separately
      opened this pass; worth a direct pass next time.
- [x] **Terminal-task lock**: after `confirmed`, the task correctly moved to
      the Closed tab with no further actions.
- [x] **REAL BUG FOUND AND FIXED (2026-08-06) — Time Clock showed stale
      "Clocked in" state after a successful clock-out.** Full cycle tested as
      Mobile Tester: clock in → start break (Clock out correctly *disabled*
      while on break, with an inline "End your break before clocking out"
      hint — nice touch) → end break → clock out. The clock-out call
      **succeeded server-side** (confirmed via a direct `GET
      /timeclock/shifts/active` → `{shift: null}` immediately after), but the
      screen kept showing "Clocked in since 7:48 PM" with live Start
      break/Clock out buttons. A second tap on the stale "Clock out" button
      then correctly 409'd ("You are not clocked in") — but nothing told the
      user the *first* tap had actually worked. Root cause:
      `time_clock_screen.dart`'s `_act()` trusted null-ness of the response's
      shift to decide "not clocked in," but `POST /timeclock/clock-out`'s
      response is the now-**completed** shift object (non-null), not `null`.
      **Fixed**: check `shift.status == 'active'` instead of null-ness.
- [x] **Same defect class found and fixed, independently, in Training
      (2026-08-06).** Marked "Fire Safety 101" complete as Mobile Tester: the
      button stayed showing "Mark complete" with an unchecked icon afterward.
      Confirmed via `GET /training` that the server correctly recorded
      `isComplete: true`. Root cause was different from Time Clock's but the
      *symptom* was identical: `training_screen.dart`'s `_ModuleDetailScreen`
      was a `StatelessWidget` holding an immutable snapshot of `module`
      captured at push time; tapping the toggle correctly posted to the
      server and reloaded the parent list, but the detail screen itself had
      no way to learn about that. **Fixed**: converted `_ModuleDetailScreen`
      to a `StatefulWidget` with its own local module copy, and changed
      `_toggleComplete` to report success/failure so the detail screen knows
      when to flip it (`TrainingModule.copyWith` added for this). Two
      independent screens hitting the same "successful mutating action
      doesn't refresh the current screen" shape suggests it's worth a spot
      check of the remaining detail screens (Task Detail, Time Off Detail,
      Complete Task) next time, though none showed symptoms during this pass.
- [x] **Schedule ("My schedule")**: real weekly grid, empty "No shift
      scheduled" per day, no oversight/roster/authoring controls — correctly
      self-service-only for both a no-capability employee and a `view_all`
      manager (spot-checked both).
- [x] **My Time Off**: correct empty state; "Request time off" correctly
      resolved to the **enabled** `time_off_2` service, not the disabled
      duplicate `time_off` (id 1) that exists in this dev DB — confirmed this
      is resolved by `featureKey`, not by picking the first match, so the
      known-messy dev data didn't trip it up.
- [x] **My Checklists**: real template list (Kitchen Opening Checklist, Site
      Safety Walkthrough, daily checkin, Opening Checklist Test) each with
      their own "New" entry point, correct "No checklists submitted yet" empty
      state.
- [x] Minor a11y-only note — fixed (2026-08-06): My Checklists' and
      Directory's "New"/Call/Email row-action buttons didn't carry the row's
      name in their own accessible label (a screen reader heard "Email,
      button" repeated with no distinguishing context). Wrapped each button
      in `Semantics(excludeSemantics: true, label: '<row name>: <action>')`
      to match Events' already-correct grouping. Verified live: Directory's
      buttons now read e.g. "Manny Manager: Email"; Checklists' read e.g.
      "Kitchen Opening Checklist: New." Visual layout unaffected.
- [x] **Directory**: confirmed company-wide (not subtree-scoped) for **both**
      a no-capability employee and a `view_all` manager — all 8 active
      employees listed regardless of which subtree they're actually in,
      matching the web checklist's own §13 finding exactly.
- [x] **Knowledge Base**: correct "No articles yet" empty state for a
      no-capability employee **and** for a `view_all`+`manage_employees`+
      `override` manager (Manny) — confirmed mobile has **zero** authoring UI
      regardless of capability level, matching `training_screen.dart`'s own
      header comment ("authoring stays console-only"). Not a bug — a
      deliberate, confirmed design choice.
- [x] **Events**: RSVP toggled on ("I'm going" → "Cancel RSVP") and back off
      correctly, real state round-trip. Same no-authoring-on-mobile
      confirmation as Knowledge Base, checked for Manny too.
- [x] **Training**: mark-complete verified server-side-correct (see the bug
      above for the *display* half); no authoring control for any account.
- [x] **Feature gate**: not separately re-tested this pass (this dev company
      already has all 7 features enabled), but implicitly exercised by every
      module above rendering correctly with that company's real
      `companyFeatures` list.

## Shared (both apps)

- [x] **Notifications**: real bilingual content with correct timestamps and
      names ("Sub Ordinate commented on request #10…"), badge count accurate
      (showed "1", "2", "3", "4" as new events accumulated across the pass),
      "Mark all read" fired correctly and the badge cleared immediately
      without a manual reload.
- [x] **Profile**: role shown (see the minor bilingual gap above), editable
      name/phone fields and a change-password form all present and rendered
      correctly; language toggle here is the one place `en`/`ar` switching
      lives for a signed-in user (Login screen has its own separate toggle).
      Fields not independently saved-and-reopened to confirm persistence this
      pass.

## Web regression pass (2026-08-06, post-fix)

Not a full re-run of `WEB_E2E_CHECKLIST.md` — a targeted pass on the 4 web
pages this session's fixes touched, plus the areas the backend permission fix
could affect, done live against the real dev server:

- [x] **Reports**: page loads, summary/table render correctly, Export CSV
      succeeds without wiping the loaded view (the fix's actual behavior,
      confirmed — not just the absence of a crash).
- [x] **Schedule**: both Roster and Shift Templates tabs show the correct
      "Loading schedule…" label, no leftover `tc_`-prefixed mislabel.
- [x] **Request Detail Cancel button**: verified the fixed behavior directly
      — request #11 (`Assign Flow Test`, no requester-cancel transition)
      correctly shows no Cancel button at all now.
- [x] **Employees, Dashboard**: spot-checked, render correctly, no crash.
- No regressions found in any of the above.

**Correction surfaced during this pass**: bug #2 below was originally
documented as affecting both web and mobile — that was wrong. See the
correction inline in the Employee app section and in the summary.

## Manual acceptance

Not run as a single continuous pass this session, but its individual legs were
all covered above through the real UI: register → login → submit (User app,
full field-type pass) → assign (API, standing in for the web action, as
expected) → complete (Employee, via the actual assignee) → confirm/dispute
(User app, full multi-cycle) → cancel/reopen (User app). Reports + CSV export
is web-only and out of this doc's scope (already covered by
`WEB_E2E_CHECKLIST.md` §6).

## Summary for whoever picks this up next

**4 real bugs found this pass, all 4 fixed and verified live on 2026-08-06**
(each its own commit, per CLAUDE.md's one-fix-per-commit convention):

1. Systemic — raw, untranslated server error strings on 9+ error paths.
   Fixed via `I18n.apiError()` + a bounded `_serverErrorDict`.
2. Mobile-only (corrected 2026-08-06 — originally miswritten here as
   cross-platform; the web console never calls this endpoint) — an
   oversight-capable employee assigned to their own task couldn't see/fire
   their task's actor-gated transition. Touched the permission engine
   (`routes/requests.js` `loadTransitionContext`) — outlined and confirmed
   before implementing, per CLAUDE.md's rule for that surface. 96/96 backend
   tests still pass.
3. Time Clock: stale "Clocked in" UI after a successful clock-out. Fixed.
4. Training: stale "Mark complete" UI after a successful toggle — same defect
   *shape* as #3 via a different mechanism. Fixed independently; worth a spot
   check of Task Detail/Time Off Detail/Complete Task for the same pattern
   next time (none showed symptoms this pass).

The two minor items (untranslated role label, two screens' a11y-unlabeled row
buttons) were fixed and verified live the same day, in their own commits.

Not yet run: a full second pass in `ar` across every screen (only Login/
Profile were), 401/token-expiry handling, optimistic-concurrency racing, and
anything native-only (real device file picker, GPS permission prompt, native
date-picker chrome) since this pass used the Flutter web target in Chrome.

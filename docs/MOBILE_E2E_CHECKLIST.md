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

**Test accounts used** (throwaway, created live via the real API/UI this pass,
same convention as the web checklist's fixtures — left in place afterward):
`mobile.requester@example.com` (`user`, password `MobileTest123!`),
`mo.tester@adad.ada` "Mobile Tester" (`employee`, no capabilities, password
`MobileTest123!`), `ma.manager@adad.ada` "Manny Manager" (existing Manager-level
employee, password reset this pass to `Temp-h0xSJ26A`), `su.ordinate@adad.ada`
"Sub Ordinate" (existing no-capability employee, password reset to
`Temp-XeVvzYV5`). Two fixture services were created for this pass:
`mobile_field_type_test` (all 9 field types, an `assign`-capability transition)
and `mobile_confirm_dispute_test` (a full assign→complete→confirm/dispute
chain) — both reusable for a future re-run.

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
- [ ] **Bilingual — REAL, SYSTEMIC BUG FOUND, not fixed this pass.** Every
      server-side error message reaches the UI **raw and untranslated**,
      regardless of app language. Confirmed live: switching Login to Arabic
      and submitting a wrong password showed the literal English string
      "Invalid credentials" (the backend's exact `res.status(401).json({error:
      'Invalid credentials'})` from `routes/auth.js:147/156`) sitting inside an
      otherwise fully-Arabic form. Root cause: `ApiException.message`
      (`api_client.dart:26`) is populated straight from the server's `{error}`
      body with no i18n mapping anywhere in the client, and **9 separate call
      sites** display it directly: `login_screen.dart:75`,
      `create_request_screen.dart:72`, `request_detail_screen.dart:242`,
      `time_off_detail_screen.dart:174`, `time_clock_screen.dart:71`,
      `task_detail_screen.dart:228`, `complete_task_screen.dart:104`,
      `manual_hours_screen.dart:84`, `profile_screen.dart:67,99`, and
      `dynamic_form.dart:401` (file-upload errors). The web app has an
      equivalent problem nowhere near this scale — `LoginPage.tsx` maps every
      401 to one generic bilingual string (per the web checklist's §1 row 4)
      — mobile has no such mapping layer at all. This is an I5 violation on
      **every error path in the app**, not a one-off. Flagging for a
      deliberate fix (likely: a small server-message → i18n-key mapping table,
      or at minimum a generic bilingual fallback string for anything not
      recognized), not patching call-by-call.
- [~] Minor, separate bilingual gap: `profile_screen.dart:139` renders
      `Text(user?.role ?? '')` — the raw machine role key ("user"/"employee")
      with no translation, so it shows the English word even in Arabic mode.
      Small enough to bundle with the fix above rather than its own pass.
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
- [ ] **REAL BUG FOUND, not fixed this pass — self-assigned oversight employee
      can never see their own "Complete" action.** Assigned request #26 to
      Manny Manager (a `view_all`-holding employee) himself and opened Task
      Detail: it showed **"No actions available — this task is closed or on
      hold"** even though the request was in a live, non-terminal `assigned`
      status with a real `actor: 'assignee', required_form_key: 'completion'`
      transition waiting. Root cause, confirmed by reading
      `routes/requests.js`'s `loadTransitionContext` (~line 378): it checks
      `isOversight(req.user)` and returns `party: null` (no actor transitions)
      **before** checking whether the caller is also the task's assignee —
      unlike the requester case three lines above it, which is explicitly
      checked first for exactly this overlap. Confirmed this is a display-only
      bug, not a security/engine bug: firing the transition directly via
      `POST /requests/{id}/transitions` with the correct body succeeded
      immediately (the engine's own party resolution is correct). **This bug
      is shared with the web console** — both clients call the same
      `GET /requests/{id}/transitions` endpoint — so a manager (or any
      `view_all`/`override`/etc. holder) assigned to their own task can never
      complete it through the normal UI on *either* platform, only via a raw
      API call or an oversight override that skips the completion-form
      collection entirely. This touches the permission/workflow engine
      (CLAUDE.md's highest-risk category) — flagging for a deliberate fix
      with sign-off, not patching inline.
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
- [ ] **REAL BUG FOUND, not fixed this pass — Time Clock shows stale
      "Clocked in" state after a successful clock-out.** Full cycle tested as
      Mobile Tester: clock in → start break (Clock out correctly *disabled*
      while on break, with an inline "End your break before clocking out"
      hint — nice touch) → end break → clock out. The clock-out call
      **succeeded server-side** (confirmed via a direct `GET
      /timeclock/shifts/active` → `{shift: null}` immediately after), but the
      screen kept showing "Clocked in since 7:48 PM" with live Start
      break/Clock out buttons. A second tap on the stale "Clock out" button
      then correctly 409'd ("You are not clocked in") — but nothing told the
      user the *first* tap had actually worked; leaving and reopening the
      screen showed the correct "Not clocked in" state immediately. Root
      cause: `time_clock_screen.dart`'s `_act()` (~line 68) does
      `setState(() => _shift = _parseShift(json))` uncritically for every
      action; `POST /timeclock/clock-out`'s response (`routes/timeClock.js`
      ~line 135) returns the now-**completed** shift object (non-null), not
      `null`, so the `if (shift == null)` check (~line 119) that decides
      "not clocked in" never fires. The fix is narrow (special-case the
      clock-out response, or check `shift.status == 'active'` instead of
      null-ness) but flagging rather than patching mid-pass.
- [ ] **Same defect class found again, independently, in Training —
      REAL BUG, not fixed this pass.** Marked "Fire Safety 101" complete as
      Mobile Tester: the button stayed showing "Mark complete" with an
      unchecked icon afterward. Confirmed via `GET /training` that the server
      correctly recorded `isComplete: true`. Leaving and reopening the module
      immediately showed the correct "Undo complete" state. Root cause is
      different from Time Clock's but the *symptom* is identical:
      `training_screen.dart`'s `_ModuleDetailScreen` is a `StatelessWidget`
      holding an immutable snapshot of `module` captured at
      `Navigator.push` time (~line 106); tapping the toggle correctly posts to
      the server and reloads the **parent** list screen's state, but the
      detail screen itself has no way to learn about that and keeps rendering
      its stale copy until popped. **Two independent screens showing the same
      "successful mutating action doesn't refresh the current screen" pattern
      is worth a systemic audit** across the other detail screens (Task
      Detail, Time Off Detail, Complete Task) rather than treating these as
      two unrelated one-off bugs — they may share a fix shape (e.g., pop with
      a result and let the caller decide, or convert detail screens to accept
      a `ValueListenable`/re-fetch on their own).
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
- [~] Minor a11y-only note: My Checklists' and Directory's "New"/"Email"
      row-action buttons don't carry the row's name in their own accessible
      label (a screen reader hears "New, button" four times with no
      distinguishing context) — Events' equivalent buttons *do* group this
      correctly (`group "All-Hands Aug 20…" → button "I'm going"`), so this
      isn't a systemic pattern, just two screens worth a small fix. Visually
      unaffected — sighted use is fine.
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

## Manual acceptance

Not run as a single continuous pass this session, but its individual legs were
all covered above through the real UI: register → login → submit (User app,
full field-type pass) → assign (API, standing in for the web action, as
expected) → complete (Employee, via the actual assignee) → confirm/dispute
(User app, full multi-cycle) → cancel/reopen (User app). Reports + CSV export
is web-only and out of this doc's scope (already covered by
`WEB_E2E_CHECKLIST.md` §6).

## Summary for whoever picks this up next

**4 real bugs found, none fixed this pass** (flagging per this doc's own
"don't silently fix mid-pass" rule, same as the web checklist):

1. Systemic — raw, untranslated server error strings on every error path
   across the app (9+ call sites). Highest priority: an I5 violation on
   basically every failure a user can hit.
2. Cross-platform (web **and** mobile) — an oversight-capable employee
   assigned to their own task can never see/fire their task's actor-gated
   transition (`routes/requests.js` `loadTransitionContext`). Touches the
   permission engine — needs sign-off before fixing.
3. Time Clock: stale "Clocked in" UI after a successful clock-out.
4. Training: stale "Mark complete" UI after a successful toggle — same defect
   *shape* as #3 via a different mechanism; worth checking Task Detail, Time
   Off Detail, and Complete Task for the same pattern before fixing #3/#4
   separately.

Two minor items (untranslated role label, two screens' a11y-unlabeled row
buttons) can likely ride along with whichever of the above they're closest to.

Not yet run: a full second pass in `ar` across every screen (only Login/
Profile were), 401/token-expiry handling, optimistic-concurrency racing, and
anything native-only (real device file picker, GPS permission prompt, native
date-picker chrome) since this pass used the Flutter web target in Chrome.

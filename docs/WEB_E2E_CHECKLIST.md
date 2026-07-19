# Monitor web — manual E2E checklist

The §14 release gate for the React dashboard. The backend and the Flutter
renderer are covered by automated tests (`backend/test`, `mobile/test`); the web
app is not, so this list is the gate.

**Run it against seeded data** (`npm run migrate && npm run seed`), in **both
`en` and `ar`**, on the deployed build. Run it as the student who did *not* build
the page. Every row is pass/fail — a page is not "done" until all of its rows pass.

Accounts (from `company-config.js` — check the seed output for the exact logins):

| Who | Kind | Reaches |
|---|---|---|
| admin | `admin` | config pages only (Services, Org, Levels, Audit, Webhooks) |
| City Manager | employee, root | every subtree; all capabilities |
| a department head | employee | own subtree only |
| a field officer | employee | no `view_all` — should not reach the dashboard at all |
| a self-registered user | `user` | nothing here (mobile only) |

---

## Cross-cutting (check on every page, both directions)

- [ ] **RTL**: switch to Arabic — no element flips to the wrong side, no clipped
      text, no left-anchored icon in an otherwise mirrored row (I6).
- [ ] **Bilingual**: no English string survives in Arabic mode (I5). Machine keys
      (status keys, field ids) are *supposed* to stay ASCII.
- [ ] **Loading**: throttle the network — a spinner/skeleton shows, never a
      flash of "no results".
- [ ] **Empty**: filter to something impossible — an empty *state* renders, not a
      bare table.
- [ ] **Error**: stop the backend — an inline error with a retry, never a blank
      page or a stack trace.
- [ ] **401**: delete the token in devtools, act — redirected to login.
- [ ] **403/404**: hit a page your capability doesn't grant (URL directly, not
      the nav) — inline refusal, and the nav link was not rendered either.
- [ ] Nothing is authorised by hiding a button: for each denied action below,
      confirm the API refuses it too (devtools network tab / curl).

---

## 1. Login

- [ ] Wrong password → inline error, no redirect.
- [ ] 6 rapid failures → 429 rate-limit message (not a generic failure).
- [ ] A `user`-role account is refused / told to use the mobile app.
- [ ] A deactivated employee cannot sign in.
- [ ] Successful login lands on Dashboard; a page refresh keeps the session.
- [ ] Wordmark shows `VITE_BRAND_*`, and the tab title matches.

## 2. Dashboard overview

- [ ] Totals group **open vs closed**, not by status key.
- [ ] Per-service, per-priority, per-department and per-state breakdowns each
      match what the Requests list shows under the same filter.
- [ ] The 30-day chart renders; a date with no data is a gap, not a crash.
- [ ] Average resolution shows the no-resolved-yet state on a fresh DB.
- [ ] A department head sees only their subtree's numbers — compare against the
      City Manager's totals for the same service.

## 3. Requests management + detail pane

- [ ] Filters (state, service, priority, employee, search, date range) each
      narrow the list; **Clear filters** restores it.
- [ ] Pagination: `pageSize` respected, next/previous correct at both ends.
- [ ] Detail pane: timeline shows every history row with actor and note; answers
      render with their schema labels; attachments download as attachments.
- [ ] **Assign** — the candidate list contains *only* subtree employees. Assign,
      then reassign; both write a timeline row.
- [ ] Assigning the same employee twice → 409 surfaced as an inline error.
- [ ] **Priority** change writes a timeline row.
- [ ] **Status override** requires a note; without one → 422 shown inline.
- [ ] **Cancel / reopen** each show a confirmation dialog first.
- [ ] Once the request is terminal, task actions are gone (not just disabled).
- [ ] Comments post and appear; the other party gets a notification.
- [ ] A head cannot open a request from another subtree by URL → 404.
- [ ] Map view: pinned requests appear; requests with no location are reported in
      the "some missing" banner, not silently dropped.

## 4. Employees management

- [ ] Create an employee — the server allocates the 4-digit login; the client
      never sends one. The number falls in the department's block.
- [ ] The new employee can sign in with that number.
- [ ] Deactivate an employee holding an open task → **409** with the
      open-tasks message; reassign, then deactivate succeeds.
- [ ] Reactivate works.
- [ ] Department filter and the per-employee task panel match the Requests list.
- [ ] An employee without `manage_employees` cannot reach this page.

## 5. Reports + export

- [ ] Filters (date range, service, employee) change the summary numbers.
- [ ] CSV downloads and opens; a cell starting with `= + - @` is prefixed with
      `'` (open it in Excel and confirm nothing evaluates).
- [ ] PDF export renders.
- [ ] A non-capable employee gets 403 on the export endpoint, not just a hidden
      button.

## 6. Audit (admin)

- [ ] Both families appear: config actions (`service.created`, `employee.created`)
      and operational ones (`request.status_changed`, `.assigned`, `.priority_changed`).
- [ ] Actor and action filters work; "no match" state renders.
- [ ] A non-admin employee gets 403.

## 7. Services / config (admin) — **the thesis demo**

- [ ] **Load example** fills the JSON box; **Create** onboards the service.
- [ ] Malformed JSON → the bad-JSON message, no request sent.
- [ ] An invalid form or workflow → 422 naming the offending field/status.
- [ ] A duplicate `service.key` → 409, and no second row is created.
- [ ] The new service appears in the list with its department, owner and
      external flag; its definition (statuses, transitions, gates, SLA, forms)
      renders read-only.
- [ ] Submit a request to the new sector from the mobile app and drive it to a
      terminal status — **with zero code changes**. This is the demo.
- [ ] Enable/disable toggles the catalogue for external users.
- [ ] A service with `accepts_external_users: false` is invisible to a
      self-registered user and refuses their submission with 403.

## 8. Org tree + Levels (admin)

- [ ] The tree renders reporting lines; capabilities per level are shown.
- [ ] Deactivating from the org page warns about open tasks and 409s the same way
      as the Employees page.
- [ ] Editing a level's grants changes what that level's employees can do —
      verify by signing in as one.

## 9. Webhooks (admin)

- [ ] Create a subscription; the secret is shown **once** and never returned by
      a later GET.
- [ ] Point it at a request-bin: firing a status change delivers
      `status_changed` with a valid `X-MonitorFlow-Signature` HMAC.
- [ ] Delete asks for confirmation and stops deliveries.

## 10. Notifications + profile (shell)

- [ ] The bell badge updates within ~30s of a change made elsewhere.
- [ ] Opening a notification navigates to its request.
- [ ] Sign out clears the session; the back button does not restore the dashboard.

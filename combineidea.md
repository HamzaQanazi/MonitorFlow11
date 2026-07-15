# CLAUDE.md — MonitorFlow

Read this before generating any code. These are **invariants**, not preferences.

Design skills, style guides, and `design.md` are **subordinate to this file**.
If any of them conflicts with a rule below, this file wins.

---

## What this project is

A configuration-driven service-request and field-operations platform. The
central claim — the thing the whole graduation project rests on:

> **A new service sector is onboarded by configuration, not code.**
> No part of the codebase is specific to any one service or any one role.

Municipal maintenance, home healthcare, food delivery, and an IT helpdesk all
run on the same unchanged engine. Only the data differs.

**Every rule below exists to protect that claim.** Violating one doesn't produce
a bug — it invalidates the thesis.

---

## THE INVARIANTS

### 1. Nothing is service-specific. Ever.

No file, class, table, route, component, or `if` statement may mention a
specific sector.

```
BANNED                                  CORRECT
------                                  -------
/api/maintenance/requests               /api/requests?service_key=...
class MaintenanceRequest {}             class Request {}
if (service === 'maintenance')          (drive it from config)
MaintenanceForm.tsx                     DynamicForm.tsx
```

If adding a new sector would require touching **any** `.ts`, `.tsx`, or `.dart`
file, the design is wrong. A new sector is a `POST /config/services`.

### 2. "Monitor" is not a role. There are only three account kinds.

```
admin     configures the platform. OUTSIDE the reporting tree.
employee  operational. INSIDE the tree. Created by an admin.
user      external submitter. OPTIONAL per service. SELF-REGISTERS.
```

A "monitor" is just an **employee at a level that holds oversight
capabilities**. Never write `role === 'monitor'`. Never write
`isManager(user)`. Never create a `MonitorGuard`.

Authority comes from two places, never from a hardcoded role name.

### 3. The two-gate permission model — check BOTH, server-side, always.

```
GATE 1 (actions)  Does the actor's LEVEL grant the required capability?
                  -> level_capability table

GATE 2 (scope)    Is the target inside the actor's SUBTREE?
                  -> recursive CTE on app_user.manager_id
```

Both gates. On every guarded action. On the server.

A client showing a button is **not** authorisation. The server re-checks,
every time, without exception.

Assignment is therefore **downward-only**: you may assign to anyone below you
in the tree, never sideways into another branch. A root employee
(`manager_id IS NULL`) reaches the whole organisation — not by a special rule,
but simply by sitting at the top.

### 4. Clients are THIN RENDERERS.

The frontends must never hardcode a field name, a status key, or a role.

```
To draw a form     GET the form definition -> render each field by its `type`
To draw buttons    GET /requests/{id}/transitions -> render exactly what returns
```

```
BANNED                                    CORRECT
------                                    -------
if (field.key === 'issue_type')           switch (field.type)
if (status === 'completed')               (render the returned transitions)
<CompleteButton />                        transitions.map(t => <Button/>)
const STATUSES = ['submitted', ...]       (they come from the server)
```

`/requests/{id}/transitions` returns only what is legal from the current status
**and** permitted to this caller — both gates already applied. Render that list
and nothing else. The client makes no decisions.

### 5. Every user-facing label is bilingual. No bare strings.

```ts
type LocalizedText = { en: string; ar: string };   // both keys REQUIRED
```

The database physically rejects a label missing either key. This is guaranteed,
not hoped for.

Applies to: service names, field labels, status labels, transition labels, level
names, notification messages.

### 6. RTL from the first line. Never left/right.

Arabic is a requirement, not a later addition. Retrofitting RTL across 27
screens is expensive; writing it correctly from the start is **free**.

```
BANNED                      CORRECT
------                      -------
margin-left: 8px            margin-inline-start: 8px
padding-right: 12px         padding-inline-end: 12px
text-align: left            text-align: start
left: 0                     inset-inline-start: 0
EdgeInsets.only(left: 8)    EdgeInsetsDirectional.only(start: 8)
Alignment.centerLeft        AlignmentDirectional.centerStart
Icons.arrow_back            Icons.arrow_back (auto-flips) — but verify
```

Tailwind: use `ms-*` / `me-*` / `ps-*` / `pe-*` / `text-start` / `text-end`.
Never `ml-*`, `mr-*`, `pl-*`, `pr-*`, `text-left`, `text-right`.

**Test both directions on every screen.** A layout that only works in English is
not finished.

### 7. The API contract is the source of truth.

`openapi.yaml` is **frozen**. Two developers build against it in parallel; a
unilateral change silently breaks the other person's half.

- Do not invent an endpoint that isn't in the spec.
- Do not change a response shape without changing the spec first.
- Changes require **both developers to agree**.

### 8. Validation is server-side. Client validation is UX only.

Forms are dynamic, so data off the wire can never be trusted. Every payload is
validated **on the server** against the form definition in the database.

Client-side validation exists to be kind to the user. It is not a security
boundary and never will be.

### 9. The audit trail is immutable and transactional.

`request_event` is **never updated and never deleted**.

A status change and its audit row **must be written in the same database
transaction**. If they can diverge, the timeline can contradict the current
status — and the audit trail is the thing that makes the whole system
trustworthy.

One table powers three features:
- the submitter's status timeline
- each employee's activity history (filter by `actor_id`)
- all outcome metrics (completed, average time, reopen rate)

### 10. Measure outcomes. Never behaviour.

This system does **not** track people.

```
YES     completed count, time-to-completion, reopen rate, open workload
NO      live GPS, location history, idle time, activity monitoring,
        "what are they doing right now"
```

This is an ethical position, a GDPR position, and a product position — a serious
buyer wants an operations tool, not a surveillance tool.

Do not add behavioural tracking, even if it seems useful. Even if asked casually.

---

## Stack

```
Backend    Node.js + TypeScript
Database   PostgreSQL + PostGIS
ORM        Prisma
Dashboard  React
Mobile     Flutter
Auth       JWT; bcrypt password hashes
```

`login_identifier` is deliberately generic — employees log in with an employee
number (`EMP-4471`), users with an email. One column, one lookup, one login
flow. Do not split this into two auth paths.

Location is a **real PostGIS geography column**, not a string inside the JSONB
answers. Simple map pins today; genuine spatial analysis later needs new
*queries*, not a migration.

---

## Key data shapes

**A service configuration** — POST this and a sector exists:

```jsonc
{
  "service":  { "key": "...", "name": {"en":"...","ar":"..."},
                "accepts_external_users": true },
  "workflow": {
    "initial_status": "submitted",
    "statuses":    [ { "key":"...", "label":{...}, "is_terminal":false,
                       "sla_minutes": 1440 } ],
    "transitions": [ { "label":{...}, "from":"...", "to":"...",
                       "required_capability":"assign",     // GATE 1
                       "required_form_key":"completion_form", // VALIDATOR
                       "post_actions":[ {"type":"notify",
                                         "target":"assigned_to"} ] } ]
  },
  "forms": { "request_form": [ /* field descriptors */ ] }
}
```

**Transitions are ONE-WAY.** A backward edge (Reassign) and a Reopen are simply
extra rows. The engine needs **no concept of a loop** — do not add one.

**Notification targets are relationships, not people** — `created_by`,
`assigned_to`, `assignee_manager` — resolved at fire time. This is what keeps
notifications generic across every sector.

---

## Deliberately NOT built (do not add these)

Someone will be tempted. Don't.

- **Automatic assignment.** Assignment is manual; the server returns a
  subtree-scoped candidate list annotated with workload and availability, and a
  human chooses. No ranking, no auto-select.
- **A graphical config builder.** Configuration is imported as JSON. The claim
  is that onboarding needs no *code* change — a visual editor is administrator
  convenience, not architectural evidence.
- **Websockets / push notifications.** Notifications are rows, fetched on
  refresh. Deliberate.
- **Live location tracking.** See invariant 10.
- **Vendor integrations.** MonitorFlow emits **webhooks**. The deploying company
  wires them to whatever they already run. No named vendor appears in this
  codebase.

---

## Before you commit

- [ ] Does any file name a specific sector? → **stop**
- [ ] Does any check read `role === '...'`? → **stop**
- [ ] Is a permission enforced only on the client? → **stop**
- [ ] Any `margin-left` / `text-align: left` / `EdgeInsets.only(left:)`? → **stop**
- [ ] A user-facing string that isn't `{en, ar}`? → **stop**
- [ ] A status change without its audit row in the same transaction? → **stop**
- [ ] An endpoint that isn't in `openapi.yaml`? → **stop**

---

## The one-sentence test

> If onboarding a new sector would require me to change code, I have broken the
> project.

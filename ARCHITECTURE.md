# Architecture — Operiva

This document records **why** Operiva is built the way it is: the decisions
taken, the alternatives rejected, and the reasoning in each case.

`CLAUDE.md` states the rules. This states the reasoning behind them.

---

## 1. The problem

Municipalities, university facilities, maintenance agencies, healthcare support
services, and delivery organisations all run separate software for each service
they offer — even though the underlying process is identical:

> a request is submitted → reviewed and assigned → completed by a worker →
> reported back to the requester

Building a separate system per service duplicates functionality, multiplies cost,
and makes maintenance and expansion harder.

**Operiva's claim:**

> A new service sector is onboarded by **configuration, not code**.
> No part of the codebase is specific to any one service or any one role.

Everything in this document exists to protect that claim. A decision that
weakens it is the wrong decision, regardless of its other merits.

---

## 2. How the claim is validated

The same unchanged engine has been shown to run four structurally different
sectors:

| Sector | Shape | Notable |
|---|---|---|
| Municipal maintenance | linear | external citizen submits |
| Home healthcare | branching | separate triage form mid-workflow |
| Food delivery | linear + user action | the *submitter* fires the final transition (rating) |
| IT helpdesk | **looping** | approval gate, backward reassignment, reopen from resolved |

The helpdesk is the significant one. Reassignment (`in_progress → approved`) runs
*backwards*, and reopening (`resolved → in_progress`) leaves a near-terminal
state. Both work with no special handling — see decision 3.2.

Onboarding any of them is a single `POST /config/services`.

---

## 3. Decision records

### 3.1 Configuration engine: Jira's model, not ServiceNow's

**Chosen:** workflows and forms are *data*, mapped to services (Jira's
"workflow scheme" pattern, flattened).

**Rejected:** ServiceNow's approach, where each sector is a database table
*extending* a base `Task` table.

**Why:** ServiceNow's model is elegant but pushes configuration into the
**schema** — a new sector means a new table. That directly contradicts the claim
that onboarding requires no code or migration. Jira's scheme-mapping model keeps
configuration as rows, which is exactly what the claim demands.

The *one* idea borrowed from ServiceNow is conceptual: a shared "task" with
common fields that every request has. But this is implemented as **common
columns on one `request` table**, not as physical table inheritance.

**Also rejected:** FixMyStreet as a model. It is a *reporting* tool — it routes a
citizen's report to the correct authority and stops there. The assignment,
completion, and oversight loop happens in the council's own systems. Its
generality comes from a single geographic abstraction; ours comes from
configuration. It is useful as related work precisely because it stops where
this project begins.

---

### 3.2 Transitions are one-way

**Chosen:** a transition is a single directed edge: `from_status → to_status`.
Moving back requires a second, separate transition row.

**Why:** this is Jira's convention, and it means the engine needs **no concept of
a loop**. A backward edge (Reassign) and a reopen are simply extra rows. The IT
helpdesk's `in_progress → approved → in_progress` cycle required zero engine
changes — it is just data.

Any design that special-cased "loops" would have been more complex *and* less
general.

---

### 3.3 Each transition carries its own rules

Borrowed directly from Jira's condition / validator / post-function triad:

| Field | Jira equivalent | Purpose |
|---|---|---|
| `required_capability` | condition | **Gate 1** — who may fire it |
| `required_form_key` | validator | what must be filled first |
| `post_actions` | post functions | notify, emit webhook |

**Why this matters:** the rule *"a completion form must be submitted before a
task can be closed"* is **configuration**, not code. A hospital and a delivery
company express entirely different rules using the same mechanism.

Notification targets are **relationships** (`created_by`, `assigned_to`,
`assignee_manager`), resolved at fire time — never named individuals. This is
what keeps notifications generic across sectors.

---

### 3.4 There are three account kinds. "Monitor" is not a role.

**Chosen:**

```
admin     configures the platform. OUTSIDE the reporting tree.
employee  operational. INSIDE the tree. Created by an admin.
user      external submitter. OPTIONAL per service. Self-registers.
```

**Rejected:** a hardcoded `Monitor` role distinct from `Employee`.

**Why:** a supervisor observed that a monitor *is* an employee — one with a boss,
who may themselves have a boss. The difference between a field technician and a
dispatcher is not one of *kind*; it is what they may do and who they oversee.

So authority is decomposed into two independent axes, and "Monitor" dissolves
into a **configuration** of an employee. This is the same principle as the config
engine, applied to the role model — behaviour comes from data, not from
hardcoded types.

**The `user` role is optional per service** (`accepts_external_users`). A
municipal service accepts citizen submissions; an internal IT helpdesk does not,
and work is created by employees instead. One flag; no code branches.

---

### 3.5 The two-gate permission model

```
GATE 1 — ACTIONS come from the employee's LEVEL     (level_capability)
GATE 2 — SCOPE   comes from the employee's SUBTREE  (app_user.manager_id)
```

**Levels** are named grades — Field Technician, Team Lead, Division Manager —
defined by the admin *per deployment*. A hospital defines different levels than a
delivery company. Levels are themselves configuration.

**Capabilities attach to the level, not the individual.** Change a level once and
every employee at that level updates.

> Rejected: per-person capability grants. Simpler to build, but real
> organisations think in job grades, not individual permission sets — and
> per-person grants would have made the admin's job unmanageable at scale.

**Scope** is the employee's whole subtree — self plus all descendants, at any
depth, via a recursive CTE on `manager_id`.

> Rejected: depth-based levels (where "level" = distance from the root). This
> breaks the moment one division has an extra management layer: two people doing
> the same job would get different permissions purely because of tree shape.

A **root employee** (`manager_id IS NULL`) reaches the entire organisation — not
by a special "superuser" rule, but simply by sitting at the top of the tree. No
special case exists in the code.

---

### 3.6 Assignment is downward-only

**Chosen:** you may assign to anyone in your subtree, provided your level grants
`assign`. You may **never** assign across branches.

**Why:** scope is the subtree. Allowing sideways assignment would let a manager
create obligations for an employee they neither oversee nor can see the workload
of — incoherent with the model, and organisationally wrong.

Because `GET /requests/{id}/candidates` is subtree-scoped, cross-branch
assignment is not merely *blocked*: it is **unrepresentable**. The client
physically cannot offer an illegal target.

**The escape hatch** (deferred): work that genuinely must cross branches
escalates *upward* to a common ancestor, who assigns it back down. Every
assignment remains downward.

---

### 3.7 Assignment is manual, with an informed candidate list

**Chosen:** the server returns employees in the caller's subtree, annotated with
current workload and availability. A human chooses.

**Rejected:** automatic assignment by skill / availability / workload.

**Why:** three reasons, in order of weight.

1. **Managers distrust black boxes.** A ranked list that a human confirms is more
   likely to be *used* than an automatic assignment they cannot veto.
2. **The policy question has no universal answer.** Should a job go to the most
   skilled person (who is busy) or the least loaded (who is less skilled)? It
   depends on the sector — which would itself have to become configuration.
3. **Production auto-assignment is a rabbit hole**: rejection handling,
   reassignment, race conditions on concurrent jobs.

The ranking machinery was prototyped and works. It is deliberately deferred.

---

### 3.8 Dynamic answers in JSONB; location in PostGIS

**Chosen:** a hybrid.

- Ordinary form answers → `request.request_data` (JSONB), validated
  server-side against the service's form definition.
- Location → `request.location`, a first-class `GEOGRAPHY(Point, 4326)` column
  with a GIST index.

**Why pull location out?** If location lived in JSONB as a string, adding real
spatial capability later would require a **migration** — rewriting every existing
row. As a PostGIS column, the same upgrade requires only new **queries**.

Today the project uses simple map pins. If genuine spatial analysis (proximity,
districts, spatial assignment) is later required, nothing needs to move. The cost
of this hedge was one line: `CREATE EXTENSION postgis`.

**Rejected:** an EAV table (one row per field answer). More "correct"
relationally, but far more joins for no practical gain at this scale, and the
form definition already provides the schema.

---

### 3.9 Bilingual by construction, not by convention

Every admin-configured, user-facing label — service names, field labels, status
labels, transition labels, level names, notification messages — is stored as
JSONB `{"en": "...", "ar": "..."}`.

**The database physically rejects a label missing either key:**

```sql
CONSTRAINT level_name_bilingual CHECK (name ? 'en' AND name ? 'ar')
```

**Why enforce it in the schema?** Because "remember to add the Arabic" is a
convention, and conventions decay — especially with two developers and
AI-assisted code generation. A constraint is a guarantee. It is now *impossible*
to ship an English-only label.

**RTL is written from the first line, not retrofitted.** Layout uses logical
properties (`margin-inline-start`, `EdgeInsetsDirectional`) throughout. Writing
RTL-safe layout from the start is nearly free; retrofitting it across 27 screens
is expensive. This is a *habit*, enforced by `CLAUDE.md`, not a feature.

---

### 3.10 The audit trail is immutable, transactional, and does triple duty

`request_event` is never updated and never deleted. A status change and its audit
row are written **in the same database transaction**.

**Why transactional?** If they could diverge, the timeline could contradict the
current status — and the audit trail is the thing that makes the entire system
trustworthy. An unreliable audit trail is worse than none, because it is
believed.

**One table powers three features:**

1. the submitter's status timeline
2. each employee's activity history (the same rows, filtered by `actor_id`)
3. all outcome metrics (completed count, time-to-completion, reopen rate)

This is the highest-leverage table in the system.

---

### 3.11 Outcomes, never behaviour

Operiva measures **what was accomplished**, not **what someone was doing**.

| Measured | Not measured |
|---|---|
| completed count | live GPS / location history |
| time-to-completion | idle time |
| reopen rate | activity monitoring |
| open workload | "what are they doing right now" |

**Three independent reasons, any one of which would suffice:**

- **Ethical.** Continuous worker surveillance is corrosive and drives good people
  away.
- **Legal.** Under GDPR — and French law in particular — employee monitoring
  requires legitimate purpose, proportionality, and consultation. Excessive
  monitoring has been ruled against.
- **Commercial.** A serious buyer of this category of software wants an
  *operations* tool, not a *surveillance* tool. The value is "I know the status
  of every job and can prove it was done" — not "I can watch my staff."

This is a deliberate position, stated so that it is not quietly eroded later.
`CLAUDE.md` forbids adding behavioural tracking even if asked casually.

---

### 3.12 Notifications are deliberately dumb

Notifications are **rows**, inserted by a transition's `post_actions` (or by the
background worker), and fetched on refresh.

**Rejected:** websockets, push infrastructure.

**Why:** real-time push to a Flutter app is a genuine rabbit hole — infrastructure,
delivery guarantees, battery, platform-specific tokens — for a feature whose
value here is fully served by polling. This is a scope decision made with open
eyes, not an oversight.

**SLA, escalation, and digests** share a single background worker:

- Each status may declare `sla_minutes`. Configuration, not code.
- On breach, escalate **up the reporting tree** — the same tree already built for
  permissions. The hierarchy pays for itself twice.
- Digests are notification rows too (`kind = 'digest'`), not a separate screen.

Building all three costs little more than building one, because the worker is
the expensive part.

---

### 3.13 Webhooks, not vendor integrations

A supervisor asked for "some sort of API" so a deploying company could connect
Operiva to systems it already runs.

**Chosen:** outbound webhooks. On a subscribed event (`request_created`,
`status_changed`, `assigned`, `sla_breached`), Operiva POSTs a signed JSON
payload to a URL the admin configured. The company wires it to whatever they
have — SMS gateway, email service, internal system.

**Why:** one generic mechanism, unlimited integrations, **zero vendor-specific
code**. Operiva integrates with no named third party. It emits events; the
company decides what to do with them.

Integrating with N specific vendors would have been more work *and* would have
put vendor names into a codebase whose entire premise is that nothing is
hardcoded.

---

### 3.14 Authentication: one generic identifier

`login_identifier` is a single unique column holding whichever identifier suits
the account:

- employees → an employee number (`EMP-4471`)
- users → an email (`citizen@example.com`)

**Why not require email for everyone?** Many field and maintenance staff genuinely
do not have work email addresses. Forcing one is real friction, and companies
deploying this already have employee IDs.

**Why not two separate login flows?** Because there is no need. One column, one
lookup, one endpoint. The auth code does not care what the string *means*.

**Users self-register; employees are created by an admin** — an employee number
cannot be self-assigned.

---

## 4. System shape

```
                    ┌──────────────┐        ┌──────────────┐
                    │  Flutter app │        │ React        │
                    │  user + field│        │ dashboard    │
                    └──────┬───────┘        └──────┬───────┘
                           │   THIN RENDERERS      │
                           │   (no hardcoded       │
                           │    fields/statuses)   │
                           └───────────┬───────────┘
                                       │  REST (openapi.yaml)
                           ┌───────────▼───────────┐
                           │   NestJS backend      │
                           │                       │
                           │  ┌─────────────────┐  │
                           │  │ Guards          │  │  GATE 1 + GATE 2
                           │  │ (declarative)   │  │  declared, never inlined
                           │  └────────┬────────┘  │
                           │  ┌────────▼────────┐  │
                           │  │ Config engine   │  │  ZERO sector-specific code
                           │  │ - validate form │  │
                           │  │ - fire transition│ │
                           │  │ - post-actions  │  │
                           │  └────────┬────────┘  │
                           └───────────┼───────────┘
                                       │
                    ┌──────────────────▼──────────────────┐
                    │      PostgreSQL + PostGIS           │
                    │                                     │
                    │  CONFIGURATION  ← the admin writes  │
                    │    service_type, workflow,          │
                    │    workflow_status, transition,     │
                    │    form_definition, employee_level, │
                    │    level_capability, capability     │
                    │                                     │
                    │  PEOPLE                             │
                    │    app_user (self-ref: manager_id)  │
                    │                                     │
                    │  RUNTIME  ← one shape per service   │
                    │    request (JSONB + PostGIS)        │
                    │    request_event (immutable)        │
                    └─────────────────────────────────────┘
                                       ▲
                           ┌───────────┴───────────┐
                           │  Background worker    │
                           │  SLA · escalation ·   │
                           │  digests · webhooks   │
                           └───────────────────────┘
```

**The clients are thin renderers.** To draw a form, they fetch a form definition
and render each field by its `type`. To draw action buttons, they fetch
`/requests/{id}/transitions` and render exactly what returns. Neither client
hardcodes a field name, a status, or a role.

---

## 5. The request lifecycle

```
  1. submit          POST /requests
                     → server validates `data` against the service's
                       request_form definition (client validation is UX only —
                       dynamic forms mean wire data is never trusted)
                     → lands in workflow.initial_status
                     → creation event written to the audit trail

  2. what can I do?  GET /requests/{id}/transitions
                     → both gates already applied
                     → client renders one button per returned item

  3. act             POST /requests/{id}/transitions
                     → 1. legal from current status?
                       2. GATE 1 — level grants required_capability?
                       3. GATE 2 — target inside actor's subtree?
                       4. required form validates?
                       5. status + audit row, ONE transaction
                       6. post-actions fire (notify, webhook)

                     409 if `expected_status` no longer matches — someone else
                     acted first; refresh rather than clobber.
```

There is **no** `/requests/{id}/complete` and no `/requests/{id}/approve`.
Assign, approve, start, complete, reopen, close, rate — every step, in every
sector, is the same generic call.

---

## 6. Deliberately not built

Recorded so that the omissions are understood as **decisions**, not oversights.

| Not built | Why |
|---|---|
| Automatic assignment | Managers want a veto; policy is sector-dependent; needs rejection handling and concurrency safety. Ranking prototyped and shelved. |
| Graphical config builder | The claim is that onboarding needs no *code* change. Loading a JSON configuration proves this completely. A visual editor is administrator convenience, not architectural evidence — and the two builder screens were the largest schedule risk in the project. |
| Live GPS / location tracking | See 3.11. Ethically, legally, and commercially wrong — and expensive. |
| Websockets / push | See 3.12. |
| Vendor integrations | See 3.13. Webhooks instead. |
| Teams / shared pull queues | Not needed to prove the claim. |
| Cross-branch escalation | Assignment stays downward-only; escalation upward to a common ancestor is the intended future mechanism. |
| Richer transition conditions | e.g. "only the *assigned* employee", "only if urgency = Critical". Additive to `workflow_transition` later; the schema absorbs it without restructuring. |

Every item in this table is **additive**. None would require the architecture to
change — which is itself evidence that the abstractions are sound.

---

## 7. Known limitations

Stated plainly, because they will be asked about.

- **Conditions are coarse.** A transition declares a single
  `required_capability`. Real workflows sometimes need richer guards ("only the
  *assigned* employee, not any employee"). The extension point exists
  (`workflow_transition` can take a `conditions JSONB` array); it is not built.
- **Post-actions support two types** (`notify`, `webhook`). `set_field` and
  `auto_escalate` are plausible additions and would be additive.
- **Configuration is imported, not authored.** An admin writes or is given a JSON
  configuration. Seed configurations ship with the project; a builder UI does
  not.
- **Time-based logic is awkward to test.** SLA and escalation require either
  configurable short intervals or a fakeable clock — a real cost, and easy to
  underestimate.
- **Skills exist but do not drive assignment.** They are stored and displayed;
  ranking is deferred (3.7).

---

## 8. Team and process

Two developers, both generalists, eight weeks.

**Split by vertical, not by layer.** One owns the management side (React
dashboard plus the endpoints it needs); the other owns the field side (Flutter
plus the endpoints it needs). A layered split (one backend, one frontend) would
create an artificial dependency and a single point of failure, and would waste
two matched skill sets.

**The shared core is built jointly, first**: database schema, API contract,
configuration engine, authentication. This is the single most important step for
avoiding integration failure. `openapi.yaml` is **frozen** — a unilateral change
silently breaks the other developer's half.

**AI-assisted development is used deliberately and guarded.** `CLAUDE.md` pins
the invariants, because a code generator will happily hardcode a role or a sector
if unconstrained — producing clean, working code that quietly destroys the
project's central claim. Pull-request review is mandatory, partly for quality and
partly so that **each developer understands the other's half well enough to
defend it**.

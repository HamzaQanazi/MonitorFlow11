# MonitorFlow — Demo Script

Two configuration paths, in the order you should present them. Path A explains
what a deployment *is*; Path B is the thesis proof and the part the committee
remembers.

Everything below was run against a freshly seeded database. The Path B payload
in `docs/demo/home_nursing.json` is verified — it returns 201, and re-posting it
returns 409.

**The claim you are demonstrating:**

> A new service sector is onboarded by configuration, not code.

---

## Before you start

```bash
cd backend
npm run migrate     # schema
npm run seed        # the municipality: 3 departments, 7 services, 3 workflows
npm start           # http://localhost:3000
```

Seeded logins (all use `Password123!`; `SEED_ADMIN_PASSWORD` overrides the admin
password on a real handover):

| Who | Signs in as | Role in the demo |
|---|---|---|
| Adam Admin | `admin@city.gov` | configures the platform — holds **no** capabilities |
| Maya Manager | `1000` | org root, sees every subtree |
| Rami Roads | `1100` | Public Works head — the owner Path B attaches the new sector to |
| Ziad Field | `1101` | field officer, no capabilities |
| Rania Resident | `resident@city.gov` | external submitter |

Employees sign in with a **4-digit number**, users with an **email**. One column,
one login flow — worth saying out loud, someone always asks.

---

## Path A — the seed (how a deployment is born)

`backend/src/company-config.js` is the entire municipality as **data**:
departments, employee levels and the capabilities each grants, seven services,
three structurally different workflows, and every form schema.

Open it on screen and scroll it. The point to make:

> "This file is the whole organisation. No engine code knows what a pothole is.
> Replace this file's contents and the same binary is a hospital."

`seed.js` reads it and writes the database — it is the only sanctioned way demo
data enters the system, so every developer and every demo starts identical.

Three workflows ship, deliberately different in *shape*, to prove one engine
covers all of them:

| Workflow | Shape | Services |
|---|---|---|
| Public Works | dispatch + hold loop | pothole, streetlight, water leak |
| Sanitation | lean scheduled pickup | bulky waste, missed collection |
| Licensing | approval gate + reject terminal | building permit, business license |

Same `workflowEngine.js`, three different JSON documents. If someone challenges
"you just hardcoded three flows", show them that the engine only ever reads
`is_terminal`, `required_capability`, and `actor` — never a status key.

---

## Path B — the config API (the proof)

This one happens **live, with the server already running, nothing restarted**.

### 1. Log in as the admin

```bash
TOKEN=$(curl -s -X POST localhost:3000/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"identifier":"admin@city.gov","password":"Password123!"}' | jq -r .token)
```

### 2. Onboard an entire healthcare sector in one call

```bash
curl -X POST localhost:3000/api/v1/config/services \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d @docs/demo/home_nursing.json
```

Expected:

```json
{ "service_key": "home_nursing", "serviceTypeId": 8 }
```

That one body carried a service, a department, a five-status workflow with four
transitions, a request form, and a completion form.

### 3. Show it live

Log in to the mobile app as `resident@city.gov`. **Home Nursing Visit** is in the
catalogue. Open it: the form renders patient name (text), care type (dropdown),
and address (map pin) — because the JSON said so. Submit it. It lands in
`Requested`.

Log in to the web dashboard as `1100` (Rami). The request is in his queue,
because the payload named him as `owner`, and the buttons he sees come from the
transitions in that same JSON.

### 4. The line that lands

```bash
git status
```

Clean.

> "We just added a healthcare sector to a municipal platform. Zero files changed,
> zero deployments, zero restarts. The engine never learned what nursing is."

---

## Rehearse these — they are what breaks live

- **`service.owner` is a login_identifier**, not a name or an id — `"1100"`, Rami's
  employee number. Omit it and the sector has no oversight subtree: the request
  is submitted successfully but **nobody on the web dashboard can see it**, and
  the demo dies quietly halfway through step 3.
- **Every label needs both `en` and `ar`.** The database physically rejects a
  missing key; the API answers 422 naming the field.
- **The service `key` is unique forever.** A second POST of the same body is a
  **409** — by design. Re-seed (`npm run seed`) before re-running the demo, or
  change the key. This is the single most likely live failure; practise the
  recovery.
- **Exactly one of `required_capability` or `actor` per transition.** Both, or
  neither, is a 422 from the seed-time validator the API reuses.
- **Definitions are immutable once a request exists** for that service. So do the
  configuration demo *before* the submission demo — once you submit in step 3,
  you cannot "just fix" the form. Re-seed between rehearsals.
- Admins hold **no capabilities**. Do not try to assign or override while logged
  in as `admin@city.gov`; that is an employee decision and will 403. This is
  intentional and worth explaining rather than hiding.

---

## If they push back

**"You could have hardcoded that service."**
Show `git status` (clean), then `git log` — no commit. Then POST a second,
different sector they invent on the spot. The payload is small enough to edit
live; change the key, the labels, and one field type.

**"The forms must be hardcoded in the app."**
Open the mobile renderer: it switches on the field `type` from the schema and
has exactly one fallback — an unknown type renders a disabled "unsupported
field" placeholder. There is no `PermitForm`, no `PotholeForm`.

**"What about the buttons?"**
`GET /requests/{id}/transitions` returns only what is legal from the current
status *and* permitted for that caller — both permission gates already applied
server-side. The client renders that list and nothing more.

**"Is the permission model real, or just hidden UI?"**
`backend/test/permissions.test.js` — a capable actor outside their subtree is
refused; a subtree member without the capability is refused. Run `npm test` in
`backend/` and show 98 passing.

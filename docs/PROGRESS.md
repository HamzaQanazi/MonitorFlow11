# MonitorFlow — Progress

Tracks completed work against the CLAUDE.md Section 10 plan. Update this when a week's deliverables land.

## Done

### Week 1 (commit `a931457`)
- Monorepo scaffold, ER v3 schema + migrations (`backend/migrations/001_init.sql`, `npm run migrate`)
- Auth: `POST /auth/register`, `POST /auth/login`, `GET /auth/me` — JWT HS256 24h, bcrypt, login rate limit, deactivated accounts rejected at JWT validation

### Week 2 — backend / Student 2 (commits `8930731`, `ce9acfe`, `4247d7a`)
- **Seed script** (`npm run seed`): wipes all data and reseeds — IT + Facilities departments, Equipment Repair + Home Cleaning Visit, 4 form definitions, both Section 9.4 workflows, dev accounts. Seed-time validation in `backend/src/lib/formSchema.js` + `workflowSchema.js` runs before any insert.
- **Config read endpoints** (`backend/src/routes/services.js`): `GET /services`, `GET /services/{id}/forms/request|completion`, `GET /services/{id}/workflow`. Auth required, no role gate (decided: the Section 6 catalogue row gates the *page*, not these reads — employees need completion forms, monitors need workflow metadata).
- **Form validation function** (`backend/src/lib/validateFormResponse.js`): Section 8 rules, errors keyed by field id, photo ownership checked via injected `db`. 13 unit tests (`npm test`, node:test).

## Seeded dev accounts

All password `Password123!` (re-run `npm run seed` to reset):

| Email | Role |
|---|---|
| monitor@monitorflow.dev | monitor |
| tech@monitorflow.dev | employee (IT) |
| cleaner@monitorflow.dev | employee (Facilities) |
| user@monitorflow.dev | user |

## Next

- **Week 2, Student 1:** Flutter dynamic form renderer (all 8 field types) against `GET /services/{id}/forms/request`. Week 2 must-pass: renderer draws both request forms with zero code differences.
- **Week 3, Student 2:** `POST /requests` (consume `validateFormResponse`, 422 per-field), `GET /requests` both modes (own-only 404 rule), React scaffold + Monitor login + requests list.
- **Week 3 gate:** vertical slice v1 — phone submits → appears in Monitor.

## Local setup reminders

- Postgres 18 local service, DB `monitorflow`, creds in `backend/.env`
- Run order for a fresh start: `npm run migrate` → `npm run seed` → `npm start`

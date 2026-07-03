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

### Design context (commit `f458907`)
- `PRODUCT.md` (design strategy: product register, calm/operational/trustworthy, anti-references) + `DESIGN.md` seed (North Star "The Dispatch Board", Workwear Amber on pure white, Source Sans 3, status-categories-own-color rule). Read both before building any UI. Re-run `/impeccable document` once more web components exist to replace the seed with scanned tokens.

### Week 3 — web / Student 2, started early (commits `f7cd488`, `abdc8f6`)
- **Monitor Login** (Section 4 page): `/login` split layout, all states designed (field errors, 401, 429, network, submitting), password visibility toggle, client-side monitor-role gate (non-monitor logins are rejected and the token discarded — server still enforces per-route). Verified end-to-end in headless Edge (Playwright, `channel: 'msedge'` — no Chrome on the dev machine).
- **Reusable web plumbing**: design tokens (`web/src/styles/tokens.css`, OKLCH), typed API client (`web/src/lib/api.ts`, token in localStorage `mf.token`), auth context with session restore (`web/src/auth/AuthContext.tsx`), `RequireAuth` route guard, Vite dev proxy `/api` → `:3000` (backend deliberately has no CORS). `/` is the empty Dashboard Overview shell awaiting Week 6 content.

### Dashboard Overview (Section 4 page) — pulled forward from Week 6
- **Backend** (`backend/src/routes/dashboard.js`): `GET /dashboard/stats` (counts by status *category* via workflow JSONB join — no status keys in code, per Section 9) + `GET /dashboard/chart` (requests/day, last 30 days, zero-filled). Monitor-only via new `requireRole` in `middleware/auth.js` (403 verified for user role).
- **Seed demo data**: 22 demo requests across both services with full status-history walks (changed_by resolved from each transition's `allowed_role`), task rows where the walk passes assignment, completion forms where completed. Demo data is validated like API input (`validateDemo()` in `seed.js`).
- **Web** (`web/src/pages/DashboardPage.tsx`): queue-health category strip + stacked proportion bar (hero), 30-day activity chart (plain HTML/CSS bars, hover tooltip, sr-only data table), by-service/by-priority breakdowns. 30s polling (silent refresh). Skeleton / error+retry / zero-data empty states. Status-category palette added to `tokens.css` (`--cat-*` — the fixed six-category assignment all three apps must reuse).
- **Shell nav**: top-bar nav (Dashboard · Requests · Employees · Reports) with nested routes; unbuilt pages render a `ComingSoon` stub naming their week.
- Verified headless-Edge at 1440/834/390px; lint + build green; no console errors.

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
- **Week 3, Student 2 (remaining):** `POST /requests` (consume `validateFormResponse`, 422 per-field), `GET /requests` both modes (own-only 404 rule), Monitor requests list page (React scaffold + login + dashboard already done).
- **Week 3 gate:** vertical slice v1 — phone submits → appears in Monitor.

## Local setup reminders

- Postgres 18 local service, DB `monitorflow`, creds in `backend/.env`
- Run order for a fresh start: `npm run migrate` → `npm run seed` → `npm start`
- Web: `cd web && pnpm dev` → http://localhost:5173 (backend must be on :3000 for the proxy). Browser checks use Playwright with installed Edge (`channel: 'msedge'`); there is no Chrome on the dev machine.

# Handoff — AI feature track (Training/Directory removal + bilingual auto-fill shipped, auto-assign + scheduling deferred) — 2026-08-21

## Where things stand

Supervisor meeting decided two things this session: cut two low-value
feature modules, and pursue three AI ideas. Of the three AI ideas, one
shipped; two are deliberately deferred to a future session (explicit
decision, not an oversight).

**Shipped and committed** (`59fc5d0`, `cd7f530` on `main`):
1. **Training & Directory feature modules removed** — backend routes,
   `manage_training` capability, onboarding wizard catalogue entries, web
   pages/nav, mobile screens, all gone. New migration
   `029_remove_training_directory.sql`.
2. **Bilingual auto-fill translation** via Gemini — `POST /translate`,
   `TranslateButton` (single field) wired into every bilingual field pair in
   the console, `TranslateAllButton` (sequential loop) added to Add
   Service's field/status editors specifically.

**Deferred, not started** (see "Deferred AI work" below):
3. **AI auto-assign ranking**
4. **AI scheduling suggestions**

## Shipped: Training & Directory removal

Low product/thesis value relative to effort — neither exercised the
dynamic form/workflow engine or the two-gate permission model beyond a
basic company-wide read, unlike the modules that stay (Time Clock, Schedule,
Checklists, Knowledge Base, Events). Full rationale in CLAUDE.md §13
("Removed 2026-08-21").

Nothing left to do here — full backend suite (108/108), `tsc --noEmit`, and
`flutter analyze` all clean after the removal.

## Shipped: bilingual auto-fill translation

**Why Gemini, not GPT/LibreTranslate**: discussed with the user — OpenAI's
API has no real free tier (pay-per-token only); LibreTranslate is free but
self-hosting it is real infra work with nowhere obvious to run it on the
project's free-tier deployment host, and translation quality for en/ar is
noticeably behind an LLM anyway. Gemini's free tier (Google AI Studio) needs
no card and has generous limits for a course-demo volume.

**Backend** (`backend/src/lib/translate.js`, `backend/src/routes/translate.js`):
- `POST /translate` — `{ text, target: 'en'|'ar' }` → `{ translation }`.
  `requireAuth`, role `user` (external submitters) refused, 422 validation,
  503 if `GEMINI_API_KEY` isn't set, 502 on vendor failure.
- Server-side proxy only — same shape as the onboarding wizard's Nominatim
  geocode proxy (`routes/onboarding.js`). The key never reaches the client.
- **Model gotcha, worth remembering**: the default is
  `gemini-3.5-flash-lite`, *not* the flagship `gemini-3.6-flash`. The
  flagship model does mandatory extended "thinking" even for a two-word
  label translation — measured 3-18s+ latency with occasional 503s from
  Google's side in testing. `flash-lite` answers the same task in well
  under a second with identical quality and no reasoning-token overhead.
  If a future model rename breaks this, override via `GEMINI_MODEL` env var
  rather than guessing — verify with a raw `curl` against
  `generativelanguage.googleapis.com/v1beta/models` first (list of
  available models) before picking a new default.

**Frontend**:
- `components/TranslateButton.tsx` — one shared component, explicit click
  only (never fires while typing — deliberate choice, discussed with the
  user), auto-detects direction from whichever side has content.
- `components/TranslateAllButton.tsx` + `lib/translate.ts`'s
  `translatePair()` — sequential "translate all" loop, added as a same-
  session follow-up once the user noticed clicking per-field was tedious on
  Add Service's field/status editors (the only two places a form can have
  many bilingual rows at once). Deliberately sequential, not one combined
  multi-row API call — a bad response can only ever corrupt the one row
  being translated right now, and it stays naturally rate-limit-friendly.
- Wired into every bilingual field pair in the console: Add Service
  (service name, request/completion field labels, dropdown/radio option
  labels, status labels, cancel label), Onboarding Wizard (company name,
  owner job title, branch names — **deliberately not** the address field,
  since translating a street address is a transliteration problem, not a
  translation one), Knowledge Base, Events, Levels, Departments.

**CLAUDE.md §13**: this is the second deliberate exception to the named-
vendor ban (the first was Nominatim geocoding) — documented with the same
"dated, flagged, not a precedent" treatment.

## Deferred AI work — auto-assign ranking + scheduling

Both explicitly deferred to a future session at the user's request, not
because of any blocker found while building. Mechanics were discussed and
agreed before deferring, so the next session can start straight into
implementation rather than re-litigating design:

**AI auto-assign ranking**: replace/augment the existing deterministic
least-loaded-employee algorithm (`service_type.auto_assign`,
`lib/autoAssign.js`) with ranking by outcome metrics already tracked
(completion count, time-to-completion, reopen rate — all I10-safe, no new
data collection). **Agreed: no external vendor call for this one** — a
local scoring function or a small model trained on existing DB data. This
does *not* need a §13 exception.

**AI scheduling**: AI *suggests* a roster for a manager to review/approve —
does **not** write `schedule_entry` directly (keeps a human in the loop,
unlike auto-assign's opt-in-and-fire-automatically pattern). **Open
question, not resolved**: there is no employee availability/preference
table in the schema today (`schedule_entry` only stores what a manager
already assigned, not what an employee is available for) — decide whether
that's in scope before starting, since it may need its own migration first.

## Test / dev setup

Owner login for the local dev DB: `owner@meridianfg.com` / `Password123!`
(company already onboarded — lands straight in the console).

`GEMINI_API_KEY` must be set in `backend/.env` (gitignored, not committed —
see `backend/.env.example`) for translation to work; without it, `/translate`
still responds cleanly with 503 rather than crashing. Get a free key at
https://aistudio.google.com/apikey, no card required.

## How to run everything

```
cd backend && npm run dev     # API on :3000, --watch reloads on file change
cd web && npm run dev         # console on :5173, proxies /api to :3000
```

## If you're picking this up cold

1. Read `CLAUDE.md` §13 first for the two named-vendor exceptions
   (Nominatim, Gemini) and the Training/Directory removal rationale —
   don't re-add either module or a third vendor integration without the
   same kind of deliberate, dated conversation.
2. `backend/src/lib/translate.js` and `web/src/lib/translate.ts` are the
   two files to read before touching the translation feature — both are
   small and comment-heavy on the "why," not just the "what."
3. For auto-assign/scheduling: start from "Deferred AI work" above, not
   from scratch — the vendor question and the human-in-the-loop question
   are both already answered.

<!-- SEED: re-run /impeccable document once there's code to capture the actual tokens and components. -->

---
name: MonitorFlow
description: Calm, operational design system for a multi-sector service-request and field-ops platform.
---

# Design System: MonitorFlow

## 1. Overview

**Creative North Star: "The Dispatch Board"**

A well-run dispatch office: quiet, orderly, nothing demanding attention that hasn't earned it. Every screen exists to answer one question — *where is this request and what happens next* — so the visual system's job is to make status, priority, and the next action legible before anything else is even noticed. Surfaces stay clean and neutral; color is reserved for meaning (brand actions and status categories), never for decoration. The same calm language runs across all three surfaces — Monitor web dashboard, User app, Employee app — because visual consistency is itself part of the product's "one platform, many sectors" thesis.

What this system explicitly rejects: the generic Bootstrap admin template (stock sidebar, four identical stat cards, badge soup, default-blue everything) and Jira-style enterprise overload (dense toolbars, nested menus, configuration chrome). It learns instead from Linear (calm precision, sparse meaningful status color), Things 3 (calm mobile task UI, generous whitespace, thumb-friendly targets), and Samsara (operational lists that read at a glance).

**Key Characteristics:**
- Clean neutral surfaces; brand color on ≤10% of any screen
- Status categories carry a single consistent color-and-shape language everywhere
- One humanist sans family across web and mobile
- Responsive motion — real feedback, no choreography
- Every list state (loading, empty, error) is designed, not defaulted

## 2. Colors

Restrained strategy anchored on a warm workwear amber — hi-vis field-gear warmth on clean neutral ground, the deliberate opposite of default-blue admin.

**The Restrained Rule.** Neutral surfaces carry the interface; the amber primary appears on at most 10% of any screen — primary actions, focus, and brand moments only. Its rarity is what keeps status color meaningful.

**The Status-Owns-Color Rule.** The six workflow categories (new / triage / in_progress / done / closed / terminated) get one fixed color assignment, designed once and reused identically across all three apps. No other UI element may borrow a status color. Never color alone — every status pairing includes its label text.

### Primary
- **Workwear Amber** (hue ~57°, exact OKLCH values `[to be resolved during implementation]`): primary buttons, active states, focus rings, brand accents. White text on filled amber.

### Neutral
- **Surface & ink family** (`[to be resolved during implementation]`): pure-white body background direction (no warm tint — warmth lives in the primary, not the surface), with a near-black ink at ≥7:1 contrast and a muted secondary text at ≥4.5:1.

### Status category palette
`[to be resolved during implementation]` — six distinguishable, AA-compliant assignments, chosen to not collide with the amber primary or with error-red semantics.

## 3. Typography

**Display / Body Font:** single humanist sans family, multiple weights `[font to be chosen at implementation — must ship on web (React) and mobile (Flutter)]`

**Character:** Warm but workmanlike — legible at small sizes in sunlight on a phone, comfortable over long desk sessions on the dashboard. Hierarchy comes from weight and size within the one family, never from a second typeface.

### Hierarchy
`[scale to be resolved during implementation]` — expect: page title, section/card title, body, and a small label tier for timestamps, IDs, and status pills. Body line length capped at 65–75ch on the dashboard.

## 4. Elevation

Flat by default. Depth is conveyed through tonal layering (background vs. surface) and 1px borders; shadows appear only as a response to state — raised dialogs, dragged elements, sticky headers over scrolled content. If a resting card casts a shadow, it's wrong.

## 6. Do's and Don'ts

### Do:
- **Do** keep the amber primary rare — ≤10% of any screen, actions and focus only (The Restrained Rule).
- **Do** use the single fixed status-category palette everywhere, always paired with label text (The Status-Owns-Color Rule).
- **Do** design loading, empty, and error states for every list, and confirmation dialogs for every destructive or terminal action — PRODUCT.md's "every state is a designed state."
- **Do** keep mobile touch targets large and primary actions thumb-reachable; the Employee app is used one-handed, outdoors.
- **Do** provide `prefers-reduced-motion` alternatives for all animation (WCAG 2.1 AA target).

### Don't:
- **Don't** ship the "generic Bootstrap admin template" look PRODUCT.md bans by name: stock collapsing sidebar, four identical stat cards in a row, badge soup on table rows, default-blue everything.
- **Don't** drift toward Jira: no dense toolbars, no nested menu chrome, no configuration surfaces leaking into working screens.
- **Don't** communicate status by color alone, and don't let non-status elements borrow status colors.
- **Don't** tint the body background warm; the surface stays pure — warmth is the primary's job.
- **Don't** invent per-service styling. The dynamic form renderer and workflow timeline are designed once and must make any seeded schema look intentional.

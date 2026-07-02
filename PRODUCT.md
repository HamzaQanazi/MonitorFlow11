# Product

## Register

product

## Users

Three roles share one platform, each with a different context:

- **Users (citizens/customers)** — submit and track service requests from the Flutter User app. Occasional, task-driven usage: pick a service, fill a dynamic form, watch a status timeline. Often on a phone, possibly mid-errand. They need to understand "where is my request and what happens next" in one glance.
- **Employees (field workers)** — work assigned tasks from the Flutter Employee app, frequently on-site and one-handed (IT technicians, cleaning crews). They accept/reject tasks, walk statuses forward, and file completion forms. Glanceability and large touch targets matter more than density.
- **Monitors (dispatchers/supervisors)** — triage, assign, and oversee everything from the React web dashboard, at a desk, for extended sessions. Their job is queue health: what's new, what's stuck, who's free.

Secondary audience: the graduation-project committee watching a live demo. The interface must read as a real product, not a student prototype.

## Product Purpose

MonitorFlow is a configurable, multi-sector service-request and field-operations platform: two mobile apps and one web dashboard on one backend. Its core thesis — the reason it exists — is that structurally different service types (different form fields, different workflow states) run through the *same* code via seeded JSON configuration: a dynamic form engine and a dynamic workflow engine. Success looks like the two seeded services ("Equipment Repair" and "Home Cleaning Visit") flowing end-to-end, submit → assign → complete → confirm, in a smooth 8-week-deadline demo, with the UI visibly rendering both configurations with zero per-service code.

## Brand Personality

Calm, operational, trustworthy. The interface stays out of the way so status, priority, and the next action read instantly. Quiet confidence over decoration: the product should feel like dependable infrastructure. Warmth in the citizen-facing User app comes from accent color, rounded controls, and friendly copy — not a separate personality per app. One visual language across all three surfaces, since consistency itself is part of the "one platform, many sectors" pitch.

## Anti-references

- **Generic Bootstrap admin template.** Stock collapsing sidebar, four identical stat cards in a row, badge soup on every table row, default-blue everything. The Monitor dashboard especially must not look like a purchased admin theme with the logo swapped.

## Design Principles

1. **Status is the interface.** Every screen's first job is answering "where is this request and what happens next." Status *categories* (new / triage / in_progress / done / closed / terminated) get one consistent color-and-shape language across all three apps; raw status keys only ever appear as their seeded labels.
2. **Design components, not screens.** Forms and workflows are rendered from seeded JSON, so the design system must make *any* valid schema look intentional — field spacing, label rhythm, and error presentation are designed once in the renderer, never per service.
3. **Every state is a designed state.** Loading, empty, error, and confirmation states are part of the page, not afterthoughts (CLAUDE.md's UI-state rule: no page is done without them). Destructive and terminal actions always confirm, with a note field where the workflow demands one.
4. **Field-first ergonomics on mobile.** The Employee app is used standing up, outdoors, one-handed: big tap targets, high-contrast status at list level, primary action reachable by thumb.
5. **Polish the frozen 14, add nothing.** Scope is fixed; craft budget goes into finishing the existing pages (states, spacing, motion restraint), never into new surfaces.

## Accessibility & Inclusion

Target **WCAG 2.1 AA**: body text ≥ 4.5:1 contrast, large text ≥ 3:1, keyboard navigability on the web dashboard, visible focus states, and `prefers-reduced-motion` alternatives for all animation. Status categories must never be communicated by color alone — pair color with label text or shape/icon. The dynamic form renderer carries a special obligation: because fields are schema-driven, accessible markup (labels bound to inputs, per-field error association) must be generated correctly for every field type, once, in the renderer.

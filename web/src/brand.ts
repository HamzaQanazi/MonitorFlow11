// Deployment branding — the company name and logo shown in the console chrome.
//
// Build-time on purpose. CLAUDE.md §13 commits to one organisation per
// deployment, so branding is deployment identity like the database URL: a new
// customer means a new build, not a runtime lookup. That also keeps the login
// page (which renders the wordmark before anyone has authenticated) from
// needing a public unauthenticated endpoint.
//
// To rebrand a deployment, either set the VITE_BRAND_* variables in the build
// environment (see .env.example) or edit the defaults below, then rebuild.
//
// NOT branding: the `X-MonitorFlow-Signature` webhook header. That is a wire
// protocol subscribers verify against — a product name, not a company name.
// Never rename it here or in backend/src/lib/webhooks.js.
import type { Loc } from './i18n'

const env = import.meta.env

// The defaults below are the generic product name shown pre-onboarding (login
// page, and the console shell before the Owner's company has a name) and are
// deployment data in exactly the same sense the seeded services are — the
// engine itself stays sector-agnostic (I1). Another customer overrides all
// three via .env; nothing here is referenced by name anywhere else in the
// codebase. Once an Owner completes onboarding, <Wordmark> in the console
// shell prefers their company's name (from /auth/me) over this default — see
// Wordmark.tsx. The login page never gets that override (no session yet), so
// it always shows this default.
export const brand: { name: Loc; logo: string | null } = {
  // Both languages required (I5). A deployment that sets only one falls back to
  // the default for the other rather than rendering an empty wordmark.
  name: {
    en: env.VITE_BRAND_NAME_EN || 'MonitorFlow',
    ar: env.VITE_BRAND_NAME_AR || 'مونيتر فلو',
  },
  // Path to a logo under web/public. Unset (the default) falls back to the
  // plain accent pip — the normal MonitorFlow look, no specific crest baked
  // in. A deployment that wants a static logo sets VITE_BRAND_LOGO; an Owner
  // who uploads one in the onboarding wizard gets that instead, at runtime,
  // once onboarding completes (Wordmark.tsx's companyLogo prop) — this value
  // only matters pre-onboarding and for deployments that never use the wizard.
  logo: env.VITE_BRAND_LOGO || null,
}

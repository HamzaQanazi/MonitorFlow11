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

export const brand: { name: Loc; logo: string | null } = {
  // Both languages required (I5). A deployment that sets only one falls back to
  // the default for the other rather than rendering an empty wordmark.
  name: {
    en: env.VITE_BRAND_NAME_EN || 'MonitorFlow',
    ar: env.VITE_BRAND_NAME_AR || 'مونيتر فلو',
  },
  // Path to a logo under web/public, e.g. '/logo.svg'. Unset → the wordmark
  // renders its accent pip instead, which is the shipped look.
  logo: env.VITE_BRAND_LOGO || null,
}

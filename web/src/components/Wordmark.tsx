// The company name in the console chrome. Shared by the dashboard shell and the
// login page because both must show whatever the deployment is branded as, and
// both need the same logo-or-pip fallback (see brand.ts).
//
// `variant` picks the caller's existing class prefix rather than introducing a
// third set of styles — the two sites size the mark differently.
//
// `companyName`/`companyLogo` are the runtime overrides: once an Owner finishes
// onboarding, the console shell passes their company's plain-text name (not
// bilingual — tenant data, not a system label, see CLAUDE.md §6) and uploaded
// logo (a data URI — see auth.js's getCompanyInfo) here instead of the
// build-time brand default. The login page never passes either (no session
// yet), so it always shows the build-time default.
import { brand } from '../brand'
import { useI18n } from '../i18n'

export function Wordmark({
  variant,
  companyName,
  companyLogo,
}: {
  variant: 'shell' | 'login'
  companyName?: string | null
  companyLogo?: string | null
}) {
  const { L } = useI18n()
  const logo = companyLogo || brand.logo
  return (
    <p className={`${variant}-wordmark`}>
      {logo ? (
        // alt="" — the company name sits right beside it, so announcing the
        // logo too would read the name twice.
        <img className={`${variant}-logo`} src={logo} alt="" />
      ) : (
        <span className={`${variant}-pip`} aria-hidden="true" />
      )}
      {companyName || L(brand.name)}
    </p>
  )
}

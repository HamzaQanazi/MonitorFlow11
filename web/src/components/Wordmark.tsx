// The company name in the console chrome. Shared by the dashboard shell and the
// login page because both must show whatever the deployment is branded as, and
// both need the same logo-or-pip fallback (see brand.ts).
//
// `variant` picks the caller's existing class prefix rather than introducing a
// third set of styles — the two sites size the mark differently.
import { brand } from '../brand'
import { useI18n } from '../i18n'

export function Wordmark({ variant }: { variant: 'shell' | 'login' }) {
  const { L } = useI18n()
  return (
    <p className={`${variant}-wordmark`}>
      {brand.logo ? (
        // alt="" — the company name sits right beside it, so announcing the
        // logo too would read the name twice.
        <img className={`${variant}-logo`} src={brand.logo} alt="" />
      ) : (
        <span className={`${variant}-pip`} aria-hidden="true" />
      )}
      {L(brand.name)}
    </p>
  )
}

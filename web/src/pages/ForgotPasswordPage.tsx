import { useRef, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { useI18n } from '../i18n'
import { Wordmark } from '../components/Wordmark'
import { apiFetch } from '../lib/api'
import './LoginPage.css'

// Step 1 of self-service reset (CLAUDE.md §13 re-scope, supervisor-directed).
// POST /auth/forgot-password always responds the same way whether or not the
// identifier matched an account — this page shows the same "check your
// email" message either way, by design (no account enumeration).
export default function ForgotPasswordPage() {
  const { t } = useI18n()
  const identifierRef = useRef<HTMLInputElement>(null)
  const [submitting, setSubmitting] = useState(false)
  const [sent, setSent] = useState(false)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const identifier = identifierRef.current?.value.trim() ?? ''
    if (!identifier) return
    setSubmitting(true)
    try {
      await apiFetch('/auth/forgot-password', { method: 'POST', body: { identifier }, auth: false })
    } catch {
      // Deliberately swallowed: the endpoint itself never reveals whether the
      // account exists, and a network hiccup shouldn't tell an attacker
      // anything different from a real failure either — same message either way.
    } finally {
      setSubmitting(false)
      setSent(true)
    }
  }

  return (
    <main className="login">
      <section className="login-pane">
        <Wordmark variant="login" />
        <div className="login-pane-foot">
          <p className="login-tagline">{t('login_tagline')}</p>
        </div>
      </section>

      <section className="login-form-pane">
        {sent ? (
          <div className="login-form">
            <div className="login-head">
              <h1>{t('fp_title')}</h1>
            </div>
            <p className="login-note">{t('fp_sent')}</p>
            <Link to="/login" className="login-forgot">
              {t('fp_back_to_login')}
            </Link>
          </div>
        ) : (
          <form className="login-form" onSubmit={handleSubmit} noValidate>
            <div className="login-head">
              <h1>{t('fp_title')}</h1>
              <p className="login-sub">{t('fp_sub')}</p>
            </div>

            <div className="login-field">
              <label htmlFor="identifier">{t('fp_identifier')}</label>
              <input id="identifier" ref={identifierRef} type="text" autoComplete="username" disabled={submitting} required />
            </div>

            <button className="login-submit" type="submit" disabled={submitting}>
              {submitting ? (
                <>
                  <span className="spinner login-submit-spinner" aria-hidden="true" />
                  {t('fp_submitting')}
                </>
              ) : (
                t('fp_submit')
              )}
            </button>

            <Link to="/login" className="login-forgot">
              {t('fp_back_to_login')}
            </Link>
          </form>
        )}
      </section>
    </main>
  )
}

import { useRef, useState, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useI18n } from '../i18n'
import { Wordmark } from '../components/Wordmark'
import { apiFetch, ApiError } from '../lib/api'
import './LoginPage.css'

// Step 2 of self-service reset (CLAUDE.md §13 re-scope, supervisor-directed) —
// reached via the link POST /auth/forgot-password emails. The token is a
// single-use, 1-hour-expiry opaque string in the query string; the server
// validates it, this page never inspects or trusts it beyond forwarding it.
export default function ResetPasswordPage() {
  const { t } = useI18n()
  const [params] = useSearchParams()
  const token = params.get('token') || ''
  const passwordRef = useRef<HTMLInputElement>(null)
  const confirmRef = useRef<HTMLInputElement>(null)
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    const password = passwordRef.current?.value ?? ''
    const confirm = confirmRef.current?.value ?? ''
    if (password.length < 8) {
      setError(t('rp_too_short'))
      return
    }
    if (password !== confirm) {
      setError(t('rp_mismatch'))
      return
    }
    setSubmitting(true)
    try {
      await apiFetch('/auth/reset-password', { method: 'POST', body: { token, newPassword: password }, auth: false })
      setDone(true)
    } catch (err) {
      if (err instanceof ApiError && err.status === 422) setError(t('rp_invalid_token'))
      else setError(t('login_err_server'))
    } finally {
      setSubmitting(false)
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
        {!token ? (
          <div className="login-form">
            <div className="login-head">
              <h1>{t('rp_title')}</h1>
            </div>
            <p className="login-error" role="alert">
              {t('rp_no_token')}
            </p>
            <Link to="/forgot-password" className="login-forgot">
              {t('rp_request_new_link')}
            </Link>
          </div>
        ) : done ? (
          <div className="login-form">
            <div className="login-head">
              <h1>{t('rp_title')}</h1>
            </div>
            <p className="login-note">{t('rp_success')}</p>
            <Link to="/login" className="login-submit">
              {t('rp_go_to_login')}
            </Link>
          </div>
        ) : (
          <form className="login-form" onSubmit={handleSubmit} noValidate>
            <div className="login-head">
              <h1>{t('rp_title')}</h1>
            </div>

            {error && (
              <p className="login-error" role="alert">
                {error}
              </p>
            )}

            <div className="login-field">
              <label htmlFor="password">{t('rp_new_password')}</label>
              <input id="password" ref={passwordRef} type="password" autoComplete="new-password" disabled={submitting} required />
            </div>
            <div className="login-field">
              <label htmlFor="confirm">{t('rp_confirm_password')}</label>
              <input id="confirm" ref={confirmRef} type="password" autoComplete="new-password" disabled={submitting} required />
            </div>

            <button className="login-submit" type="submit" disabled={submitting}>
              {submitting ? (
                <>
                  <span className="spinner login-submit-spinner" aria-hidden="true" />
                  {t('rp_submitting')}
                </>
              ) : (
                t('rp_submit')
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

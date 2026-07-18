import { useRef, useState, type FormEvent } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { useI18n } from '../i18n'
import { ApiError } from '../lib/api'
import { Wordmark } from '../components/Wordmark'
import './LoginPage.css'

interface FieldErrors {
  email?: string
  password?: string
}

export default function LoginPage() {
  const { status, login } = useAuth()
  const { t, lang, setLang } = useI18n()
  const navigate = useNavigate()
  const location = useLocation()
  const emailRef = useRef<HTMLInputElement>(null)
  const passwordRef = useRef<HTMLInputElement>(null)
  const [submitting, setSubmitting] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})
  const [formError, setFormError] = useState<string | null>(null)

  if (status === 'signedIn') return <Navigate to="/" replace />

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const email = emailRef.current?.value.trim() ?? ''
    const password = passwordRef.current?.value ?? ''

    const errors: FieldErrors = {}
    if (!email) errors.email = t('login_err_email')
    if (!password) errors.password = t('login_err_password')
    setFieldErrors(errors)
    setFormError(null)
    if (errors.email) {
      emailRef.current?.focus()
      return
    }
    if (errors.password) {
      passwordRef.current?.focus()
      return
    }

    setSubmitting(true)
    try {
      await login(email, password)
      const from = (location.state as { from?: string } | null)?.from
      navigate(from && from !== '/login' ? from : '/', { replace: true })
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.code === 'not_console') {
          setFormError(t('login_err_not_console'))
        } else if (err.status === 401) {
          setFormError(t('login_err_credentials'))
        } else if (err.status === 429) {
          setFormError(t('login_err_rate'))
        } else {
          setFormError(t('login_err_server'))
        }
      } else {
        setFormError(t('login_err_network'))
      }
      setSubmitting(false)
    }
  }

  return (
    <main className="login">
      <section className="login-pane">
        <Wordmark variant="login" />
        <div className="login-pane-foot">
          <p className="login-tagline">{t('login_tagline')}</p>
          <p className="login-console">{t('login_console')}</p>
        </div>
      </section>

      <section className="login-form-pane">
        <form className="login-form" onSubmit={handleSubmit} noValidate>
          <div className="login-head">
            <button
              type="button"
              className="login-lang"
              onClick={() => setLang(lang === 'ar' ? 'en' : 'ar')}
            >
              {t('lang_toggle')}
            </button>
            <h1>{t('login_signin')}</h1>
            <p className="login-sub">{t('login_sub')}</p>
          </div>

          {formError && (
            <p className="login-error" role="alert">
              {formError}
            </p>
          )}

          <div className="login-field">
            <label htmlFor="email">{t('login_identifier')}</label>
            <input
              id="email"
              ref={emailRef}
              // NOT type="email": employees sign in with a 4-digit number, which
              // the browser's email validation would reject outright.
              type="text"
              name="identifier"
              autoComplete="username"
              disabled={submitting}
              aria-invalid={fieldErrors.email ? true : undefined}
              aria-describedby={fieldErrors.email ? 'email-error' : undefined}
            />
            {fieldErrors.email && (
              <p className="login-field-error" id="email-error">
                {fieldErrors.email}
              </p>
            )}
          </div>

          <div className="login-field">
            <label htmlFor="password">{t('login_password')}</label>
            <div className="login-input-wrap">
              <input
                id="password"
                ref={passwordRef}
                type={showPassword ? 'text' : 'password'}
                name="password"
                autoComplete="current-password"
                disabled={submitting}
                aria-invalid={fieldErrors.password ? true : undefined}
                aria-describedby={fieldErrors.password ? 'password-error' : undefined}
              />
              <button
                type="button"
                className="login-reveal"
                onClick={() => setShowPassword((v) => !v)}
                disabled={submitting}
                aria-label={showPassword ? t('login_hide_password') : t('login_show_password')}
                aria-pressed={showPassword}
              >
                {showPassword ? (
                  <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M10.73 5.08A10.4 10.4 0 0 1 12 5c4.65 0 8.58 3.1 9.94 6.65a1 1 0 0 1 0 .7 13.2 13.2 0 0 1-1.67 2.68" />
                    <path d="M6.61 6.61A13.5 13.5 0 0 0 2.06 11.65a1 1 0 0 0 0 .7C3.42 15.9 7.35 19 12 19c1.34 0 2.63-.26 3.8-.73" />
                    <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24" />
                    <path d="m2 2 20 20" />
                  </svg>
                ) : (
                  <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M2.06 12.35a1 1 0 0 1 0-.7C3.42 8.1 7.35 5 12 5s8.58 3.1 9.94 6.65a1 1 0 0 1 0 .7C20.58 15.9 16.65 19 12 19s-8.58-3.1-9.94-6.65Z" />
                    <circle cx="12" cy="12" r="3" />
                  </svg>
                )}
              </button>
            </div>
            {fieldErrors.password && (
              <p className="login-field-error" id="password-error">
                {fieldErrors.password}
              </p>
            )}
          </div>

          <button className="login-submit" type="submit" disabled={submitting}>
            {submitting ? (
              <>
                <span className="spinner login-submit-spinner" aria-hidden="true" />
                {t('login_signing_in')}
              </>
            ) : (
              t('login_signin')
            )}
          </button>

          <p className="login-note">{t('login_note')}</p>
        </form>
      </section>
    </main>
  )
}

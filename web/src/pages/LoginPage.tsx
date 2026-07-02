import { useRef, useState, type FormEvent } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { ApiError } from '../lib/api'
import './LoginPage.css'

interface FieldErrors {
  email?: string
  password?: string
}

export default function LoginPage() {
  const { status, login } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const emailRef = useRef<HTMLInputElement>(null)
  const passwordRef = useRef<HTMLInputElement>(null)
  const [submitting, setSubmitting] = useState(false)
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})
  const [formError, setFormError] = useState<string | null>(null)

  if (status === 'signedIn') return <Navigate to="/" replace />

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const email = emailRef.current?.value.trim() ?? ''
    const password = passwordRef.current?.value ?? ''

    const errors: FieldErrors = {}
    if (!email) errors.email = 'Enter your email address.'
    if (!password) errors.password = 'Enter your password.'
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
        if (err.code === 'not_monitor') {
          setFormError(
            'This dashboard is for monitor accounts. Users and employees sign in from the mobile apps.',
          )
        } else if (err.status === 401) {
          setFormError('Email or password is incorrect.')
        } else if (err.status === 429) {
          setFormError('Too many attempts. Wait a few minutes, then try again.')
        } else {
          setFormError('Something went wrong on our side. Try again.')
        }
      } else {
        setFormError('Can’t reach the server. Check your connection and try again.')
      }
      setSubmitting(false)
    }
  }

  return (
    <main className="login">
      <section className="login-pane">
        <p className="login-wordmark">
          <span className="login-pip" aria-hidden="true" />
          MonitorFlow
        </p>
        <div className="login-pane-foot">
          <p className="login-tagline">Service requests and field operations, on one board.</p>
          <p className="login-console">Monitor console</p>
        </div>
      </section>

      <section className="login-form-pane">
        <form className="login-form" onSubmit={handleSubmit} noValidate>
          <div className="login-head">
            <h1>Sign in</h1>
            <p className="login-sub">Oversee requests, assignments, and field work.</p>
          </div>

          {formError && (
            <p className="login-error" role="alert">
              {formError}
            </p>
          )}

          <div className="login-field">
            <label htmlFor="email">Email</label>
            <input
              id="email"
              ref={emailRef}
              type="email"
              name="email"
              autoComplete="email"
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
            <label htmlFor="password">Password</label>
            <input
              id="password"
              ref={passwordRef}
              type="password"
              name="password"
              autoComplete="current-password"
              disabled={submitting}
              aria-invalid={fieldErrors.password ? true : undefined}
              aria-describedby={fieldErrors.password ? 'password-error' : undefined}
            />
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
                Signing in…
              </>
            ) : (
              'Sign in'
            )}
          </button>

          <p className="login-note">
            Monitor accounts are provisioned by an administrator — there’s no self-registration
            here.
          </p>
        </form>
      </section>
    </main>
  )
}

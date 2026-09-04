import { useState } from 'react'
import { apiFetch, ApiError } from '../lib/api'
import { useAuth } from '../auth/AuthContext'
import { useI18n } from '../i18n'
import './RequestsPage.css'
import './SettingsPage.css'

// Self-service account edit — any signed-in account (Owner included, closing
// the gap CLAUDE.md flagged: an Owner had no way to change their own password
// once provisioned). Reuses the existing PATCH /users/me and
// /users/me/password endpoints (routes/users.js), which already back the
// mobile Profile screen; this is the same backend, a web page for it. Email/
// login identifier stay read-only — routes/users.js treats them as identity,
// not something this page changes.

export default function ProfilePage() {
  const { t } = useI18n()
  const { user, updateProfile } = useAuth()

  const [name, setName] = useState(user?.name ?? '')
  const [phone, setPhone] = useState(user?.phone ?? '')
  const [infoBusy, setInfoBusy] = useState(false)
  const [infoSaved, setInfoSaved] = useState(false)
  const [infoError, setInfoError] = useState('')
  const [infoErrors, setInfoErrors] = useState<Record<string, string>>({})

  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [pwBusy, setPwBusy] = useState(false)
  const [pwSaved, setPwSaved] = useState(false)
  const [pwError, setPwError] = useState('')
  const [pwErrors, setPwErrors] = useState<Record<string, string>>({})

  async function saveInfo() {
    setInfoBusy(true)
    setInfoSaved(false)
    setInfoError('')
    setInfoErrors({})
    try {
      await apiFetch('/users/me', { method: 'PATCH', body: { name, phone: phone || null } })
      updateProfile(name, phone || null)
      setInfoSaved(true)
    } catch (err) {
      if (err instanceof ApiError && err.status === 422) {
        const body = err.body as { errors?: Record<string, string> } | undefined
        if (body?.errors) setInfoErrors(body.errors)
      }
      setInfoError((err as Error).message)
    } finally {
      setInfoBusy(false)
    }
  }

  async function savePassword() {
    setPwSaved(false)
    setPwError('')
    setPwErrors({})
    if (newPassword !== confirmPassword) {
      setPwErrors({ confirmPassword: t('profile_password_mismatch') })
      return
    }
    setPwBusy(true)
    try {
      await apiFetch('/users/me/password', { method: 'PATCH', body: { currentPassword, newPassword } })
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
      setPwSaved(true)
    } catch (err) {
      if (err instanceof ApiError && err.status === 422) {
        const body = err.body as { errors?: Record<string, string> } | undefined
        if (body?.errors) setPwErrors(body.errors)
      }
      setPwError((err as Error).message)
    } finally {
      setPwBusy(false)
    }
  }

  return (
    <div className="req">
      <header className="req-head">
        <h1>{t('profile_title')}</h1>
      </header>

      <div className="set-page">
        <section className="set-section">
          <header>
            <h2>{t('profile_sec_info')}</h2>
          </header>
          <div className="set-pair">
            <SetField label={t('profile_name')} error={infoErrors.name}>
              <input value={name} onChange={(e) => setName(e.target.value)} aria-invalid={!!infoErrors.name || undefined} />
            </SetField>
            <SetField label={t('profile_phone')} error={infoErrors.phone}>
              <input value={phone} inputMode="tel" onChange={(e) => setPhone(e.target.value)} aria-invalid={!!infoErrors.phone || undefined} />
            </SetField>
          </div>
          <div className="set-pair">
            <SetField label={t('profile_login_id')} hint={t('profile_login_id_hint')}>
              <input value={user?.loginIdentifier ?? ''} disabled />
            </SetField>
          </div>
          <div className="set-bar">
            <button type="button" className="req-retry" onClick={() => void saveInfo()} disabled={infoBusy}>
              {infoBusy ? t('ob_saving') : t('profile_save')}
            </button>
            {infoError && (
              <span className="set-bar-status is-error" role="alert">
                {infoError}
              </span>
            )}
            {infoSaved && !infoError && (
              <span className="set-bar-status" role="status">
                {t('profile_saved')}
              </span>
            )}
          </div>
        </section>

        <section className="set-section">
          <header>
            <h2>{t('profile_sec_password')}</h2>
          </header>
          <div className="set-pair">
            <SetField label={t('profile_current_password')} error={pwErrors.currentPassword}>
              <input
                type="password"
                autoComplete="current-password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                aria-invalid={!!pwErrors.currentPassword || undefined}
              />
            </SetField>
          </div>
          <div className="set-pair">
            <SetField label={t('profile_new_password')} error={pwErrors.newPassword}>
              <input
                type="password"
                autoComplete="new-password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                aria-invalid={!!pwErrors.newPassword || undefined}
              />
            </SetField>
            <SetField label={t('profile_confirm_password')} error={pwErrors.confirmPassword}>
              <input
                type="password"
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                aria-invalid={!!pwErrors.confirmPassword || undefined}
              />
            </SetField>
          </div>
          <div className="set-bar">
            <button type="button" className="req-retry" onClick={() => void savePassword()} disabled={pwBusy}>
              {pwBusy ? t('ob_saving') : t('profile_change_password')}
            </button>
            {pwError && (
              <span className="set-bar-status is-error" role="alert">
                {pwError}
              </span>
            )}
            {pwSaved && !pwError && (
              <span className="set-bar-status" role="status">
                {t('profile_password_changed')}
              </span>
            )}
          </div>
        </section>
      </div>
    </div>
  )
}

function SetField({
  label,
  error,
  hint,
  children,
}: {
  label: string
  error?: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <div className="set-field">
      <label>{label}</label>
      {children}
      {hint && <span className="set-hint">{hint}</span>}
      {error && <span className="set-error">{error}</span>}
    </div>
  )
}

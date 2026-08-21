import { useCallback, useEffect, useState } from 'react'
import { apiFetch, ApiError } from '../lib/api'
import { useI18n, type Loc } from '../i18n'
import { TranslateButton } from '../components/TranslateButton'
import './RequestsPage.css'
import './EmployeesPage.css'
import './DepartmentsPage.css'

// Levels & Capabilities (Gate-1 configuration, admin-only). Level authoring
// was seed-only until now (CLAUDE.md §12) — this is the live editor: create a
// level, tick which capabilities it grants. Capability keys stay plain ASCII
// (I5 — same precedent as AddServiceWizard's transition-gate picker), no
// bilingual catalogue for them.

const CAPABILITIES = [
  'view_all',
  'assign',
  'set_priority',
  'override',
  'manage_employees',
  'export',
  'manage_events',
  'manage_knowledge_base',
] as const

interface Level {
  id: number
  name: Loc
  capabilities: string[]
  holderCount: number
}
type FieldErrors = Record<string, string>

function fieldErrorsOf(err: unknown): FieldErrors {
  if (err instanceof ApiError && err.body && typeof err.body === 'object') {
    const errors = (err.body as { errors?: unknown }).errors
    if (errors && typeof errors === 'object') return errors as FieldErrors
  }
  return {}
}

export default function LevelsPage() {
  const { t, L } = useI18n()
  const [levels, setLevels] = useState<Level[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [toggleBusy, setToggleBusy] = useState<number | null>(null)

  const [dialog, setDialog] = useState<
    { kind: 'create' } | { kind: 'delete'; level: Level } | null
  >(null)
  // Confirmed before firing — this is bulk (every holder of the level) and
  // immediate (no per-employee step like the Employees page's level picker),
  // so a plain hint isn't enough here the way it was there.
  const [pendingToggle, setPendingToggle] = useState<{ level: Level; key: string; willEnable: boolean } | null>(
    null
  )

  const load = useCallback(async () => {
    const res = await apiFetch<{ levels: Level[] }>('/employee-levels')
    setLevels(res.levels)
    setError(null)
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- setError fires only in the async catch, not synchronously
    load().catch((err: Error) => setError(err.message))
  }, [load])

  function onDone() {
    setDialog(null)
    load().catch((err: Error) => setError(err.message))
  }

  async function confirmToggle() {
    if (!pendingToggle) return
    const { level, key, willEnable } = pendingToggle
    setToggleBusy(level.id)
    const next = willEnable ? [...level.capabilities, key] : level.capabilities.filter((c) => c !== key)
    try {
      await apiFetch(`/employee-levels/${level.id}`, { method: 'PATCH', body: { capabilities: next } })
      setPendingToggle(null)
      await load()
    } catch (err) {
      setError((err as Error).message)
      setPendingToggle(null)
    } finally {
      setToggleBusy(null)
    }
  }

  return (
    <div className="req">
      <header className="req-head">
        <h1>{t('lvl_title')}</h1>
        <button type="button" className="req-retry emp-add" onClick={() => setDialog({ kind: 'create' })}>
          {t('lvl_add')}
        </button>
      </header>
      <p className="org-legend">{t('lvl_sub')}</p>
      <p className="org-legend">{t('lvl_legend')}</p>

      {error ? (
        <div className="req-status">
          <p className="req-status-msg">{error}</p>
          <button
            type="button"
            className="req-retry"
            onClick={() => {
              setError(null)
              load().catch((err: Error) => setError(err.message))
            }}
          >
            {t('try_again')}
          </button>
        </div>
      ) : !levels ? (
        <div className="req-skeleton" aria-busy="true">
          <span className="visually-hidden">{t('lvl_loading')}</span>
          {Array.from({ length: 3 }, (_, i) => (
            <div className="skel-row" aria-hidden="true" key={i} />
          ))}
        </div>
      ) : (
        <div className="req-tablewrap">
          <table className="req-table">
            <thead>
              <tr>
                <th scope="col">{t('lvl_col_level')}</th>
                <th scope="col">{t('lvl_grants')}</th>
                <th scope="col">{t('lvl_col_holders')}</th>
                <th scope="col" className="emp-actions-col">
                  {t('col_actions')}
                </th>
              </tr>
            </thead>
            <tbody>
              {levels.map((lvl) => (
                <tr key={lvl.id}>
                  <td className="req-service">{L(lvl.name)}</td>
                  <td>
                    <div className="dept-member-list">
                      {CAPABILITIES.map((key) => (
                        <label key={key} className="dept-member-row">
                          <input
                            type="checkbox"
                            checked={lvl.capabilities.includes(key)}
                            disabled={toggleBusy === lvl.id}
                            onChange={() => {}}
                            onClick={(e) => {
                              e.preventDefault()
                              setPendingToggle({ level: lvl, key, willEnable: !lvl.capabilities.includes(key) })
                            }}
                          />
                          <code>{key}</code>
                        </label>
                      ))}
                    </div>
                  </td>
                  <td>{lvl.holderCount}</td>
                  <td className="emp-actions">
                    <button
                      type="button"
                      className="action-btn is-danger"
                      disabled={lvl.holderCount > 0}
                      title={lvl.holderCount > 0 ? t('lvl_delete_warn') : undefined}
                      onClick={() => setDialog({ kind: 'delete', level: lvl })}
                    >
                      {t('lvl_delete')}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {dialog?.kind === 'create' && <LevelForm onClose={() => setDialog(null)} onDone={onDone} />}
      {dialog?.kind === 'delete' && (
        <DeleteDialog level={dialog.level} onClose={() => setDialog(null)} onDone={onDone} />
      )}
      {pendingToggle && (
        <ToggleConfirmDialog
          pending={pendingToggle}
          busy={toggleBusy === pendingToggle.level.id}
          onCancel={() => setPendingToggle(null)}
          onConfirm={confirmToggle}
        />
      )}
    </div>
  )
}

function ToggleConfirmDialog({
  pending,
  busy,
  onCancel,
  onConfirm,
}: {
  pending: { level: Level; key: string; willEnable: boolean }
  busy: boolean
  onCancel: () => void
  onConfirm: () => void
}) {
  const { t, L } = useI18n()
  const { level, key, willEnable } = pending

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !busy && onCancel()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel, busy])

  return (
    <div className="dialog-backdrop" onClick={() => !busy && onCancel()}>
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        <h4>
          {willEnable ? t('lvl_toggle_grant_h') : t('lvl_toggle_revoke_h')} <code>{key}</code>
        </h4>
        <p className="req-status-msg">
          {(willEnable ? t('lvl_toggle_grant_p') : t('lvl_toggle_revoke_p'))
            .replace('{level}', L(level.name))
            .replace('{count}', String(level.holderCount))}
        </p>
        <div className="dialog-actions">
          <button type="button" className="detail-close-text" onClick={onCancel} disabled={busy}>
            {t('cancel')}
          </button>
          <button
            type="button"
            className={`req-retry${willEnable ? '' : ' is-danger'}`}
            onClick={onConfirm}
            disabled={busy}
          >
            {busy ? t('tc_saving') : willEnable ? t('lvl_toggle_grant_btn') : t('lvl_toggle_revoke_btn')}
          </button>
        </div>
      </div>
    </div>
  )
}

function LevelForm({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { t } = useI18n()
  const [nameEn, setNameEn] = useState('')
  const [nameAr, setNameAr] = useState('')
  const [errors, setErrors] = useState<FieldErrors>({})
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setErrors({})
    try {
      await apiFetch('/employee-levels', { method: 'POST', body: { name: { en: nameEn, ar: nameAr } } })
      onDone()
    } catch (err) {
      const fe = fieldErrorsOf(err)
      setErrors(Object.keys(fe).length ? fe : { _: (err as Error).message })
      setBusy(false)
    }
  }

  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <form className="dialog" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <h4>{t('lvl_create')}</h4>
        {errors._ && <p className="assign-error">{errors._}</p>}
        <label className="field">
          {t('lvl_name_en')}
          <input value={nameEn} onChange={(e) => setNameEn(e.target.value)} required autoFocus />
          {errors.name && <em className="field-err">{errors.name}</em>}
        </label>
        <label className="field">
          {t('lvl_name_ar')}
          <input value={nameAr} onChange={(e) => setNameAr(e.target.value)} required dir="rtl" />
        </label>
        <TranslateButton en={nameEn} ar={nameAr} setEn={setNameEn} setAr={setNameAr} />
        <div className="dialog-actions">
          <button type="button" className="detail-close-text" onClick={onClose}>
            {t('cancel')}
          </button>
          <button type="submit" className="req-retry" disabled={busy || !nameEn.trim() || !nameAr.trim()}>
            {t('lvl_create')}
          </button>
        </div>
      </form>
    </div>
  )
}

function DeleteDialog({ level, onClose, onDone }: { level: Level; onClose: () => void; onDone: () => void }) {
  const { t, L } = useI18n()
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  async function confirm() {
    setBusy(true)
    setError(null)
    try {
      await apiFetch(`/employee-levels/${level.id}`, { method: 'DELETE' })
      onDone()
    } catch (err) {
      setError((err as Error).message)
      setBusy(false)
    }
  }

  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        <h4>
          {t('lvl_delete_q')} {L(level.name)}
        </h4>
        <p className="req-status-msg">{t('lvl_delete_warn')}</p>
        {error && <p className="assign-error">{error}</p>}
        <div className="dialog-actions">
          <button type="button" className="detail-close-text" onClick={onClose}>
            {t('cancel')}
          </button>
          <button type="button" className="req-retry is-danger" onClick={confirm} disabled={busy}>
            {t('lvl_delete')}
          </button>
        </div>
      </div>
    </div>
  )
}

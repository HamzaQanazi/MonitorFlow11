import { useCallback, useEffect, useState } from 'react'
import { apiFetch, ApiError } from '../lib/api'
import { useI18n, type Loc } from '../i18n'
import './RequestsPage.css'
import './EmployeesPage.css'

// Levels & capabilities (admin only) — where Gate 1 is configured.
//
// Admin-only on purpose. If a manager could set levels they could grant a
// subordinate a capability they don't hold themselves (escalation by proxy),
// which would need a "may only grant what you hold" check on a hot path. An
// admin sits outside the reporting tree and holds no capabilities (I2), so
// granting one gains them nothing and that rule isn't needed.
//
// Reporting lines are NOT edited here — see the note in routes/config.js.
// The employee list is reused from GET /config/org rather than adding another
// listing endpoint; that payload already carries level and capabilities.

interface Level {
  id: number
  name: Loc
  capabilities: string[]
  employeeCount: number
}
interface OrgEmployee {
  id: number
  name: string
  isActive: boolean
  departmentName: Loc | null
  levelId: number | null
  levelName: Loc | null
  capabilities: string[]
}

export default function LevelsPage() {
  const { t, L } = useI18n()
  const [levels, setLevels] = useState<Level[] | null>(null)
  const [catalogue, setCatalogue] = useState<string[]>([])
  const [staff, setStaff] = useState<OrgEmployee[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [creating, setCreating] = useState(false)

  const load = useCallback(async () => {
    const [caps, lv, org] = await Promise.all([
      apiFetch<{ capabilities: string[] }>('/config/capabilities'),
      apiFetch<{ levels: Level[] }>('/config/levels'),
      apiFetch<{ employees: OrgEmployee[] }>('/config/org'),
    ])
    setCatalogue(caps.capabilities)
    setLevels(lv.levels)
    setStaff(org.employees)
    setError(null)
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- setError fires only in the async catch, not synchronously
    load().catch((err: Error) => setError(err.message))
  }, [load])

  function fail(err: unknown) {
    const b = err instanceof ApiError ? (err.body as { errors?: string[] } | null) : null
    setError(b?.errors?.join(' · ') ?? (err as Error).message)
  }

  // Toggling a grant re-sends the whole set — the endpoint replaces it wholesale,
  // which keeps "what this level grants" a single value rather than a diff.
  async function toggleCap(level: Level, cap: string) {
    const next = level.capabilities.includes(cap)
      ? level.capabilities.filter((c) => c !== cap)
      : [...level.capabilities, cap]
    setBusy(true)
    try {
      await apiFetch(`/config/levels/${level.id}`, { method: 'PATCH', body: { capabilities: next } })
      await load()
    } catch (err) {
      fail(err)
    } finally {
      setBusy(false)
    }
  }

  async function setEmployeeLevel(employeeId: number, levelId: number | null) {
    setBusy(true)
    try {
      await apiFetch(`/config/employees/${employeeId}/level`, { method: 'PATCH', body: { levelId } })
      await load()
    } catch (err) {
      fail(err)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="req">
      <header className="req-head">
        <h1>{t('lvl_title')}</h1>
        <p className="req-meta">{t('lvl_sub')}</p>
      </header>

      {error && <p className="assign-error">{error}</p>}

      {!levels || !staff ? (
        <div className="req-skeleton" aria-busy="true">
          <span className="visually-hidden">{t('lvl_loading')}</span>
          {Array.from({ length: 4 }, (_, i) => (
            <div className="skel-row" aria-hidden="true" key={i} />
          ))}
        </div>
      ) : (
        <>
          <p className="org-legend">{t('lvl_legend')}</p>

          <div className="req-filters">
            <div className="control-row">
              <button type="button" className="req-retry emp-add" onClick={() => setCreating(true)}>
                {t('lvl_add')}
              </button>
            </div>
          </div>

          <div className="req-tablewrap">
            <table className="req-table">
              <thead>
                <tr>
                  <th scope="col">{t('lvl_col_level')}</th>
                  <th scope="col">{t('lvl_col_holders')}</th>
                  {catalogue.map((c) => (
                    <th scope="col" key={c}>
                      <code>{c}</code>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {levels.map((lv) => (
                  <tr key={lv.id}>
                    <td className="req-service">{L(lv.name)}</td>
                    <td>{lv.employeeCount}</td>
                    {catalogue.map((c) => (
                      <td key={c}>
                        <label className="wh-check">
                          <input
                            type="checkbox"
                            checked={lv.capabilities.includes(c)}
                            disabled={busy}
                            onChange={() => void toggleCap(lv, c)}
                            aria-label={`${L(lv.name)} — ${c}`}
                          />
                        </label>
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <h2 className="lvl-h2">{t('lvl_assign_h')}</h2>
          <p className="org-legend">{t('lvl_assign_p')}</p>
          <div className="req-tablewrap">
            <table className="req-table">
              <thead>
                <tr>
                  <th scope="col">{t('lvl_col_employee')}</th>
                  <th scope="col">{t('svc_col_department')}</th>
                  <th scope="col">{t('lvl_col_level')}</th>
                  <th scope="col">{t('lvl_col_grants')}</th>
                </tr>
              </thead>
              <tbody>
                {staff.map((e) => (
                  <tr key={e.id}>
                    <td className="req-service">
                      {e.name}
                      {!e.isActive && <span className="org-inactive"> · {t('org_inactive')}</span>}
                    </td>
                    <td>{e.departmentName ? L(e.departmentName) : '—'}</td>
                    <td>
                      <select
                        className="req-select"
                        disabled={busy}
                        value={e.levelId ?? ''}
                        onChange={(ev) =>
                          void setEmployeeLevel(e.id, ev.target.value ? Number(ev.target.value) : null)
                        }
                      >
                        <option value="">{t('org_no_level')}</option>
                        {levels.map((l) => (
                          <option key={l.id} value={l.id}>
                            {L(l.name)}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="org-caps">
                      {e.capabilities.length === 0 ? (
                        <span className="org-cap is-none">{t('org_no_caps')}</span>
                      ) : (
                        e.capabilities.map((c) => (
                          <span className="org-cap" key={c}>
                            {c}
                          </span>
                        ))
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {creating && (
        <CreateLevelDialog
          catalogue={catalogue}
          onClose={() => setCreating(false)}
          onDone={() => {
            setCreating(false)
            load().catch((err: Error) => setError(err.message))
          }}
        />
      )}
    </div>
  )
}

function CreateLevelDialog({
  catalogue,
  onClose,
  onDone,
}: {
  catalogue: string[]
  onClose: () => void
  onDone: () => void
}) {
  const { t } = useI18n()
  const [en, setEn] = useState('')
  const [ar, setAr] = useState('')
  const [caps, setCaps] = useState<string[]>([])
  const [errors, setErrors] = useState<string[]>([])
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setErrors([])
    try {
      await apiFetch('/config/levels', {
        method: 'POST',
        body: { name: { en, ar }, capabilities: caps },
      })
      onDone()
    } catch (err) {
      const b = err instanceof ApiError ? (err.body as { errors?: string[] } | null) : null
      setErrors(b?.errors ?? [(err as Error).message])
      setBusy(false)
    }
  }

  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <form className="dialog" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <h4>{t('lvl_add')}</h4>
        <label className="field">
          <span>{t('lvl_name_en')}</span>
          <input value={en} onChange={(e) => setEn(e.target.value)} dir="ltr" autoFocus />
        </label>
        <label className="field">
          <span>{t('lvl_name_ar')}</span>
          <input value={ar} onChange={(e) => setAr(e.target.value)} dir="rtl" />
        </label>
        <fieldset className="field wh-events">
          <legend>{t('lvl_grants')}</legend>
          {catalogue.map((c) => (
            <label key={c} className="wh-check">
              <input
                type="checkbox"
                checked={caps.includes(c)}
                onChange={() =>
                  setCaps((p) => (p.includes(c) ? p.filter((x) => x !== c) : [...p, c]))
                }
              />
              <code>{c}</code>
            </label>
          ))}
        </fieldset>
        {errors.map((m) => (
          <p className="assign-error" key={m}>
            {m}
          </p>
        ))}
        <div className="dialog-actions">
          <button type="button" className="detail-close-text" onClick={onClose}>
            {t('cancel')}
          </button>
          <button type="submit" className="req-retry" disabled={busy || !en.trim() || !ar.trim()}>
            {t('lvl_create')}
          </button>
        </div>
      </form>
    </div>
  )
}

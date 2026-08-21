import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { apiFetch } from '../lib/api'
import { useI18n, type Loc } from '../i18n'
import './RequestsPage.css'
import './EmployeesPage.css'

// Services — admin-only management list. The console had no such page: the
// Add Service wizard could create a service, and PATCH /services/{id}/enabled
// and /auto-assign existed on the server, but nothing in the UI ever called
// them. Disabling a service was therefore unreachable, and so was re-enabling
// one (the list only ever returned enabled rows). This is also the entry
// point for editing a service that no request has used yet (§3).

interface ServiceRow {
  id: number
  name: Loc
  departmentName: Loc
  defaultPriority: 'low' | 'medium' | 'high'
  autoAssign: boolean
  enabled: boolean
  editable: boolean
}

export default function ServicesPage() {
  const { t, L } = useI18n()
  const [services, setServices] = useState<ServiceRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<number | null>(null)

  async function load() {
    const res = await apiFetch<{ services: ServiceRow[] }>('/services?includeDisabled=true')
    setServices(res.services)
    setError(null)
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- setError fires only in the async catch
    load().catch((err: Error) => setError(err.message))
  }, [])

  async function toggle(row: ServiceRow, field: 'enabled' | 'autoAssign') {
    setBusyId(row.id)
    try {
      const path = field === 'enabled' ? 'enabled' : 'auto-assign'
      const body = field === 'enabled' ? { enabled: !row.enabled } : { autoAssign: !row.autoAssign }
      await apiFetch(`/services/${row.id}/${path}`, { method: 'PATCH', body })
      await load()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="req">
      <header className="req-head">
        <h1>{t('svc_list_title')}</h1>
      </header>

      <div className="req-filters">
        <div className="control-row">
          <Link className="req-retry emp-add" to="/services/new">
            {t('svc_new')}
          </Link>
        </div>
      </div>

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
      ) : !services ? (
        <div className="req-skeleton" aria-busy="true">
          {Array.from({ length: 4 }, (_, i) => (
            <div className="skel-row" aria-hidden="true" key={i} />
          ))}
        </div>
      ) : services.length === 0 ? (
        <div className="req-empty">
          <h2>{t('svc_list_none_h')}</h2>
          <p>{t('svc_list_none_p')}</p>
        </div>
      ) : (
        <div className="req-tablewrap">
          <table className="req-table">
            <thead>
              <tr>
                <th scope="col">{t('col_name')}</th>
                <th scope="col">{t('emp_department')}</th>
                <th scope="col">{t('svc_default_priority')}</th>
                <th scope="col">{t('svc_col_enabled')}</th>
                <th scope="col">{t('svc_col_auto_assign')}</th>
                <th scope="col" className="emp-actions-col">
                  {t('col_actions')}
                </th>
              </tr>
            </thead>
            <tbody>
              {services.map((row) => (
                <tr key={row.id}>
                  <td className="req-service">{L(row.name)}</td>
                  <td>{L(row.departmentName)}</td>
                  <td>{t(`pri_${row.defaultPriority}`)}</td>
                  <td>
                    <label className="svc-check">
                      <input
                        type="checkbox"
                        checked={row.enabled}
                        disabled={busyId === row.id}
                        onChange={() => toggle(row, 'enabled')}
                      />
                      <span className="visually-hidden">{t('svc_col_enabled')}</span>
                    </label>
                  </td>
                  <td>
                    <label className="svc-check">
                      <input
                        type="checkbox"
                        checked={row.autoAssign}
                        disabled={busyId === row.id}
                        onChange={() => toggle(row, 'autoAssign')}
                      />
                      <span className="visually-hidden">{t('svc_col_auto_assign')}</span>
                    </label>
                  </td>
                  <td className="emp-actions-col">
                    {row.editable ? (
                      <Link className="action-btn" to={`/services/${row.id}/edit`}>
                        {t('emp_edit')}
                      </Link>
                    ) : (
                      <span className="tc-muted" title={t('svc_edit_locked')}>
                        {t('svc_edit_locked')}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

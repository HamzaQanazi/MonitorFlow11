import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { apiFetch } from '../lib/api'
import { useAuth } from '../auth/AuthContext'
import { useI18n } from '../i18n'
import './RequestsPage.css'
import './EmployeesPage.css'

// Audit Log (spec v4 Sections C/D, admin-only). Read-only, filterable table
// over GET /audit-events. Covers account/configuration events AND operational
// events (§6 re-scope: status changes, assignments, priority changes) — the
// per-request timeline still lives in each request's detail.

const PAGE_SIZE = 20

// The known audit actions (lib/audit.js writers). The select is a closed
// list so a typo can't silently filter to nothing. Account writes target
// employees (leads and field techs); operational writes target requests.
const ACTIONS = [
  ...['created', 'updated', 'activated', 'deactivated', 'password_reset'].map((w) => `employee.${w}`),
  'request.status_changed',
  'request.assigned',
  'request.priority_changed',
  'service.created',
  'service.updated',
  'level.created',
  'level.updated',
  'employee.level_changed',
]

interface AuditEvent {
  id: number
  action: string
  entityType: string
  entityId: number
  entityName: string | null
  detail: Record<string, unknown> | null
  createdAt: string
  actor: { id: number; name: string }
}
interface ListResponse {
  events: AuditEvent[]
  actors: { id: number; name: string }[]
  page: number
  pageSize: number
  total: number
}

// Action labels are a closed set, translated via t(); an unknown action falls
// back to its raw key. Keyed on the FULL action — `employee.created` and
// `service.created` share a verb, so keying on the verb alone showed one of
// them under the other's label.
function actionLabel(action: string, t: (k: string) => string) {
  const key = `audit_act_${action.replaceAll('.', '_')}`
  const label = t(key)
  return label === key ? action : label
}

// Entity type ('user' | 'request') → localized noun; falls back to the raw key.
function entityTypeLabel(entityType: string, t: (k: string) => string) {
  const key = `audit_entity_${entityType}`
  const label = t(key)
  return label === key ? entityType : label
}

function detailText(detail: AuditEvent['detail']) {
  if (!detail || Object.keys(detail).length === 0) return '—'
  return Object.entries(detail)
    .map(([k, v]) => `${k}: ${String(v)}`)
    .join(' · ')
}

export default function AuditPage() {
  const { user } = useAuth()
  const { t } = useI18n()
  const [params, setParams] = useSearchParams()
  const page = Math.max(1, Number(params.get('page')) || 1)
  const action = params.get('action') ?? ''
  const actorId = params.get('actorId') ?? ''
  const dateFrom = params.get('dateFrom') ?? ''
  const dateTo = params.get('dateTo') ?? ''
  const hasFilters = Boolean(action || actorId || dateFrom || dateTo)

  const [data, setData] = useState<ListResponse | null>(null)
  const [error, setError] = useState<string | null>(null)

  const setFilter = useCallback(
    (key: string, value: string) => {
      const next = new URLSearchParams(params)
      if (value) next.set(key, value)
      else next.delete(key)
      next.delete('page')
      setParams(next, { replace: true })
    },
    [params, setParams],
  )

  function setPage(p: number) {
    const next = new URLSearchParams(params)
    if (p > 1) next.set('page', String(p))
    else next.delete('page')
    setParams(next)
  }

  function clearFilters() {
    setParams(new URLSearchParams(), { replace: true })
  }

  const load = useCallback(async () => {
    const qs = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) })
    if (action) qs.set('action', action)
    if (actorId) qs.set('actorId', actorId)
    if (dateFrom) qs.set('dateFrom', dateFrom)
    if (dateTo) qs.set('dateTo', dateTo)
    const res = await apiFetch<ListResponse>(`/audit-events?${qs.toString()}`)
    setData(res)
    setError(null)
  }, [page, action, actorId, dateFrom, dateTo])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- setError fires only in the async catch, not synchronously
    load().catch((err: Error) => setError(err.message))
  }, [load])

  const pages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1

  return (
    <div className="req">
      <header className="req-head">
        <h1>{t('audit_title')}</h1>
        {data && (
          <p className="req-meta">
            {data.total} {data.total === 1 ? t('event_word') : t('events_word')}
            {hasFilters && ` ${t('matching')}`}
          </p>
        )}
      </header>

      <div className="req-filters">
        <div className="control-row">
          <select
            className="req-select"
            aria-label={t('audit_filter_action')}
            value={action}
            onChange={(e) => setFilter('action', e.target.value)}
          >
            <option value="">{t('audit_all_actions')}</option>
            {ACTIONS.map((a) => (
              <option key={a} value={a}>
                {actionLabel(a, t)}
              </option>
            ))}
          </select>
          <select
            className="req-select"
            aria-label={t('audit_filter_actor')}
            value={actorId}
            onChange={(e) => setFilter('actorId', e.target.value)}
          >
            <option value="">{t('audit_all_actors')}</option>
            {(data?.actors ?? []).map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
                {user && a.id === user.id ? ` (${t('audit_you')})` : ''}
              </option>
            ))}
          </select>
          <input
            type="date"
            className="req-select"
            aria-label={t('rep_from_date_aria')}
            value={dateFrom}
            onChange={(e) => setFilter('dateFrom', e.target.value)}
          />
          <input
            type="date"
            className="req-select"
            aria-label={t('rep_to_date_aria')}
            value={dateTo}
            onChange={(e) => setFilter('dateTo', e.target.value)}
          />
          {hasFilters && (
            <button type="button" className="req-clear" onClick={clearFilters}>
              {t('clear_filters')}
            </button>
          )}
        </div>
      </div>

      {error ? (
        <div className="req-status">
          <p className="req-status-msg">
            {t('audit_load_err')} {error}
          </p>
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
      ) : !data ? (
        <div className="req-skeleton" aria-busy="true">
          <span className="visually-hidden">{t('audit_loading')}</span>
          {Array.from({ length: 6 }, (_, i) => (
            <div className="skel-row" aria-hidden="true" key={i} />
          ))}
        </div>
      ) : data.events.length === 0 ? (
        <div className="req-empty">
          <h2>{hasFilters ? t('audit_no_match_h') : t('audit_none_h')}</h2>
          <p>{hasFilters ? t('emp_loosen_p') : t('audit_none_p')}</p>
          {hasFilters && (
            <button type="button" className="req-retry" onClick={clearFilters}>
              {t('clear_filters')}
            </button>
          )}
        </div>
      ) : (
        <>
          <div className="req-tablewrap">
            <table className="req-table">
              <thead>
                <tr>
                  <th scope="col">{t('col_when')}</th>
                  <th scope="col">{t('col_actor')}</th>
                  <th scope="col">{t('col_action')}</th>
                  <th scope="col">{t('col_target')}</th>
                  <th scope="col">{t('col_details')}</th>
                </tr>
              </thead>
              <tbody>
                {data.events.map((e) => (
                  <tr key={e.id}>
                    <td>{new Date(e.createdAt).toLocaleString()}</td>
                    <td className="req-service">{e.actor.name}</td>
                    <td>{actionLabel(e.action, t)}</td>
                    <td>{e.entityName ?? `${entityTypeLabel(e.entityType, t)} #${e.entityId}`}</td>
                    <td className="emp-email">{detailText(e.detail)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {data.total > PAGE_SIZE && (
            <nav className="req-pager" aria-label={t('pagination')}>
              <span className="req-pager-info">
                {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, data.total)} {t('of')} {data.total}
              </span>
              <button type="button" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                {t('previous')}
              </button>
              <button type="button" disabled={page >= pages} onClick={() => setPage(page + 1)}>
                {t('next')}
              </button>
            </nav>
          )}
        </>
      )}
    </div>
  )
}

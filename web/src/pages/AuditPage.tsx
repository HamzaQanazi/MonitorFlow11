import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { apiFetch } from '../lib/api'
import './RequestsPage.css'
import './EmployeesPage.css'

// Audit Log (spec v4 Sections C/D, admin-only). Read-only, filterable table
// over GET /audit-events. Account/configuration events only — request
// lifecycle lives in each request's timeline.

const PAGE_SIZE = 20

// The known audit actions (lib/audit.js writers). The select is a closed
// list so a typo can't silently filter to nothing.
const ACTIONS = ['monitor', 'employee'].flatMap((who) =>
  ['created', 'updated', 'activated', 'deactivated', 'password_reset'].map((what) => `${who}.${what}`),
)

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
  page: number
  pageSize: number
  total: number
}

function actionLabel(action: string) {
  const [who, what] = action.split('.')
  return `${who[0].toUpperCase()}${who.slice(1)} ${what.replaceAll('_', ' ')}`
}

function detailText(detail: AuditEvent['detail']) {
  if (!detail || Object.keys(detail).length === 0) return '—'
  return Object.entries(detail)
    .map(([k, v]) => `${k}: ${String(v)}`)
    .join(' · ')
}

export default function AuditPage() {
  const [params, setParams] = useSearchParams()
  const page = Math.max(1, Number(params.get('page')) || 1)
  const action = params.get('action') ?? ''
  const dateFrom = params.get('dateFrom') ?? ''
  const dateTo = params.get('dateTo') ?? ''
  const hasFilters = Boolean(action || dateFrom || dateTo)

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
    if (dateFrom) qs.set('dateFrom', dateFrom)
    if (dateTo) qs.set('dateTo', dateTo)
    const res = await apiFetch<ListResponse>(`/audit-events?${qs.toString()}`)
    setData(res)
    setError(null)
  }, [page, action, dateFrom, dateTo])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- setError fires only in the async catch, not synchronously
    load().catch((err: Error) => setError(err.message))
  }, [load])

  const pages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1

  return (
    <div className="req">
      <header className="req-head">
        <h1>Audit Log</h1>
        {data && (
          <p className="req-meta">
            {data.total} event{data.total === 1 ? '' : 's'}
            {hasFilters && ' matching'}
          </p>
        )}
      </header>

      <div className="req-filters">
        <div className="control-row">
          <select
            className="req-select"
            aria-label="Filter by action"
            value={action}
            onChange={(e) => setFilter('action', e.target.value)}
          >
            <option value="">All actions</option>
            {ACTIONS.map((a) => (
              <option key={a} value={a}>
                {actionLabel(a)}
              </option>
            ))}
          </select>
          <input
            type="date"
            className="req-select"
            aria-label="From date"
            value={dateFrom}
            onChange={(e) => setFilter('dateFrom', e.target.value)}
          />
          <input
            type="date"
            className="req-select"
            aria-label="To date"
            value={dateTo}
            onChange={(e) => setFilter('dateTo', e.target.value)}
          />
          {hasFilters && (
            <button type="button" className="req-clear" onClick={clearFilters}>
              Clear filters
            </button>
          )}
        </div>
      </div>

      {error ? (
        <div className="req-status">
          <p className="req-status-msg">Couldn’t load the audit log: {error}</p>
          <button
            type="button"
            className="req-retry"
            onClick={() => {
              setError(null)
              load().catch((err: Error) => setError(err.message))
            }}
          >
            Try again
          </button>
        </div>
      ) : !data ? (
        <div className="req-skeleton" aria-busy="true">
          <span className="visually-hidden">Loading audit events…</span>
          {Array.from({ length: 6 }, (_, i) => (
            <div className="skel-row" aria-hidden="true" key={i} />
          ))}
        </div>
      ) : data.events.length === 0 ? (
        <div className="req-empty">
          <h2>{hasFilters ? 'No matching events' : 'No audit events yet'}</h2>
          <p>
            {hasFilters
              ? 'Loosen or clear the filters to see more.'
              : 'Account and configuration changes will appear here as they happen.'}
          </p>
          {hasFilters && (
            <button type="button" className="req-retry" onClick={clearFilters}>
              Clear filters
            </button>
          )}
        </div>
      ) : (
        <>
          <div className="req-tablewrap">
            <table className="req-table">
              <thead>
                <tr>
                  <th scope="col">When</th>
                  <th scope="col">Actor</th>
                  <th scope="col">Action</th>
                  <th scope="col">Target</th>
                  <th scope="col">Details</th>
                </tr>
              </thead>
              <tbody>
                {data.events.map((e) => (
                  <tr key={e.id}>
                    <td>{new Date(e.createdAt).toLocaleString()}</td>
                    <td className="req-service">{e.actor.name}</td>
                    <td>{actionLabel(e.action)}</td>
                    <td>{e.entityName ?? `${e.entityType} #${e.entityId}`}</td>
                    <td className="emp-email">{detailText(e.detail)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {data.total > PAGE_SIZE && (
            <nav className="req-pager" aria-label="Pagination">
              <span className="req-pager-info">
                {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, data.total)} of {data.total}
              </span>
              <button type="button" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                Previous
              </button>
              <button type="button" disabled={page >= pages} onClick={() => setPage(page + 1)}>
                Next
              </button>
            </nav>
          )}
        </>
      )}
    </div>
  )
}

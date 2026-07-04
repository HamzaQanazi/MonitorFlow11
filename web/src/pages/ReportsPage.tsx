import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { apiFetch, getToken } from '../lib/api'
import './RequestsPage.css'
import './ReportsPage.css'

// Basic Reports (CLAUDE.md Section 4). Monitor-only. Same filters as Requests
// (the backend reuses the one query engine), plus aggregate cards and a CSV
// export of the current filter set.

const CATEGORIES = ['new', 'triage', 'in_progress', 'done', 'closed', 'terminated'] as const
type Category = (typeof CATEGORIES)[number]
const CATEGORY_LABEL: Record<Category, string> = {
  new: 'New',
  triage: 'Triage',
  in_progress: 'In progress',
  done: 'Done',
  closed: 'Closed',
  terminated: 'Terminated',
}
const PRIORITIES = ['high', 'medium', 'low'] as const
const PRIORITY_LABEL: Record<string, string> = { high: 'High', medium: 'Medium', low: 'Low' }
const PAGE_SIZE = 20

interface ReportRow {
  id: number
  serviceTypeName: string
  status: { key: string; label: string; category: Category | null }
  priority: string
  createdAt: string
  requester: { id: number; name: string }
}
interface Aggregates {
  total: number
  byCategory: Record<string, number>
  byPriority: Record<string, number>
  byService: Record<string, number>
}
interface ReportResponse {
  requests: ReportRow[]
  page: number
  pageSize: number
  total: number
  aggregates: Aggregates
}
interface Service {
  id: number
  name: string
}

interface EmployeeOption {
  id: number
  name: string
  isActive: boolean
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

export default function ReportsPage() {
  const [params, setParams] = useSearchParams()
  const page = Math.max(1, Number(params.get('page')) || 1)
  const category = params.get('category') ?? ''
  const serviceTypeId = params.get('service') ?? ''
  const employeeId = params.get('employee') ?? ''
  const priority = params.get('priority') ?? ''
  const dateFrom = params.get('dateFrom') ?? ''
  const dateTo = params.get('dateTo') ?? ''
  const q = params.get('q') ?? ''
  const hasFilters = Boolean(category || serviceTypeId || employeeId || priority || dateFrom || dateTo || q)

  const [data, setData] = useState<ReportResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [services, setServices] = useState<Service[]>([])
  const [employees, setEmployees] = useState<EmployeeOption[]>([])
  const [search, setSearch] = useState(q)
  const [exporting, setExporting] = useState(false)

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
    setSearch('')
    setParams(new URLSearchParams(), { replace: true })
  }

  // The filter query string the backend understands (shared by list + export).
  const backendQuery = useCallback(() => {
    const qs = new URLSearchParams()
    if (category) qs.set('category', category)
    if (serviceTypeId) qs.set('serviceTypeId', serviceTypeId)
    if (employeeId) qs.set('employeeId', employeeId)
    if (priority) qs.set('priority', priority)
    if (dateFrom) qs.set('dateFrom', dateFrom)
    if (dateTo) qs.set('dateTo', dateTo)
    if (q) qs.set('q', q)
    return qs
  }, [category, serviceTypeId, employeeId, priority, dateFrom, dateTo, q])

  const load = useCallback(async () => {
    const qs = backendQuery()
    qs.set('page', String(page))
    qs.set('pageSize', String(PAGE_SIZE))
    const res = await apiFetch<ReportResponse>(`/reports?${qs.toString()}`)
    setData(res)
    setError(null)
  }, [backendQuery, page])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- setError fires only in the async catch, not synchronously
    load().catch((err: Error) => setError(err.message))
  }, [load])

  useEffect(() => {
    apiFetch<{ services: Service[] }>('/services')
      .then((res) => setServices(res.services))
      .catch(() => {})
    // pageSize 100 = the API max; fine at this project's employee count.
    apiFetch<{ employees: EmployeeOption[] }>('/employees?pageSize=100')
      .then((res) => setEmployees(res.employees))
      .catch(() => {})
  }, [])

  const [prevQ, setPrevQ] = useState(q)
  if (prevQ !== q) {
    setPrevQ(q)
    setSearch(q)
  }
  useEffect(() => {
    if (search === q) return
    const t = setTimeout(() => setFilter('q', search), 350)
    return () => clearTimeout(t)
  }, [search, q, setFilter])

  // CSV export needs the Authorization header, so it can't be a plain link —
  // fetch the blob and trigger a download.
  async function exportCsv() {
    setExporting(true)
    try {
      const res = await fetch(`/api/v1/reports/export.csv?${backendQuery().toString()}`, {
        headers: { Authorization: `Bearer ${getToken() ?? ''}` },
      })
      if (!res.ok) throw new Error(`Export failed (${res.status})`)
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'requests.csv'
      a.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setExporting(false)
    }
  }

  const pages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1
  const agg = data?.aggregates

  return (
    <div className="req">
      <header className="req-head">
        <h1>Reports</h1>
        {data && (
          <p className="req-meta">
            {data.total} request{data.total === 1 ? '' : 's'}
            {hasFilters && ' matching'}
          </p>
        )}
        <button
          type="button"
          className="req-retry emp-add"
          onClick={exportCsv}
          disabled={exporting || !data || data.total === 0}
        >
          {exporting ? 'Exporting…' : 'Export CSV'}
        </button>
      </header>

      <div className="req-filters">
        <div className="chip-row" role="group" aria-label="Filter by workflow category">
          <button type="button" className="chip" aria-pressed={category === ''} onClick={() => setFilter('category', '')}>
            All
          </button>
          {CATEGORIES.map((c) => (
            <button
              key={c}
              type="button"
              className={`chip is-${c}`}
              aria-pressed={category === c}
              onClick={() => setFilter('category', category === c ? '' : c)}
            >
              <i className="chip-dot" aria-hidden="true" />
              {CATEGORY_LABEL[c]}
            </button>
          ))}
        </div>
        <div className="control-row">
          <input
            type="search"
            className="req-search"
            placeholder="Search requester or service…"
            aria-label="Search by requester or service name"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <select className="req-select" aria-label="Filter by service type" value={serviceTypeId} onChange={(e) => setFilter('service', e.target.value)}>
            <option value="">All services</option>
            {services.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <select className="req-select" aria-label="Filter by employee" value={employeeId} onChange={(e) => setFilter('employee', e.target.value)}>
            <option value="">All employees</option>
            {employees.map((emp) => (
              <option key={emp.id} value={emp.id}>
                {emp.name}
                {emp.isActive ? '' : ' (inactive)'}
              </option>
            ))}
          </select>
          <select className="req-select" aria-label="Filter by priority" value={priority} onChange={(e) => setFilter('priority', e.target.value)}>
            <option value="">Any priority</option>
            {PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {PRIORITY_LABEL[p]}
              </option>
            ))}
          </select>
          <label className="date-field">
            <span>From</span>
            <input type="date" className="req-select" value={dateFrom} max={dateTo || undefined} onChange={(e) => setFilter('dateFrom', e.target.value)} />
          </label>
          <label className="date-field">
            <span>To</span>
            <input type="date" className="req-select" value={dateTo} min={dateFrom || undefined} onChange={(e) => setFilter('dateTo', e.target.value)} />
          </label>
          {hasFilters && (
            <button type="button" className="req-clear" onClick={clearFilters}>
              Clear filters
            </button>
          )}
        </div>
      </div>

      {error ? (
        <div className="req-status">
          <p className="req-status-msg">Couldn’t load reports: {error}</p>
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
      ) : !data || !agg ? (
        <div className="req-skeleton" aria-busy="true">
          <span className="visually-hidden">Loading reports…</span>
          {Array.from({ length: 6 }, (_, i) => (
            <div className="skel-row" aria-hidden="true" key={i} />
          ))}
        </div>
      ) : (
        <>
          <section className="rep-cards" aria-label="Summary">
            <div className="rep-card rep-card-total">
              <span className="rep-card-num">{agg.total}</span>
              <span className="rep-card-label">Total requests</span>
            </div>
            <div className="rep-card">
              <h3>By category</h3>
              <ul className="rep-breakdown">
                {CATEGORIES.filter((c) => agg.byCategory[c]).map((c) => (
                  <li key={c}>
                    <span className={`status-pill is-${c}`}>
                      <i className="pill-dot" aria-hidden="true" />
                      {CATEGORY_LABEL[c]}
                    </span>
                    <b>{agg.byCategory[c]}</b>
                  </li>
                ))}
                {Object.keys(agg.byCategory).length === 0 && <li className="rep-none">No data</li>}
              </ul>
            </div>
            <div className="rep-card">
              <h3>By priority</h3>
              <ul className="rep-breakdown">
                {PRIORITIES.filter((p) => agg.byPriority[p]).map((p) => (
                  <li key={p}>
                    <span className={`req-priority is-${p}`}>{PRIORITY_LABEL[p]}</span>
                    <b>{agg.byPriority[p]}</b>
                  </li>
                ))}
                {Object.keys(agg.byPriority).length === 0 && <li className="rep-none">No data</li>}
              </ul>
            </div>
            <div className="rep-card">
              <h3>By service</h3>
              <ul className="rep-breakdown">
                {Object.entries(agg.byService).map(([name, n]) => (
                  <li key={name}>
                    <span className="rep-service-name">{name}</span>
                    <b>{n}</b>
                  </li>
                ))}
                {Object.keys(agg.byService).length === 0 && <li className="rep-none">No data</li>}
              </ul>
            </div>
          </section>

          {data.requests.length === 0 ? (
            <div className="req-empty">
              <h2>No matching requests</h2>
              <p>Nothing matches these filters. Loosen or clear them to see more.</p>
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
                      <th scope="col" className="req-id">
                        ID
                      </th>
                      <th scope="col">Service</th>
                      <th scope="col">Requester</th>
                      <th scope="col">Status</th>
                      <th scope="col" className="req-priority">
                        Priority
                      </th>
                      <th scope="col" className="req-when">
                        Created
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.requests.map((r) => (
                      <tr key={r.id}>
                        <td className="req-id">#{r.id}</td>
                        <td className="req-service">{r.serviceTypeName}</td>
                        <td>{r.requester.name}</td>
                        <td>
                          <span className={`status-pill${r.status.category ? ` is-${r.status.category}` : ''}`}>
                            <i className="pill-dot" aria-hidden="true" />
                            {r.status.label}
                          </span>
                        </td>
                        <td className={`req-priority is-${r.priority}`}>{PRIORITY_LABEL[r.priority] ?? r.priority}</td>
                        <td className="req-when">{formatDate(r.createdAt)}</td>
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
        </>
      )}
    </div>
  )
}

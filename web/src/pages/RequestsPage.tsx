import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { apiFetch } from '../lib/api'
import RequestDetailPane from './RequestDetailPane'
import './RequestsPage.css'

// Categories are the closed enum from CLAUDE.md Section 9 — the only workflow
// vocabulary application code may know. Raw status keys appear only as their
// seeded labels, resolved by the backend.
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
const POLL_MS = 30_000

interface RequestRow {
  id: number
  serviceTypeId: number
  serviceTypeName: string
  status: { key: string; label: string; category: Category | null }
  priority: string
  createdAt: string
  updatedAt: string
  requester: { id: number; name: string }
}

interface ListResponse {
  requests: RequestRow[]
  page: number
  pageSize: number
  total: number
}

interface Service {
  id: number
  name: string
  departmentId: number
}

function formatWhen(iso: string) {
  const d = new Date(iso)
  const now = new Date()
  if (d.toDateString() === now.toDateString()) {
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  }
  const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' }
  if (d.getFullYear() !== now.getFullYear()) opts.year = 'numeric'
  return d.toLocaleDateString(undefined, opts)
}

export default function RequestsPage() {
  const [params, setParams] = useSearchParams()
  const navigate = useNavigate()
  const { id: idParam } = useParams()
  const selectedId = idParam !== undefined && Number.isInteger(Number(idParam)) ? Number(idParam) : null
  const page = Math.max(1, Number(params.get('page')) || 1)
  const category = params.get('category') ?? ''
  const serviceTypeId = params.get('service') ?? ''
  const priority = params.get('priority') ?? ''
  const q = params.get('q') ?? ''
  const hasFilters = Boolean(category || serviceTypeId || priority || q)

  const [data, setData] = useState<ListResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null)
  const [services, setServices] = useState<Service[]>([])
  const [search, setSearch] = useState(q)

  const setFilter = useCallback(
    (key: string, value: string) => {
      const next = new URLSearchParams(params)
      if (value) next.set(key, value)
      else next.delete(key)
      next.delete('page') // a changed filter always restarts at page 1
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

  // Detail pane routing: /requests/:id, keeping the filter query string.
  function openDetail(id: number) {
    navigate(`/requests/${id}${params.toString() ? `?${params.toString()}` : ''}`)
  }
  const closeDetail = useCallback(() => {
    navigate(`/requests${params.toString() ? `?${params.toString()}` : ''}`)
  }, [navigate, params])

  const departmentIdOf = useCallback(
    (serviceTypeId: number) => services.find((s) => s.id === serviceTypeId)?.departmentId,
    [services],
  )

  const load = useCallback(async () => {
    const qs = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) })
    if (category) qs.set('category', category)
    if (serviceTypeId) qs.set('serviceTypeId', serviceTypeId)
    if (priority) qs.set('priority', priority)
    if (q) qs.set('q', q)
    const res = await apiFetch<ListResponse>(`/requests?${qs.toString()}`)
    setData(res)
    setUpdatedAt(new Date())
    setError(null)
  }, [page, category, serviceTypeId, priority, q])

  useEffect(() => {
    let cancelled = false
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-cycle flag; the data setStates land async in load()
    setRefreshing(true)
    load()
      .catch((err: Error) => {
        if (!cancelled) setError(err.message)
      })
      .finally(() => {
        if (!cancelled) setRefreshing(false)
      })
    // Polling, not WebSockets (CLAUDE.md Section 2). Silent refresh: a failed
    // poll keeps the last good data and simply tries again next tick.
    const timer = setInterval(() => {
      load().catch(() => {})
    }, POLL_MS)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [load])

  // Service names for the filter dropdown; if this fails the dropdown just
  // stays at "All services" — the list itself is unaffected.
  useEffect(() => {
    apiFetch<{ services: Service[] }>('/services')
      .then((res) => setServices(res.services))
      .catch(() => {})
  }, [])

  // Keep the search box in sync when q changes underneath it (back button,
  // Clear filters) — the render-time adjustment pattern from the React docs,
  // which never fires mid-keystroke because q only moves after the debounce.
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

  const pages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1

  return (
    <div className="req">
      <header className="req-head">
        <h1>Requests</h1>
        {data && (
          <p className="req-meta">
            {data.total} request{data.total === 1 ? '' : 's'}
            {hasFilters && ' matching'}
            {updatedAt && (
              <>
                {' '}
                · updated {updatedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </>
            )}
          </p>
        )}
      </header>

      <div className="req-filters">
        <div className="chip-row" role="group" aria-label="Filter by workflow category">
          <button
            type="button"
            className="chip"
            aria-pressed={category === ''}
            onClick={() => setFilter('category', '')}
          >
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
          <select
            className="req-select"
            aria-label="Filter by service type"
            value={serviceTypeId}
            onChange={(e) => setFilter('service', e.target.value)}
          >
            <option value="">All services</option>
            {services.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <select
            className="req-select"
            aria-label="Filter by priority"
            value={priority}
            onChange={(e) => setFilter('priority', e.target.value)}
          >
            <option value="">Any priority</option>
            {PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {PRIORITY_LABEL[p]}
              </option>
            ))}
          </select>
          {hasFilters && (
            <button type="button" className="req-clear" onClick={clearFilters}>
              Clear filters
            </button>
          )}
        </div>
      </div>

      <div className={`req-body${selectedId !== null ? ' is-split' : ''}`}>
        <div className="req-main">
      {error ? (
        <div className="req-status">
          <p className="req-status-msg">Couldn’t load requests: {error}</p>
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
          <span className="visually-hidden">Loading requests…</span>
          {Array.from({ length: 8 }, (_, i) => (
            <div className="skel-row" aria-hidden="true" key={i} />
          ))}
        </div>
      ) : data.requests.length === 0 ? (
        hasFilters ? (
          <div className="req-empty">
            <h2>No matching requests</h2>
            <p>Nothing on the board matches these filters. Loosen or clear them to see more.</p>
            <button type="button" className="req-retry" onClick={clearFilters}>
              Clear filters
            </button>
          </div>
        ) : (
          <div className="req-empty">
            <h2>The board is clear</h2>
            <p>
              Requests appear here the moment users submit them, newest first, with their current
              workflow status. Filters above narrow the board by category, service, or priority.
            </p>
          </div>
        )
      ) : (
        <>
          <div className={`req-tablewrap${refreshing ? ' is-refreshing' : ''}`}>
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
                  <tr
                    key={r.id}
                    className={r.id === selectedId ? 'is-selected' : undefined}
                    onClick={() => openDetail(r.id)}
                  >
                    <td className="req-id">#{r.id}</td>
                    <td className="req-service">
                      <button
                        type="button"
                        className="req-open"
                        onClick={(e) => {
                          e.stopPropagation()
                          openDetail(r.id)
                        }}
                        aria-current={r.id === selectedId ? 'true' : undefined}
                      >
                        {r.serviceTypeName}
                      </button>
                    </td>
                    <td>{r.requester.name}</td>
                    <td>
                      <span className={`status-pill${r.status.category ? ` is-${r.status.category}` : ''}`}>
                        <i className="pill-dot" aria-hidden="true" />
                        {r.status.label}
                      </span>
                    </td>
                    <td className={`req-priority is-${r.priority}`}>
                      {PRIORITY_LABEL[r.priority] ?? r.priority}
                    </td>
                    <td className="req-when">{formatWhen(r.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {data.total > PAGE_SIZE && (
            <nav className="req-pager" aria-label="Pagination">
              <span className="req-pager-info">
                {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, data.total)} of{' '}
                {data.total}
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
        {selectedId !== null && (
          <RequestDetailPane
            id={selectedId}
            departmentIdOf={departmentIdOf}
            onClose={closeDetail}
            onChanged={() => load().catch(() => {})}
          />
        )}
      </div>
    </div>
  )
}

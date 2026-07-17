import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { apiFetch, getToken } from '../lib/api'
import { useI18n, type Loc } from '../i18n'
import Donut from '../components/Donut'
import './RequestsPage.css'
import './ReportsPage.css'

// Basic Reports (CLAUDE.md Section 4). Monitor-only. Same filters as Requests
// (the backend reuses the one query engine), plus aggregate cards and a CSV
// export of the current filter set.

const STATES = ['open', 'closed'] as const
const PRIORITIES = ['high', 'medium', 'low'] as const
const PAGE_SIZE = 20

interface ReportRow {
  id: number
  serviceTypeName: Loc
  status: { key: string; label: Loc; isTerminal: boolean }
  priority: string
  createdAt: string
  requester: { id: number; name: string }
}
interface Aggregates {
  total: number
  byState: Record<string, number>
  byPriority: Record<string, number>
  // byService is keyed by the English service name (backend resolves it) — a
  // documented Phase-3 gap: these keys stay English even in the Arabic view.
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
  name: Loc
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
  const { t, L } = useI18n()
  const [params, setParams] = useSearchParams()
  const page = Math.max(1, Number(params.get('page')) || 1)
  const state = params.get('state') ?? ''
  const serviceTypeId = params.get('service') ?? ''
  const employeeId = params.get('employee') ?? ''
  const priority = params.get('priority') ?? ''
  const dateFrom = params.get('dateFrom') ?? ''
  const dateTo = params.get('dateTo') ?? ''
  const q = params.get('q') ?? ''
  const hasFilters = Boolean(state || serviceTypeId || employeeId || priority || dateFrom || dateTo || q)

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
    if (state) qs.set('state', state)
    if (serviceTypeId) qs.set('serviceTypeId', serviceTypeId)
    if (employeeId) qs.set('employeeId', employeeId)
    if (priority) qs.set('priority', priority)
    if (dateFrom) qs.set('dateFrom', dateFrom)
    if (dateTo) qs.set('dateTo', dateTo)
    if (q) qs.set('q', q)
    return qs
  }, [state, serviceTypeId, employeeId, priority, dateFrom, dateTo, q])

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
    // owned=true → only services the signed-in monitor oversees (Gate 2), so the
    // filter never offers a service whose requests they can't see.
    apiFetch<{ services: Service[] }>('/services?owned=true')
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
    const tm = setTimeout(() => setFilter('q', search), 350)
    return () => clearTimeout(tm)
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

  // Human-readable summary of the active filters, printed in the PDF header.
  const filterSummary = [
    state && `${t('req_filter_state')}: ${t(`state_${state}`)}`,
    serviceTypeId && `${t('col_service')}: ${L(services.find((s) => String(s.id) === serviceTypeId)?.name)}`,
    employeeId && `${t('rep_filter_employee')}: ${employees.find((e) => String(e.id) === employeeId)?.name ?? ''}`,
    priority && `${t('col_priority')}: ${t(`pri_${priority}`)}`,
    dateFrom && `${t('rep_from')} ${dateFrom}`,
    dateTo && `${t('rep_to')} ${dateTo}`,
    q && `“${q}”`,
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <div className="req">
      <header className="req-head">
        <h1>{t('rep_title')}</h1>
        {data && (
          <p className="req-meta">
            {data.total} {data.total === 1 ? t('request_word') : t('requests_word')}
            {hasFilters && ` ${t('matching')}`}
          </p>
        )}
        <div className="rep-actions">
          <button
            type="button"
            className="req-retry emp-add rep-print-btn"
            onClick={() => window.print()}
            disabled={!data || data.total === 0}
          >
            {t('rep_export_pdf')}
          </button>
          <button
            type="button"
            className="req-retry emp-add"
            onClick={exportCsv}
            disabled={exporting || !data || data.total === 0}
          >
            {exporting ? t('rep_exporting') : t('rep_export')}
          </button>
        </div>
      </header>

      {/* Print-only header — the browser's Print → Save as PDF (feature 8) uses
          the on-screen charts + summary + table (feature 9). Chrome, filters and
          buttons are hidden by the @media print rules in ReportsPage.css. */}
      <div className="rep-print-head" aria-hidden="true">
        <h2>{t('rep_title')}</h2>
        <p>
          {t('rep_generated')}: {new Date().toLocaleString()}
          {' · '}
          {t('rep_filters_applied')}: {hasFilters ? filterSummary : t('rep_filters_none')}
        </p>
      </div>

      <div className="req-filters">
        <div className="chip-row" role="group" aria-label={t('req_filter_state')}>
          <button type="button" className="chip" aria-pressed={state === ''} onClick={() => setFilter('state', '')}>
            {t('all')}
          </button>
          {STATES.map((s) => (
            <button
              key={s}
              type="button"
              className={`chip is-${s}`}
              aria-pressed={state === s}
              onClick={() => setFilter('state', state === s ? '' : s)}
            >
              <i className="chip-dot" aria-hidden="true" />
              {t(`state_${s}`)}
            </button>
          ))}
        </div>
        <div className="control-row">
          <input
            type="search"
            className="req-search"
            placeholder={t('req_search_ph')}
            aria-label={t('req_search_aria')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <select className="req-select" aria-label={t('req_filter_service')} value={serviceTypeId} onChange={(e) => setFilter('service', e.target.value)}>
            <option value="">{t('req_all_services')}</option>
            {services.map((s) => (
              <option key={s.id} value={s.id}>
                {L(s.name)}
              </option>
            ))}
          </select>
          <select className="req-select" aria-label={t('rep_filter_employee')} value={employeeId} onChange={(e) => setFilter('employee', e.target.value)}>
            <option value="">{t('req_all_employees')}</option>
            {employees.map((emp) => (
              <option key={emp.id} value={emp.id}>
                {emp.name}
                {emp.isActive ? '' : ` ${t('rep_inactive_suffix')}`}
              </option>
            ))}
          </select>
          <select className="req-select" aria-label={t('req_filter_priority')} value={priority} onChange={(e) => setFilter('priority', e.target.value)}>
            <option value="">{t('req_any_priority')}</option>
            {PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {t(`pri_${p}`)}
              </option>
            ))}
          </select>
          <label className="date-field">
            <span>{t('rep_from')}</span>
            <input type="date" className="req-select" value={dateFrom} max={dateTo || undefined} onChange={(e) => setFilter('dateFrom', e.target.value)} />
          </label>
          <label className="date-field">
            <span>{t('rep_to')}</span>
            <input type="date" className="req-select" value={dateTo} min={dateFrom || undefined} onChange={(e) => setFilter('dateTo', e.target.value)} />
          </label>
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
            {t('rep_load_err')} {error}
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
      ) : !data || !agg ? (
        <div className="req-skeleton" aria-busy="true">
          <span className="visually-hidden">{t('rep_loading')}</span>
          {Array.from({ length: 6 }, (_, i) => (
            <div className="skel-row" aria-hidden="true" key={i} />
          ))}
        </div>
      ) : (
        <>
          <section className="rep-cards" aria-label={t('rep_summary')}>
            <div className="rep-card rep-card-total">
              <span className="rep-card-num">{agg.total}</span>
              <span className="rep-card-label">{t('rep_total_requests')}</span>
            </div>
            <div className="rep-card">
              <h3>{t('rep_by_state')}</h3>
              <ul className="rep-breakdown">
                {STATES.filter((s) => agg.byState[s]).map((s) => (
                  <li key={s}>
                    <span className={`status-pill is-${s}`}>
                      <i className="pill-dot" aria-hidden="true" />
                      {t(`state_${s}`)}
                    </span>
                    <b>{agg.byState[s]}</b>
                  </li>
                ))}
                {STATES.every((s) => !agg.byState[s]) && <li className="rep-none">{t('no_data')}</li>}
              </ul>
            </div>
            <div className="rep-card">
              <h3>{t('rep_by_priority')}</h3>
              <ul className="rep-breakdown">
                {PRIORITIES.filter((p) => agg.byPriority[p]).map((p) => (
                  <li key={p}>
                    <span className={`req-priority is-${p}`}>{t(`pri_${p}`)}</span>
                    <b>{agg.byPriority[p]}</b>
                  </li>
                ))}
                {Object.keys(agg.byPriority).length === 0 && <li className="rep-none">{t('no_data')}</li>}
              </ul>
            </div>
            <div className="rep-card">
              <h3>{t('rep_by_service')}</h3>
              <ul className="rep-breakdown">
                {Object.entries(agg.byService).map(([name, n]) => (
                  <li key={name}>
                    <span className="rep-service-name">{name}</span>
                    <b>{n}</b>
                  </li>
                ))}
                {Object.keys(agg.byService).length === 0 && <li className="rep-none">{t('no_data')}</li>}
              </ul>
            </div>
          </section>

          {agg.total > 0 && (
            <section className="rep-charts" aria-label={t('rep_summary')}>
              <div className="rep-chart-card">
                <h3>{t('rep_by_state')}</h3>
                <Donut
                  title={t('rep_by_state')}
                  slices={STATES.map((s) => ({ key: s, label: t(`state_${s}`), value: agg.byState[s] || 0 }))}
                />
              </div>
              <div className="rep-chart-card">
                <h3>{t('rep_by_priority')}</h3>
                <Donut
                  title={t('rep_by_priority')}
                  slices={PRIORITIES.map((p) => ({ key: p, label: t(`pri_${p}`), value: agg.byPriority[p] || 0 }))}
                />
              </div>
              <div className="rep-chart-card">
                <h3>{t('rep_by_service')}</h3>
                <Donut
                  title={t('rep_by_service')}
                  slices={Object.entries(agg.byService).map(([name, n]) => ({ key: name, label: name, value: n }))}
                />
              </div>
            </section>
          )}

          {data.requests.length === 0 ? (
            <div className="req-empty">
              <h2>{t('rep_no_match_h')}</h2>
              <p>{t('rep_no_match_p')}</p>
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
                      <th scope="col" className="req-id">
                        {t('col_id')}
                      </th>
                      <th scope="col">{t('col_service')}</th>
                      <th scope="col">{t('col_requester')}</th>
                      <th scope="col">{t('col_status')}</th>
                      <th scope="col" className="req-priority">
                        {t('col_priority')}
                      </th>
                      <th scope="col" className="req-when">
                        {t('col_created')}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.requests.map((r) => (
                      <tr key={r.id}>
                        <td className="req-id">#{r.id}</td>
                        <td className="req-service">{L(r.serviceTypeName)}</td>
                        <td>{r.requester.name}</td>
                        <td>
                          <span className={`status-pill is-${r.status.isTerminal ? 'closed' : 'open'}`}>
                            <i className="pill-dot" aria-hidden="true" />
                            {L(r.status.label)}
                          </span>
                        </td>
                        <td className={`req-priority is-${r.priority}`}>{t(`pri_${r.priority}`)}</td>
                        <td className="req-when">{formatDate(r.createdAt)}</td>
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
        </>
      )}
    </div>
  )
}

import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { apiFetch } from '../lib/api'
import { useI18n, type Loc } from '../i18n'
import './RequestsPage.css'
import './EmployeesPage.css'

// Company directory (communication feature group, onboarding wizard). Unlike
// Employees Management, this is read-only and deliberately company-wide, not
// subtree- or capability-scoped beyond "can reach the console at all" — see
// GET /directory's comment for why.

const PAGE_SIZE = 20

interface DirectoryEntry {
  id: number
  name: string
  phone: string | null
  email: string | null
  isYou: boolean
  departmentName: Loc | null
  branchName: Loc | null
  levelName: Loc | null
}
interface ListResponse {
  directory: DirectoryEntry[]
  page: number
  pageSize: number
  total: number
}
interface Branch {
  id: number
  name: Loc
}

export default function DirectoryPage() {
  const { t, L } = useI18n()
  const [params, setParams] = useSearchParams()
  const page = Math.max(1, Number(params.get('page')) || 1)
  const branchId = params.get('branch') ?? ''
  const q = params.get('q') ?? ''
  const hasFilters = Boolean(branchId || q)

  const [data, setData] = useState<ListResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [branches, setBranches] = useState<Branch[]>([])
  const [search, setSearch] = useState(q)

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

  const load = useCallback(async () => {
    const qs = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) })
    if (branchId) qs.set('branchId', branchId)
    if (q) qs.set('q', q)
    const res = await apiFetch<ListResponse>(`/directory?${qs.toString()}`)
    setData(res)
    setError(null)
  }, [page, branchId, q])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- setError fires only in the async catch, not synchronously
    load().catch((err: Error) => setError(err.message))
  }, [load])

  useEffect(() => {
    apiFetch<{ branches: Branch[] }>('/branches')
      .then((res) => setBranches(res.branches))
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

  const pages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1

  return (
    <div className="req">
      <header className="req-head">
        <h1>{t('dir_title')}</h1>
        {data && (
          <p className="req-meta">
            {data.total} {data.total === 1 ? t('employee_word') : t('employees_word')}
            {hasFilters && ` ${t('matching')}`}
          </p>
        )}
      </header>

      <div className="req-filters">
        <div className="control-row">
          <input
            type="search"
            className="req-search"
            placeholder={t('dir_search_ph')}
            aria-label={t('dir_search_aria')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <select
            className="req-select"
            aria-label={t('col_branch')}
            value={branchId}
            onChange={(e) => setFilter('branch', e.target.value)}
          >
            <option value="">{t('dir_all_branches')}</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {L(b.name)}
              </option>
            ))}
          </select>
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
            {t('dir_load_err')} {error}
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
          <span className="visually-hidden">{t('dir_loading')}</span>
          {Array.from({ length: 6 }, (_, i) => (
            <div className="skel-row" aria-hidden="true" key={i} />
          ))}
        </div>
      ) : data.directory.length === 0 ? (
        <div className="req-empty">
          <h2>{hasFilters ? t('dir_no_match_h') : t('dir_none_h')}</h2>
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
                  <th scope="col">{t('col_name')}</th>
                  <th scope="col">{t('col_role')}</th>
                  <th scope="col">{t('col_department')}</th>
                  <th scope="col">{t('col_branch')}</th>
                  <th scope="col">{t('col_phone')}</th>
                  <th scope="col">{t('col_email')}</th>
                </tr>
              </thead>
              <tbody>
                {data.directory.map((entry) => (
                  <tr key={entry.id}>
                    <td className="req-service">
                      {entry.name}
                      {entry.isYou && <span className="emp-branch"> · {t('dir_you')}</span>}
                    </td>
                    <td>{entry.levelName ? L(entry.levelName) : '—'}</td>
                    <td>{entry.departmentName ? L(entry.departmentName) : '—'}</td>
                    <td>{entry.branchName ? L(entry.branchName) : '—'}</td>
                    <td>{entry.phone ?? '—'}</td>
                    <td className="emp-email">{entry.email ?? '—'}</td>
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

import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { apiFetch, ApiError } from '../lib/api'
import { useI18n, type Loc } from '../i18n'
import { formatDuration } from '../lib/format'
import './RequestsPage.css'
import './EmployeesPage.css'

// Employees Management (CLAUDE.md Section 4). Monitor-only CRUD over the Week 6
// employee endpoints. No polling — this is an admin surface, reloaded after
// each write (the request/task lists are the live-polled ones, Section 2).

const PAGE_SIZE = 20

interface Employee {
  id: number
  name: string
  email: string
  phone: string | null
  isActive: boolean
  departmentId: number
  departmentName: Loc
  // Avg minutes to resolve the requests this employee holds; null = none yet.
  avgResolutionMinutes: number | null
}
interface ListResponse {
  employees: Employee[]
  page: number
  pageSize: number
  total: number
}
interface Department {
  id: number
  name: Loc
}
type FieldErrors = Record<string, string>

function fieldErrorsOf(err: unknown): FieldErrors {
  if (err instanceof ApiError && err.body && typeof err.body === 'object') {
    const errors = (err.body as { errors?: unknown }).errors
    if (errors && typeof errors === 'object') return errors as FieldErrors
  }
  return {}
}

export default function EmployeesPage() {
  const { t, L } = useI18n()
  const [params, setParams] = useSearchParams()
  const page = Math.max(1, Number(params.get('page')) || 1)
  const departmentId = params.get('department') ?? ''
  const q = params.get('q') ?? ''
  const hasFilters = Boolean(departmentId || q)

  const [data, setData] = useState<ListResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [departments, setDepartments] = useState<Department[]>([])
  const [search, setSearch] = useState(q)

  // Which dialog is open, if any.
  const [dialog, setDialog] = useState<
    | { kind: 'create' }
    | { kind: 'edit'; employee: Employee }
    | { kind: 'deactivate'; employee: Employee }
    | { kind: 'reset'; employee: Employee }
    | { kind: 'summary'; employee: Employee }
    | null
  >(null)

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
    if (departmentId) qs.set('departmentId', departmentId)
    if (q) qs.set('q', q)
    const res = await apiFetch<ListResponse>(`/employees?${qs.toString()}`)
    setData(res)
    setError(null)
  }, [page, departmentId, q])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- setError fires only in the async catch, not synchronously
    load().catch((err: Error) => setError(err.message))
  }, [load])

  useEffect(() => {
    apiFetch<{ departments: Department[] }>('/departments')
      .then((res) => setDepartments(res.departments))
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

  function onDone() {
    setDialog(null)
    load().catch((err: Error) => setError(err.message))
  }

  return (
    <div className="req">
      <header className="req-head">
        <h1>{t('emp_title')}</h1>
        {data && (
          <p className="req-meta">
            {data.total} {data.total === 1 ? t('employee_word') : t('employees_word')}
            {hasFilters && ` ${t('matching')}`}
          </p>
        )}
        <button type="button" className="req-retry emp-add" onClick={() => setDialog({ kind: 'create' })}>
          {t('emp_add')}
        </button>
      </header>

      <div className="req-filters">
        <div className="control-row">
          <input
            type="search"
            className="req-search"
            placeholder={t('emp_search_ph')}
            aria-label={t('emp_search_aria')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <select
            className="req-select"
            aria-label={t('emp_filter_dept')}
            value={departmentId}
            onChange={(e) => setFilter('department', e.target.value)}
          >
            <option value="">{t('emp_all_depts')}</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>
                {L(d.name)}
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
            {t('emp_load_err')} {error}
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
          <span className="visually-hidden">{t('emp_loading')}</span>
          {Array.from({ length: 6 }, (_, i) => (
            <div className="skel-row" aria-hidden="true" key={i} />
          ))}
        </div>
      ) : data.employees.length === 0 ? (
        <div className="req-empty">
          <h2>{hasFilters ? t('emp_no_match_h') : t('emp_none_h')}</h2>
          <p>{hasFilters ? t('emp_loosen_p') : t('emp_add_first_p')}</p>
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
                  <th scope="col">{t('col_email')}</th>
                  <th scope="col">{t('col_department')}</th>
                  <th scope="col">{t('col_avg_resolution')}</th>
                  <th scope="col">{t('col_status')}</th>
                  <th scope="col" className="emp-actions-col">
                    {t('col_actions')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.employees.map((e) => (
                  <tr key={e.id}>
                    <td className="req-service">
                      <button
                        type="button"
                        className="link-button emp-name-link"
                        onClick={() => setDialog({ kind: 'summary', employee: e })}
                      >
                        {e.name}
                      </button>
                    </td>
                    <td className="emp-email">{e.email}</td>
                    <td>{L(e.departmentName)}</td>
                    <td>{formatDuration(e.avgResolutionMinutes, t)}</td>
                    <td>
                      <span className={`emp-badge${e.isActive ? ' is-active' : ' is-inactive'}`}>
                        {e.isActive ? t('emp_active') : t('emp_inactive')}
                      </span>
                    </td>
                    <td className="emp-actions">
                      <button type="button" className="action-btn" onClick={() => setDialog({ kind: 'edit', employee: e })}>
                        {t('emp_edit')}
                      </button>
                      {e.isActive ? (
                        <button
                          type="button"
                          className="action-btn is-danger"
                          onClick={() => setDialog({ kind: 'deactivate', employee: e })}
                        >
                          {t('emp_deactivate')}
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="action-btn"
                          onClick={() =>
                            apiFetch(`/employees/${e.id}/activate`, { method: 'PATCH' })
                              .then(onDone)
                              .catch((err: Error) => setError(err.message))
                          }
                        >
                          {t('emp_activate')}
                        </button>
                      )}
                      <button type="button" className="action-btn" onClick={() => setDialog({ kind: 'reset', employee: e })}>
                        {t('emp_reset_password')}
                      </button>
                    </td>
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

      {dialog?.kind === 'create' && (
        <EmployeeForm departments={departments} onClose={() => setDialog(null)} onDone={onDone} />
      )}
      {dialog?.kind === 'edit' && (
        <EmployeeForm departments={departments} employee={dialog.employee} onClose={() => setDialog(null)} onDone={onDone} />
      )}
      {dialog?.kind === 'deactivate' && (
        <DeactivateDialog employee={dialog.employee} onClose={() => setDialog(null)} onDone={onDone} />
      )}
      {dialog?.kind === 'reset' && (
        <ResetPasswordDialog employee={dialog.employee} onClose={() => setDialog(null)} />
      )}
      {dialog?.kind === 'summary' && (
        <EmployeeSummaryDialog employee={dialog.employee} onClose={() => setDialog(null)} />
      )}
    </div>
  )
}

// Create (no employee) or edit (employee given). Create sends the initial
// password; edit changes name/phone/department only.
function EmployeeForm({
  departments,
  employee,
  onClose,
  onDone,
}: {
  departments: Department[]
  employee?: Employee
  onClose: () => void
  onDone: () => void
}) {
  const { t, L } = useI18n()
  const isEdit = !!employee
  const [name, setName] = useState(employee?.name ?? '')
  const [email, setEmail] = useState(employee?.email ?? '')
  const [password, setPassword] = useState('')
  const [phone, setPhone] = useState(employee?.phone ?? '')
  const [depId, setDepId] = useState(String(employee?.departmentId ?? departments[0]?.id ?? ''))
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
      if (isEdit) {
        await apiFetch(`/employees/${employee!.id}`, {
          method: 'PATCH',
          body: { name, phone: phone || null, departmentId: Number(depId) },
        })
      } else {
        await apiFetch('/employees', {
          method: 'POST',
          body: { name, email, password, phone: phone || null, departmentId: Number(depId) },
        })
      }
      onDone()
    } catch (err) {
      const fe = fieldErrorsOf(err)
      if (Object.keys(fe).length) setErrors(fe)
      else setErrors({ _: (err as Error).message })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <form className="dialog" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <h4>{isEdit ? t('emp_edit_h') : t('emp_add')}</h4>
        <label className="field">
          <span>{t('emp_name')}</span>
          <input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          {errors.name && <em className="field-err">{errors.name}</em>}
        </label>
        {!isEdit && (
          <>
            <label className="field">
              <span>{t('emp_email')}</span>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
              {errors.email && <em className="field-err">{errors.email}</em>}
            </label>
            <label className="field">
              <span>{t('emp_initial_password')}</span>
              <input type="text" value={password} onChange={(e) => setPassword(e.target.value)} />
              {errors.password && <em className="field-err">{errors.password}</em>}
            </label>
          </>
        )}
        <label className="field">
          <span>{t('emp_phone_optional')}</span>
          <input value={phone ?? ''} onChange={(e) => setPhone(e.target.value)} />
          {errors.phone && <em className="field-err">{errors.phone}</em>}
        </label>
        <label className="field">
          <span>{t('emp_department')}</span>
          <select className="req-select" value={depId} onChange={(e) => setDepId(e.target.value)}>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>
                {L(d.name)}
              </option>
            ))}
          </select>
          {errors.departmentId && <em className="field-err">{errors.departmentId}</em>}
        </label>
        {errors._ && <p className="assign-error">{errors._}</p>}
        <div className="dialog-actions">
          <button type="button" className="detail-close-text" onClick={onClose}>
            {t('cancel')}
          </button>
          <button type="submit" className="req-retry" disabled={busy}>
            {isEdit ? t('emp_save_changes') : t('emp_create')}
          </button>
        </div>
      </form>
    </div>
  )
}

function DeactivateDialog({ employee, onClose, onDone }: { employee: Employee; onClose: () => void; onDone: () => void }) {
  const { t } = useI18n()
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
      await apiFetch(`/employees/${employee.id}/deactivate`, { method: 'PATCH' })
      onDone()
    } catch (err) {
      // 409 = the employee still holds open tasks; reassign them first.
      setError(
        err instanceof ApiError && err.status === 409
          ? t('emp_deactivate_open_tasks')
          : (err as Error).message,
      )
      setBusy(false)
    }
  }

  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        <h4>
          {t('emp_deactivate_q_pre')} {employee.name}?
        </h4>
        <p className="req-status-msg">{t('emp_deactivate_warn')}</p>
        {error && <p className="assign-error">{error}</p>}
        <div className="dialog-actions">
          <button type="button" className="detail-close-text" onClick={onClose}>
            {t('cancel')}
          </button>
          <button type="button" className="req-retry is-danger" onClick={confirm} disabled={busy}>
            {t('emp_deactivate')}
          </button>
        </div>
      </div>
    </div>
  )
}

function ResetPasswordDialog({ employee, onClose }: { employee: Employee; onClose: () => void }) {
  const { t } = useI18n()
  const [temp, setTemp] = useState<string | null>(null)
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
      const res = await apiFetch<{ tempPassword: string }>(`/employees/${employee.id}/reset-password`, {
        method: 'PATCH',
      })
      setTemp(res.tempPassword)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        <h4>
          {t('emp_reset_q_pre')} {employee.name}?
        </h4>
        {temp ? (
          <>
            <p className="req-status-msg">{t('emp_temp_share')}</p>
            <code className="temp-pass">{temp}</code>
            <div className="dialog-actions">
              <button type="button" className="req-retry" onClick={onClose}>
                {t('done')}
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="req-status-msg">{t('emp_temp_will')}</p>
            {error && <p className="assign-error">{error}</p>}
            <div className="dialog-actions">
              <button type="button" className="detail-close-text" onClick={onClose}>
                {t('cancel')}
              </button>
              <button type="button" className="req-retry" onClick={confirm} disabled={busy}>
                {t('emp_reset_password')}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// Read-only workload summary: every task ever assigned to this employee,
// with open/closed counts. Data is the existing GET /employees/{id}/tasks —
// no new endpoint.
interface EmployeeTask {
  id: number
  requestId: number
  serviceTypeName: Loc
  status: { key: string; label: Loc; isTerminal: boolean }
  priority: string
  assignedAt: string
}

function EmployeeSummaryDialog({ employee, onClose }: { employee: Employee; onClose: () => void }) {
  const { t, L } = useI18n()
  const [tasks, setTasks] = useState<EmployeeTask[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  useEffect(() => {
    apiFetch<{ tasks: EmployeeTask[] }>(`/employees/${employee.id}/tasks`)
      .then((res) => setTasks(res.tasks))
      .catch((err: Error) => setError(err.message))
  }, [employee.id])

  const counts = new Map<string, number>()
  for (const tk of tasks ?? []) {
    const state = tk.status.isTerminal ? 'closed' : 'open'
    counts.set(state, (counts.get(state) ?? 0) + 1)
  }

  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div
        className="dialog emp-summary"
        role="dialog"
        aria-modal="true"
        aria-label={employee.name}
        onClick={(e) => e.stopPropagation()}
      >
        <h4>{employee.name}</h4>
        <p className="emp-summary-meta">
          {employee.email} · {L(employee.departmentName)} ·{' '}
          <span className={`emp-badge${employee.isActive ? ' is-active' : ' is-inactive'}`}>
            {employee.isActive ? t('emp_active') : t('emp_inactive')}
          </span>
        </p>

        {error ? (
          <p className="req-status-msg">
            {t('emp_tasks_load_err')} {error}
          </p>
        ) : !tasks ? (
          <p className="detail-empty">{t('emp_loading_tasks')}</p>
        ) : tasks.length === 0 ? (
          <p className="detail-empty">{t('emp_no_tasks')}</p>
        ) : (
          <>
            <p className="emp-summary-counts">
              {tasks.length} {tasks.length === 1 ? t('task_word') : t('tasks_word')}
              {[...counts.entries()].map(([state, n]) => (
                <span key={state} className={`status-pill is-${state}`}>
                  {n} {t(`state_${state}`)}
                </span>
              ))}
            </p>
            <div className="req-tablewrap emp-summary-tablewrap">
              <table className="req-table">
                <thead>
                  <tr>
                    <th scope="col">{t('col_request')}</th>
                    <th scope="col">{t('col_service')}</th>
                    <th scope="col">{t('col_status')}</th>
                    <th scope="col">{t('col_priority')}</th>
                    <th scope="col">{t('col_assigned')}</th>
                  </tr>
                </thead>
                <tbody>
                  {tasks.map((tk) => (
                    <tr key={tk.id}>
                      <td>#{tk.requestId}</td>
                      <td className="req-service">{L(tk.serviceTypeName)}</td>
                      <td>
                        <span className={`status-pill is-${tk.status.isTerminal ? 'closed' : 'open'}`}>
                          {L(tk.status.label)}
                        </span>
                      </td>
                      <td>{t(`pri_${tk.priority}`)}</td>
                      <td>{new Date(tk.assignedAt).toLocaleDateString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        <div className="dialog-actions">
          <button type="button" className="req-retry" onClick={onClose}>
            {t('close')}
          </button>
        </div>
      </div>
    </div>
  )
}

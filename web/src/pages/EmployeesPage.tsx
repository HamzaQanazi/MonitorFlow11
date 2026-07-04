import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { apiFetch, ApiError } from '../lib/api'
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
  departmentName: string
}
interface ListResponse {
  employees: Employee[]
  page: number
  pageSize: number
  total: number
}
interface Department {
  id: number
  name: string
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
    const t = setTimeout(() => setFilter('q', search), 350)
    return () => clearTimeout(t)
  }, [search, q, setFilter])

  const pages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1

  function onDone() {
    setDialog(null)
    load().catch((err: Error) => setError(err.message))
  }

  return (
    <div className="req">
      <header className="req-head">
        <h1>Employees</h1>
        {data && (
          <p className="req-meta">
            {data.total} employee{data.total === 1 ? '' : 's'}
            {hasFilters && ' matching'}
          </p>
        )}
        <button type="button" className="req-retry emp-add" onClick={() => setDialog({ kind: 'create' })}>
          Add employee
        </button>
      </header>

      <div className="req-filters">
        <div className="control-row">
          <input
            type="search"
            className="req-search"
            placeholder="Search name or email…"
            aria-label="Search by name or email"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <select
            className="req-select"
            aria-label="Filter by department"
            value={departmentId}
            onChange={(e) => setFilter('department', e.target.value)}
          >
            <option value="">All departments</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
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

      {error ? (
        <div className="req-status">
          <p className="req-status-msg">Couldn’t load employees: {error}</p>
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
          <span className="visually-hidden">Loading employees…</span>
          {Array.from({ length: 6 }, (_, i) => (
            <div className="skel-row" aria-hidden="true" key={i} />
          ))}
        </div>
      ) : data.employees.length === 0 ? (
        <div className="req-empty">
          <h2>{hasFilters ? 'No matching employees' : 'No employees yet'}</h2>
          <p>
            {hasFilters
              ? 'Loosen or clear the filters to see more.'
              : 'Add your first employee to start assigning requests to them.'}
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
                  <th scope="col">Name</th>
                  <th scope="col">Email</th>
                  <th scope="col">Department</th>
                  <th scope="col">Status</th>
                  <th scope="col" className="emp-actions-col">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.employees.map((e) => (
                  <tr key={e.id}>
                    <td className="req-service">{e.name}</td>
                    <td className="emp-email">{e.email}</td>
                    <td>{e.departmentName}</td>
                    <td>
                      <span className={`emp-badge${e.isActive ? ' is-active' : ' is-inactive'}`}>
                        {e.isActive ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="emp-actions">
                      <button type="button" className="action-btn" onClick={() => setDialog({ kind: 'edit', employee: e })}>
                        Edit
                      </button>
                      {e.isActive ? (
                        <button
                          type="button"
                          className="action-btn is-danger"
                          onClick={() => setDialog({ kind: 'deactivate', employee: e })}
                        >
                          Deactivate
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
                          Activate
                        </button>
                      )}
                      <button type="button" className="action-btn" onClick={() => setDialog({ kind: 'reset', employee: e })}>
                        Reset password
                      </button>
                    </td>
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
        <h4>{isEdit ? 'Edit employee' : 'Add employee'}</h4>
        <label className="field">
          <span>Name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          {errors.name && <em className="field-err">{errors.name}</em>}
        </label>
        {!isEdit && (
          <>
            <label className="field">
              <span>Email</span>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
              {errors.email && <em className="field-err">{errors.email}</em>}
            </label>
            <label className="field">
              <span>Initial password</span>
              <input type="text" value={password} onChange={(e) => setPassword(e.target.value)} />
              {errors.password && <em className="field-err">{errors.password}</em>}
            </label>
          </>
        )}
        <label className="field">
          <span>Phone (optional)</span>
          <input value={phone ?? ''} onChange={(e) => setPhone(e.target.value)} />
          {errors.phone && <em className="field-err">{errors.phone}</em>}
        </label>
        <label className="field">
          <span>Department</span>
          <select className="req-select" value={depId} onChange={(e) => setDepId(e.target.value)}>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
          {errors.departmentId && <em className="field-err">{errors.departmentId}</em>}
        </label>
        {errors._ && <p className="assign-error">{errors._}</p>}
        <div className="dialog-actions">
          <button type="button" className="detail-close-text" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="req-retry" disabled={busy}>
            {isEdit ? 'Save changes' : 'Create employee'}
          </button>
        </div>
      </form>
    </div>
  )
}

function DeactivateDialog({ employee, onClose, onDone }: { employee: Employee; onClose: () => void; onDone: () => void }) {
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
          ? 'This employee still has open tasks. Reassign them before deactivating.'
          : (err as Error).message,
      )
      setBusy(false)
    }
  }

  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        <h4>Deactivate {employee.name}?</h4>
        <p className="req-status-msg">
          They will be unable to log in and cannot be assigned new tasks. You can reactivate them
          later.
        </p>
        {error && <p className="assign-error">{error}</p>}
        <div className="dialog-actions">
          <button type="button" className="detail-close-text" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="req-retry is-danger" onClick={confirm} disabled={busy}>
            Deactivate
          </button>
        </div>
      </div>
    </div>
  )
}

function ResetPasswordDialog({ employee, onClose }: { employee: Employee; onClose: () => void }) {
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
        <h4>Reset password for {employee.name}?</h4>
        {temp ? (
          <>
            <p className="req-status-msg">
              Share this temporary password now — it is shown only once and cannot be retrieved
              again.
            </p>
            <code className="temp-pass">{temp}</code>
            <div className="dialog-actions">
              <button type="button" className="req-retry" onClick={onClose}>
                Done
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="req-status-msg">
              A new temporary password will be generated and shown once. The current password stops
              working immediately.
            </p>
            {error && <p className="assign-error">{error}</p>}
            <div className="dialog-actions">
              <button type="button" className="detail-close-text" onClick={onClose}>
                Cancel
              </button>
              <button type="button" className="req-retry" onClick={confirm} disabled={busy}>
                Reset password
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

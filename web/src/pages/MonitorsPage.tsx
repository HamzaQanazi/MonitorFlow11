import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { apiFetch, ApiError } from '../lib/api'
import './RequestsPage.css'
import './EmployeesPage.css'

// Monitors Management (spec v4 Section D, admin-only). A deliberate clone of
// Employees Management one level up — same list/dialog vocabulary, no
// department (monitors are org-wide). No polling; reload after each write.

const PAGE_SIZE = 20

interface Monitor {
  id: number
  name: string
  email: string
  phone: string | null
  isActive: boolean
  departmentId: number
  departmentName: string
}
interface ListResponse {
  monitors: Monitor[]
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

export default function MonitorsPage() {
  const [params, setParams] = useSearchParams()
  const page = Math.max(1, Number(params.get('page')) || 1)
  const q = params.get('q') ?? ''
  const hasFilters = Boolean(q)

  const [data, setData] = useState<ListResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [departments, setDepartments] = useState<Department[]>([])
  const [search, setSearch] = useState(q)

  useEffect(() => {
    apiFetch<{ departments: Department[] }>('/departments')
      .then((res) => setDepartments(res.departments))
      .catch(() => {})
  }, [])

  const [dialog, setDialog] = useState<
    | { kind: 'create' }
    | { kind: 'edit'; monitor: Monitor }
    | { kind: 'deactivate'; monitor: Monitor }
    | { kind: 'reset'; monitor: Monitor }
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
    if (q) qs.set('q', q)
    const res = await apiFetch<ListResponse>(`/monitors?${qs.toString()}`)
    setData(res)
    setError(null)
  }, [page, q])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- setError fires only in the async catch, not synchronously
    load().catch((err: Error) => setError(err.message))
  }, [load])

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
        <h1>Monitors</h1>
        {data && (
          <p className="req-meta">
            {data.total} monitor{data.total === 1 ? '' : 's'}
            {hasFilters && ' matching'}
          </p>
        )}
        <button type="button" className="req-retry emp-add" onClick={() => setDialog({ kind: 'create' })}>
          Add monitor
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
          {hasFilters && (
            <button type="button" className="req-clear" onClick={clearFilters}>
              Clear filters
            </button>
          )}
        </div>
      </div>

      {error ? (
        <div className="req-status">
          <p className="req-status-msg">Couldn’t load monitors: {error}</p>
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
          <span className="visually-hidden">Loading monitors…</span>
          {Array.from({ length: 4 }, (_, i) => (
            <div className="skel-row" aria-hidden="true" key={i} />
          ))}
        </div>
      ) : data.monitors.length === 0 ? (
        <div className="req-empty">
          <h2>{hasFilters ? 'No matching monitors' : 'No monitors yet'}</h2>
          <p>
            {hasFilters
              ? 'Loosen or clear the search to see more.'
              : 'Add the first monitor so operations can run the board.'}
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
                {data.monitors.map((m) => (
                  <tr key={m.id}>
                    <td className="req-service">{m.name}</td>
                    <td className="emp-email">{m.email}</td>
                    <td>{m.departmentName}</td>
                    <td>
                      <span className={`emp-badge${m.isActive ? ' is-active' : ' is-inactive'}`}>
                        {m.isActive ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="emp-actions">
                      <button type="button" className="action-btn" onClick={() => setDialog({ kind: 'edit', monitor: m })}>
                        Edit
                      </button>
                      {m.isActive ? (
                        <button
                          type="button"
                          className="action-btn is-danger"
                          onClick={() => setDialog({ kind: 'deactivate', monitor: m })}
                        >
                          Deactivate
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="action-btn"
                          onClick={() =>
                            apiFetch(`/monitors/${m.id}/activate`, { method: 'PATCH' })
                              .then(onDone)
                              .catch((err: Error) => setError(err.message))
                          }
                        >
                          Activate
                        </button>
                      )}
                      <button type="button" className="action-btn" onClick={() => setDialog({ kind: 'reset', monitor: m })}>
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
        <MonitorForm departments={departments} onClose={() => setDialog(null)} onDone={onDone} />
      )}
      {dialog?.kind === 'edit' && (
        <MonitorForm departments={departments} monitor={dialog.monitor} onClose={() => setDialog(null)} onDone={onDone} />
      )}
      {dialog?.kind === 'deactivate' && (
        <DeactivateDialog monitor={dialog.monitor} onClose={() => setDialog(null)} onDone={onDone} />
      )}
      {dialog?.kind === 'reset' && (
        <ResetPasswordDialog monitor={dialog.monitor} onClose={() => setDialog(null)} />
      )}
    </div>
  )
}

// Create (no monitor) or edit (monitor given). Create sends the initial
// password; edit changes name/phone/department. Spec v4: every monitor
// belongs to a department — the select is required on create.
function MonitorForm({
  departments,
  monitor,
  onClose,
  onDone,
}: {
  departments: Department[]
  monitor?: Monitor
  onClose: () => void
  onDone: () => void
}) {
  const isEdit = !!monitor
  const [name, setName] = useState(monitor?.name ?? '')
  const [email, setEmail] = useState(monitor?.email ?? '')
  const [password, setPassword] = useState('')
  const [phone, setPhone] = useState(monitor?.phone ?? '')
  const [depId, setDepId] = useState(String(monitor?.departmentId ?? departments[0]?.id ?? ''))
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
        await apiFetch(`/monitors/${monitor!.id}`, {
          method: 'PATCH',
          body: { name, phone: phone || null, departmentId: Number(depId) },
        })
      } else {
        await apiFetch('/monitors', {
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
        <h4>{isEdit ? 'Edit monitor' : 'Add monitor'}</h4>
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
            {isEdit ? 'Save changes' : 'Create monitor'}
          </button>
        </div>
      </form>
    </div>
  )
}

function DeactivateDialog({ monitor, onClose, onDone }: { monitor: Monitor; onClose: () => void; onDone: () => void }) {
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
      await apiFetch(`/monitors/${monitor.id}/deactivate`, { method: 'PATCH' })
      onDone()
    } catch (err) {
      // 409 = this is the last active monitor; operations would have no one.
      setError(
        err instanceof ApiError && err.status === 409
          ? 'This is the last active monitor. Activate or add another monitor first.'
          : (err as Error).message,
      )
      setBusy(false)
    }
  }

  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        <h4>Deactivate {monitor.name}?</h4>
        <p className="req-status-msg">
          They will be unable to log in or manage requests. You can reactivate them later.
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

function ResetPasswordDialog({ monitor, onClose }: { monitor: Monitor; onClose: () => void }) {
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
      const res = await apiFetch<{ tempPassword: string }>(`/monitors/${monitor.id}/reset-password`, {
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
        <h4>Reset password for {monitor.name}?</h4>
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

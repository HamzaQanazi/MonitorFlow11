import { useCallback, useEffect, useState } from 'react'
import { apiFetch, ApiError } from '../lib/api'
import { useI18n, type Loc } from '../i18n'
import './RequestsPage.css'
import './EmployeesPage.css'
import './DepartmentsPage.css'

// Departments (Owner-only). Create requires a head + at least one other
// employee (both get moved into the department, the other members also get
// manager_id = head — Gate 2). Rename and reassign-head are separate small
// writes; delete is refused (409) while any employee or service still
// references the department. See backend/src/routes/departments.js.

interface Department {
  id: number
  name: Loc
  headUserId: number | null
  headName: string | null
  memberCount: number
}
interface EmployeeOption {
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

export default function DepartmentsPage() {
  const { t, L } = useI18n()
  const [departments, setDepartments] = useState<Department[] | null>(null)
  const [employees, setEmployees] = useState<EmployeeOption[]>([])
  const [error, setError] = useState<string | null>(null)

  const [dialog, setDialog] = useState<
    | { kind: 'create' }
    | { kind: 'rename'; department: Department }
    | { kind: 'reassign'; department: Department }
    | { kind: 'delete'; department: Department }
    | null
  >(null)

  const load = useCallback(async () => {
    const [d, e] = await Promise.all([
      apiFetch<{ departments: Department[] }>('/departments'),
      apiFetch<{ employees: EmployeeOption[] }>('/employees?pageSize=100'),
    ])
    setDepartments(d.departments)
    setEmployees(e.employees)
    setError(null)
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- setError fires only in the async catch, not synchronously
    load().catch((err: Error) => setError(err.message))
  }, [load])

  function onDone() {
    setDialog(null)
    load().catch((err: Error) => setError(err.message))
  }

  return (
    <div className="req">
      <header className="req-head">
        <h1>{t('dept_title')}</h1>
        {departments && (
          <p className="req-meta">
            {departments.length} {departments.length === 1 ? t('department_word') : t('departments_word')}
          </p>
        )}
        <button type="button" className="req-retry emp-add" onClick={() => setDialog({ kind: 'create' })}>
          {t('dept_add')}
        </button>
      </header>

      {error ? (
        <div className="req-status">
          <p className="req-status-msg">
            {t('dept_load_err')} {error}
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
      ) : !departments ? (
        <div className="req-skeleton" aria-busy="true">
          <span className="visually-hidden">{t('dept_loading')}</span>
          {Array.from({ length: 4 }, (_, i) => (
            <div className="skel-row" aria-hidden="true" key={i} />
          ))}
        </div>
      ) : departments.length === 0 ? (
        <div className="req-empty">
          <h2>{t('dept_none_h')}</h2>
          <p>{t('dept_none_p')}</p>
        </div>
      ) : (
        <div className="req-tablewrap">
          <table className="req-table">
            <thead>
              <tr>
                <th scope="col">{t('col_name')}</th>
                <th scope="col">{t('col_head')}</th>
                <th scope="col">{t('col_members')}</th>
                <th scope="col" className="emp-actions-col">
                  {t('col_actions')}
                </th>
              </tr>
            </thead>
            <tbody>
              {departments.map((d) => (
                <tr key={d.id}>
                  <td className="req-service">{L(d.name)}</td>
                  <td>{d.headName ?? t('dept_no_head')}</td>
                  <td>{d.memberCount}</td>
                  <td className="emp-actions">
                    <button type="button" className="action-btn" onClick={() => setDialog({ kind: 'rename', department: d })}>
                      {t('dept_rename')}
                    </button>
                    <button type="button" className="action-btn" onClick={() => setDialog({ kind: 'reassign', department: d })}>
                      {t('dept_reassign_head')}
                    </button>
                    <button
                      type="button"
                      className="action-btn is-danger"
                      onClick={() => setDialog({ kind: 'delete', department: d })}
                    >
                      {t('dept_delete')}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {dialog?.kind === 'create' && (
        <DepartmentForm employees={employees} onClose={() => setDialog(null)} onDone={onDone} />
      )}
      {dialog?.kind === 'rename' && (
        <RenameDialog department={dialog.department} onClose={() => setDialog(null)} onDone={onDone} />
      )}
      {dialog?.kind === 'reassign' && (
        <ReassignHeadDialog department={dialog.department} employees={employees} onClose={() => setDialog(null)} onDone={onDone} />
      )}
      {dialog?.kind === 'delete' && (
        <DeleteDialog department={dialog.department} onClose={() => setDialog(null)} onDone={onDone} />
      )}
    </div>
  )
}

// Create: bilingual name + a head picker + a member checklist. Submit stays
// disabled until a head is picked and at least one other employee is ticked
// (server enforces the same rule — this just avoids a round trip for it).
function DepartmentForm({
  employees,
  onClose,
  onDone,
}: {
  employees: EmployeeOption[]
  onClose: () => void
  onDone: () => void
}) {
  const { t } = useI18n()
  const [nameEn, setNameEn] = useState('')
  const [nameAr, setNameAr] = useState('')
  const [headId, setHeadId] = useState('')
  const [memberIds, setMemberIds] = useState<Set<number>>(new Set())
  const [errors, setErrors] = useState<FieldErrors>({})
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  function toggleMember(id: number) {
    setMemberIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const canSubmit = nameEn.trim() && nameAr.trim() && headId && memberIds.size > 0

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setErrors({})
    try {
      await apiFetch('/departments', {
        method: 'POST',
        body: {
          name: { en: nameEn, ar: nameAr },
          headEmployeeId: Number(headId),
          memberEmployeeIds: [...memberIds],
        },
      })
      onDone()
    } catch (err) {
      const fe = fieldErrorsOf(err)
      setErrors(Object.keys(fe).length ? fe : { _: t('dept_err_save') })
      setBusy(false)
    }
  }

  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <form className="dialog" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <h4>{t('dept_create_h')}</h4>
        {errors._ && <p className="assign-error">{errors._}</p>}
        <label className="field">
          {t('dept_name_en')}
          <input value={nameEn} onChange={(e) => setNameEn(e.target.value)} required />
          {errors.name && <em className="field-err">{errors.name}</em>}
        </label>
        <label className="field">
          {t('dept_name_ar')}
          <input value={nameAr} onChange={(e) => setNameAr(e.target.value)} required dir="rtl" />
        </label>
        <label className="field">
          {t('dept_head_label')}
          <select value={headId} onChange={(e) => setHeadId(e.target.value)} required>
            <option value="">{t('dept_head_ph')}</option>
            {employees.map((emp) => (
              <option key={emp.id} value={emp.id} disabled={memberIds.has(emp.id)}>
                {emp.name}
              </option>
            ))}
          </select>
          {errors.headEmployeeId && <em className="field-err">{errors.headEmployeeId}</em>}
        </label>
        <div className="field">
          {t('dept_members_label')}
          <div className="dept-member-list">
            {employees
              .filter((emp) => String(emp.id) !== headId)
              .map((emp) => (
                <label key={emp.id} className="dept-member-row">
                  <input
                    type="checkbox"
                    checked={memberIds.has(emp.id)}
                    onChange={() => toggleMember(emp.id)}
                  />
                  {emp.name}
                </label>
              ))}
          </div>
          {errors.memberEmployeeIds && <em className="field-err">{errors.memberEmployeeIds}</em>}
        </div>
        <div className="dialog-actions">
          <button type="button" className="detail-close-text" onClick={onClose}>
            {t('cancel')}
          </button>
          <button type="submit" className="req-retry" disabled={busy || !canSubmit}>
            {t('dept_create')}
          </button>
        </div>
      </form>
    </div>
  )
}

function RenameDialog({
  department,
  onClose,
  onDone,
}: {
  department: Department
  onClose: () => void
  onDone: () => void
}) {
  const { t } = useI18n()
  const [nameEn, setNameEn] = useState(department.name.en)
  const [nameAr, setNameAr] = useState(department.name.ar)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await apiFetch(`/departments/${department.id}`, {
        method: 'PATCH',
        body: { name: { en: nameEn, ar: nameAr } },
      })
      onDone()
    } catch (err) {
      setError((err as Error).message)
      setBusy(false)
    }
  }

  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <form className="dialog" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <h4>{t('dept_rename_h')}</h4>
        {error && <p className="assign-error">{error}</p>}
        <label className="field">
          {t('dept_name_en')}
          <input value={nameEn} onChange={(e) => setNameEn(e.target.value)} required />
        </label>
        <label className="field">
          {t('dept_name_ar')}
          <input value={nameAr} onChange={(e) => setNameAr(e.target.value)} required dir="rtl" />
        </label>
        <div className="dialog-actions">
          <button type="button" className="detail-close-text" onClick={onClose}>
            {t('cancel')}
          </button>
          <button type="submit" className="req-retry" disabled={busy || !nameEn.trim() || !nameAr.trim()}>
            {t('save')}
          </button>
        </div>
      </form>
    </div>
  )
}

function ReassignHeadDialog({
  department,
  employees,
  onClose,
  onDone,
}: {
  department: Department
  employees: EmployeeOption[]
  onClose: () => void
  onDone: () => void
}) {
  const { t } = useI18n()
  const [headId, setHeadId] = useState(department.headUserId ? String(department.headUserId) : '')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await apiFetch(`/departments/${department.id}/head`, {
        method: 'PATCH',
        body: { headEmployeeId: Number(headId) },
      })
      onDone()
    } catch (err) {
      setError((err as Error).message)
      setBusy(false)
    }
  }

  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <form className="dialog" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <h4>{t('dept_reassign_head_h')}</h4>
        {error && <p className="assign-error">{error}</p>}
        <label className="field">
          {t('dept_head_label')}
          <select value={headId} onChange={(e) => setHeadId(e.target.value)} required>
            <option value="">{t('dept_head_ph')}</option>
            {employees.map((emp) => (
              <option key={emp.id} value={emp.id}>
                {emp.name}
              </option>
            ))}
          </select>
        </label>
        <div className="dialog-actions">
          <button type="button" className="detail-close-text" onClick={onClose}>
            {t('cancel')}
          </button>
          <button type="submit" className="req-retry" disabled={busy || !headId}>
            {t('save')}
          </button>
        </div>
      </form>
    </div>
  )
}

function DeleteDialog({
  department,
  onClose,
  onDone,
}: {
  department: Department
  onClose: () => void
  onDone: () => void
}) {
  const { t, L } = useI18n()
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
      await apiFetch(`/departments/${department.id}`, { method: 'DELETE' })
      onDone()
    } catch (err) {
      setError(err instanceof ApiError && err.status === 409 ? err.message : t('dept_err_delete'))
      setBusy(false)
    }
  }

  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        <h4>
          {t('dept_delete_q_pre')} {L(department.name)}?
        </h4>
        <p className="req-status-msg">{t('dept_delete_warn')}</p>
        {error && <p className="assign-error">{error}</p>}
        <div className="dialog-actions">
          <button type="button" className="detail-close-text" onClick={onClose}>
            {t('cancel')}
          </button>
          <button type="button" className="req-retry is-danger" onClick={confirm} disabled={busy}>
            {t('dept_delete')}
          </button>
        </div>
      </div>
    </div>
  )
}

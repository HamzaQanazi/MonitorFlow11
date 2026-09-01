import { useCallback, useEffect, useState } from 'react'
import { apiFetch, ApiError } from '../lib/api'
import { useI18n, type Loc } from '../i18n'
import { TranslateButton } from '../components/TranslateButton'
import './RequestsPage.css'
import './EmployeesPage.css'
import './DepartmentsPage.css'

// Departments (Owner-only). Create needs only a name + branch — a head and
// members are optional and can be added later. Gate 2 scope is flat
// department membership (re-scoped, user-directed: no more manager tree),
// so head_user_id is display metadata only. Rename and reassign-head are
// separate small writes; delete is refused (409) while any employee or
// service still references the department. See
// backend/src/routes/departments.js.

interface Department {
  id: number
  name: Loc
  headUserId: number | null
  headName: string | null
  branchId: number | null
  branchName: Loc | null
  memberCount: number
}
interface EmployeeOption {
  id: number
  name: string
  departmentId: number | null
  departmentName: Loc | null
}
interface BranchOption {
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

export default function DepartmentsPage() {
  const { t, L } = useI18n()
  const [departments, setDepartments] = useState<Department[] | null>(null)
  const [employees, setEmployees] = useState<EmployeeOption[]>([])
  const [branches, setBranches] = useState<BranchOption[]>([])
  const [error, setError] = useState<string | null>(null)

  const [dialog, setDialog] = useState<
    | { kind: 'create' }
    | { kind: 'rename'; department: Department }
    | { kind: 'reassign'; department: Department }
    | { kind: 'delete'; department: Department }
    | null
  >(null)

  const load = useCallback(async () => {
    const [d, e, b] = await Promise.all([
      apiFetch<{ departments: Department[] }>('/departments'),
      apiFetch<{ employees: EmployeeOption[] }>('/employees?pageSize=100'),
      apiFetch<{ branches: BranchOption[] }>('/branches'),
    ])
    setDepartments(d.departments)
    setEmployees(e.employees)
    setBranches(b.branches)
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
                <th scope="col">{t('col_branch')}</th>
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
                  <td>{d.branchName ? L(d.branchName) : t('dept_no_branch')}</td>
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
        <DepartmentForm employees={employees} branches={branches} onClose={() => setDialog(null)} onDone={onDone} />
      )}
      {dialog?.kind === 'rename' && (
        <RenameDialog department={dialog.department} branches={branches} onClose={() => setDialog(null)} onDone={onDone} />
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

// Create: bilingual name + branch are the only requirements — a head and
// employees are optional at creation (re-scoped, user-directed: an Owner can
// spin up an empty department and staff it later, either manually via
// Employees or through the CSV import's department column). The employee
// checklist below stays available for staffing it immediately, with a "Head"
// radio (only one at a time, only among checked rows) for picking a head
// alongside them. If any checked employee already belongs to a different
// department, a confirmation step lists exactly who's being moved before the
// write happens — user-directed, 2026-08-21: this used to silently reassign
// department_id/manager_id with no warning.
function DepartmentForm({
  employees,
  branches,
  onClose,
  onDone,
}: {
  employees: EmployeeOption[]
  branches: BranchOption[]
  onClose: () => void
  onDone: () => void
}) {
  const { t, L } = useI18n()
  const [nameEn, setNameEn] = useState('')
  const [nameAr, setNameAr] = useState('')
  const [branchId, setBranchId] = useState('')
  const [headId, setHeadId] = useState('')
  const [includedIds, setIncludedIds] = useState<Set<number>>(new Set())
  const [errors, setErrors] = useState<FieldErrors>({})
  const [busy, setBusy] = useState(false)
  const [confirmingMove, setConfirmingMove] = useState(false)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  function toggleIncluded(id: number) {
    setIncludedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
        if (headId === String(id)) setHeadId('')
      } else {
        next.add(id)
      }
      return next
    })
  }

  const otherMemberIds = [...includedIds].filter((id) => String(id) !== headId)
  const canSubmit = nameEn.trim() && nameAr.trim() && branchId
  const movedEmployees = employees.filter((emp) => includedIds.has(emp.id) && emp.departmentId != null)

  async function doCreate() {
    setBusy(true)
    setErrors({})
    try {
      await apiFetch('/departments', {
        method: 'POST',
        body: {
          name: { en: nameEn, ar: nameAr },
          branchId: Number(branchId),
          headEmployeeId: headId ? Number(headId) : null,
          memberEmployeeIds: otherMemberIds,
        },
      })
      onDone()
    } catch (err) {
      const fe = fieldErrorsOf(err)
      setErrors(Object.keys(fe).length ? fe : { _: t('dept_err_save') })
      setBusy(false)
      setConfirmingMove(false)
    }
  }

  function submit(e: React.FormEvent) {
    e.preventDefault()
    if (movedEmployees.length > 0 && !confirmingMove) {
      setConfirmingMove(true)
      return
    }
    doCreate()
  }

  if (confirmingMove) {
    return (
      <div className="dialog-backdrop" onClick={onClose}>
        <div className="dialog" onClick={(e) => e.stopPropagation()}>
          <h4>{t('dept_move_confirm_h')}</h4>
          <p className="req-status-msg">{t('dept_move_confirm_p')}</p>
          <ul className="dept-move-list">
            {movedEmployees.map((emp) => (
              <li key={emp.id}>
                {emp.name} — {emp.departmentName ? L(emp.departmentName) : ''}
              </li>
            ))}
          </ul>
          {errors._ && <p className="assign-error">{errors._}</p>}
          <div className="dialog-actions">
            <button type="button" className="detail-close-text" onClick={() => setConfirmingMove(false)} disabled={busy}>
              {t('dept_move_back')}
            </button>
            <button type="button" className="req-retry" onClick={doCreate} disabled={busy}>
              {busy ? t('tc_saving') : t('dept_move_confirm_btn')}
            </button>
          </div>
        </div>
      </div>
    )
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
        <TranslateButton en={nameEn} ar={nameAr} setEn={setNameEn} setAr={setNameAr} />
        <label className="field">
          {t('dept_branch_label')}
          <select value={branchId} onChange={(e) => setBranchId(e.target.value)} required>
            <option value="">{t('dept_branch_ph')}</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {L(b.name)}
              </option>
            ))}
          </select>
          {errors.branchId && <em className="field-err">{errors.branchId}</em>}
        </label>
        <div className="field">
          {t('dept_members_label')}
          <p className="field-hint">{t('dept_members_hint')}</p>
          <div className="dept-member-list">
            {employees.map((emp) => {
              const included = includedIds.has(emp.id)
              return (
                <div key={emp.id} className="dept-member-row">
                  <label className="dept-member-check">
                    <input type="checkbox" checked={included} onChange={() => toggleIncluded(emp.id)} />
                    {emp.name}
                    {emp.departmentName && (
                      <span className="dept-member-current">
                        {' — '}
                        {t('dept_currently_in')} {L(emp.departmentName)}
                      </span>
                    )}
                  </label>
                  {included && (
                    <label className="dept-head-radio">
                      <input
                        type="radio"
                        name="dept-head"
                        checked={headId === String(emp.id)}
                        onChange={() => setHeadId(String(emp.id))}
                      />
                      {t('dept_head_radio_label')}
                    </label>
                  )}
                </div>
              )
            })}
          </div>
          {errors.headEmployeeId && <em className="field-err">{errors.headEmployeeId}</em>}
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
  branches,
  onClose,
  onDone,
}: {
  department: Department
  branches: BranchOption[]
  onClose: () => void
  onDone: () => void
}) {
  const { t, L } = useI18n()
  const [nameEn, setNameEn] = useState(department.name.en)
  const [nameAr, setNameAr] = useState(department.name.ar)
  const [branchId, setBranchId] = useState(department.branchId ? String(department.branchId) : '')
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
        body: { name: { en: nameEn, ar: nameAr }, branchId: branchId ? Number(branchId) : undefined },
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
        <TranslateButton en={nameEn} ar={nameAr} setEn={setNameEn} setAr={setNameAr} />
        <label className="field">
          {t('dept_branch_label')}
          <select value={branchId} onChange={(e) => setBranchId(e.target.value)}>
            <option value="">{t('dept_branch_ph')}</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {L(b.name)}
              </option>
            ))}
          </select>
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
  const { t, L } = useI18n()
  const [headId, setHeadId] = useState(department.headUserId ? String(department.headUserId) : '')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirmingMove, setConfirmingMove] = useState(false)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // Same silent-move risk DepartmentForm's create flow was fixed for
  // (2026-08-21): PATCH /departments/{id}/head always runs with
  // moveIntoDepartment: true, so picking someone from a different department
  // pulls them out of it — this dialog never warned about that.
  const newHead = employees.find((emp) => String(emp.id) === headId)
  const movingFromOtherDept =
    newHead != null && newHead.departmentId != null && newHead.departmentId !== department.id ? newHead : null

  async function doReassign() {
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
      setConfirmingMove(false)
    }
  }

  function submit(e: React.FormEvent) {
    e.preventDefault()
    if (movingFromOtherDept && !confirmingMove) {
      setConfirmingMove(true)
      return
    }
    doReassign()
  }

  if (confirmingMove && movingFromOtherDept) {
    return (
      <div className="dialog-backdrop" onClick={onClose}>
        <div className="dialog" onClick={(e) => e.stopPropagation()}>
          <h4>{t('dept_move_confirm_h')}</h4>
          <p className="req-status-msg">{t('dept_move_confirm_p')}</p>
          <ul className="dept-move-list">
            <li>
              {movingFromOtherDept.name} —{' '}
              {movingFromOtherDept.departmentName ? L(movingFromOtherDept.departmentName) : ''}
            </li>
          </ul>
          {error && <p className="assign-error">{error}</p>}
          <div className="dialog-actions">
            <button type="button" className="detail-close-text" onClick={() => setConfirmingMove(false)} disabled={busy}>
              {t('dept_move_back')}
            </button>
            <button type="button" className="req-retry" onClick={doReassign} disabled={busy}>
              {busy ? t('tc_saving') : t('dept_move_confirm_btn')}
            </button>
          </div>
        </div>
      </div>
    )
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
                {emp.departmentId != null && emp.departmentId !== department.id && emp.departmentName
                  ? ` — ${t('dept_currently_in')} ${L(emp.departmentName)}`
                  : ''}
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

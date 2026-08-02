import { useEffect, useState } from 'react'
import { apiFetch, ApiError } from '../lib/api'
import { useI18n, type Loc } from '../i18n'
import './RequestsPage.css'
import './EmployeesPage.css'
import './AddServiceWizard.css'

// The "Add Service" builder (admin-only). This is the exact "visual Form
// Builder / Workflow Config UI" CLAUDE.md §3/§13 lists as deliberately not
// built — a conscious, flagged deviation, not an oversight. It writes through
// POST /services, which validates via the SAME formSchema.js/workflowSchema.js
// rules the seed script used to be the only caller of — nothing this UI lets
// you submit can pass client-side and fail server-side for a different reason
// than "you left something blank".
//
// UX pass: client-side per-step validation blocks "Next" instead of letting
// you sail through 5 steps blank and hit a wall of 13 raw validator strings
// at the end; a 422's errors are classified back to the step (and row, where
// the message names one) they came from instead of dumped as one blob on
// Review; every row input gets a persistent label instead of a placeholder
// that vanishes once typed; capability/actor/notify controls show friendly
// text instead of raw snake_case keys.

const FIELD_TYPES = ['text', 'multiline', 'number', 'date', 'dropdown', 'radio', 'checkbox', 'photo', 'location'] as const
type FieldType = (typeof FIELD_TYPES)[number]
const OPTION_TYPES = new Set<FieldType>(['dropdown', 'radio'])
const BOUNDED_TYPES = new Set<FieldType>(['number', 'text', 'multiline'])
const PRIORITIES = ['low', 'medium', 'high'] as const
const CAPABILITIES = [
  'view_all',
  'assign',
  'set_priority',
  'override',
  'manage_employees',
  'export',
  'manage_events',
  'manage_knowledge_base',
  'manage_training',
] as const
const ACTORS = ['requester', 'assignee'] as const
const NOTIFY_TARGETS = ['created_by', 'assigned_to', 'assignee_manager'] as const

const STEP_COUNT = 5

interface Department {
  id: number
  name: Loc
}
interface EmployeeOption {
  id: number
  name: string
}
interface OptionRow {
  value: string
  labelEn: string
  labelAr: string
}
// `rid` is a stable React list key, separate from `id`/`key` (the actual
// business identifiers the server validates) — the two are unrelated and
// conflating them made every row start with a colliding empty React key.
interface FieldRow {
  rid: string
  id: string
  labelEn: string
  labelAr: string
  type: FieldType
  required: boolean
  options: OptionRow[]
  min: string
  max: string
}
interface StatusRow {
  rid: string
  key: string
  labelEn: string
  labelAr: string
  isInitial: boolean
  isTerminal: boolean
  slaMinutes: string
}
interface TransitionRow {
  rid: string
  key: string
  from: string
  to: string
  labelEn: string
  labelAr: string
  gate: 'capability' | 'actor'
  capability: string
  actor: string
  requiresCompletionForm: boolean
  requiresNote: boolean
  notify: string[]
}

let ridSeq = 0
function newRid() {
  ridSeq += 1
  return `r${ridSeq}`
}
function newFieldRow(): FieldRow {
  return { rid: newRid(), id: '', labelEn: '', labelAr: '', type: 'text', required: true, options: [], min: '', max: '' }
}
function newStatusRow(): StatusRow {
  return { rid: newRid(), key: '', labelEn: '', labelAr: '', isInitial: false, isTerminal: false, slaMinutes: '' }
}
function newTransitionRow(): TransitionRow {
  return {
    rid: newRid(),
    key: '',
    from: '',
    to: '',
    labelEn: '',
    labelAr: '',
    gate: 'capability',
    capability: 'view_all',
    actor: 'requester',
    requiresCompletionForm: false,
    requiresNote: false,
    notify: [],
  }
}

// Client-side mirrors of the server's requirements (formSchema.js /
// workflowSchema.js / services.js) — good enough to gate "Next" so a blank
// row never reaches the server; the server payload's shape is still the only
// thing that's actually trusted (I8).
function optionValid(o: OptionRow) {
  return !!(o.value.trim() && o.labelEn.trim() && o.labelAr.trim())
}
function fieldRowValid(r: FieldRow) {
  if (!r.id.trim() || !r.labelEn.trim() || !r.labelAr.trim()) return false
  if (OPTION_TYPES.has(r.type)) return r.options.length > 0 && r.options.every(optionValid)
  return true
}
function statusRowValid(r: StatusRow) {
  return !!(r.key.trim() && r.labelEn.trim() && r.labelAr.trim())
}
function transitionRowValid(r: TransitionRow) {
  return !!(r.key.trim() && r.from && r.to && r.labelEn.trim() && r.labelAr.trim())
}

// Classifies the server's flat error-string array back to the step (and,
// where the message names one, the row index within that step) it came
// from — every message formSchema.js/workflowSchema.js/services.js can
// produce has a deterministic prefix (verified against the backend source),
// so this is a plain prefix match, not string-sniffing guesswork.
interface ClassifiedErrors {
  byStep: [string[], string[], string[], string[], string[]]
  requestFieldRows: Set<number>
  completionFieldRows: Set<number>
  statusRows: Set<number>
  transitionRows: Set<number>
}
function classifyErrors(errors: string[]): ClassifiedErrors {
  const result: ClassifiedErrors = {
    byStep: [[], [], [], [], []],
    requestFieldRows: new Set(),
    completionFieldRows: new Set(),
    statusRows: new Set(),
    transitionRows: new Set(),
  }
  for (const msg of errors) {
    let m: RegExpMatchArray | null
    if ((m = msg.match(/^requestFields field\[(\d+)\]/))) {
      result.byStep[1].push(msg.replace(/^requestFields /, ''))
      result.requestFieldRows.add(Number(m[1]))
    } else if ((m = msg.match(/^completionFields field\[(\d+)\]/))) {
      result.byStep[2].push(msg.replace(/^completionFields /, ''))
      result.completionFieldRows.add(Number(m[1]))
    } else if ((m = msg.match(/^statuses\[(\d+)\]/))) {
      result.byStep[3].push(msg)
      result.statusRows.add(Number(m[1]))
    } else if ((m = msg.match(/^transitions\[(\d+)\]/))) {
      result.byStep[3].push(msg)
      result.transitionRows.add(Number(m[1]))
    } else if (
      msg.startsWith('workflow must have') ||
      msg.startsWith('statuses must be') ||
      msg.startsWith('transitions must be') ||
      msg.startsWith('transitions "')
    ) {
      result.byStep[3].push(msg)
    } else {
      // name / departmentId / defaultPriority / accepts* / ownerId /
      // featureKey — everything Step 1 (Basics) owns, plus a safe default
      // bucket for anything not explicitly recognized above.
      result.byStep[0].push(msg)
    }
  }
  return result
}
function firstErrorStep(c: ClassifiedErrors): number {
  const i = c.byStep.findIndex((s) => s.length > 0)
  return i === -1 ? 0 : i
}

export default function AddServiceWizard() {
  const { t, L } = useI18n()

  const [departments, setDepartments] = useState<Department[]>([])
  const [employees, setEmployees] = useState<EmployeeOption[]>([])
  const [loadError, setLoadError] = useState(false)
  const [step, setStep] = useState(0)
  const [busy, setBusy] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [stepErrors, setStepErrors] = useState<[string[], string[], string[], string[], string[]]>([[], [], [], [], []])
  const [errorRows, setErrorRows] = useState({
    requestFields: new Set<number>(),
    completionFields: new Set<number>(),
    statuses: new Set<number>(),
    transitions: new Set<number>(),
  })
  const [created, setCreated] = useState<{ serviceTypeId: number; key: string } | null>(null)

  // Step 1
  const [nameEn, setNameEn] = useState('')
  const [nameAr, setNameAr] = useState('')
  const [departmentId, setDepartmentId] = useState('')
  const [defaultPriority, setDefaultPriority] = useState<(typeof PRIORITIES)[number]>('medium')
  const [acceptsExternalUsers, setAcceptsExternalUsers] = useState(true)
  const [acceptsEmployeeSubmitters, setAcceptsEmployeeSubmitters] = useState(false)
  const [ownerId, setOwnerId] = useState('')
  // Step 2 / 3
  const [requestFields, setRequestFields] = useState<FieldRow[]>([newFieldRow()])
  const [completionFields, setCompletionFields] = useState<FieldRow[]>([newFieldRow()])
  // Step 4
  const [statuses, setStatuses] = useState<StatusRow[]>([])
  const [transitions, setTransitions] = useState<TransitionRow[]>([])

  useEffect(() => {
    Promise.all([
      apiFetch<{ departments: Department[] }>('/departments'),
      apiFetch<{ employees: EmployeeOption[] }>('/employees?pageSize=100'),
    ])
      .then(([d, e]) => {
        setDepartments(d.departments)
        setEmployees(e.employees)
      })
      .catch(() => setLoadError(true))
  }, [])

  function stepValid(s: number): boolean {
    switch (s) {
      case 0:
        return !!(nameEn.trim() && nameAr.trim() && departmentId && ownerId)
      case 1:
        return requestFields.length > 0 && requestFields.every(fieldRowValid)
      case 2:
        return completionFields.length > 0 && completionFields.every(fieldRowValid)
      case 3:
        return (
          statuses.length > 0 &&
          statuses.every(statusRowValid) &&
          statuses.filter((st) => st.isInitial).length === 1 &&
          statuses.some((st) => st.isTerminal) &&
          transitions.length > 0 &&
          transitions.every(transitionRowValid)
        )
      default:
        return true
    }
  }

  async function finish() {
    setBusy(true)
    setSaveError('')
    setStepErrors([[], [], [], [], []])
    setErrorRows({ requestFields: new Set(), completionFields: new Set(), statuses: new Set(), transitions: new Set() })
    try {
      const res = await apiFetch<{ serviceTypeId: number; key: string }>('/services', {
        method: 'POST',
        body: {
          name: { en: nameEn, ar: nameAr },
          departmentId: Number(departmentId),
          defaultPriority,
          acceptsExternalUsers,
          acceptsEmployeeSubmitters,
          ownerId: Number(ownerId),
          requestFields: requestFields.map(toFieldSchema),
          completionFields: completionFields.map(toFieldSchema),
          statuses: statuses.map(toStatusSchema),
          transitions: transitions.map(toTransitionSchema),
        },
      })
      setCreated(res)
    } catch (err) {
      if (err instanceof ApiError && err.status === 422) {
        const body = err.body as { errors?: unknown } | undefined
        if (Array.isArray(body?.errors)) {
          const classified = classifyErrors(body!.errors as string[])
          setStepErrors(classified.byStep)
          setErrorRows({
            requestFields: classified.requestFieldRows,
            completionFields: classified.completionFieldRows,
            statuses: classified.statusRows,
            transitions: classified.transitionRows,
          })
          setStep(firstErrorStep(classified))
        } else {
          setSaveError(t('svc_err_save'))
        }
      } else {
        setSaveError(t('svc_err_save'))
      }
    } finally {
      setBusy(false)
    }
  }

  function next() {
    if (!stepValid(step)) return
    if (step < STEP_COUNT - 1) setStep(step + 1)
    else void finish()
  }
  function back() {
    setSaveError('')
    if (step > 0) setStep(step - 1)
  }

  if (loadError) {
    return (
      <div className="req-status">
        <p className="req-status-msg">{t('svc_err_load')}</p>
      </div>
    )
  }

  if (created) {
    return (
      <div className="req">
        <header className="req-head">
          <h1>{t('svc_created_h')}</h1>
        </header>
        <div className="req-empty">
          <h2>{nameEn}</h2>
          <p>
            {t('svc_created_p')} <code>{created.key}</code>
          </p>
        </div>
      </div>
    )
  }

  const stepTitles = ['svc_s1_title', 'svc_s2_title', 'svc_s3_title', 'svc_s4_title', 'svc_s5_title']
  const currentStepErrors = stepErrors[step]

  return (
    <div className="req">
      <header className="req-head">
        <h1>{t('svc_title')}</h1>
        <p className="req-meta">
          {t('ob_step_of')} {step + 1} {t('of')} {STEP_COUNT} — {t(stepTitles[step])}
        </p>
      </header>

      <div className="svc-body">
        {currentStepErrors.length > 0 && (
          <ul className="svc-step-errors">
            {currentStepErrors.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        )}

        {step === 0 && (
          <>
            <label className="field">
              <span>{t('svc_name_en')}</span>
              <input value={nameEn} onChange={(e) => setNameEn(e.target.value)} />
            </label>
            <label className="field">
              <span>{t('svc_name_ar')}</span>
              <input value={nameAr} onChange={(e) => setNameAr(e.target.value)} dir="rtl" />
            </label>
            <label className="field">
              <span>{t('emp_department')}</span>
              <select className="req-select" value={departmentId} onChange={(e) => setDepartmentId(e.target.value)}>
                <option value="">{t('ob_select')}</option>
                {departments.map((d) => (
                  <option key={d.id} value={d.id}>
                    {L(d.name)}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>{t('svc_default_priority')}</span>
              <select
                className="req-select"
                value={defaultPriority}
                onChange={(e) => setDefaultPriority(e.target.value as (typeof PRIORITIES)[number])}
              >
                {PRIORITIES.map((p) => (
                  <option key={p} value={p}>
                    {t(`pri_${p}`)}
                  </option>
                ))}
              </select>
            </label>
            <label className="svc-check">
              <input
                type="checkbox"
                checked={acceptsExternalUsers}
                onChange={(e) => setAcceptsExternalUsers(e.target.checked)}
              />
              <span>{t('svc_accepts_external')}</span>
            </label>
            <label className="svc-check">
              <input
                type="checkbox"
                checked={acceptsEmployeeSubmitters}
                onChange={(e) => setAcceptsEmployeeSubmitters(e.target.checked)}
              />
              <span>{t('svc_accepts_employee')}</span>
            </label>
            <label className="field">
              <span>{t('svc_owner')}</span>
              <select className="req-select" value={ownerId} onChange={(e) => setOwnerId(e.target.value)}>
                <option value="">{t('ob_select')}</option>
                {employees.map((emp) => (
                  <option key={emp.id} value={emp.id}>
                    {emp.name}
                  </option>
                ))}
              </select>
              <p className="ob-hint">{t('svc_owner_hint')}</p>
            </label>
          </>
        )}

        {step === 1 && (
          <FieldSchemaEditor
            title={t('svc_request_fields_h')}
            rows={requestFields}
            setRows={setRequestFields}
            errorRows={errorRows.requestFields}
            t={t}
          />
        )}

        {step === 2 && (
          <FieldSchemaEditor
            title={t('svc_completion_fields_h')}
            rows={completionFields}
            setRows={setCompletionFields}
            errorRows={errorRows.completionFields}
            t={t}
          />
        )}

        {step === 3 && (
          <>
            <section className="svc-section">
              <div className="svc-section-head">
                <h3>{t('svc_statuses_h')}</h3>
                <button type="button" className="action-btn" onClick={() => setStatuses((prev) => [...prev, newStatusRow()])}>
                  {t('svc_add_status')}
                </button>
              </div>
              <p className="ob-hint">{t('svc_statuses_hint')}</p>
              {statuses.map((s, i) => (
                <StatusEditor
                  key={s.rid}
                  row={s}
                  hasError={errorRows.statuses.has(i)}
                  onChange={(next) => setStatuses((prev) => prev.map((r, j) => (j === i ? next : r)))}
                  onRemove={() => setStatuses((prev) => prev.filter((_, j) => j !== i))}
                  t={t}
                />
              ))}
            </section>
            <section className="svc-section">
              <div className="svc-section-head">
                <h3>{t('svc_transitions_h')}</h3>
                <button
                  type="button"
                  className="action-btn"
                  onClick={() => setTransitions((prev) => [...prev, newTransitionRow()])}
                  disabled={statuses.length < 1}
                >
                  {t('svc_add_transition')}
                </button>
              </div>
              <p className="ob-hint">{t('svc_transitions_hint')}</p>
              {transitions.map((tr, i) => (
                <TransitionEditor
                  key={tr.rid}
                  row={tr}
                  statuses={statuses}
                  hasError={errorRows.transitions.has(i)}
                  onChange={(next) => setTransitions((prev) => prev.map((r, j) => (j === i ? next : r)))}
                  onRemove={() => setTransitions((prev) => prev.filter((_, j) => j !== i))}
                  t={t}
                />
              ))}
            </section>
          </>
        )}

        {step === 4 && (
          <div className="svc-review">
            <h3>{nameEn || t('svc_untitled')}</h3>
            <p>
              {requestFields.length + completionFields.length} {t('svc_review_fields')} · {statuses.length}{' '}
              {t('svc_review_statuses')} · {transitions.length} {t('svc_review_transitions')}
            </p>
          </div>
        )}

        {saveError && <p className="assign-error">{saveError}</p>}
      </div>

      <div className="dialog-actions svc-foot">
        <button type="button" className="detail-close-text" onClick={back} disabled={step === 0 || busy}>
          {t('previous')}
        </button>
        {!stepValid(step) && !busy && <p className="svc-next-hint">{t('svc_fill_required')}</p>}
        <button type="button" className="req-retry" onClick={next} disabled={busy || !stepValid(step)}>
          {busy ? t('ob_saving') : step === STEP_COUNT - 1 ? t('svc_create') : t('next')}
        </button>
      </div>
    </div>
  )
}

function toFieldSchema(row: FieldRow) {
  const base: Record<string, unknown> = {
    id: row.id.trim(),
    label: { en: row.labelEn, ar: row.labelAr },
    type: row.type,
    required: row.required,
  }
  if (OPTION_TYPES.has(row.type)) {
    base.options = row.options.map((o) => ({ value: o.value.trim(), label: { en: o.labelEn, ar: o.labelAr } }))
  }
  if (BOUNDED_TYPES.has(row.type)) {
    if (row.min !== '') base.min = Number(row.min)
    if (row.max !== '') base.max = Number(row.max)
  }
  return base
}
function toStatusSchema(row: StatusRow) {
  return {
    key: row.key.trim(),
    label: { en: row.labelEn, ar: row.labelAr },
    is_initial: row.isInitial,
    is_terminal: row.isTerminal,
    sla_minutes: row.slaMinutes === '' ? null : Number(row.slaMinutes),
  }
}
function toTransitionSchema(row: TransitionRow) {
  return {
    key: row.key.trim(),
    from: row.from,
    to: row.to,
    label: { en: row.labelEn, ar: row.labelAr },
    required_capability: row.gate === 'capability' ? row.capability : null,
    actor: row.gate === 'actor' ? row.actor : null,
    required_form_key: row.requiresCompletionForm ? 'completion' : null,
    requires_note: row.requiresNote,
    notify: row.notify,
  }
}

// A labeled row cell — the persistent-label equivalent of Step 1's
// <label className="field">, sized for the dense grid rows in steps 2-4.
function MiniField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="svc-mini-field">
      <span>{label}</span>
      {children}
    </label>
  )
}

function FieldSchemaEditor({
  title,
  rows,
  setRows,
  errorRows,
  t,
}: {
  title: string
  rows: FieldRow[]
  setRows: (fn: (prev: FieldRow[]) => FieldRow[]) => void
  errorRows: Set<number>
  t: (k: string) => string
}) {
  function update(i: number, patch: Partial<FieldRow>) {
    setRows((prev) => prev.map((r, j) => (j === i ? { ...r, ...patch } : r)))
  }
  return (
    <section className="svc-section">
      <div className="svc-section-head">
        <h3>{title}</h3>
        <button type="button" className="action-btn" onClick={() => setRows((prev) => [...prev, newFieldRow()])}>
          {t('svc_add_field')}
        </button>
      </div>
      {rows.map((row, i) => (
        <div key={row.rid} className={`svc-row${errorRows.has(i) ? ' has-error' : ''}`}>
          <div className="svc-row-grid">
            <MiniField label={t('svc_field_id')}>
              <input value={row.id} onChange={(e) => update(i, { id: e.target.value })} />
            </MiniField>
            <MiniField label={t('svc_field_label_en')}>
              <input value={row.labelEn} onChange={(e) => update(i, { labelEn: e.target.value })} />
            </MiniField>
            <MiniField label={t('svc_field_label_ar')}>
              <input dir="rtl" value={row.labelAr} onChange={(e) => update(i, { labelAr: e.target.value })} />
            </MiniField>
            <MiniField label={t('svc_field_type')}>
              <select className="req-select" value={row.type} onChange={(e) => update(i, { type: e.target.value as FieldType })}>
                {FIELD_TYPES.map((ft) => (
                  <option key={ft} value={ft}>
                    {t(`field_type_${ft}`)}
                  </option>
                ))}
              </select>
            </MiniField>
            <label className="svc-check">
              <input type="checkbox" checked={row.required} onChange={(e) => update(i, { required: e.target.checked })} />
              <span>{t('svc_required')}</span>
            </label>
            {rows.length > 1 && (
              <button type="button" className="action-btn is-danger" onClick={() => setRows((prev) => prev.filter((_, j) => j !== i))}>
                {t('svc_remove')}
              </button>
            )}
          </div>
          {BOUNDED_TYPES.has(row.type) && (
            <div className="svc-row-grid">
              <MiniField label={t('svc_min')}>
                <input type="number" value={row.min} onChange={(e) => update(i, { min: e.target.value })} />
              </MiniField>
              <MiniField label={t('svc_max')}>
                <input type="number" value={row.max} onChange={(e) => update(i, { max: e.target.value })} />
              </MiniField>
            </div>
          )}
          {OPTION_TYPES.has(row.type) && (
            <div className="svc-options">
              {row.options.map((opt, oi) => (
                <div key={oi} className="svc-row-grid">
                  <MiniField label={t('svc_option_value')}>
                    <input
                      value={opt.value}
                      onChange={(e) =>
                        update(i, { options: row.options.map((o, j) => (j === oi ? { ...o, value: e.target.value } : o)) })
                      }
                    />
                  </MiniField>
                  <MiniField label={t('svc_field_label_en')}>
                    <input
                      value={opt.labelEn}
                      onChange={(e) =>
                        update(i, { options: row.options.map((o, j) => (j === oi ? { ...o, labelEn: e.target.value } : o)) })
                      }
                    />
                  </MiniField>
                  <MiniField label={t('svc_field_label_ar')}>
                    <input
                      dir="rtl"
                      value={opt.labelAr}
                      onChange={(e) =>
                        update(i, { options: row.options.map((o, j) => (j === oi ? { ...o, labelAr: e.target.value } : o)) })
                      }
                    />
                  </MiniField>
                  <button
                    type="button"
                    className="action-btn is-danger"
                    onClick={() => update(i, { options: row.options.filter((_, j) => j !== oi) })}
                  >
                    {t('svc_remove')}
                  </button>
                </div>
              ))}
              <button
                type="button"
                className="action-btn"
                onClick={() => update(i, { options: [...row.options, { value: '', labelEn: '', labelAr: '' }] })}
              >
                {t('svc_add_option')}
              </button>
            </div>
          )}
        </div>
      ))}
    </section>
  )
}

function StatusEditor({
  row,
  hasError,
  onChange,
  onRemove,
  t,
}: {
  row: StatusRow
  hasError: boolean
  onChange: (next: StatusRow) => void
  onRemove: () => void
  t: (k: string) => string
}) {
  return (
    <div className={`svc-row${hasError ? ' has-error' : ''}`}>
      <div className="svc-row-grid">
        <MiniField label={t('svc_status_key')}>
          <input value={row.key} onChange={(e) => onChange({ ...row, key: e.target.value })} />
        </MiniField>
        <MiniField label={t('svc_field_label_en')}>
          <input value={row.labelEn} onChange={(e) => onChange({ ...row, labelEn: e.target.value })} />
        </MiniField>
        <MiniField label={t('svc_field_label_ar')}>
          <input dir="rtl" value={row.labelAr} onChange={(e) => onChange({ ...row, labelAr: e.target.value })} />
        </MiniField>
        <label className="svc-check">
          <input type="checkbox" checked={row.isInitial} onChange={(e) => onChange({ ...row, isInitial: e.target.checked })} />
          <span>{t('svc_is_initial')}</span>
        </label>
        <label className="svc-check">
          <input type="checkbox" checked={row.isTerminal} onChange={(e) => onChange({ ...row, isTerminal: e.target.checked })} />
          <span>{t('svc_is_terminal')}</span>
        </label>
        <MiniField label={t('svc_sla_minutes')}>
          <input type="number" value={row.slaMinutes} onChange={(e) => onChange({ ...row, slaMinutes: e.target.value })} />
        </MiniField>
        <button type="button" className="action-btn is-danger" onClick={onRemove}>
          {t('svc_remove')}
        </button>
      </div>
    </div>
  )
}

function TransitionEditor({
  row,
  statuses,
  hasError,
  onChange,
  onRemove,
  t,
}: {
  row: TransitionRow
  statuses: StatusRow[]
  hasError: boolean
  onChange: (next: TransitionRow) => void
  onRemove: () => void
  t: (k: string) => string
}) {
  return (
    <div className={`svc-row${hasError ? ' has-error' : ''}`}>
      <div className="svc-row-grid">
        <MiniField label={t('svc_transition_key')}>
          <input value={row.key} onChange={(e) => onChange({ ...row, key: e.target.value })} />
        </MiniField>
        <MiniField label={t('svc_from')}>
          <select className="req-select" value={row.from} onChange={(e) => onChange({ ...row, from: e.target.value })}>
            <option value="">{t('ob_select')}</option>
            {statuses.map((s) => (
              <option key={s.rid} value={s.key}>
                {s.key}
              </option>
            ))}
          </select>
        </MiniField>
        <MiniField label={t('svc_to')}>
          <select className="req-select" value={row.to} onChange={(e) => onChange({ ...row, to: e.target.value })}>
            <option value="">{t('ob_select')}</option>
            {statuses.map((s) => (
              <option key={s.rid} value={s.key}>
                {s.key}
              </option>
            ))}
          </select>
        </MiniField>
        <MiniField label={t('svc_field_label_en')}>
          <input value={row.labelEn} onChange={(e) => onChange({ ...row, labelEn: e.target.value })} />
        </MiniField>
        <MiniField label={t('svc_field_label_ar')}>
          <input dir="rtl" value={row.labelAr} onChange={(e) => onChange({ ...row, labelAr: e.target.value })} />
        </MiniField>
        <button type="button" className="action-btn is-danger" onClick={onRemove}>
          {t('svc_remove')}
        </button>
      </div>
      <div className="svc-row-grid">
        <label className="svc-check">
          <input
            type="radio"
            name={`gate-${row.rid}`}
            checked={row.gate === 'capability'}
            onChange={() => onChange({ ...row, gate: 'capability' })}
          />
          <span>{t('svc_gate_capability')}</span>
        </label>
        <select
          className="req-select"
          disabled={row.gate !== 'capability'}
          value={row.capability}
          onChange={(e) => onChange({ ...row, capability: e.target.value })}
        >
          {CAPABILITIES.map((c) => (
            <option key={c} value={c}>
              {t(`cap_${c}`)}
            </option>
          ))}
        </select>
        <label className="svc-check">
          <input
            type="radio"
            name={`gate-${row.rid}`}
            checked={row.gate === 'actor'}
            onChange={() => onChange({ ...row, gate: 'actor' })}
          />
          <span>{t('svc_gate_actor')}</span>
        </label>
        <select className="req-select" disabled={row.gate !== 'actor'} value={row.actor} onChange={(e) => onChange({ ...row, actor: e.target.value })}>
          {ACTORS.map((a) => (
            <option key={a} value={a}>
              {t(`actor_${a}`)}
            </option>
          ))}
        </select>
      </div>
      <p className="ob-hint">{t('svc_gate_hint')}</p>
      <div className="svc-row-grid">
        <label className="svc-check">
          <input
            type="checkbox"
            checked={row.requiresCompletionForm}
            onChange={(e) => onChange({ ...row, requiresCompletionForm: e.target.checked })}
          />
          <span>{t('svc_requires_completion_form')}</span>
        </label>
        <label className="svc-check">
          <input type="checkbox" checked={row.requiresNote} onChange={(e) => onChange({ ...row, requiresNote: e.target.checked })} />
          <span>{t('svc_requires_note')}</span>
        </label>
      </div>
      <p className="ob-hint">{t('svc_transition_flags_hint')}</p>
      <div className="svc-row-grid">
        {NOTIFY_TARGETS.map((target) => (
          <label key={target} className="svc-check">
            <input
              type="checkbox"
              checked={row.notify.includes(target)}
              onChange={(e) =>
                onChange({
                  ...row,
                  notify: e.target.checked ? [...row.notify, target] : row.notify.filter((n) => n !== target),
                })
              }
            />
            <span>{t(`notify_${target}`)}</span>
          </label>
        ))}
      </div>
      <p className="ob-hint">{t('svc_notify_hint')}</p>
    </div>
  )
}

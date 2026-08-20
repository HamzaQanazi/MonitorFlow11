import { useEffect, useState } from 'react'
import { apiFetch, ApiError } from '../lib/api'
import { useI18n, type Loc } from '../i18n'
import { TranslateButton } from '../components/TranslateButton'
import { TranslateAllButton } from '../components/TranslateAllButton'
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
// Simplification pass (on top of the original UX pass below): field/status/
// transition machine keys are no longer typed by hand — they're slugified
// from the English label client-side, the same way services.js already
// derives a service's own `key` from its name, with a collision suffix loop.
// Step 4 no longer exposes raw statuses+transitions editors: the admin types
// steps in the order a request moves through; the first is always is_initial,
// the last is always is_terminal, and one transition per consecutive pair is
// derived automatically. An optional "can be rejected/cancelled" toggle adds
// one extra terminal step reachable from every non-final step, covering the
// one branch shape most services actually need without exposing a general
// from/to transition builder. Every derived transition defaults to a
// `view_all`-gated oversight action (label reused from its destination
// status, no note required, `notify: ['created_by']`, and the completion
// form required only on the transition into the final step) — the only
// per-transition choice left is one checkbox: let the assignee do this step
// instead. This deliberately drops the ability to build branching/looping
// workflows (holds, multiple distinct rejection outcomes, requester-gated
// confirm/dispute steps) or pick a specific non-view_all oversight
// capability through this wizard — CLAUDE.md's engine still supports all of
// that, it's just no longer reachable from this simplified builder.
//
// UX pass: client-side per-step validation blocks "Next" instead of letting
// you sail through 5 steps blank and hit a wall of raw validator strings at
// the end; a 422's errors are classified back to the step (and row, where
// the message names one) they came from instead of dumped as one blob on
// Review; every row input gets a persistent label instead of a placeholder
// that vanishes once typed.

const FIELD_TYPES = ['text', 'multiline', 'number', 'date', 'dropdown', 'radio', 'checkbox', 'photo', 'location'] as const
type FieldType = (typeof FIELD_TYPES)[number]
const OPTION_TYPES = new Set<FieldType>(['dropdown', 'radio'])
const BOUNDED_TYPES = new Set<FieldType>(['number', 'text', 'multiline'])
const PRIORITIES = ['low', 'medium', 'high'] as const

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
// `rid` is a stable React list key AND the stable identity a derived
// machine key/edge id hangs off of — unlike the id/key itself, it never
// changes when a label is edited or rows are reordered.
interface FieldRow {
  rid: string
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
  labelEn: string
  labelAr: string
  slaMinutes: string
}

let ridSeq = 0
function newRid() {
  ridSeq += 1
  return `r${ridSeq}`
}
function newFieldRow(): FieldRow {
  return { rid: newRid(), labelEn: '', labelAr: '', type: 'text', required: true, options: [], min: '', max: '' }
}
function newStatusRow(): StatusRow {
  return { rid: newRid(), labelEn: '', labelAr: '', slaMinutes: '' }
}

// Mirrors services.js's own `slugify()` (used for the service's `key`) so a
// field id / status key derived here is built exactly the same way the
// server already builds one — lowercase, non-alphanumerics collapsed to
// underscores, trimmed.
function slugify(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

// Turns a list of English labels into unique machine keys, in order —
// collisions get a `_2`, `_3`, … suffix, same shape as services.js's
// key-uniqueness loop. An empty/unslugifiable label falls back to `fallback`
// (still deduped against its neighbors).
function deriveIds(labels: string[], fallback: string): string[] {
  const seen = new Map<string, number>()
  return labels.map((label) => {
    const base = slugify(label) || fallback
    const count = seen.get(base) ?? 0
    seen.set(base, count + 1)
    return count === 0 ? base : `${base}_${count + 1}`
  })
}

// Client-side mirrors of the server's requirements (formSchema.js /
// workflowSchema.js / services.js) — good enough to gate "Next" so a blank
// row never reaches the server; the server payload's shape is still the only
// thing that's actually trusted (I8).
function optionValid(o: OptionRow) {
  return !!(o.value.trim() && o.labelEn.trim() && o.labelAr.trim())
}
function fieldRowValid(r: FieldRow) {
  if (!r.labelEn.trim() || !r.labelAr.trim()) return false
  if (OPTION_TYPES.has(r.type)) return r.options.length > 0 && r.options.every(optionValid)
  return true
}
function statusRowValid(r: StatusRow) {
  return !!(r.labelEn.trim() && r.labelAr.trim())
}

interface Edge {
  id: string
  fromKeyIndex: number // index into the derived status-key array, or -1 for the cancel step
  toKeyIndex: number
  fromLabelEn: string
  toLabelEn: string
  labelEn: string
  labelAr: string
  isFirst: boolean
  requiresCompletion: boolean
}

// Derives the workflow's statuses + the candidate transition edges from the
// ordered step list. `edges` still needs edgesToTransitions() (below) to
// become the actual POST payload — kept separate so the UI can render the
// edge list (for the one per-edge checkbox) without re-deriving it.
function buildFlow(statuses: StatusRow[], allowCancel: boolean, cancelLabelEn: string, cancelLabelAr: string) {
  const n = statuses.length
  const labels = statuses.map((s) => s.labelEn)
  if (allowCancel) labels.push(cancelLabelEn || 'Cancelled')
  const keys = deriveIds(labels, 'status')
  const statusKeys = keys.slice(0, n)
  const cancelKey = allowCancel ? keys[n] : null

  const statusSchemas = statuses.map((s, i) => ({
    key: statusKeys[i],
    label: { en: s.labelEn, ar: s.labelAr },
    is_initial: i === 0,
    is_terminal: i === n - 1,
    sla_minutes: s.slaMinutes === '' ? null : Number(s.slaMinutes),
  }))
  if (allowCancel && cancelKey) {
    statusSchemas.push({
      key: cancelKey,
      label: { en: cancelLabelEn.trim() || 'Cancelled', ar: cancelLabelAr.trim() || 'ملغى' },
      is_initial: false,
      is_terminal: true,
      sla_minutes: null,
    })
  }

  const edges: Edge[] = []
  for (let i = 0; i < n - 1; i++) {
    edges.push({
      id: `${statuses[i].rid}->${statuses[i + 1].rid}`,
      fromKeyIndex: i,
      toKeyIndex: i + 1,
      fromLabelEn: statuses[i].labelEn,
      toLabelEn: statuses[i + 1].labelEn,
      labelEn: statuses[i + 1].labelEn,
      labelAr: statuses[i + 1].labelAr,
      isFirst: i === 0,
      requiresCompletion: i === n - 2,
    })
  }
  if (allowCancel && cancelKey) {
    for (let i = 0; i < n - 1; i++) {
      edges.push({
        id: `${statuses[i].rid}->cancel`,
        fromKeyIndex: i,
        toKeyIndex: -1,
        fromLabelEn: statuses[i].labelEn,
        toLabelEn: cancelLabelEn.trim() || 'Cancelled',
        labelEn: cancelLabelEn.trim() || 'Cancelled',
        labelAr: cancelLabelAr.trim() || 'ملغى',
        isFirst: false,
        requiresCompletion: false,
      })
    }
  }

  return { statusKeys, cancelKey, statusSchemas, edges }
}

// Every derived transition is view_all-gated oversight by default — the one
// override is the per-edge "assignee handles this" checkbox. When auto-assign
// is on, the very first edge is forced to `required_capability: 'assign'`
// instead (that's the exact transition lib/autoAssign.js looks for) and its
// checkbox is hidden, so turning auto-assign on can never silently do nothing.
function edgesToTransitions(
  edges: Edge[],
  statusKeys: string[],
  cancelKey: string | null,
  autoAssign: boolean,
  assigneeGated: Record<string, boolean>
) {
  const keyOf = (idx: number) => (idx === -1 ? cancelKey! : statusKeys[idx])
  return edges.map((e) => {
    const fromKey = keyOf(e.fromKeyIndex)
    const toKey = keyOf(e.toKeyIndex)
    const forcedAssign = autoAssign && e.isFirst
    const gated = !forcedAssign && !!assigneeGated[e.id]
    return {
      key: `${fromKey}_to_${toKey}`,
      from: fromKey,
      to: toKey,
      label: { en: e.labelEn, ar: e.labelAr },
      required_capability: gated ? null : forcedAssign ? 'assign' : 'view_all',
      actor: gated ? 'assignee' : null,
      required_form_key: e.requiresCompletion ? 'completion' : null,
      requires_note: false,
      notify: ['created_by'],
    }
  })
}

// Classifies the server's flat error-string array back to the step (and,
// where the message names one, the row index within that step) it came
// from — every message formSchema.js/workflowSchema.js/services.js can
// produce has a deterministic prefix (verified against the backend source),
// so this is a plain prefix match, not string-sniffing guesswork. Statuses
// still map back to a specific Step-4 row; transitions are derived (not
// hand-built rows anymore) so their errors surface as step-level text only —
// in practice unreachable, since the derivation can't produce a shape the
// validator rejects.
interface ClassifiedErrors {
  byStep: [string[], string[], string[], string[], string[]]
  requestFieldRows: Set<number>
  completionFieldRows: Set<number>
  statusRows: Set<number>
}
function classifyErrors(errors: string[]): ClassifiedErrors {
  const result: ClassifiedErrors = {
    byStep: [[], [], [], [], []],
    requestFieldRows: new Set(),
    completionFieldRows: new Set(),
    statusRows: new Set(),
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
    } else if (/^transitions\[\d+\]/.test(msg)) {
      result.byStep[3].push(msg)
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
  })
  const [created, setCreated] = useState<{ serviceTypeId: number; key: string } | null>(null)

  // Step 1
  const [nameEn, setNameEn] = useState('')
  const [nameAr, setNameAr] = useState('')
  const [departmentId, setDepartmentId] = useState('')
  const [defaultPriority, setDefaultPriority] = useState<(typeof PRIORITIES)[number]>('medium')
  const [acceptsExternalUsers, setAcceptsExternalUsers] = useState(true)
  const [acceptsEmployeeSubmitters, setAcceptsEmployeeSubmitters] = useState(false)
  const [autoAssign, setAutoAssign] = useState(false)
  const [ownerId, setOwnerId] = useState('')
  // Step 2 / 3
  const [requestFields, setRequestFields] = useState<FieldRow[]>([newFieldRow()])
  const [completionFields, setCompletionFields] = useState<FieldRow[]>([newFieldRow()])
  // Step 4
  const [statuses, setStatuses] = useState<StatusRow[]>([newStatusRow(), newStatusRow()])
  const [allowCancel, setAllowCancel] = useState(false)
  const [cancelLabelEn, setCancelLabelEn] = useState('Cancelled')
  const [cancelLabelAr, setCancelLabelAr] = useState('ملغى')
  const [assigneeGated, setAssigneeGated] = useState<Record<string, boolean>>({})

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

  const { statusKeys, cancelKey, statusSchemas, edges } = buildFlow(statuses, allowCancel, cancelLabelEn, cancelLabelAr)
  const transitionSchemas = edgesToTransitions(edges, statusKeys, cancelKey, autoAssign, assigneeGated)

  function moveStatus(i: number, dir: -1 | 1) {
    setStatuses((prev) => {
      const j = i + dir
      if (j < 0 || j >= prev.length) return prev
      const next = [...prev]
      ;[next[i], next[j]] = [next[j], next[i]]
      return next
    })
  }

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
          statuses.length >= 2 &&
          statuses.every(statusRowValid) &&
          (!allowCancel || (cancelLabelEn.trim() !== '' && cancelLabelAr.trim() !== ''))
        )
      default:
        return true
    }
  }

  async function finish() {
    setBusy(true)
    setSaveError('')
    setStepErrors([[], [], [], [], []])
    setErrorRows({ requestFields: new Set(), completionFields: new Set(), statuses: new Set() })
    try {
      const res = await apiFetch<{ serviceTypeId: number; key: string }>('/services', {
        method: 'POST',
        body: {
          name: { en: nameEn, ar: nameAr },
          departmentId: Number(departmentId),
          defaultPriority,
          acceptsExternalUsers,
          acceptsEmployeeSubmitters,
          autoAssign,
          ownerId: Number(ownerId),
          requestFields: fieldsToSchema(requestFields),
          completionFields: fieldsToSchema(completionFields),
          statuses: statusSchemas,
          transitions: transitionSchemas,
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
            <TranslateButton en={nameEn} ar={nameAr} setEn={setNameEn} setAr={setNameAr} />
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
            <label className="svc-check">
              <input
                type="checkbox"
                checked={autoAssign}
                onChange={(e) => setAutoAssign(e.target.checked)}
              />
              <span>{t('svc_auto_assign')}</span>
            </label>
            <p className="ob-hint">{t('svc_auto_assign_hint')}</p>
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
              <TranslateAllButton
                rows={statuses}
                getEn={(r) => r.labelEn}
                getAr={(r) => r.labelAr}
                setPair={(i, en, ar) =>
                  setStatuses((prev) => prev.map((r, j) => (j === i ? { ...r, labelEn: en, labelAr: ar } : r)))
                }
              />
              <p className="ob-hint">{t('svc_statuses_hint')}</p>
              {statuses.map((s, i) => (
                <div key={s.rid} className={`svc-row${errorRows.statuses.has(i) ? ' has-error' : ''}`}>
                  <div className="svc-row-grid">
                    <MiniField label={t('svc_field_label_en')}>
                      <input
                        value={s.labelEn}
                        onChange={(e) =>
                          setStatuses((prev) => prev.map((r, j) => (j === i ? { ...r, labelEn: e.target.value } : r)))
                        }
                      />
                    </MiniField>
                    <MiniField label={t('svc_field_label_ar')}>
                      <input
                        dir="rtl"
                        value={s.labelAr}
                        onChange={(e) =>
                          setStatuses((prev) => prev.map((r, j) => (j === i ? { ...r, labelAr: e.target.value } : r)))
                        }
                      />
                    </MiniField>
                    <TranslateButton
                      en={s.labelEn}
                      ar={s.labelAr}
                      setEn={(v) => setStatuses((prev) => prev.map((r, j) => (j === i ? { ...r, labelEn: v } : r)))}
                      setAr={(v) => setStatuses((prev) => prev.map((r, j) => (j === i ? { ...r, labelAr: v } : r)))}
                    />
                    <MiniField label={t('svc_sla_minutes')}>
                      <input
                        type="number"
                        value={s.slaMinutes}
                        onChange={(e) =>
                          setStatuses((prev) => prev.map((r, j) => (j === i ? { ...r, slaMinutes: e.target.value } : r)))
                        }
                      />
                    </MiniField>
                    <div className="svc-chain-controls">
                      <button
                        type="button"
                        className="action-btn"
                        disabled={i === 0}
                        aria-label={t('svc_move_up')}
                        onClick={() => moveStatus(i, -1)}
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        className="action-btn"
                        disabled={i === statuses.length - 1}
                        aria-label={t('svc_move_down')}
                        onClick={() => moveStatus(i, 1)}
                      >
                        ↓
                      </button>
                      {statuses.length > 2 && (
                        <button
                          type="button"
                          className="action-btn is-danger"
                          onClick={() => setStatuses((prev) => prev.filter((_, j) => j !== i))}
                        >
                          {t('svc_remove')}
                        </button>
                      )}
                    </div>
                  </div>
                  {(i === 0 || i === statuses.length - 1) && (
                    <p className="svc-chain-badge">{i === 0 ? t('svc_badge_initial') : t('svc_badge_terminal')}</p>
                  )}
                </div>
              ))}
            </section>

            <section className="svc-section">
              <label className="svc-check">
                <input type="checkbox" checked={allowCancel} onChange={(e) => setAllowCancel(e.target.checked)} />
                <span>{t('svc_allow_cancel')}</span>
              </label>
              {allowCancel && (
                <div className="svc-row-grid">
                  <MiniField label={t('svc_field_label_en')}>
                    <input value={cancelLabelEn} onChange={(e) => setCancelLabelEn(e.target.value)} />
                  </MiniField>
                  <MiniField label={t('svc_field_label_ar')}>
                    <input dir="rtl" value={cancelLabelAr} onChange={(e) => setCancelLabelAr(e.target.value)} />
                  </MiniField>
                  <TranslateButton en={cancelLabelEn} ar={cancelLabelAr} setEn={setCancelLabelEn} setAr={setCancelLabelAr} />
                </div>
              )}
            </section>

            <section className="svc-section">
              <h3>{t('svc_flow_preview_h')}</h3>
              <p className="ob-hint">{t('svc_flow_preview_hint')}</p>
              {edges.map((e) => (
                <div key={e.id} className="svc-row-grid svc-edge-row">
                  <span className="svc-edge-label">
                    {e.fromLabelEn || t('svc_untitled')} → {e.toLabelEn || t('svc_untitled')}
                  </span>
                  {e.isFirst && autoAssign ? (
                    <p className="ob-hint">{t('svc_auto_assign_note')}</p>
                  ) : (
                    <label className="svc-check">
                      <input
                        type="checkbox"
                        checked={!!assigneeGated[e.id]}
                        onChange={(ev) =>
                          setAssigneeGated((prev) => ({ ...prev, [e.id]: ev.target.checked }))
                        }
                      />
                      <span>{t('svc_assignee_handles')}</span>
                    </label>
                  )}
                </div>
              ))}
            </section>
          </>
        )}

        {step === 4 && (
          <div className="svc-review">
            <h3>{nameEn || t('svc_untitled')}</h3>
            <p>
              {requestFields.length + completionFields.length} {t('svc_review_fields')} · {statusSchemas.length}{' '}
              {t('svc_review_statuses')} · {transitionSchemas.length} {t('svc_review_transitions')}
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

function fieldsToSchema(rows: FieldRow[]) {
  const ids = deriveIds(rows.map((r) => r.labelEn), 'field')
  return rows.map((row, i) => toFieldSchema(row, ids[i]))
}
function toFieldSchema(row: FieldRow, id: string) {
  const base: Record<string, unknown> = {
    id,
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
      <TranslateAllButton
        rows={rows}
        getEn={(r) => r.labelEn}
        getAr={(r) => r.labelAr}
        setPair={(i, en, ar) => update(i, { labelEn: en, labelAr: ar })}
      />
      {rows.map((row, i) => (
        <div key={row.rid} className={`svc-row${errorRows.has(i) ? ' has-error' : ''}`}>
          <div className="svc-row-grid">
            <MiniField label={t('svc_field_label_en')}>
              <input value={row.labelEn} onChange={(e) => update(i, { labelEn: e.target.value })} />
            </MiniField>
            <MiniField label={t('svc_field_label_ar')}>
              <input dir="rtl" value={row.labelAr} onChange={(e) => update(i, { labelAr: e.target.value })} />
            </MiniField>
            <TranslateButton
              en={row.labelEn}
              ar={row.labelAr}
              setEn={(v) => update(i, { labelEn: v })}
              setAr={(v) => update(i, { labelAr: v })}
            />
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
                  <TranslateButton
                    en={opt.labelEn}
                    ar={opt.labelAr}
                    setEn={(v) => update(i, { options: row.options.map((o, j) => (j === oi ? { ...o, labelEn: v } : o)) })}
                    setAr={(v) => update(i, { options: row.options.map((o, j) => (j === oi ? { ...o, labelAr: v } : o)) })}
                  />
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

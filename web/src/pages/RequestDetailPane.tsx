import { useCallback, useEffect, useState } from 'react'
import { apiFetch, ApiError } from '../lib/api'

// The detail half of Requests Management (Section 4): request detail,
// timeline, comments (read — posting arrives Week 5), attachments metadata,
// and assign/reassign. One GET /requests/{id} call feeds everything except
// the form's field labels (the form schema) and the employee picker.

interface Status {
  key: string
  label: string
  category: string | null
}

interface Detail {
  id: number
  serviceTypeId: number
  serviceTypeName: string
  status: Status
  priority: string
  formResponse: Record<string, unknown>
  createdAt: string
  requester: { id: number; name: string; email: string; phone: string | null }
  task: { id: number; employeeId: number; employeeName: string; assignedAt: string } | null
  statusHistory: { status: Status; changedBy: { id: number; name: string }; changedAt: string; note: string | null }[]
  comments: { id: number; body: string; createdAt: string; author: { id: number; name: string } }[]
  attachments: { id: string; originalFilename: string; mimeType: string; sizeBytes: number }[]
}

interface Field {
  id: string
  label: string
  type: string
  options?: { value: string; label: string }[]
}

interface Employee {
  id: number
  name: string
  isActive: boolean
}

const PRIORITY_LABEL: Record<string, string> = { high: 'High', medium: 'Medium', low: 'Low' }

function formatDateTime(iso: string) {
  const d = new Date(iso)
  const opts: Intl.DateTimeFormatOptions = {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }
  if (d.getFullYear() !== new Date().getFullYear()) opts.year = 'numeric'
  return d.toLocaleString(undefined, opts)
}

function formatSize(bytes: number) {
  return bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`
}

function fieldValue(f: Field, v: unknown): string {
  if (v === undefined || v === null || v === '') return '—'
  switch (f.type) {
    case 'checkbox':
      return v ? 'Yes' : 'No'
    case 'dropdown':
    case 'radio':
      return f.options?.find((o) => o.value === v)?.label ?? String(v)
    case 'photo':
      return 'Photo attached'
    case 'date':
      return formatDateTime(`${String(v)}T00:00:00`).split(',')[0]
    default:
      return String(v)
  }
}

export default function RequestDetailPane({
  id,
  departmentIdOf,
  onClose,
  onChanged,
}: {
  id: number
  departmentIdOf: (serviceTypeId: number) => number | undefined
  onClose: () => void
  onChanged: () => void
}) {
  const [detail, setDetail] = useState<Detail | null>(null)
  const [fields, setFields] = useState<Field[]>([])
  const [employees, setEmployees] = useState<Employee[]>([])
  const [error, setError] = useState<string | null>(null)
  const [pick, setPick] = useState('')
  const [assignBusy, setAssignBusy] = useState(false)
  const [assignError, setAssignError] = useState<string | null>(null)

  const load = useCallback(async () => {
    const { request } = await apiFetch<{ request: Detail }>(`/requests/${id}`)
    setDetail(request)
    setError(null)
    // Field labels for the form response; failure just falls back to raw ids.
    apiFetch<{ fields: Field[] }>(`/services/${request.serviceTypeId}/forms/request`)
      .then((r) => setFields(r.fields))
      .catch(() => {})
    const deptId = departmentIdOf(request.serviceTypeId)
    if (deptId !== undefined) {
      apiFetch<{ employees: Employee[] }>(`/employees?departmentId=${deptId}&pageSize=100`)
        .then((r) => setEmployees(r.employees.filter((e) => e.isActive)))
        .catch(() => {})
    }
  }, [id, departmentIdOf])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset for the incoming request; fetch states land async
    setDetail(null)
    setError(null)
    setPick('')
    setAssignError(null)
    load().catch((err: Error) => setError(err.message))
    // Detail pages refresh on focus, not on a timer (CLAUDE.md Section 2).
    const onFocus = () => load().catch(() => {})
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [load])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  async function assign() {
    if (!pick) return
    setAssignBusy(true)
    setAssignError(null)
    try {
      await apiFetch(`/requests/${id}/assign`, { method: 'PATCH', body: { employeeId: Number(pick) } })
      setPick('')
      await load()
      onChanged()
    } catch (err) {
      if (err instanceof ApiError && err.status === 422) {
        setAssignError('That employee can’t take this request (wrong department or inactive).')
      } else {
        setAssignError(err instanceof Error ? err.message : 'Assignment failed')
      }
    } finally {
      setAssignBusy(false)
    }
  }

  if (error) {
    return (
      <aside className="req-detail" aria-label="Request detail">
        <div className="detail-status">
          <p className="req-status-msg">Couldn’t load this request: {error}</p>
          <div className="detail-status-actions">
            <button type="button" className="req-retry" onClick={() => load().catch((err: Error) => setError(err.message))}>
              Try again
            </button>
            <button type="button" className="detail-close-text" onClick={onClose}>
              Back to list
            </button>
          </div>
        </div>
      </aside>
    )
  }

  if (!detail) {
    return (
      <aside className="req-detail" aria-busy="true" aria-label="Request detail">
        <span className="visually-hidden">Loading request…</span>
        <div className="detail-skel" aria-hidden="true">
          <div className="skel-row" style={{ width: '60%' }} />
          <div className="skel-row" />
          <div className="skel-row" style={{ height: 120 }} />
          <div className="skel-row" style={{ height: 180 }} />
        </div>
      </aside>
    )
  }

  const category = detail.status.category
  const assignable = category !== 'terminated' && category !== 'closed'
  const pickable = employees.filter((e) => e.id !== detail.task?.employeeId)

  return (
    <aside className="req-detail" aria-label={`Request #${detail.id} detail`}>
      <header className="detail-head">
        <div>
          <h2>
            <span className="detail-id">#{detail.id}</span> {detail.serviceTypeName}
          </h2>
          <p className="detail-sub">
            <span className={`status-pill${category ? ` is-${category}` : ''}`}>
              <i className="pill-dot" aria-hidden="true" />
              {detail.status.label}
            </span>
            <span className={`req-priority is-${detail.priority}`}>
              {PRIORITY_LABEL[detail.priority] ?? detail.priority} priority
            </span>
            <span className="detail-when">opened {formatDateTime(detail.createdAt)}</span>
          </p>
        </div>
        <button type="button" className="detail-close" onClick={onClose} aria-label="Close detail">
          ×
        </button>
      </header>

      <p className="detail-requester">
        {detail.requester.name} · {detail.requester.email}
        {detail.requester.phone && <> · {detail.requester.phone}</>}
      </p>

      <section className="detail-section" aria-labelledby={`assign-h-${detail.id}`}>
        <h3 id={`assign-h-${detail.id}`}>Assignment</h3>
        {detail.task ? (
          <p className="detail-assignee">
            Assigned to <strong>{detail.task.employeeName}</strong> since{' '}
            {formatDateTime(detail.task.assignedAt)}
          </p>
        ) : (
          <p className="detail-assignee is-none">Not assigned yet</p>
        )}
        {assignable && (
          <div className="assign-row">
            <select
              aria-label={detail.task ? 'Reassign to' : 'Assign to'}
              className="req-select"
              value={pick}
              onChange={(e) => setPick(e.target.value)}
              disabled={assignBusy || pickable.length === 0}
            >
              <option value="">
                {pickable.length === 0 ? 'No other employees in this department' : 'Choose an employee…'}
              </option>
              {pickable.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}
                </option>
              ))}
            </select>
            <button type="button" className="req-retry" onClick={assign} disabled={!pick || assignBusy}>
              {assignBusy ? 'Assigning…' : detail.task ? 'Reassign' : 'Assign'}
            </button>
          </div>
        )}
        {assignError && (
          <p className="assign-error" role="alert">
            {assignError}
          </p>
        )}
      </section>

      <section className="detail-section" aria-labelledby={`form-h-${detail.id}`}>
        <h3 id={`form-h-${detail.id}`}>Request details</h3>
        <dl className="detail-form">
          {(fields.length
            ? fields.map((f) => ({ key: f.id, label: f.label, value: fieldValue(f, detail.formResponse[f.id]) }))
            : Object.entries(detail.formResponse).map(([k, v]) => ({ key: k, label: k, value: String(v) }))
          ).map((row) => (
            <div className="detail-form-row" key={row.key}>
              <dt>{row.label}</dt>
              <dd>{row.value}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="detail-section" aria-labelledby={`tl-h-${detail.id}`}>
        <h3 id={`tl-h-${detail.id}`}>Timeline</h3>
        <ol className="timeline">
          {detail.statusHistory.map((h, i) => (
            <li key={i} className={`tl-item${h.status.category ? ` is-${h.status.category}` : ''}`}>
              <i className="tl-dot" aria-hidden="true" />
              <div className="tl-body">
                <p className="tl-line">
                  <strong>{h.status.label}</strong>
                  <span className="tl-meta">
                    {h.changedBy.name} · {formatDateTime(h.changedAt)}
                  </span>
                </p>
                {h.note && <p className="tl-note">{h.note}</p>}
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section className="detail-section" aria-labelledby={`cm-h-${detail.id}`}>
        <h3 id={`cm-h-${detail.id}`}>Comments</h3>
        {detail.comments.length === 0 ? (
          <p className="detail-empty">No comments yet.</p>
        ) : (
          <ul className="comment-list">
            {detail.comments.map((c) => (
              <li key={c.id}>
                <p className="tl-line">
                  <strong>{c.author.name}</strong>
                  <span className="tl-meta">{formatDateTime(c.createdAt)}</span>
                </p>
                <p className="comment-body">{c.body}</p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="detail-section" aria-labelledby={`att-h-${detail.id}`}>
        <h3 id={`att-h-${detail.id}`}>Attachments</h3>
        {detail.attachments.length === 0 ? (
          <p className="detail-empty">No attachments.</p>
        ) : (
          <ul className="attach-list">
            {detail.attachments.map((a) => (
              <li key={a.id}>
                {a.originalFilename} <span className="tl-meta">· {formatSize(a.sizeBytes)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </aside>
  )
}

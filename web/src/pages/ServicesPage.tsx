import { useCallback, useEffect, useRef, useState } from 'react'
import { apiFetch, ApiError } from '../lib/api'
import { useI18n, type Loc } from '../i18n'
import './RequestsPage.css'
import './EmployeesPage.css'

// Services (§9 config API, admin-only). NOT the visual Workflow Config UI that
// CLAUDE.md §3/§13 rule out: nothing here authors a definition. The admin pastes
// or drops JSON they wrote by hand and this posts it verbatim to
// POST /config/services — a thin renderer over the config API (I4), one screen
// over one call. The 422 list below comes from validateFieldSchema /
// validateWorkflowDefinition, the same seed-time validators, so the API path is
// not a second, weaker code path.
//
// There is no workflow-only endpoint and definitions are immutable once a
// request exists (§3), so this creates whole services only — no editing.

// A minimal VALID body, used by "Load example" as a starting point. Deliberately
// sector-neutral (I1): no file may name a real sector, so the placeholder is
// literally "example_service" — the admin renames every key before posting.
const EXAMPLE = {
  service: {
    key: 'example_service',
    name: { en: 'Example Service', ar: 'خدمة تجريبية' },
    department: { name: { en: 'Example Department', ar: 'قسم تجريبي' } },
    accepts_external_users: true,
    default_priority: 'medium',
  },
  workflow: {
    initial_status: 'submitted',
    statuses: [
      { key: 'submitted', label: { en: 'Submitted', ar: 'مُقدَّم' }, sla_minutes: 240 },
      { key: 'assigned', label: { en: 'Assigned', ar: 'مُسنَد' }, sla_minutes: 1200 },
      { key: 'completed', label: { en: 'Completed', ar: 'مكتمل' }, sla_minutes: 1440 },
      { key: 'resolved', label: { en: 'Resolved', ar: 'تم الحل' }, is_terminal: true },
      { key: 'cancelled', label: { en: 'Cancelled', ar: 'ملغى' }, is_terminal: true },
    ],
    transitions: [
      {
        key: 'assign',
        from: 'submitted',
        to: 'assigned',
        label: { en: 'Assign', ar: 'إسناد' },
        required_capability: 'assign',
        notify: ['created_by', 'assigned_to'],
      },
      {
        key: 'cancel',
        from: 'submitted',
        to: 'cancelled',
        label: { en: 'Cancel request', ar: 'إلغاء الطلب' },
        actor: 'requester',
        requires_note: true,
      },
      {
        key: 'complete',
        from: 'assigned',
        to: 'completed',
        label: { en: 'Complete task', ar: 'إكمال المهمة' },
        actor: 'assignee',
        required_form_key: 'completion',
      },
      {
        key: 'confirm',
        from: 'completed',
        to: 'resolved',
        label: { en: 'Confirm resolution', ar: 'تأكيد الحل' },
        actor: 'requester',
      },
    ],
  },
  forms: {
    request: [
      { id: 'title', label: { en: 'Title', ar: 'العنوان' }, type: 'text', required: true, max: 120 },
      { id: 'details', label: { en: 'Details', ar: 'التفاصيل' }, type: 'multiline', required: false },
      { id: 'where', label: { en: 'Location', ar: 'الموقع' }, type: 'location', required: false },
    ],
    completion: [
      {
        id: 'work_done',
        label: { en: 'Work done', ar: 'العمل المنجز' },
        type: 'multiline',
        required: true,
      },
      { id: 'proof', label: { en: 'Photo', ar: 'صورة' }, type: 'photo', required: false },
    ],
  },
}

interface Service {
  id: number
  ownerLogin: string | null
  ownerName: string | null
  key: string
  name: Loc
  departmentName: Loc
  enabled: boolean
  acceptsExternalUsers: boolean
}

export default function ServicesPage() {
  const { t, L } = useI18n()
  const [services, setServices] = useState<Service[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const [busyKey, setBusyKey] = useState<string | null>(null)
  const [inspecting, setInspecting] = useState<Service | null>(null)
  const [ownerOptions, setOwnerOptions] = useState<
    { id: number; name: string; loginIdentifier: string }[]
  >([])

  // The owner picker needs employees; /config/org already returns them all,
  // so no extra endpoint. loginIdentifier isn't in that payload, so the picker
  // is keyed by it via a second lookup below — see ownerOptions.
  const load = useCallback(async () => {
    const [res, org] = await Promise.all([
      apiFetch<{ services: Service[] }>('/config/services'),
      apiFetch<{ employees: { id: number; name: string; loginIdentifier: string }[] }>('/config/org'),
    ])
    setServices(res.services)
    setOwnerOptions(org.employees)
    setError(null)
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- setError fires only in the async catch, not synchronously
    load().catch((err: Error) => setError(err.message))
  }, [load])

  // Disable, not delete: a service anchors its requests, forms and workflow, so
  // retiring one means dropping it from the catalogue while in-flight requests
  // keep running (§3). Reversible, so no confirmation dialog.
  async function toggle(s: Service) {
    setBusyKey(s.key)
    try {
      await apiFetch(`/config/services/${encodeURIComponent(s.key)}`, {
        method: 'PATCH',
        body: { enabled: !s.enabled },
      })
      await load()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusyKey(null)
    }
  }

  // The owner is the Gate 2 visibility anchor: employees see a service's
  // requests when its owner sits in their subtree. A service with no owner is
  // invisible to everyone, which is the normal state right after onboarding.
  async function setOwner(s: Service, login: string | null) {
    setBusyKey(s.key)
    try {
      await apiFetch(`/config/services/${encodeURIComponent(s.key)}`, {
        method: 'PATCH',
        body: { owner: login },
      })
      await load()
    } catch (err) {
      const b = err instanceof ApiError ? (err.body as { errors?: string[] } | null) : null
      setError(b?.errors?.join(' · ') ?? (err as Error).message)
    } finally {
      setBusyKey(null)
    }
  }

  return (
    <div className="req">
      <header className="req-head">
        <h1>{t('svc_title')}</h1>
        <p className="req-meta">{t('svc_sub')}</p>
      </header>

      <div className="req-filters">
        <div className="control-row">
          <button type="button" className="req-retry emp-add" onClick={() => setOpen(true)}>
            {t('svc_onboard')}
          </button>
        </div>
      </div>

      {error ? (
        <div className="req-status">
          <p className="req-status-msg">
            {t('svc_load_err')} {error}
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
      ) : !services ? (
        <div className="req-skeleton" aria-busy="true">
          <span className="visually-hidden">{t('svc_loading')}</span>
          {Array.from({ length: 5 }, (_, i) => (
            <div className="skel-row" aria-hidden="true" key={i} />
          ))}
        </div>
      ) : services.length === 0 ? (
        <div className="req-empty">
          <h2>{t('svc_none_h')}</h2>
          <p>{t('svc_none_p')}</p>
        </div>
      ) : (
        <div className="req-tablewrap">
          <table className="req-table">
            <thead>
              <tr>
                <th scope="col">{t('svc_col_key')}</th>
                <th scope="col">{t('svc_col_name')}</th>
                <th scope="col">{t('svc_col_department')}</th>
                <th scope="col">{t('svc_col_owner')}</th>
                <th scope="col">{t('svc_col_enabled')}</th>
                <th scope="col">{t('svc_col_external')}</th>
                <th scope="col">{t('col_actions')}</th>
              </tr>
            </thead>
            <tbody>
              {services.map((s) => (
                <tr key={s.key}>
                  <td className="emp-email">
                    <button type="button" className="emp-name-link linkish" onClick={() => setInspecting(s)}>
                      {s.key}
                    </button>
                  </td>
                  <td className="req-service">{L(s.name)}</td>
                  <td>{L(s.departmentName)}</td>
                  <td>
                    <select
                      className="req-select"
                      disabled={busyKey === s.key}
                      value={s.ownerLogin ?? ''}
                      aria-label={`${s.key} — ${t('svc_col_owner')}`}
                      onChange={(e) => void setOwner(s, e.target.value || null)}
                    >
                      <option value="">{t('svc_no_owner')}</option>
                      {ownerOptions.map((o) => (
                        <option key={o.id} value={o.loginIdentifier}>
                          {o.name}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>{s.enabled ? t('svc_yes') : t('svc_no')}</td>
                  <td>{s.acceptsExternalUsers ? t('svc_yes') : t('svc_no')}</td>
                  <td>
                    <button
                      type="button"
                      className={s.enabled ? 'action-btn is-danger' : 'action-btn'}
                      disabled={busyKey === s.key}
                      onClick={() => void toggle(s)}
                    >
                      {s.enabled ? t('svc_disable') : t('svc_enable')}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {inspecting && (
        <DefinitionDialog service={inspecting} onClose={() => setInspecting(null)} />
      )}

      {open && (
        <OnboardDialog
          onClose={() => setOpen(false)}
          onDone={() => {
            setOpen(false)
            load().catch((err: Error) => setError(err.message))
          }}
        />
      )}
    </div>
  )
}

// Read-only view of a service's STORED definition, so an admin can see the
// engine that a POST /config/services call actually produced. Reuses the
// existing renderer endpoints (GET /services/{id}/workflow and
// /services/{id}/forms/{formType}) — the same ones the mobile apps read, so
// what's shown here is exactly what the clients drive off. No editing:
// definitions are immutable once a request exists (§3).
interface WorkflowStatus {
  key: string
  label: Loc
  is_initial?: boolean
  is_terminal?: boolean
  sla_minutes?: number | null
}
interface WorkflowTransition {
  key: string
  from: string
  to: string
  label: Loc
  required_capability?: string | null
  actor?: string | null
  required_form_key?: string | null
  requires_note?: boolean
}
interface FormField {
  id: string
  label: Loc
  type: string
  required?: boolean
}

function DefinitionDialog({ service, onClose }: { service: Service; onClose: () => void }) {
  const { t, L } = useI18n()
  const [wf, setWf] = useState<{ statuses: WorkflowStatus[]; transitions: WorkflowTransition[] } | null>(null)
  const [forms, setForms] = useState<{ request: FormField[]; completion: FormField[] } | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  useEffect(() => {
    let live = true
    Promise.all([
      apiFetch<{ statuses: WorkflowStatus[]; transitions: WorkflowTransition[] }>(
        `/services/${service.id}/workflow`,
      ),
      apiFetch<{ fields: FormField[] }>(`/services/${service.id}/forms/request`),
      apiFetch<{ fields: FormField[] }>(`/services/${service.id}/forms/completion`),
    ])
      .then(([w, req, comp]) => {
        if (!live) return
        setWf(w)
        setForms({ request: req.fields, completion: comp.fields })
      })
      .catch((err: Error) => live && setError(err.message))
    return () => {
      live = false
    }
  }, [service.id])

  // A transition is gated by exactly one of capability (oversight) or actor
  // (whose turn it is) — show which, never invent a third notion of authority.
  function gate(tr: WorkflowTransition) {
    if (tr.required_capability) return `${t('svc_gate_cap')}: ${tr.required_capability}`
    if (tr.actor) return `${t('svc_gate_actor')}: ${tr.actor}`
    return '—'
  }

  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div
        className="dialog svc-dialog"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <h4>{L(service.name)}</h4>
        <p className="req-status-msg emp-email">{service.key}</p>

        {error ? (
          <p className="assign-error">{error}</p>
        ) : !wf || !forms ? (
          <p className="req-status-msg">{t('svc_def_loading')}</p>
        ) : (
          <div className="svc-def">
            <h5>{t('svc_def_statuses')}</h5>
            <ul className="svc-def-list">
              {wf.statuses.map((s) => (
                <li key={s.key}>
                  <code>{s.key}</code> — {L(s.label)}
                  {s.is_initial && <span className="org-cap"> {t('svc_def_initial')}</span>}
                  {s.is_terminal && <span className="org-cap"> {t('svc_def_terminal')}</span>}
                  {s.sla_minutes ? (
                    <span className="org-cap"> {t('svc_def_sla')}: {s.sla_minutes}</span>
                  ) : null}
                </li>
              ))}
            </ul>

            <h5>{t('svc_def_transitions')}</h5>
            <ul className="svc-def-list">
              {wf.transitions.map((tr) => (
                <li key={tr.key}>
                  <code>
                    {tr.from} → {tr.to}
                  </code>{' '}
                  — {L(tr.label)}
                  <span className="org-cap"> {gate(tr)}</span>
                  {tr.required_form_key && (
                    <span className="org-cap"> {t('svc_def_form')}: {tr.required_form_key}</span>
                  )}
                  {tr.requires_note && <span className="org-cap"> {t('svc_def_note')}</span>}
                </li>
              ))}
            </ul>

            {(['request', 'completion'] as const).map((kind) => (
              <div key={kind}>
                <h5>{kind === 'request' ? t('svc_def_form_request') : t('svc_def_form_completion')}</h5>
                <ul className="svc-def-list">
                  {forms[kind].map((f) => (
                    <li key={f.id}>
                      <code>{f.id}</code> — {L(f.label)}
                      <span className="org-cap"> {f.type}</span>
                      {f.required && <span className="org-cap"> {t('svc_def_required')}</span>}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
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

function OnboardDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { t } = useI18n()
  const [text, setText] = useState('')
  const [errors, setErrors] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // A dropped/picked file just fills the textarea — one payload, one submit,
  // one error surface, rather than a second upload path.
  async function readFile(file: File | undefined) {
    if (!file) return
    setText(await file.text())
    setErrors([])
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setErrors([])
    let body: unknown
    try {
      body = JSON.parse(text)
    } catch (err) {
      // Parse locally so a typo doesn't cost a round trip; the server still
      // re-validates everything (I8).
      setErrors([`${t('svc_bad_json')} ${(err as Error).message}`])
      return
    }
    setBusy(true)
    try {
      await apiFetch('/config/services', { method: 'POST', body })
      onDone()
    } catch (err) {
      if (err instanceof ApiError) {
        const b = err.body as { errors?: string[]; error?: string } | null
        setErrors(b?.errors ?? [b?.error ?? err.message])
      } else {
        setErrors([(err as Error).message])
      }
      setBusy(false)
    }
  }

  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <form className="dialog svc-dialog" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <h4>{t('svc_onboard')}</h4>
        <p className="req-status-msg">{t('svc_onboard_hint')}</p>

        <div className="control-row">
          <button
            type="button"
            className="action-btn"
            onClick={() => setText(JSON.stringify(EXAMPLE, null, 2))}
          >
            {t('svc_load_example')}
          </button>
          <button type="button" className="action-btn" onClick={() => fileRef.current?.click()}>
            {t('svc_choose_file')}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            className="visually-hidden"
            onChange={(e) => void readFile(e.target.files?.[0])}
          />
        </div>

        <label className="field">
          <span>{t('svc_json')}</span>
          <textarea
            className="svc-textarea"
            value={text}
            spellCheck={false}
            dir="ltr"
            placeholder={t('svc_json_placeholder')}
            onChange={(e) => setText(e.target.value)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault()
              void readFile(e.dataTransfer.files?.[0])
            }}
          />
        </label>

        {errors.map((msg) => (
          <p className="assign-error" key={msg}>
            {msg}
          </p>
        ))}

        <div className="dialog-actions">
          <button type="button" className="detail-close-text" onClick={onClose}>
            {t('cancel')}
          </button>
          <button type="submit" className="req-retry" disabled={busy || !text.trim()}>
            {t('svc_create')}
          </button>
        </div>
      </form>
    </div>
  )
}

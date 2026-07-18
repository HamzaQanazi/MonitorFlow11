import { useCallback, useEffect, useState } from 'react'
import { apiFetch, ApiError } from '../lib/api'
import { useI18n } from '../i18n'
import './RequestsPage.css'
import './EmployeesPage.css'

// Webhooks (§9, admin-only). A thin renderer over the existing config API:
// GET/POST/DELETE /config/webhooks. The secret is write-only — the server
// never returns it, so it is entered once here and then never shown again.

// The four events lib/webhooks.js fires. Closed list, mirrored from EVENTS.
const EVENTS = ['request_created', 'status_changed', 'assigned', 'sla_breached']

interface Webhook {
  id: number
  url: string
  events: string[]
  is_active: boolean
  created_at: string
}

export default function WebhooksPage() {
  const { t } = useI18n()
  const [hooks, setHooks] = useState<Webhook[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [dialog, setDialog] = useState<{ kind: 'create' } | { kind: 'delete'; hook: Webhook } | null>(null)

  const load = useCallback(async () => {
    const res = await apiFetch<{ webhooks: Webhook[] }>('/config/webhooks')
    setHooks(res.webhooks)
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
        <h1>{t('wh_title')}</h1>
        <p className="req-meta">{t('wh_sub')}</p>
      </header>

      <div className="req-filters">
        <div className="control-row">
          <button type="button" className="req-retry emp-add" onClick={() => setDialog({ kind: 'create' })}>
            {t('wh_add')}
          </button>
        </div>
      </div>

      {error ? (
        <div className="req-status">
          <p className="req-status-msg">
            {t('wh_load_err')} {error}
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
      ) : !hooks ? (
        <div className="req-skeleton" aria-busy="true">
          <span className="visually-hidden">{t('wh_loading')}</span>
          {Array.from({ length: 3 }, (_, i) => (
            <div className="skel-row" aria-hidden="true" key={i} />
          ))}
        </div>
      ) : hooks.length === 0 ? (
        <div className="req-empty">
          <h2>{t('wh_none_h')}</h2>
          <p>{t('wh_none_p')}</p>
        </div>
      ) : (
        <div className="req-tablewrap">
          <table className="req-table">
            <thead>
              <tr>
                <th scope="col">{t('wh_col_url')}</th>
                <th scope="col">{t('wh_col_events')}</th>
                <th scope="col">{t('col_when')}</th>
                <th scope="col">{t('col_actions')}</th>
              </tr>
            </thead>
            <tbody>
              {hooks.map((h) => (
                <tr key={h.id}>
                  <td className="emp-email">{h.url}</td>
                  <td className="req-service">{h.events.map((e) => t(`wh_ev_${e}`)).join(' · ')}</td>
                  <td>{new Date(h.created_at).toLocaleString()}</td>
                  <td>
                    <button
                      type="button"
                      className="action-btn is-danger"
                      onClick={() => setDialog({ kind: 'delete', hook: h })}
                    >
                      {t('wh_delete')}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {dialog?.kind === 'create' && <WebhookForm onClose={() => setDialog(null)} onDone={onDone} />}
      {dialog?.kind === 'delete' && (
        <DeleteDialog hook={dialog.hook} onClose={() => setDialog(null)} onDone={onDone} />
      )}
    </div>
  )
}

function WebhookForm({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { t } = useI18n()
  const [url, setUrl] = useState('')
  // Prefilled so the admin doesn't invent a weak one; the server floor is 8 chars.
  const [secret, setSecret] = useState<string>(() => crypto.randomUUID())
  const [events, setEvents] = useState<string[]>([])
  const [errors, setErrors] = useState<string[]>([])
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  function toggle(ev: string) {
    setEvents((prev) => (prev.includes(ev) ? prev.filter((e) => e !== ev) : [...prev, ev]))
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setErrors([])
    try {
      await apiFetch('/config/webhooks', { method: 'POST', body: { url, secret, events } })
      onDone()
    } catch (err) {
      // 422 carries `{ errors: string[] }` from the config route.
      const body = err instanceof ApiError ? (err.body as { errors?: string[] } | null) : null
      setErrors(body?.errors ?? [(err as Error).message])
      setBusy(false)
    }
  }

  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <form className="dialog" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <h4>{t('wh_add')}</h4>
        <label className="field">
          <span>{t('wh_url')}</span>
          <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://" autoFocus />
        </label>
        <label className="field">
          <span>{t('wh_secret')}</span>
          <input value={secret} onChange={(e) => setSecret(e.target.value)} />
        </label>
        <p className="req-status-msg">{t('wh_secret_hint')}</p>
        <fieldset className="field wh-events">
          <legend>{t('wh_events')}</legend>
          {EVENTS.map((ev) => (
            <label key={ev} className="wh-check">
              <input type="checkbox" checked={events.includes(ev)} onChange={() => toggle(ev)} />
              <span>{t(`wh_ev_${ev}`)}</span>
            </label>
          ))}
        </fieldset>
        {errors.map((msg) => (
          <p className="assign-error" key={msg}>
            {msg}
          </p>
        ))}
        <div className="dialog-actions">
          <button type="button" className="detail-close-text" onClick={onClose}>
            {t('cancel')}
          </button>
          <button type="submit" className="req-retry" disabled={busy}>
            {t('wh_create')}
          </button>
        </div>
      </form>
    </div>
  )
}

function DeleteDialog({ hook, onClose, onDone }: { hook: Webhook; onClose: () => void; onDone: () => void }) {
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
      await apiFetch(`/config/webhooks/${hook.id}`, { method: 'DELETE' })
      onDone()
    } catch (err) {
      setError((err as Error).message)
      setBusy(false)
    }
  }

  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div className="dialog" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <h4>{t('wh_delete_q')}</h4>
        <p className="req-status-msg emp-email">{hook.url}</p>
        <p className="req-status-msg">{t('wh_delete_warn')}</p>
        {error && <p className="assign-error">{error}</p>}
        <div className="dialog-actions">
          <button type="button" className="detail-close-text" onClick={onClose}>
            {t('cancel')}
          </button>
          <button type="button" className="req-retry is-danger" onClick={confirm} disabled={busy}>
            {t('wh_delete')}
          </button>
        </div>
      </div>
    </div>
  )
}

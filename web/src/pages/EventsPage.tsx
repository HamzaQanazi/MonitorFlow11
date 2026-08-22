import { useCallback, useEffect, useState } from 'react'
import { apiFetch, ApiError } from '../lib/api'
import { useI18n, type Loc } from '../i18n'
import { TranslateButton } from '../components/TranslateButton'
import './RequestsPage.css'
import './EmployeesPage.css'
import './KnowledgeBasePage.css'

// Events (communication feature group, onboarding wizard). Company calendar +
// self-service RSVP. Write access is view_all or admin (same gate as
// Knowledge Base); every admin/employee can read and RSVP.

interface Event {
  id: number
  title: Loc
  description: Loc | null
  startsAt: string
  endsAt: string | null
  location: string | null
  createdByName: string
  attendeeCount: number
  isGoing: boolean
}
type FieldErrors = Record<string, string>

function fieldErrorsOf(err: unknown): FieldErrors {
  if (err instanceof ApiError && err.body && typeof err.body === 'object') {
    const errors = (err.body as { errors?: unknown }).errors
    if (errors && typeof errors === 'object') return errors as FieldErrors
  }
  return {}
}

// <input type="datetime-local"> reads/writes local time with no timezone
// suffix; new Date(...).toISOString() round-trips it to the UTC wire format.
function toLocalInputValue(iso: string): string {
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export default function EventsPage() {
  const { t, L } = useI18n()
  const [events, setEvents] = useState<Event[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [rsvpBusy, setRsvpBusy] = useState<number | null>(null)

  const [dialog, setDialog] = useState<
    | { kind: 'view'; event: Event }
    | { kind: 'create' }
    | { kind: 'edit'; event: Event }
    | { kind: 'delete'; event: Event }
    | null
  >(null)

  const load = useCallback(async () => {
    const res = await apiFetch<{ events: Event[] }>('/events')
    setEvents(res.events)
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

  async function toggleRsvp(ev: Event) {
    setRsvpBusy(ev.id)
    try {
      await apiFetch(`/events/${ev.id}/rsvp`, { method: ev.isGoing ? 'DELETE' : 'POST' })
      await load()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setRsvpBusy(null)
    }
  }

  // Splits the list into two display buckets, refreshed on each 30s poll —
  // a StrictMode/concurrent double-render calling this microseconds apart
  // never puts an event on the wrong side of a real boundary that matters.
  // eslint-disable-next-line react-hooks/purity -- see comment above
  const now = Date.now()
  const upcoming = (events ?? []).filter((e) => new Date(e.startsAt).getTime() >= now)
  // Newest first for what's already happened — the server sorts ascending,
  // which is right for what's coming and backwards for what's gone.
  const past = (events ?? [])
    .filter((e) => new Date(e.startsAt).getTime() < now)
    .slice()
    .reverse()

  function row(ev: Event) {
    return (
      <tr key={ev.id}>
        <td className="req-service">
          <button type="button" className="kb-title-btn" onClick={() => setDialog({ kind: 'view', event: ev })}>
            {L(ev.title)}
          </button>
        </td>
        <td>{new Date(ev.startsAt).toLocaleString()}</td>
        <td>{ev.location ?? '—'}</td>
        <td>{ev.attendeeCount}</td>
        <td className="emp-actions">
          <button
            type="button"
            className={`action-btn${ev.isGoing ? ' is-danger' : ''}`}
            disabled={rsvpBusy === ev.id}
            onClick={() => toggleRsvp(ev)}
          >
            {ev.isGoing ? t('ev_leave') : t('ev_join')}
          </button>
          <button type="button" className="action-btn" onClick={() => setDialog({ kind: 'edit', event: ev })}>
            {t('kb_edit')}
          </button>
          <button type="button" className="action-btn is-danger" onClick={() => setDialog({ kind: 'delete', event: ev })}>
            {t('kb_delete')}
          </button>
        </td>
      </tr>
    )
  }

  return (
    <div className="req">
      <header className="req-head">
        <h1>{t('ev_title')}</h1>
        {events && (
          <p className="req-meta">
            {events.length} {events.length === 1 ? t('ev_event_word') : t('ev_events_word')}
          </p>
        )}
        <button type="button" className="req-retry emp-add" onClick={() => setDialog({ kind: 'create' })}>
          {t('ev_add')}
        </button>
      </header>

      {error ? (
        <div className="req-status">
          <p className="req-status-msg">
            {t('ev_load_err')} {error}
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
      ) : !events ? (
        <div className="req-skeleton" aria-busy="true">
          <span className="visually-hidden">{t('ev_loading')}</span>
          {Array.from({ length: 4 }, (_, i) => (
            <div className="skel-row" aria-hidden="true" key={i} />
          ))}
        </div>
      ) : events.length === 0 ? (
        <div className="req-empty">
          <h2>{t('ev_none_h')}</h2>
          <p>{t('ev_none_p')}</p>
        </div>
      ) : (
        <>
          <div className="req-tablewrap">
            <table className="req-table">
              <thead>
                <tr>
                  <th scope="col">{t('col_title')}</th>
                  <th scope="col">{t('ev_col_when')}</th>
                  <th scope="col">{t('ev_col_where')}</th>
                  <th scope="col">{t('ev_col_going')}</th>
                  <th scope="col" className="emp-actions-col">
                    {t('col_actions')}
                  </th>
                </tr>
              </thead>
              <tbody>{upcoming.map(row)}</tbody>
            </table>
            {upcoming.length === 0 && (
              <div className="req-empty">
                <h2>{t('ev_none_upcoming_h')}</h2>
              </div>
            )}
          </div>
          {past.length > 0 && (
            <>
              <h2 className="lvl-h2">{t('ev_past')}</h2>
              <div className="req-tablewrap">
                <table className="req-table">
                  <thead>
                    <tr>
                      <th scope="col">{t('col_title')}</th>
                      <th scope="col">{t('ev_col_when')}</th>
                      <th scope="col">{t('ev_col_where')}</th>
                      <th scope="col">{t('ev_col_going')}</th>
                      <th scope="col" className="emp-actions-col">
                        {t('col_actions')}
                      </th>
                    </tr>
                  </thead>
                  <tbody>{past.map(row)}</tbody>
                </table>
              </div>
            </>
          )}
        </>
      )}

      {dialog?.kind === 'view' && (
        <EventDetail
          event={dialog.event}
          onClose={() => setDialog(null)}
          onEdit={() => setDialog({ kind: 'edit', event: dialog.event })}
        />
      )}
      {dialog?.kind === 'create' && <EventForm onClose={() => setDialog(null)} onDone={onDone} />}
      {dialog?.kind === 'edit' && (
        <EventForm event={dialog.event} onClose={() => setDialog(null)} onDone={onDone} />
      )}
      {dialog?.kind === 'delete' && (
        <DeleteDialog event={dialog.event} onClose={() => setDialog(null)} onDone={onDone} />
      )}
    </div>
  )
}

// The description and the attendee list were both stored and both invisible:
// the table showed a count, and GET /events/:id (which returns the names) had
// no caller at all. Fetches on open so the names are current.
function EventDetail({ event, onClose, onEdit }: { event: Event; onClose: () => void; onEdit: () => void }) {
  const { t, L, lang } = useI18n()
  const [attendees, setAttendees] = useState<string[] | null>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  useEffect(() => {
    apiFetch<{ event: { attendeeNames?: string[] } }>(`/events/${event.id}`)
      .then((res) => setAttendees(res.event.attendeeNames ?? []))
      .catch(() => setAttendees([]))
  }, [event.id])

  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div className="dialog kb-read" role="dialog" aria-modal="true" aria-label={L(event.title)} onClick={(e) => e.stopPropagation()}>
        <h4>{L(event.title)}</h4>
        <p className="kb-read-meta">
          {new Date(event.startsAt).toLocaleString()}
          {event.endsAt ? ` – ${new Date(event.endsAt).toLocaleString()}` : ''}
          {event.location ? ` · ${event.location}` : ''}
        </p>
        {event.description && (
          <div className="kb-read-body" dir={lang === 'ar' ? 'rtl' : 'ltr'}>
            {L(event.description)}
          </div>
        )}
        <p className="kb-read-meta">
          {t('ev_col_going')}: {event.attendeeCount}
        </p>
        {attendees === null ? (
          <p className="kb-read-meta">{t('ev_loading')}</p>
        ) : attendees.length > 0 ? (
          <ul className="ev-attendees">
            {attendees.map((name, i) => (
              <li key={i}>{name}</li>
            ))}
          </ul>
        ) : (
          <p className="kb-read-meta">{t('ev_no_attendees')}</p>
        )}
        <div className="dialog-actions">
          <button type="button" className="action-btn" onClick={onEdit}>
            {t('kb_edit')}
          </button>
          <button type="button" className="req-retry" onClick={onClose}>
            {t('close')}
          </button>
        </div>
      </div>
    </div>
  )
}

function EventForm({ event, onClose, onDone }: { event?: Event; onClose: () => void; onDone: () => void }) {
  const { t } = useI18n()
  const isEdit = !!event
  const [titleEn, setTitleEn] = useState(event?.title.en ?? '')
  const [titleAr, setTitleAr] = useState(event?.title.ar ?? '')
  const [descEn, setDescEn] = useState(event?.description?.en ?? '')
  const [descAr, setDescAr] = useState(event?.description?.ar ?? '')
  const [startsAt, setStartsAt] = useState(event ? toLocalInputValue(event.startsAt) : '')
  const [endsAt, setEndsAt] = useState(event?.endsAt ? toLocalInputValue(event.endsAt) : '')
  const [location, setLocation] = useState(event?.location ?? '')
  const [errors, setErrors] = useState<FieldErrors>({})
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const canSubmit = titleEn.trim() && titleAr.trim() && startsAt

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setErrors({})
    const body = {
      title: { en: titleEn, ar: titleAr },
      description: descEn.trim() && descAr.trim() ? { en: descEn, ar: descAr } : null,
      startsAt: new Date(startsAt).toISOString(),
      endsAt: endsAt ? new Date(endsAt).toISOString() : null,
      location: location.trim() || null,
    }
    try {
      if (isEdit) {
        await apiFetch(`/events/${event!.id}`, { method: 'PATCH', body })
      } else {
        await apiFetch('/events', { method: 'POST', body })
      }
      onDone()
    } catch (err) {
      const fe = fieldErrorsOf(err)
      setErrors(Object.keys(fe).length ? fe : { _: t('ev_err_save') })
      setBusy(false)
    }
  }

  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <form className="dialog svc-dialog" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <h4>{isEdit ? t('ev_edit_h') : t('ev_create_h')}</h4>
        {errors._ && <p className="assign-error">{errors._}</p>}
        <label className="field">
          {t('kb_title_en')}
          <input value={titleEn} onChange={(e) => setTitleEn(e.target.value)} required autoFocus />
          {errors.title && <em className="field-err">{errors.title}</em>}
        </label>
        <label className="field">
          {t('kb_title_ar')}
          <input value={titleAr} onChange={(e) => setTitleAr(e.target.value)} required dir="rtl" />
        </label>
        <TranslateButton en={titleEn} ar={titleAr} setEn={setTitleEn} setAr={setTitleAr} />
        <label className="field">
          {t('ev_desc_en')}
          <textarea className="kb-textarea" value={descEn} onChange={(e) => setDescEn(e.target.value)} />
        </label>
        <label className="field">
          {t('ev_desc_ar')}
          <textarea className="kb-textarea" value={descAr} onChange={(e) => setDescAr(e.target.value)} dir="rtl" />
          {errors.description && <em className="field-err">{errors.description}</em>}
        </label>
        <TranslateButton en={descEn} ar={descAr} setEn={setDescEn} setAr={setDescAr} />
        <label className="field">
          {t('ev_starts_at')}
          <input type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} required />
          {errors.startsAt && <em className="field-err">{errors.startsAt}</em>}
        </label>
        <label className="field">
          {t('ev_ends_at')}
          <input type="datetime-local" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} />
          {errors.endsAt && <em className="field-err">{errors.endsAt}</em>}
        </label>
        <label className="field">
          {t('ev_location')}
          <input value={location} onChange={(e) => setLocation(e.target.value)} />
        </label>
        <div className="dialog-actions">
          <button type="button" className="detail-close-text" onClick={onClose}>
            {t('cancel')}
          </button>
          <button type="submit" className="req-retry" disabled={busy || !canSubmit}>
            {isEdit ? t('save') : t('ev_create')}
          </button>
        </div>
      </form>
    </div>
  )
}

function DeleteDialog({ event, onClose, onDone }: { event: Event; onClose: () => void; onDone: () => void }) {
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
      await apiFetch(`/events/${event.id}`, { method: 'DELETE' })
      onDone()
    } catch (err) {
      setError((err as Error).message)
      setBusy(false)
    }
  }

  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        <h4>
          {t('kb_delete_q_pre')} {L(event.title)}?
        </h4>
        {error && <p className="assign-error">{error}</p>}
        <div className="dialog-actions">
          <button type="button" className="detail-close-text" onClick={onClose}>
            {t('cancel')}
          </button>
          <button type="button" className="req-retry is-danger" onClick={confirm} disabled={busy}>
            {t('kb_delete')}
          </button>
        </div>
      </div>
    </div>
  )
}

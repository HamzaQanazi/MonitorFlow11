import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { apiFetch, ApiError } from '../lib/api'
import { useAuth } from '../auth/AuthContext'
import { useI18n } from '../i18n'
import { TranslateButton } from '../components/TranslateButton'
import { TranslateAllButton } from '../components/TranslateAllButton'
import './RequestsPage.css'
import './EmployeesPage.css'
import './ChecklistsPage.css'

// Forms & Checklists dashboard. A checklist is just a service_type tagged
// feature_key = 'forms_checklists' — this page adds no engine concept, it
// only renders GET /checklists/stats and (admin only) creates new templates
// through the existing generic POST /services, with the checklist-specific
// shape (workflow, feature tag) fixed here rather than exposed as a full
// statuses/transitions/capability editor like Add Service. No due-date/
// cadence engine exists, so the stats are real submitted/logged counts, not
// an invented "expected count" ratio (see checklists.js).

interface ChecklistTemplateStats {
  serviceTypeId: number
  name: { en: string; ar: string }
  submittedToday: number
  loggedToday: number
  submittedTotal: number
  loggedTotal: number
  lastSubmittedAt: string | null
}
interface StatsResponse {
  templates: ChecklistTemplateStats[]
}

const ITEM_TYPES = ['checkbox', 'text', 'multiline', 'number', 'date', 'photo'] as const
type ItemType = (typeof ITEM_TYPES)[number]

interface ItemRow {
  rid: string
  labelEn: string
  labelAr: string
  type: ItemType
  required: boolean
}
function newItemRow(): ItemRow {
  return { rid: crypto.randomUUID(), labelEn: '', labelAr: '', type: 'checkbox', required: true }
}

// Same slugging the backend does for service keys (routes/services.js
// slugify) — item ids just need to be unique, non-empty, ASCII.
function slugify(s: string, fallback: string): string {
  const base = s
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
  return base || fallback
}

interface EmployeeOption {
  id: number
  name: string
}
interface Department {
  id: number
  name: { en: string; ar: string }
}

export default function ChecklistsPage() {
  const { t, lang } = useI18n()
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'

  const [data, setData] = useState<StatsResponse | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function load() {
    setError(null)
    const res = await apiFetch<StatsResponse>('/checklists/stats')
    setData(res)
  }

  useEffect(() => {
    // False positive: every setState here happens after the fetch resolves,
    // but the rule can't see through load().
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load().catch((err: Error) => setError(err.message))
  }, [])

  return (
    <div className="req">
      <header className="req-head">
        <h1>{t('cl_title')}</h1>
      </header>

      {error ? (
        <div className="req-status">
          <p className="req-status-msg">
            {t('cl_load_err')} {error}
          </p>
          <button
            type="button"
            className="req-retry"
            onClick={() => load().catch((err: Error) => setError(err.message))}
          >
            {t('try_again')}
          </button>
        </div>
      ) : !data ? (
        <div className="req-skeleton" aria-busy="true">
          <span className="visually-hidden">{t('cl_loading')}</span>
          {Array.from({ length: 3 }, (_, i) => (
            <div className="skel-row" aria-hidden="true" key={i} />
          ))}
        </div>
      ) : (
        <>
          {data.templates.length === 0 ? (
            <div className="req-empty">
              <h2>{t('cl_none_h')}</h2>
              <p>{t('cl_none_p')}</p>
            </div>
          ) : (
            <div className="cl-grid">
              {data.templates.map((tpl) => (
                <div className="cl-card" key={tpl.serviceTypeId}>
                  <h3 className="cl-card-title">
                    <Link to={`/requests?service=${tpl.serviceTypeId}`}>{tpl.name[lang] ?? tpl.name.en}</Link>
                  </h3>
                  <div className="cl-card-stats">
                    <Link className="cl-stat" to={`/requests?service=${tpl.serviceTypeId}`}>
                      <span className="cl-stat-num">{tpl.submittedToday}</span>
                      <span className="cl-stat-label">{t('cl_submitted_today')}</span>
                    </Link>
                    <Link className="cl-stat" to={`/requests?service=${tpl.serviceTypeId}&state=closed`}>
                      <span className="cl-stat-num">{tpl.loggedToday}</span>
                      <span className="cl-stat-label">{t('cl_logged_today')}</span>
                    </Link>
                  </div>
                  <p className="cl-card-foot">
                    {t('cl_all_time')} {tpl.loggedTotal}/{tpl.submittedTotal}
                    {tpl.lastSubmittedAt && (
                      <>
                        {' · '}
                        {t('cl_last')}{' '}
                        {new Date(tpl.lastSubmittedAt).toLocaleString(lang === 'ar' ? 'ar' : 'en', {
                          dateStyle: 'medium',
                          timeStyle: 'short',
                        })}
                      </>
                    )}
                  </p>
                </div>
              ))}
            </div>
          )}

          {isAdmin && <NewChecklistPanel onCreated={() => load()} />}
        </>
      )}
    </div>
  )
}

function NewChecklistPanel({ onCreated }: { onCreated: () => void }) {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  const [departments, setDepartments] = useState<Department[]>([])
  const [employees, setEmployees] = useState<EmployeeOption[]>([])
  const [loadError, setLoadError] = useState(false)

  const [nameEn, setNameEn] = useState('')
  const [nameAr, setNameAr] = useState('')
  const [ownerId, setOwnerId] = useState('')
  const [items, setItems] = useState<ItemRow[]>([newItemRow()])
  const [busy, setBusy] = useState(false)
  const [saveError, setSaveError] = useState('')

  useEffect(() => {
    if (!open || departments.length || employees.length) return
    Promise.all([
      apiFetch<{ departments: Department[] }>('/departments'),
      apiFetch<{ employees: EmployeeOption[] }>('/employees?pageSize=100'),
    ])
      .then(([d, e]) => {
        setDepartments(d.departments)
        setEmployees(e.employees)
      })
      .catch(() => setLoadError(true))
  }, [open, departments.length, employees.length])

  function updateItem(i: number, patch: Partial<ItemRow>) {
    setItems((rows) => rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)))
  }
  function removeItem(i: number) {
    setItems((rows) => rows.filter((_, idx) => idx !== i))
  }

  async function save() {
    setSaveError('')
    if (!nameEn.trim() || !nameAr.trim() || !ownerId || !departments.length) {
      setSaveError(t('cl_new_err_required'))
      return
    }
    const seenIds = new Set<string>()
    const requestFields = items.map((row, i) => {
      let id = slugify(row.labelEn, `item_${i + 1}`)
      while (seenIds.has(id)) id = `${id}_${i + 1}`
      seenIds.add(id)
      return { id, label: { en: row.labelEn, ar: row.labelAr }, type: row.type, required: row.required }
    })

    setBusy(true)
    try {
      await apiFetch('/services', {
        method: 'POST',
        body: {
          name: { en: nameEn, ar: nameAr },
          departmentId: departments[0].id,
          defaultPriority: 'low',
          acceptsExternalUsers: false,
          acceptsEmployeeSubmitters: true,
          featureKey: 'forms_checklists',
          ownerId: Number(ownerId),
          requestFields,
          completionFields: [{ id: 'notes', label: { en: 'Notes', ar: 'ملاحظات' }, type: 'text', required: false }],
          statuses: [
            { key: 'submitted', label: { en: 'Submitted', ar: 'تم الإرسال' }, is_initial: true, is_terminal: false },
            { key: 'logged', label: { en: 'Logged', ar: 'مسجَّل' }, is_initial: false, is_terminal: true },
          ],
          transitions: [
            {
              key: 'log',
              from: 'submitted',
              to: 'logged',
              label: { en: 'Submit', ar: 'إرسال' },
              required_capability: null,
              actor: 'requester',
              required_form_key: null,
              requires_note: false,
              notify: [],
            },
          ],
        },
      })
      setNameEn('')
      setNameAr('')
      setOwnerId('')
      setItems([newItemRow()])
      setOpen(false)
      onCreated()
    } catch (err) {
      if (err instanceof ApiError && err.status === 422) {
        const body = err.body as { errors?: unknown } | undefined
        setSaveError(Array.isArray(body?.errors) ? body!.errors.join(' · ') : t('cl_new_err_save'))
      } else {
        setSaveError(t('cl_new_err_save'))
      }
    } finally {
      setBusy(false)
    }
  }

  if (!open) {
    return (
      <button type="button" className="req-retry cl-new-toggle" onClick={() => setOpen(true)}>
        {t('cl_new_open')}
      </button>
    )
  }

  return (
    <div className="cl-builder">
      <div className="cl-builder-head">
        <h3>{t('cl_new_h')}</h3>
        <button type="button" className="req-retry" onClick={() => setOpen(false)}>
          {t('cancel')}
        </button>
      </div>

      {loadError ? (
        <p className="req-status-msg">{t('svc_err_load')}</p>
      ) : (
        <>
          <div className="cl-builder-basics">
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
              <span>{t('svc_owner')}</span>
              <select className="req-select" value={ownerId} onChange={(e) => setOwnerId(e.target.value)}>
                <option value="">{t('ob_select')}</option>
                {employees.map((emp) => (
                  <option key={emp.id} value={emp.id}>
                    {emp.name}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="cl-builder-items">
            <TranslateAllButton
              rows={items}
              getEn={(r) => r.labelEn}
              getAr={(r) => r.labelAr}
              setPair={(i, en, ar) => updateItem(i, { labelEn: en, labelAr: ar })}
            />
            {items.map((row, i) => (
              <div className="cl-item-row" key={row.rid}>
                <input
                  placeholder={t('svc_field_label_en')}
                  value={row.labelEn}
                  onChange={(e) => updateItem(i, { labelEn: e.target.value })}
                />
                <input
                  placeholder={t('svc_field_label_ar')}
                  dir="rtl"
                  value={row.labelAr}
                  onChange={(e) => updateItem(i, { labelAr: e.target.value })}
                />
                <select
                  className="req-select"
                  value={row.type}
                  onChange={(e) => updateItem(i, { type: e.target.value as ItemType })}
                >
                  {ITEM_TYPES.map((it) => (
                    <option key={it} value={it}>
                      {t(`field_type_${it}`)}
                    </option>
                  ))}
                </select>
                <label className="cl-item-required">
                  <input
                    type="checkbox"
                    checked={row.required}
                    onChange={(e) => updateItem(i, { required: e.target.checked })}
                  />
                  {t('svc_required')}
                </label>
                <button
                  type="button"
                  className="cl-item-remove"
                  onClick={() => removeItem(i)}
                  disabled={items.length === 1}
                  aria-label={t('svc_remove')}
                >
                  ×
                </button>
              </div>
            ))}
            <button type="button" className="req-retry" onClick={() => setItems((rows) => [...rows, newItemRow()])}>
              {t('cl_add_item')}
            </button>
          </div>

          {saveError && <p className="req-status-msg">{saveError}</p>}

          <button type="button" className="cl-save-btn" onClick={() => void save()} disabled={busy}>
            {busy ? t('cl_saving') : t('cl_save_template')}
          </button>
        </>
      )}
    </div>
  )
}

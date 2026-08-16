import { useCallback, useEffect, useState } from 'react'
import { apiFetch, ApiError, getToken } from '../lib/api'
import { useI18n, type Loc } from '../i18n'
import './RequestsPage.css'
import './EmployeesPage.css'
import './KnowledgeBasePage.css'
import './OnboardingWizard.css'

// Training & Onboarding (hr_skills feature group, onboarding wizard). Same
// shape as Knowledge Base plus self-service completion (mirrors Events' RSVP).
// Optional attachment ("cheap version" of a more versatile module, §11): a
// module can carry one PDF/image via the existing /files upload — reusing
// the request-detail download pattern below, since it needs the same auth
// header a plain <a href> can't carry.

interface Attachment {
  id: string
  originalFilename: string
  mimeType: string
  sizeBytes: number
}

interface TrainingModule {
  id: number
  title: Loc
  body: Loc
  createdByName: string
  updatedAt: string
  completionCount: number
  isComplete: boolean
  attachment: Attachment | null
}
type FieldErrors = Record<string, string>

async function downloadAttachment(id: string, filename: string) {
  const res = await fetch(`/api/v1/files/${id}`, {
    headers: { Authorization: `Bearer ${getToken() ?? ''}` },
  })
  if (!res.ok) return
  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

function formatSize(bytes: number) {
  return bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`
}

function fieldErrorsOf(err: unknown): FieldErrors {
  if (err instanceof ApiError && err.body && typeof err.body === 'object') {
    const errors = (err.body as { errors?: unknown }).errors
    if (errors && typeof errors === 'object') return errors as FieldErrors
  }
  return {}
}

export default function TrainingPage() {
  const { t, L } = useI18n()
  const [modules, setModules] = useState<TrainingModule[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [completeBusy, setCompleteBusy] = useState<number | null>(null)

  const [dialog, setDialog] = useState<
    | { kind: 'create' }
    | { kind: 'edit'; module: TrainingModule }
    | { kind: 'delete'; module: TrainingModule }
    | null
  >(null)

  const load = useCallback(async () => {
    const res = await apiFetch<{ modules: TrainingModule[] }>('/training')
    setModules(res.modules)
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

  async function toggleComplete(m: TrainingModule) {
    setCompleteBusy(m.id)
    try {
      await apiFetch(`/training/${m.id}/complete`, { method: m.isComplete ? 'DELETE' : 'POST' })
      await load()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setCompleteBusy(null)
    }
  }

  return (
    <div className="req">
      <header className="req-head">
        <h1>{t('tr_title')}</h1>
        {modules && (
          <p className="req-meta">
            {modules.length} {modules.length === 1 ? t('tr_module_word') : t('tr_modules_word')}
          </p>
        )}
        <button type="button" className="req-retry emp-add" onClick={() => setDialog({ kind: 'create' })}>
          {t('tr_add')}
        </button>
      </header>

      {error ? (
        <div className="req-status">
          <p className="req-status-msg">
            {t('tr_load_err')} {error}
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
      ) : !modules ? (
        <div className="req-skeleton" aria-busy="true">
          <span className="visually-hidden">{t('tr_loading')}</span>
          {Array.from({ length: 4 }, (_, i) => (
            <div className="skel-row" aria-hidden="true" key={i} />
          ))}
        </div>
      ) : modules.length === 0 ? (
        <div className="req-empty">
          <h2>{t('tr_none_h')}</h2>
          <p>{t('tr_none_p')}</p>
        </div>
      ) : (
        <div className="req-tablewrap">
          <table className="req-table">
            <thead>
              <tr>
                <th scope="col">{t('col_title')}</th>
                <th scope="col">{t('kb_col_author')}</th>
                <th scope="col">{t('tr_col_attachment')}</th>
                <th scope="col">{t('tr_col_completed')}</th>
                <th scope="col" className="emp-actions-col">
                  {t('col_actions')}
                </th>
              </tr>
            </thead>
            <tbody>
              {modules.map((m) => (
                <tr key={m.id}>
                  <td className="req-service">{L(m.title)}</td>
                  <td>{m.createdByName}</td>
                  <td>
                    {m.attachment ? (
                      <>
                        <button
                          type="button"
                          className="link-button"
                          onClick={() => void downloadAttachment(m.attachment!.id, m.attachment!.originalFilename)}
                        >
                          {m.attachment.originalFilename}
                        </button>
                        <span className="tl-meta"> · {formatSize(m.attachment.sizeBytes)}</span>
                      </>
                    ) : (
                      <span className="req-meta">{t('tr_no_attachment')}</span>
                    )}
                  </td>
                  <td>{m.completionCount}</td>
                  <td className="emp-actions">
                    <button
                      type="button"
                      className={`action-btn${m.isComplete ? ' is-danger' : ''}`}
                      disabled={completeBusy === m.id}
                      onClick={() => toggleComplete(m)}
                    >
                      {m.isComplete ? t('tr_uncomplete') : t('tr_complete')}
                    </button>
                    <button type="button" className="action-btn" onClick={() => setDialog({ kind: 'edit', module: m })}>
                      {t('kb_edit')}
                    </button>
                    <button
                      type="button"
                      className="action-btn is-danger"
                      onClick={() => setDialog({ kind: 'delete', module: m })}
                    >
                      {t('kb_delete')}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {dialog?.kind === 'create' && <ModuleForm onClose={() => setDialog(null)} onDone={onDone} />}
      {dialog?.kind === 'edit' && (
        <ModuleForm module={dialog.module} onClose={() => setDialog(null)} onDone={onDone} />
      )}
      {dialog?.kind === 'delete' && (
        <DeleteDialog module={dialog.module} onClose={() => setDialog(null)} onDone={onDone} />
      )}
    </div>
  )
}

function ModuleForm({
  module: mod,
  onClose,
  onDone,
}: {
  module?: TrainingModule
  onClose: () => void
  onDone: () => void
}) {
  const { t } = useI18n()
  const isEdit = !!mod
  const [titleEn, setTitleEn] = useState(mod?.title.en ?? '')
  const [titleAr, setTitleAr] = useState(mod?.title.ar ?? '')
  const [bodyEn, setBodyEn] = useState(mod?.body.en ?? '')
  const [bodyAr, setBodyAr] = useState(mod?.body.ar ?? '')
  const [attachmentFile, setAttachmentFile] = useState<File | null>(null)
  const [removeAttachment, setRemoveAttachment] = useState(false)
  const [errors, setErrors] = useState<FieldErrors>({})
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const canSubmit = titleEn.trim() && titleAr.trim() && bodyEn.trim() && bodyAr.trim()

  // Same two-step contract as the onboarding wizard's logo upload: POST the
  // file first (multipart, so a raw fetch rather than apiFetch), then send
  // its id along with the module save.
  async function uploadAttachment(file: File): Promise<string> {
    const form = new FormData()
    form.append('file', file)
    const res = await fetch('/api/v1/files', {
      method: 'POST',
      headers: { Authorization: `Bearer ${getToken() ?? ''}` },
      body: form,
    })
    if (!res.ok) throw new ApiError(res.status, 'attachment upload failed', 'attachmentFileId')
    const data = await res.json()
    return data.attachment.id
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setErrors({})
    try {
      const attachmentFileId = attachmentFile
        ? await uploadAttachment(attachmentFile)
        : removeAttachment
          ? null
          : undefined
      const body = {
        title: { en: titleEn, ar: titleAr },
        body: { en: bodyEn, ar: bodyAr },
        ...(attachmentFileId !== undefined && { attachmentFileId }),
      }
      if (isEdit) {
        await apiFetch(`/training/${mod!.id}`, { method: 'PATCH', body })
      } else {
        await apiFetch('/training', { method: 'POST', body })
      }
      onDone()
    } catch (err) {
      const fe = fieldErrorsOf(err)
      setErrors(Object.keys(fe).length ? fe : { _: t('tr_err_save') })
      setBusy(false)
    }
  }

  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <form className="dialog svc-dialog" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <h4>{isEdit ? t('tr_edit_h') : t('tr_create_h')}</h4>
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
        <label className="field">
          {t('kb_body_en')}
          <textarea className="kb-textarea" value={bodyEn} onChange={(e) => setBodyEn(e.target.value)} required />
          {errors.body && <em className="field-err">{errors.body}</em>}
        </label>
        <label className="field">
          {t('kb_body_ar')}
          <textarea className="kb-textarea" value={bodyAr} onChange={(e) => setBodyAr(e.target.value)} required dir="rtl" />
        </label>
        <label className="field">
          {t('tr_attachment')}
          {mod?.attachment && !removeAttachment && !attachmentFile ? (
            <span className="ob-file">
              <span>{mod.attachment.originalFilename}</span>
              <button type="button" className="link-button" onClick={() => setRemoveAttachment(true)}>
                {t('tr_remove_attachment')}
              </button>
            </span>
          ) : (
            <label className="ob-file">
              <input
                type="file"
                accept=".jpg,.jpeg,.png,.pdf"
                onChange={(e) => {
                  setAttachmentFile(e.target.files?.[0] ?? null)
                  setRemoveAttachment(false)
                }}
              />
              <span>{attachmentFile ? attachmentFile.name : t('ob_choose_file')}</span>
            </label>
          )}
          {errors.attachmentFileId && <em className="field-err">{errors.attachmentFileId}</em>}
        </label>
        <div className="dialog-actions">
          <button type="button" className="detail-close-text" onClick={onClose}>
            {t('cancel')}
          </button>
          <button type="submit" className="req-retry" disabled={busy || !canSubmit}>
            {isEdit ? t('save') : t('tr_create')}
          </button>
        </div>
      </form>
    </div>
  )
}

function DeleteDialog({
  module: mod,
  onClose,
  onDone,
}: {
  module: TrainingModule
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
      await apiFetch(`/training/${mod.id}`, { method: 'DELETE' })
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
          {t('kb_delete_q_pre')} {L(mod.title)}?
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

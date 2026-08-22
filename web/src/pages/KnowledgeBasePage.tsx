import { useCallback, useEffect, useState } from 'react'
import { apiFetch, ApiError } from '../lib/api'
import { useI18n, type Loc } from '../i18n'
import { TranslateButton } from '../components/TranslateButton'
import './RequestsPage.css'
import './EmployeesPage.css'
import './KnowledgeBasePage.css'

// Knowledge Base (communication feature group, onboarding wizard). Flat list
// of company articles — no categories, no drafts. Write access is view_all
// or admin (same gate as Departments/Checklists' authoring surfaces); read is
// company-wide (also used, read-only, by the Employee mobile app).

interface Article {
  id: number
  title: Loc
  body: Loc
  createdByName: string
  updatedAt: string
}
type FieldErrors = Record<string, string>

function fieldErrorsOf(err: unknown): FieldErrors {
  if (err instanceof ApiError && err.body && typeof err.body === 'object') {
    const errors = (err.body as { errors?: unknown }).errors
    if (errors && typeof errors === 'object') return errors as FieldErrors
  }
  return {}
}

export default function KnowledgeBasePage() {
  const { t, L } = useI18n()
  const [articles, setArticles] = useState<Article[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const [query, setQuery] = useState('')

  const [dialog, setDialog] = useState<
    | { kind: 'create' }
    | { kind: 'read'; article: Article }
    | { kind: 'edit'; article: Article }
    | { kind: 'delete'; article: Article }
    | null
  >(null)

  const load = useCallback(async (q: string) => {
    const res = await apiFetch<{ articles: Article[] }>(
      `/knowledge-base${q.trim() ? `?q=${encodeURIComponent(q.trim())}` : ''}`,
    )
    setArticles(res.articles)
    setError(null)
  }, [])

  // Server-side search (both languages, title and body) rather than filtering
  // the loaded page: an article is worth finding by what it says.
  useEffect(() => {
    const handle = setTimeout(() => {
      load(query).catch((err: Error) => setError(err.message))
    }, query ? 250 : 0)
    return () => clearTimeout(handle)
  }, [load, query])

  function onDone() {
    setDialog(null)
    load(query).catch((err: Error) => setError(err.message))
  }

  return (
    <div className="req">
      <header className="req-head">
        <h1>{t('kb_title')}</h1>
        {articles && (
          <p className="req-meta">
            {articles.length} {articles.length === 1 ? t('kb_article_word') : t('kb_articles_word')}
          </p>
        )}
        <button type="button" className="req-retry emp-add" onClick={() => setDialog({ kind: 'create' })}>
          {t('kb_add')}
        </button>
      </header>

      <div className="req-filters">
        <div className="control-row">
          <input
            type="search"
            className="req-select"
            placeholder={t('kb_search')}
            aria-label={t('kb_search')}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      </div>

      {error ? (
        <div className="req-status">
          <p className="req-status-msg">
            {t('kb_load_err')} {error}
          </p>
          <button
            type="button"
            className="req-retry"
            onClick={() => {
              setError(null)
              load(query).catch((err: Error) => setError(err.message))
            }}
          >
            {t('try_again')}
          </button>
        </div>
      ) : !articles ? (
        <div className="req-skeleton" aria-busy="true">
          <span className="visually-hidden">{t('kb_loading')}</span>
          {Array.from({ length: 4 }, (_, i) => (
            <div className="skel-row" aria-hidden="true" key={i} />
          ))}
        </div>
      ) : articles.length === 0 ? (
        <div className="req-empty">
          <h2>{query.trim() ? t('kb_no_match_h') : t('kb_none_h')}</h2>
          {query.trim() ? (
            <button type="button" className="req-retry" onClick={() => setQuery('')}>
              {t('clear_filters')}
            </button>
          ) : (
            <p>{t('kb_none_p')}</p>
          )}
        </div>
      ) : (
        <div className="req-tablewrap">
          <table className="req-table">
            <thead>
              <tr>
                <th scope="col">{t('col_title')}</th>
                <th scope="col">{t('kb_col_author')}</th>
                <th scope="col">{t('kb_col_updated')}</th>
                <th scope="col" className="emp-actions-col">
                  {t('col_actions')}
                </th>
              </tr>
            </thead>
            <tbody>
              {articles.map((a) => (
                <tr key={a.id}>
                  <td className="req-service">
                    <button type="button" className="kb-title-btn" onClick={() => setDialog({ kind: 'read', article: a })}>
                      {L(a.title)}
                    </button>
                  </td>
                  <td>{a.createdByName}</td>
                  <td>{new Date(a.updatedAt).toLocaleDateString()}</td>
                  <td className="emp-actions">
                    <button type="button" className="action-btn" onClick={() => setDialog({ kind: 'read', article: a })}>
                      {t('kb_read')}
                    </button>
                    <button type="button" className="action-btn" onClick={() => setDialog({ kind: 'edit', article: a })}>
                      {t('kb_edit')}
                    </button>
                    <button
                      type="button"
                      className="action-btn is-danger"
                      onClick={() => setDialog({ kind: 'delete', article: a })}
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

      {dialog?.kind === 'read' && (
        <ReadDialog
          article={dialog.article}
          onClose={() => setDialog(null)}
          onEdit={() => setDialog({ kind: 'edit', article: dialog.article })}
        />
      )}
      {dialog?.kind === 'create' && <ArticleForm onClose={() => setDialog(null)} onDone={onDone} />}
      {dialog?.kind === 'edit' && (
        <ArticleForm article={dialog.article} onClose={() => setDialog(null)} onDone={onDone} />
      )}
      {dialog?.kind === 'delete' && (
        <DeleteDialog article={dialog.article} onClose={() => setDialog(null)} onDone={onDone} />
      )}
    </div>
  )
}

// Reading an article was impossible in the console: the list showed a title,
// an author and a date, and the only way to see the text was to open the edit
// form. The body already rides along in the list payload, so this needs no
// extra fetch.
function ReadDialog({
  article,
  onClose,
  onEdit,
}: {
  article: Article
  onClose: () => void
  onEdit: () => void
}) {
  const { t, L, lang } = useI18n()

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div className="dialog kb-read" role="dialog" aria-modal="true" aria-label={L(article.title)} onClick={(e) => e.stopPropagation()}>
        <h4>{L(article.title)}</h4>
        <p className="kb-read-meta">
          {article.createdByName} · {new Date(article.updatedAt).toLocaleDateString()}
        </p>
        {/* dir follows the console language so an Arabic body reads correctly
            inside an English shell and vice versa (I6). */}
        <div className="kb-read-body" dir={lang === 'ar' ? 'rtl' : 'ltr'}>
          {L(article.body)}
        </div>
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

function ArticleForm({
  article,
  onClose,
  onDone,
}: {
  article?: Article
  onClose: () => void
  onDone: () => void
}) {
  const { t } = useI18n()
  const isEdit = !!article
  const [titleEn, setTitleEn] = useState(article?.title.en ?? '')
  const [titleAr, setTitleAr] = useState(article?.title.ar ?? '')
  const [bodyEn, setBodyEn] = useState(article?.body.en ?? '')
  const [bodyAr, setBodyAr] = useState(article?.body.ar ?? '')
  const [errors, setErrors] = useState<FieldErrors>({})
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const canSubmit = titleEn.trim() && titleAr.trim() && bodyEn.trim() && bodyAr.trim()

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setErrors({})
    const body = {
      title: { en: titleEn, ar: titleAr },
      body: { en: bodyEn, ar: bodyAr },
    }
    try {
      if (isEdit) {
        await apiFetch(`/knowledge-base/${article!.id}`, { method: 'PATCH', body })
      } else {
        await apiFetch('/knowledge-base', { method: 'POST', body })
      }
      onDone()
    } catch (err) {
      const fe = fieldErrorsOf(err)
      setErrors(Object.keys(fe).length ? fe : { _: t('kb_err_save') })
      setBusy(false)
    }
  }

  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <form className="dialog svc-dialog" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <h4>{isEdit ? t('kb_edit_h') : t('kb_create_h')}</h4>
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
          {t('kb_body_en')}
          <textarea
            className="kb-textarea"
            value={bodyEn}
            onChange={(e) => setBodyEn(e.target.value)}
            required
          />
          {errors.body && <em className="field-err">{errors.body}</em>}
        </label>
        <label className="field">
          {t('kb_body_ar')}
          <textarea
            className="kb-textarea"
            value={bodyAr}
            onChange={(e) => setBodyAr(e.target.value)}
            required
            dir="rtl"
          />
        </label>
        <TranslateButton en={bodyEn} ar={bodyAr} setEn={setBodyEn} setAr={setBodyAr} />
        <div className="dialog-actions">
          <button type="button" className="detail-close-text" onClick={onClose}>
            {t('cancel')}
          </button>
          <button type="submit" className="req-retry" disabled={busy || !canSubmit}>
            {isEdit ? t('save') : t('kb_create')}
          </button>
        </div>
      </form>
    </div>
  )
}

function DeleteDialog({ article, onClose, onDone }: { article: Article; onClose: () => void; onDone: () => void }) {
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
      await apiFetch(`/knowledge-base/${article.id}`, { method: 'DELETE' })
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
          {t('kb_delete_q_pre')} {L(article.title)}?
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

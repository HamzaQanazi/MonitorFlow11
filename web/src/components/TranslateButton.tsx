import { useState } from 'react'
import { translatePair } from '../lib/translate'
import { useI18n } from '../i18n'

// Bilingual auto-fill (CLAUDE.md §13, 2026-08-21 exception — Gemini). Fills
// whichever side is empty from whichever side has content; a UX shortcut for
// I5's bilingual requirement, never authoritative — the caller can still
// edit or overwrite the suggestion, and the save endpoint still enforces
// both languages present (I5, I8) exactly as before. Explicit click only,
// never fires while typing.
export function TranslateButton({
  en,
  ar,
  setEn,
  setAr,
}: {
  en: string
  ar: string
  setEn: (v: string) => void
  setAr: (v: string) => void
}) {
  const { t } = useI18n()
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const hasSource = !!(en.trim() || ar.trim())

  async function run() {
    if (!hasSource || busy) return
    setBusy(true)
    setFailed(false)
    try {
      const next = await translatePair(en, ar)
      setEn(next.en)
      setAr(next.ar)
    } catch {
      setFailed(true)
    } finally {
      setBusy(false)
    }
  }

  return (
    <span className="translate-row">
      <button type="button" className="link-button translate-btn" onClick={run} disabled={!hasSource || busy} title={t('translate_hint')}>
        {busy ? t('translate_busy') : t('translate_cta')}
      </button>
      {failed && <em className="field-err">{t('translate_err')}</em>}
    </span>
  )
}

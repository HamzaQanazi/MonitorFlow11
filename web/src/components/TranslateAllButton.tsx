import { useState } from 'react'
import { translatePair } from '../lib/translate'
import { useI18n } from '../i18n'

// "Translate all" — sequential loop over TranslateButton's same per-pair
// call (CLAUDE.md §13, 2026-08-21 exception), for the two Add Service
// editors where rows repeat (field labels, status labels). Deliberately not
// one combined multi-row API call: reusing the single-field endpoint as-is
// means a bad response can only ever corrupt the one row being translated
// right now, not the whole batch, and it stays naturally rate-limit-friendly
// on Gemini's free tier. Skips rows that are already both-filled or both-
// empty — only rows with exactly one side typed get a call.
export function TranslateAllButton<T>({
  rows,
  getEn,
  getAr,
  setPair,
}: {
  rows: T[]
  getEn: (row: T) => string
  getAr: (row: T) => string
  setPair: (index: number, en: string, ar: string) => void
}) {
  const { t } = useI18n()
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState(0)
  const [failedCount, setFailedCount] = useState(0)

  const pendingIndexes = rows.reduce<number[]>((acc, r, i) => {
    const en = getEn(r).trim()
    const ar = getAr(r).trim()
    if ((en || ar) && !(en && ar)) acc.push(i)
    return acc
  }, [])

  async function run() {
    if (!pendingIndexes.length || running) return
    setRunning(true)
    setProgress(0)
    setFailedCount(0)
    let done = 0
    let failures = 0
    for (const i of pendingIndexes) {
      try {
        const next = await translatePair(getEn(rows[i]), getAr(rows[i]))
        setPair(i, next.en, next.ar)
      } catch {
        failures += 1
        setFailedCount(failures)
      }
      done += 1
      setProgress(done)
    }
    setRunning(false)
  }

  if (!pendingIndexes.length) return null

  return (
    <span className="translate-row">
      <button type="button" className="link-button translate-btn" onClick={run} disabled={running}>
        {running ? `${t('translate_all_busy')} (${progress}/${pendingIndexes.length})` : t('translate_all_cta')}
      </button>
      {failedCount > 0 && (
        <em className="field-err">
          {failedCount} {t('translate_all_failed_suffix')}
        </em>
      )}
    </span>
  )
}

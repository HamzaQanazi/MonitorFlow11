import { apiFetch } from './api'

// Shared bilingual-auto-fill call (CLAUDE.md §13, 2026-08-21 exception).
// TranslateButton uses this directly; TranslateAllButton loops it
// sequentially over several rows. Fills whichever side is empty from
// whichever side has content; returns the pair unchanged if both or neither
// are filled (nothing to translate).
export async function translatePair(en: string, ar: string): Promise<{ en: string; ar: string }> {
  const source = en.trim()
    ? { text: en.trim(), target: 'ar' as const }
    : ar.trim()
      ? { text: ar.trim(), target: 'en' as const }
      : null
  if (!source) return { en, ar }
  const res = await apiFetch<{ translation: string }>('/translate', { method: 'POST', body: source })
  return source.target === 'ar' ? { en, ar: res.translation } : { en: res.translation, ar }
}

// Compact resolution-time formatting shared by the Dashboard and Employees
// pages. Minutes → "45min" / "4h 10min" / "2d 3h". `t` supplies localized units
// so the string flips with the console language.
export function formatDuration(minutes: number | null | undefined, t: (k: string) => string): string {
  if (minutes == null) return '—'
  const m = Math.round(minutes)
  if (m < 60) return `${m} ${t('dur_min')}`
  const h = Math.floor(m / 60)
  if (h < 24) {
    const rem = m % 60
    return rem ? `${h}${t('dur_hr')} ${rem}${t('dur_min')}` : `${h}${t('dur_hr')}`
  }
  const d = Math.floor(h / 24)
  const remH = h % 24
  return remH ? `${d}${t('dur_day')} ${remH}${t('dur_hr')}` : `${d}${t('dur_day')}`
}

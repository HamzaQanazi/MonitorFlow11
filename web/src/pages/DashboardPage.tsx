import { useCallback, useEffect, useRef, useState } from 'react'
import { apiFetch } from '../lib/api'
import { useI18n, type Loc } from '../i18n'
import './DashboardPage.css'

// Categories are the closed enum from CLAUDE.md Section 9 — the only workflow
// vocabulary application code may know. No status key appears here. Labels come
// from t('cat_<category>') so they flip language with the console.
const CATEGORIES = ['new', 'triage', 'in_progress', 'done', 'closed', 'terminated'] as const
type Category = (typeof CATEGORIES)[number]

interface Stats {
  total: number
  byCategory: { category: Category; count: number }[]
  // Service names arrive bilingual ({en,ar}) — the dashboard picks with L().
  byService: { serviceTypeId: number; name: Loc; count: number }[]
  byPriority: { priority: string; count: number }[]
}

interface Chart {
  days: { date: string; count: number }[]
}

const POLL_MS = 30_000

function formatDay(iso: string) {
  return new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  })
}

export default function DashboardPage() {
  const { t, L } = useI18n()
  const [stats, setStats] = useState<Stats | null>(null)
  const [chart, setChart] = useState<Chart | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null)
  const [tip, setTip] = useState<{ x: number; text: string } | null>(null)
  const chartRef = useRef<HTMLDivElement>(null)

  const load = useCallback(async () => {
    const [s, c] = await Promise.all([
      apiFetch<Stats>('/dashboard/stats'),
      apiFetch<Chart>('/dashboard/chart'),
    ])
    setStats(s)
    setChart(c)
    setUpdatedAt(new Date())
    setError(null)
  }, [])

  useEffect(() => {
    let cancelled = false
    // False positive: every setState here happens after the fetch resolves,
    // but the rule can't see through load(), which the retry button shares.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load().catch((err: Error) => {
      if (!cancelled) setError(err.message)
    })
    // Polling, not WebSockets (CLAUDE.md Section 2). Silent refresh: a failed
    // poll keeps the last good data and simply tries again next tick.
    const timer = setInterval(() => {
      load().catch(() => {})
    }, POLL_MS)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [load])

  if (error && !stats) {
    return (
      <div className="dash-status">
        <h1>{t('dash_overview')}</h1>
        <p className="dash-status-msg">
          {t('dash_load_err')} {error}
        </p>
        <button
          type="button"
          className="dash-retry"
          onClick={() => {
            setError(null)
            load().catch((err: Error) => setError(err.message))
          }}
        >
          {t('try_again')}
        </button>
      </div>
    )
  }

  if (!stats || !chart) {
    return (
      <div className="dash" aria-busy="true">
        <span className="visually-hidden">{t('dash_loading')}</span>
        <div className="dash-skeleton" aria-hidden="true">
          <div className="skel skel-title" />
          <div className="skel-strip">
            {CATEGORIES.map((c) => (
              <div className="skel skel-cat" key={c} />
            ))}
          </div>
          <div className="skel-grid">
            <div className="skel skel-panel" />
            <div className="skel skel-panel" />
          </div>
        </div>
      </div>
    )
  }

  const max = Math.max(...chart.days.map((d) => d.count))
  const peak = chart.days.find((d) => d.count === max)
  const chartTotal = chart.days.reduce((sum, d) => sum + d.count, 0)
  const mid = chart.days[Math.floor(chart.days.length / 2)]
  const last = chart.days[chart.days.length - 1]

  function showTip(e: React.MouseEvent<HTMLDivElement>, day: { date: string; count: number }) {
    const col = e.currentTarget
    const width = chartRef.current?.clientWidth ?? 0
    const x = Math.max(44, Math.min(width - 44, col.offsetLeft + col.offsetWidth / 2))
    setTip({ x, text: `${formatDay(day.date)} · ${day.count}` })
  }

  return (
    <div className="dash">
      <header className="dash-head">
        <h1>{t('dash_overview')}</h1>
        <p className="dash-meta">
          {stats.total} {stats.total === 1 ? t('request_word') : t('requests_word')} {t('dash_on_board')}
          {updatedAt && (
            <>
              {' '}
              · {t('updated')} {updatedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </>
          )}
        </p>
      </header>

      <section className="dash-queue" aria-labelledby="queue-heading">
        <h2 id="queue-heading" className="visually-hidden">
          {t('dash_by_category')}
        </h2>
        <ol className="cat-strip">
          {stats.byCategory.map((c) => (
            <li key={c.category} className={`cat is-${c.category}${c.count === 0 ? ' is-zero' : ''}`}>
              <span className="cat-count">{c.count}</span>
              <span className="cat-name">
                <i className="cat-dot" aria-hidden="true" />
                {t(`cat_${c.category}`)}
              </span>
            </li>
          ))}
        </ol>
        {stats.total > 0 && (
          <div className="cat-bar" aria-hidden="true">
            {stats.byCategory
              .filter((c) => c.count > 0)
              .map((c) => (
                <span
                  key={c.category}
                  className={`cat-seg is-${c.category}`}
                  style={{ flexGrow: c.count }}
                  title={`${t(`cat_${c.category}`)}: ${c.count}`}
                />
              ))}
          </div>
        )}
      </section>

      {stats.total === 0 ? (
        <div className="dash-empty">
          <h2>{t('dash_clear_h')}</h2>
          <p>{t('dash_clear_p')}</p>
        </div>
      ) : (
        <div className="dash-grid">
          <section className="dash-panel" aria-labelledby="activity-heading">
            <div className="panel-head">
              <h2 id="activity-heading">{t('dash_requests_created')}</h2>
              <span className="panel-meta">
                {t('dash_last_30')} · {chartTotal} {t('dash_total')}
                {peak && max > 0 && (
                  <>
                    {' '}
                    · {t('dash_peak')} {max} {t('dash_on')} {formatDay(peak.date)}
                  </>
                )}
              </span>
            </div>
            <div
              className="chart"
              ref={chartRef}
              onMouseLeave={() => setTip(null)}
              role="img"
              aria-label={`${t('dash_requests_created')} — ${t('dash_last_30')}: ${chartTotal} ${t('dash_total')}${peak && max > 0 ? `, ${t('dash_peak')} ${max} ${t('dash_on')} ${formatDay(peak.date)}` : ''}.`}
            >
              {chart.days.map((d) => (
                <div className="chart-col" key={d.date} onMouseEnter={(e) => showTip(e, d)}>
                  <div
                    className={`chart-bar${d.count === 0 ? ' is-zero' : ''}`}
                    style={{ height: d.count === 0 ? undefined : `${(d.count / max) * 100}%` }}
                  />
                </div>
              ))}
              {tip && (
                <div className="chart-tip" style={{ left: tip.x }}>
                  {tip.text}
                </div>
              )}
            </div>
            <div className="chart-x" aria-hidden="true">
              <span>{formatDay(chart.days[0].date)}</span>
              <span>{formatDay(mid.date)}</span>
              <span>{formatDay(last.date)}</span>
            </div>
            <table className="visually-hidden">
              <caption>{t('dash_requests_created')}</caption>
              <thead>
                <tr>
                  <th scope="col">{t('col_when')}</th>
                  <th scope="col">{t('req_title')}</th>
                </tr>
              </thead>
              <tbody>
                {chart.days.map((d) => (
                  <tr key={d.date}>
                    <td>{d.date}</td>
                    <td>{d.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <div className="dash-side">
            <section className="dash-panel" aria-labelledby="service-heading">
              <div className="panel-head">
                <h2 id="service-heading">{t('dash_by_service')}</h2>
              </div>
              {stats.byService.map((s) => (
                <div className="break-row" key={s.serviceTypeId}>
                  <span className="break-label">{L(s.name)}</span>
                  <span className="break-count">{s.count}</span>
                  <div className="break-bar" aria-hidden="true">
                    <div style={{ width: `${stats.total ? (s.count / stats.total) * 100 : 0}%` }} />
                  </div>
                </div>
              ))}
            </section>

            <section className="dash-panel" aria-labelledby="priority-heading">
              <div className="panel-head">
                <h2 id="priority-heading">{t('dash_by_priority')}</h2>
              </div>
              {stats.byPriority.map((p) => (
                <div className="break-row" key={p.priority}>
                  <span className="break-label">{t(`pri_${p.priority}`)}</span>
                  <span className="break-count">{p.count}</span>
                  <div className="break-bar" aria-hidden="true">
                    <div style={{ width: `${stats.total ? (p.count / stats.total) * 100 : 0}%` }} />
                  </div>
                </div>
              ))}
            </section>
          </div>
        </div>
      )}
    </div>
  )
}

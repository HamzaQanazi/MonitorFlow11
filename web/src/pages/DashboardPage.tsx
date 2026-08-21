import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { apiFetch } from '../lib/api'
import { useI18n, type Loc } from '../i18n'
import { formatDuration } from '../lib/format'
import './DashboardPage.css'

// Phase 4: category is gone — the cross-service grouping is open vs closed
// (is_terminal). No status key appears here. Labels come from t('state_<s>')
// so they flip language with the console.
const STATES = ['open', 'closed'] as const
type State = (typeof STATES)[number]

interface Stats {
  total: number
  // Weighted mean minutes to resolution across the board; null = nothing resolved.
  avgResolutionMinutes: number | null
  byState: { state: State; count: number }[]
  // Department names arrive bilingual ({en,ar}) — the dashboard picks with L().
  // Sorted slowest-first by avgResolutionMinutes (backend); the count-distribution
  // panel below re-sorts its own copy by count, the Resolution panel uses this order.
  // By Service / By Priority were dropped (2026-08-21) — ReportsPage already has
  // both as filterable/exportable charts, so the dashboard no longer repeats them.
  byDepartment: { departmentId: number; name: Loc; count: number; avgResolutionMinutes: number | null }[]
  byRequesterRole: { role: string; count: number }[]
  slaBreaches: { count: number; rate: number | null }
  reopenRate: { reopened: number; everClosed: number; rate: number | null }
  // `total` is the count before the top-8 truncation, so the panel can show "+N more".
  workload: { total: number; top: { employeeId: number; employeeName: string; openCount: number }[] }
}

interface Chart {
  days: { date: string; open: number; closed: number; count: number }[]
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
            {STATES.map((s) => (
              <div className="skel skel-cat" key={s} />
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

  // Resolution panel reads stats.byDepartment as-is (backend sorts it
  // slowest-first); this distribution bar wants biggest-first instead, so it
  // re-sorts its own copy rather than the backend maintaining two orders.
  const departmentsByCount = [...stats.byDepartment].sort((a, b) => b.count - a.count)
  const maxDepartmentCount = Math.max(1, ...departmentsByCount.map((d) => d.count))
  const workloadMore = stats.workload.total - stats.workload.top.length
  // stats.byDepartment is already slowest-first (nulls last, backend-sorted),
  // so the first non-null entry is the max — same bar treatment as Department/
  // Requester/Workload below.
  const maxResolutionMinutes = Math.max(1, ...stats.byDepartment.map((d) => d.avgResolutionMinutes ?? 0))

  function showTip(e: React.MouseEvent<HTMLDivElement>, day: Chart['days'][number]) {
    const col = e.currentTarget
    const width = chartRef.current?.clientWidth ?? 0
    const x = Math.max(44, Math.min(width - 44, col.offsetLeft + col.offsetWidth / 2))
    const text =
      day.count === 0
        ? `${formatDay(day.date)} · 0`
        : `${formatDay(day.date)} · ${day.count} (${day.open} ${t('state_open')}, ${day.closed} ${t('state_closed')})`
    setTip({ x, text })
  }

  return (
    <div className="dash">
      <header className="dash-head">
        <h1>{t('dash_overview')}</h1>
        <p className="dash-meta">
          {stats.total} {stats.total === 1 ? t('request_word') : t('requests_word')} {t('dash_on_board')}
          {stats.avgResolutionMinutes != null && (
            <>
              {' '}
              · {t('dash_avg_resolution')} {formatDuration(stats.avgResolutionMinutes, t)}
            </>
          )}
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
          {t('dash_by_state')}
        </h2>
        <ol className="cat-strip">
          {stats.byState.map((c) => (
            <li key={c.state} className={`cat is-${c.state}${c.count === 0 ? ' is-zero' : ''}`}>
              <span className="cat-count">{c.count}</span>
              <span className="cat-name">
                <i className="cat-dot" aria-hidden="true" />
                {t(`state_${c.state}`)}
              </span>
            </li>
          ))}
        </ol>
        {stats.total > 0 && (
          <div className="cat-bar" aria-hidden="true">
            {stats.byState
              .filter((c) => c.count > 0)
              .map((c) => (
                <span
                  key={c.state}
                  className={`cat-seg is-${c.state}`}
                  style={{ flexGrow: c.count }}
                  title={`${t(`state_${c.state}`)}: ${c.count}`}
                />
              ))}
          </div>
        )}
      </section>

      {stats.total > 0 && (
        <section className="dash-alerts" aria-label={t('dash_health')}>
          <Link
            to="/requests?slaBreached=true"
            className={`alert-tile${stats.slaBreaches.count > 0 ? ' is-breach' : ''}`}
          >
            <span className="alert-count">{stats.slaBreaches.count}</span>
            <span className="alert-label">
              {t('dash_sla_breaches')}
              {stats.slaBreaches.rate != null && (
                <> · {Math.round(stats.slaBreaches.rate * 100)}% {t('dash_of_open')}</>
              )}
            </span>
          </Link>
          <Link to="/requests?reopened=true" className="alert-tile">
            <span className="alert-count">
              {stats.reopenRate.rate != null ? `${Math.round(stats.reopenRate.rate * 100)}%` : '—'}
            </span>
            <span className="alert-label">
              {t('dash_reopen_rate')}
              {stats.reopenRate.everClosed > 0 && (
                <> · {stats.reopenRate.reopened}/{stats.reopenRate.everClosed}</>
              )}
            </span>
          </Link>
        </section>
      )}

      {stats.total === 0 ? (
        <div className="dash-empty">
          <h2>{t('dash_clear_h')}</h2>
          <p>{t('dash_clear_p')}</p>
        </div>
      ) : (
        <div className="dash-grid">
          <div className="dash-main">
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
                    {d.count === 0 ? (
                      <div className="chart-bar is-zero" />
                    ) : (
                      <div className="chart-stack" style={{ height: `${(d.count / max) * 100}%` }}>
                        {d.open > 0 && (
                          <div className="chart-seg is-open" style={{ flexGrow: d.open }} />
                        )}
                        {d.closed > 0 && (
                          <div className="chart-seg is-closed" style={{ flexGrow: d.closed }} />
                        )}
                      </div>
                    )}
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

            <section className="dash-panel" aria-labelledby="department-heading">
              <div className="panel-head">
                <h2 id="department-heading">{t('dash_by_department')}</h2>
              </div>
              {departmentsByCount.length > 0 ? (
                departmentsByCount.map((d) => (
                  <div className="break-row" key={d.departmentId}>
                    <span className="break-label">{L(d.name)}</span>
                    <span className="break-count">{d.count}</span>
                    <div className="break-bar" aria-hidden="true">
                      <div style={{ width: `${(d.count / maxDepartmentCount) * 100}%` }} />
                    </div>
                  </div>
                ))
              ) : (
                <p className="panel-meta">{t('no_data')}</p>
              )}
            </section>

            <section className="dash-panel" aria-labelledby="resolution-heading">
              <div className="panel-head">
                <h2 id="resolution-heading">{t('dash_resolution')}</h2>
                <span className="panel-meta">
                  {t('dash_overall')}: {formatDuration(stats.avgResolutionMinutes, t)}
                </span>
              </div>
              {stats.byDepartment.some((d) => d.avgResolutionMinutes != null) ? (
                stats.byDepartment.map((d) => (
                  <div className="break-row" key={d.departmentId}>
                    <span className="break-label">{L(d.name)}</span>
                    <span className="break-count">{formatDuration(d.avgResolutionMinutes, t)}</span>
                    {d.avgResolutionMinutes != null && (
                      <div className="break-bar" aria-hidden="true">
                        <div style={{ width: `${(d.avgResolutionMinutes / maxResolutionMinutes) * 100}%` }} />
                      </div>
                    )}
                  </div>
                ))
              ) : (
                <p className="panel-meta">{t('dash_no_resolved')}</p>
              )}
            </section>
          </div>

          <div className="dash-side">
            <section className="dash-panel" aria-labelledby="requester-heading">
              <div className="panel-head">
                <h2 id="requester-heading">{t('dash_by_requester')}</h2>
              </div>
              {stats.byRequesterRole.map((r) => (
                <div className="break-row" key={r.role}>
                  <span className="break-label">{t(`requester_${r.role}`)}</span>
                  <span className="break-count">{r.count}</span>
                  <div className="break-bar" aria-hidden="true">
                    <div style={{ width: `${stats.total ? (r.count / stats.total) * 100 : 0}%` }} />
                  </div>
                </div>
              ))}
            </section>

            {stats.workload.top.length > 0 && (
              <section className="dash-panel" aria-labelledby="workload-heading">
                <div className="panel-head">
                  <h2 id="workload-heading">{t('dash_workload')}</h2>
                </div>
                {stats.workload.top.map((w) => (
                  <div className="break-row" key={w.employeeId}>
                    <span className="break-label">{w.employeeName}</span>
                    <span className="break-count">{w.openCount}</span>
                    <div className="break-bar" aria-hidden="true">
                      <div
                        style={{
                          width: `${(w.openCount / stats.workload.top[0].openCount) * 100}%`,
                        }}
                      />
                    </div>
                  </div>
                ))}
                {workloadMore > 0 && (
                  <p className="panel-meta">
                    +{workloadMore} {t('dash_more')}
                  </p>
                )}
              </section>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

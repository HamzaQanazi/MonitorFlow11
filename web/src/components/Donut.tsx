// Dependency-free donut chart for request-distribution pies (Dashboard +
// Reports). SVG arcs via stroke-dasharray on one circle; a real <ul> legend
// carries the accessible breakdown, so no hidden data table is needed. RTL is
// automatic — the SVG is direction-neutral and the legend uses logical props.
import './Donut.css'

export interface Slice {
  key: string
  label: string
  value: number
}

// Categorical palette — 8 hues that hold contrast in light and dark; cycles
// past 8 categories. Colorblind-mindful ordering (blue/amber/green/red first).
const PALETTE = ['#2563eb', '#f59e0b', '#10b981', '#ef4444', '#8b5cf6', '#14b8a6', '#ec4899', '#64748b']

export function sliceColor(i: number): string {
  return PALETTE[i % PALETTE.length]
}

const R = 60
const C = 2 * Math.PI * R

export default function Donut({ title, slices }: { title: string; slices: Slice[] }) {
  const total = slices.reduce((sum, s) => sum + s.value, 0)
  const summary = slices
    .filter((s) => s.value > 0)
    .map((s) => `${s.label} ${Math.round((s.value / total) * 100)}%`)
    .join(', ')

  let offset = 0
  return (
    <div className="donut">
      <div className="donut-graphic">
        <svg viewBox="0 0 150 150" role="img" aria-label={`${title}: ${summary || title}`}>
          <circle className="donut-track" cx="75" cy="75" r={R} />
          {total > 0 &&
            slices
              .filter((s) => s.value > 0)
              .map((s, i) => {
                const len = (s.value / total) * C
                const seg = (
                  <circle
                    key={s.key}
                    cx="75"
                    cy="75"
                    r={R}
                    fill="none"
                    stroke={sliceColor(i)}
                    strokeWidth="18"
                    strokeDasharray={`${len} ${C - len}`}
                    strokeDashoffset={-offset}
                    transform="rotate(-90 75 75)"
                  />
                )
                offset += len
                return seg
              })}
          <text x="75" y="70" className="donut-total">
            {total}
          </text>
          <text x="75" y="90" className="donut-total-label">
            {title}
          </text>
        </svg>
      </div>
      <ul className="donut-legend">
        {slices
          .filter((s) => s.value > 0)
          .map((s, i) => (
            <li key={s.key}>
              <i className="donut-swatch" style={{ background: sliceColor(i) }} aria-hidden="true" />
              <span className="donut-legend-label">{s.label}</span>
              <b className="donut-legend-value">{s.value}</b>
            </li>
          ))}
        {total === 0 && <li className="donut-empty">—</li>}
      </ul>
    </div>
  )
}

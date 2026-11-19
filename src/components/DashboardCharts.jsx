import { useRef, useState } from 'react'
import { useLanguage } from '../i18n/LanguageContext'

// Small SVG/HTML charts for the dashboard (no chart library).
// Marks: bars <= 22px, 4px rounded data-end, 2px surface gap, hairline grid, text in text colors.
// Colors (validated categorical slots): blue #2a78d6, orange #eb6834, aqua #1baf7a.

export const SERIES = { blue: '#2a78d6', orange: '#eb6834', aqua: '#1baf7a' }
const fmt = (value) => new Intl.NumberFormat('en-US').format(Math.round(value))

// One tooltip per chart: value first, then the label.
function useTooltip() {
  const ref = useRef(null)
  const [tip, setTip] = useState(null)
  const show = (event, rows, title) => {
    const box = ref.current?.getBoundingClientRect()
    if (!box) return
    const x = (event.clientX ?? box.left) - box.left
    const y = (event.clientY ?? box.top) - box.top
    setTip({ x: Math.min(x + 12, box.width - 170), y: Math.max(y - 12, 0), rows, title })
  }
  const hide = () => setTip(null)
  const node = tip && <div className="chart-tooltip" style={{ left: tip.x, top: tip.y }} role="status">
    {tip.title && <span className="chart-tooltip-title">{tip.title}</span>}
    {tip.rows.map((row) => <span key={row.name}><i style={{ background: row.color }} /><strong>{row.value}</strong> {row.name}</span>)}
  </div>
  return { ref, show, hide, node }
}

function Legend({ series }) {
  const { t } = useLanguage()
  if (series.length < 2) return null
  return <div className="chart-legend">{series.map((item) => <span key={item.name}><i style={{ background: item.color }} />{t(item.name)}</span>)}</div>
}

export function ChartCard({ eyebrow, title, subtitle, children, action }) {
  const { t } = useLanguage()
  return <section className="content-card chart-card">
    <div className="section-heading"><div><p className="eyebrow">{t(eyebrow)}</p><h3>{t(title)}</h3>{subtitle && <p className="muted">{t(subtitle)}</p>}</div>{action}</div>
    {children}
  </section>
}

// Horizontal bars, one or more series per row. rows: [{ label, values: [n, ...], href? }]
export function HBarChart({ rows, series, suffix = '', max: fixedMax, empty = 'Sin datos todavía.' }) {
  const { t } = useLanguage()
  const tip = useTooltip()
  if (!rows.length) return <p className="muted chart-empty">{t(empty)}</p>
  const max = fixedMax || Math.max(1, ...rows.flatMap((row) => row.values))
  const multi = series.length > 1
  return <div className="hbar-chart" ref={tip.ref} onPointerLeave={tip.hide}>
    <Legend series={series} />
    {rows.map((row) => <div className={`hbar-row ${multi ? 'multi' : ''}`} key={row.label}
      onPointerMove={(event) => tip.show(event, series.map((item, index) => ({ name: t(item.name), color: item.color, value: `${fmt(row.values[index])}${suffix}` })), row.label)}>
      <span className="hbar-label" data-no-translate title={row.title || row.label}>{row.label}</span>
      <span className="hbar-bars">{series.map((item, index) => {
        const value = row.values[index] || 0
        const width = value ? Math.max(1.5, (value / max) * 100) : 0
        return <span className="hbar-track" key={item.name}>
          <span className="hbar-bar" style={{ width: `${width}%`, background: item.color }} />
          <span className="hbar-value">{fmt(value)}{suffix}</span>
        </span>
      })}</span>
    </div>)}
    {tip.node}
  </div>
}

// Vertical columns over time, stacked or grouped. columns: [{ label, values: [n, ...] }]
export function ColumnChart({ columns, series, stacked = false, height = 170 }) {
  const { t } = useLanguage()
  const tip = useTooltip()
  const totals = columns.map((column) => (stacked ? column.values.reduce((sum, value) => sum + value, 0) : Math.max(...column.values)))
  const rawMax = Math.max(1, ...totals)
  const step = rawMax <= 5 ? 1 : rawMax <= 10 ? 2 : rawMax <= 25 ? 5 : rawMax <= 50 ? 10 : Math.ceil(rawMax / 50) * 10
  const max = Math.ceil(rawMax / step) * step
  const ticks = Array.from({ length: max / step + 1 }, (_, index) => index * step)
  const width = 600
  const left = 28
  const plotWidth = width - left
  const band = plotWidth / columns.length
  const groupWidth = Math.min(stacked ? 22 : 40, band * 0.7)
  const barWidth = stacked ? groupWidth : Math.min(18, (groupWidth - 2 * (series.length - 1)) / series.length)
  const y = (value) => height - (value / max) * height
  const r = 4
  const roundedTop = (x, top, w, h) => {
    if (h <= 0) return ''
    const rr = Math.min(r, h, w / 2)
    return `M${x},${top + h}V${top + rr}Q${x},${top} ${x + rr},${top}H${x + w - rr}Q${x + w},${top} ${x + w},${top + rr}V${top + h}Z`
  }
  return <div className="column-chart" ref={tip.ref} onPointerLeave={tip.hide}>
    <Legend series={series} />
    <svg viewBox={`0 0 ${width} ${height + 22}`} role="img" aria-label={series.map((item) => t(item.name)).join(', ')}>
      {ticks.map((tick) => <g key={tick}><line x1={left} x2={width} y1={y(tick)} y2={y(tick)} className="chart-grid" /><text x={left - 6} y={y(tick) + 4} className="chart-axis" textAnchor="end">{tick}</text></g>)}
      {columns.map((column, index) => {
        const center = left + band * index + band / 2
        const x0 = center - groupWidth / 2
        let stackTop = height
        const marks = column.values.map((value, seriesIndex) => {
          if (!value) return null
          const h = (value / max) * height
          if (stacked) {
            const top = stackTop - h
            const isTop = column.values.slice(seriesIndex + 1).every((rest) => !rest)
            const gap = stackTop === height ? 0 : 2
            stackTop = top
            return isTop
              ? <path key={seriesIndex} d={roundedTop(x0, top, groupWidth, h - gap)} fill={series[seriesIndex].color} />
              : <rect key={seriesIndex} x={x0} y={top} width={groupWidth} height={Math.max(0, h - gap)} fill={series[seriesIndex].color} />
          }
          const x = x0 + seriesIndex * (barWidth + 2)
          return <path key={seriesIndex} d={roundedTop(x, y(value), barWidth, h)} fill={series[seriesIndex].color} />
        })
        const total = column.values.reduce((sum, value) => sum + value, 0)
        return <g key={column.label}>
          {marks}
          {stacked && total > 0 && <text x={center} y={y(total) - 5} className="chart-value" textAnchor="middle">{total}</text>}
          <text x={center} y={height + 16} className="chart-axis" textAnchor="middle">{column.label}</text>
          <rect x={left + band * index} y={0} width={band} height={height} fill="transparent"
            onPointerMove={(event) => tip.show(event, series.map((item, seriesIndex) => ({ name: t(item.name), color: item.color, value: fmt(column.values[seriesIndex]) })), column.title || column.label)} />
        </g>
      })}
      <line x1={left} x2={width} y1={height} y2={height} className="chart-baseline" />
    </svg>
    {tip.node}
  </div>
}

// Headline numbers.
export function StatRow({ stats }) {
  const { t } = useLanguage()
  return <section className="stat-row">{stats.map((stat) => <article className="stat-tile" key={stat.label}>
    <span>{t(stat.label)}</span>
    <strong>{stat.value}</strong>
    {stat.hint && <small>{t(stat.hint)}</small>}
  </article>)}</section>
}

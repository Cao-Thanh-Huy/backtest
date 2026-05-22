'use client'

import dynamic from 'next/dynamic'
import { useAppStore } from '@/store/appStore'

const ReactECharts = dynamic(() => import('echarts-for-react'), { ssr: false })

interface Metrics {
  total_return?: number
  cagr?: number
  sharpe_ratio?: number
  sortino_ratio?: number
  calmar_ratio?: number
  max_drawdown?: number
  profit_factor?: number
  expectancy?: number
  win_rate?: number
  n_trades?: number
  n_long?: number
  n_short?: number
  avg_win_pct?: number
  avg_loss_pct?: number
  gross_profit?: number
  gross_loss?: number
  equity_r2?: number
  monthly_returns?: Record<string, Record<string, number>>
  trade_distribution?: number[]
  rolling_sharpe?: { time: string; value: number }[]
  drawdown_curve?: { time: string; value: number }[]
}

function kpiClass(val: number | undefined, higherBetter: boolean) {
  if (val === undefined || isNaN(val)) return 'text-zinc-400'
  return higherBetter
    ? val > 0 ? 'text-emerald-400' : 'text-red-400'
    : val < 0 ? 'text-emerald-400' : 'text-red-400'
}

function KpiCard({ label, value, higherBetter = true, unit = '' }: {
  label: string
  value: number | undefined
  higherBetter?: boolean
  unit?: string
}) {
  const display = value !== undefined && !isNaN(value) ? `${value.toFixed(2)}${unit}` : '—'
  return (
    <div className="rounded-xl border border-surface-border bg-surface p-3 text-center">
      <div className={`text-xl font-bold ${kpiClass(value, higherBetter)}`}>{display}</div>
      <div className="text-xs text-zinc-500 mt-1">{label}</div>
    </div>
  )
}

function MonthlyHeatmap({ data }: { data: Record<string, Record<string, number>> }) {
  const years = Object.keys(data).sort()
  const months = Array.from({ length: 12 }, (_, i) => i + 1)
  const monthLabels = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

  function colorFor(val: number) {
    if (val === undefined) return 'bg-surface-border'
    if (val > 5) return 'bg-emerald-500'
    if (val > 2) return 'bg-emerald-500/60'
    if (val > 0) return 'bg-emerald-500/30'
    if (val > -2) return 'bg-red-500/30'
    if (val > -5) return 'bg-red-500/60'
    return 'bg-red-500'
  }

  if (years.length === 0) return <div className="text-xs text-zinc-600">No monthly data</div>

  return (
    <div className="overflow-x-auto">
      <table className="text-xs min-w-full">
        <thead>
          <tr>
            <th className="pr-2 text-left text-zinc-600">Year</th>
            {monthLabels.map((m) => <th key={m} className="px-1 text-zinc-600 font-normal">{m}</th>)}
          </tr>
        </thead>
        <tbody>
          {years.map((y) => (
            <tr key={y}>
              <td className="pr-2 text-zinc-400">{y}</td>
              {months.map((m) => {
                const val = data[y]?.[String(m)]
                return (
                  <td key={m} className="px-0.5 py-0.5">
                    <div
                      className={`w-7 h-5 rounded text-center text-xs flex items-center justify-center cursor-default ${colorFor(val)}`}
                      title={val !== undefined ? `${y}-${m}: ${val.toFixed(2)}%` : ''}
                    >
                      {val !== undefined ? (Math.abs(val) < 10 ? val.toFixed(1) : Math.round(val).toString()) : ''}
                    </div>
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function FeatureImportanceTable({ importances }: { importances: Record<string, number> }) {
  const sorted = Object.entries(importances)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 30)

  const maxVal = sorted[0]?.[1] || 1

  return (
    <div className="space-y-1 max-h-80 overflow-y-auto">
      {sorted.map(([feat, imp]) => (
        <div key={feat} className="flex items-center gap-2 text-xs">
          <div className="w-32 shrink-0 text-zinc-400 truncate font-mono" title={feat}>{feat}</div>
          <div className="flex-1 bg-surface-border rounded-full h-1.5 overflow-hidden">
            <div
              className="h-full bg-brand-500 rounded-full"
              style={{ width: `${(imp / maxVal) * 100}%` }}
            />
          </div>
          <div className="w-12 text-right text-zinc-300">{imp.toFixed(4)}</div>
        </div>
      ))}
    </div>
  )
}

export function ResultsStep() {
  const { wizardBacktest, wizardEquityCurve, wizardModel } = useAppStore()

  if (!wizardBacktest) {
    return (
      <div className="text-center py-12 text-zinc-500">
        Complete steps 1–5 to see your results here.
      </div>
    )
  }

  const metrics = (wizardBacktest.metrics || {}) as Metrics
  const drawdownCurve = metrics.drawdown_curve || []
  const monthlyCurve = metrics.monthly_returns || {}
  const tradeDist = metrics.trade_distribution || []
  const rollingSharp = metrics.rolling_sharpe || []

  // Equity curve ECharts option
  const equityOption = {
    backgroundColor: 'transparent',
    grid: { left: 60, right: 20, top: 10, bottom: 30 },
    xAxis: {
      type: 'category',
      data: wizardEquityCurve.map((p) => p.time),
      axisLabel: { color: '#64748b', fontSize: 10, interval: Math.floor(wizardEquityCurve.length / 8) },
      axisLine: { lineStyle: { color: '#334155' } },
    },
    yAxis: {
      type: 'value',
      axisLabel: { color: '#64748b', fontSize: 10, formatter: (v: number) => `$${v >= 1000 ? (v / 1000).toFixed(1) + 'k' : v}` },
      splitLine: { lineStyle: { color: '#1e293b' } },
    },
    series: [{
      type: 'line',
      data: wizardEquityCurve.map((p) => p.value),
      smooth: true,
      symbol: 'none',
      lineStyle: { color: '#6366f1', width: 2 },
      areaStyle: { color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: 'rgba(99,102,241,0.25)' }, { offset: 1, color: 'rgba(99,102,241,0)' }] } },
    }],
    tooltip: { trigger: 'axis', backgroundColor: '#0f172a', borderColor: '#334155', textStyle: { color: '#e2e8f0', fontSize: 11 } },
  }

  const drawdownOption = {
    backgroundColor: 'transparent',
    grid: { left: 60, right: 20, top: 10, bottom: 30 },
    xAxis: {
      type: 'category',
      data: drawdownCurve.map((p) => p.time),
      axisLabel: { color: '#64748b', fontSize: 10, interval: Math.floor(drawdownCurve.length / 8) },
      axisLine: { lineStyle: { color: '#334155' } },
    },
    yAxis: {
      type: 'value',
      axisLabel: { color: '#64748b', fontSize: 10, formatter: (v: number) => `${v.toFixed(1)}%` },
      splitLine: { lineStyle: { color: '#1e293b' } },
    },
    series: [{
      type: 'line',
      data: drawdownCurve.map((p) => p.value),
      smooth: true,
      symbol: 'none',
      lineStyle: { color: '#ef4444', width: 1.5 },
      areaStyle: { color: 'rgba(239,68,68,0.15)' },
    }],
    tooltip: { trigger: 'axis', backgroundColor: '#0f172a', borderColor: '#334155', textStyle: { color: '#e2e8f0', fontSize: 11 } },
  }

  // Trade distribution histogram
  const distBins: Record<string, number> = {}
  tradeDist.forEach((val) => {
    const bin = (Math.round(val * 2) / 2).toFixed(1)
    distBins[bin] = (distBins[bin] || 0) + 1
  })
  const distKeys = Object.keys(distBins).sort((a, b) => Number(a) - Number(b))

  const tradeDistOption = {
    backgroundColor: 'transparent',
    grid: { left: 50, right: 10, top: 10, bottom: 30 },
    xAxis: {
      type: 'category',
      data: distKeys,
      axisLabel: { color: '#64748b', fontSize: 9, formatter: (v: string) => `${v}%` },
      axisLine: { lineStyle: { color: '#334155' } },
    },
    yAxis: {
      type: 'value',
      axisLabel: { color: '#64748b', fontSize: 9 },
      splitLine: { lineStyle: { color: '#1e293b' } },
    },
    series: [{
      type: 'bar',
      data: distKeys.map((k) => ({
        value: distBins[k],
        itemStyle: { color: Number(k) >= 0 ? '#10b981' : '#ef4444' },
      })),
    }],
    tooltip: { trigger: 'axis', backgroundColor: '#0f172a', borderColor: '#334155', textStyle: { color: '#e2e8f0', fontSize: 11 } },
  }

  return (
    <div className="space-y-6">
      {/* KPI Row 1 — Primary */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <KpiCard label="Sharpe Ratio" value={metrics.sharpe_ratio} unit="" />
        <KpiCard label="CAGR" value={metrics.cagr} unit="%" />
        <KpiCard label="Max Drawdown" value={metrics.max_drawdown} unit="%" higherBetter={false} />
        <KpiCard label="Win Rate" value={metrics.win_rate} unit="%" />
      </div>

      {/* KPI Row 2 — Secondary */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <KpiCard label="Total Return" value={metrics.total_return} unit="%" />
        <KpiCard label="Sortino" value={metrics.sortino_ratio} />
        <KpiCard label="Calmar" value={metrics.calmar_ratio} />
        <KpiCard label="Profit Factor" value={metrics.profit_factor} />
      </div>

      {/* KPI Row 3 — Trade stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <KpiCard label="Total Trades" value={metrics.n_trades} unit="" />
        <KpiCard label="Avg Win" value={metrics.avg_win_pct} unit="%" />
        <KpiCard label="Avg Loss" value={metrics.avg_loss_pct} unit="%" higherBetter={false} />
        <KpiCard label="Equity R²" value={metrics.equity_r2} />
      </div>

      {/* Equity curve */}
      {wizardEquityCurve.length > 0 && (
        <div className="rounded-xl border border-surface-border bg-surface p-4">
          <div className="text-sm font-semibold text-zinc-300 mb-3">Equity Curve</div>
          <ReactECharts option={equityOption} style={{ height: 220 }} theme="dark" />
        </div>
      )}

      {/* Drawdown curve */}
      {drawdownCurve.length > 0 && (
        <div className="rounded-xl border border-surface-border bg-surface p-4">
          <div className="text-sm font-semibold text-zinc-300 mb-3">Drawdown</div>
          <ReactECharts option={drawdownOption} style={{ height: 140 }} theme="dark" />
        </div>
      )}

      {/* Monthly heatmap */}
      {Object.keys(monthlyCurve).length > 0 && (
        <div className="rounded-xl border border-surface-border bg-surface p-4">
          <div className="text-sm font-semibold text-zinc-300 mb-3">Monthly Returns (%)</div>
          <MonthlyHeatmap data={monthlyCurve} />
        </div>
      )}

      {/* Trade distribution */}
      {tradeDist.length > 0 && (
        <div className="rounded-xl border border-surface-border bg-surface p-4">
          <div className="text-sm font-semibold text-zinc-300 mb-3">Trade Return Distribution</div>
          <ReactECharts option={tradeDistOption} style={{ height: 150 }} theme="dark" />
        </div>
      )}

      {/* Feature importance */}
      {wizardModel?.feature_importances && Object.keys(wizardModel.feature_importances).length > 0 && (
        <div className="rounded-xl border border-surface-border bg-surface p-4">
          <div className="text-sm font-semibold text-zinc-300 mb-3">Feature Importance (Top 30)</div>
          <FeatureImportanceTable importances={wizardModel.feature_importances} />
        </div>
      )}

      {/* Trade analysis */}
      <div className="rounded-xl border border-surface-border bg-surface p-4">
        <div className="text-sm font-semibold text-zinc-300 mb-3">Trade Analysis</div>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs">
          {[
            { label: 'Long Trades', value: metrics.n_long },
            { label: 'Short Trades', value: metrics.n_short },
            { label: 'Gross Profit', value: metrics.gross_profit ? `${metrics.gross_profit?.toFixed(2)}%` : '—' },
            { label: 'Gross Loss', value: metrics.gross_loss ? `${metrics.gross_loss?.toFixed(2)}%` : '—' },
            { label: 'Expectancy', value: metrics.expectancy ? `${metrics.expectancy?.toFixed(4)}%` : '—' },
            { label: 'Model', value: wizardModel?.model_type?.toUpperCase() },
          ].map((row) => (
            <div key={row.label} className="flex flex-col gap-0.5">
              <div className="text-zinc-500">{row.label}</div>
              <div className="text-zinc-200 font-medium">{String(row.value ?? '—')}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Save to experiments note */}
      <div className="rounded-lg bg-brand-500/10 border border-brand-500/20 p-3 text-xs text-brand-400">
        This result has been saved to your Experiments. Go to the Experiments page to compare it with other runs.
      </div>
    </div>
  )
}

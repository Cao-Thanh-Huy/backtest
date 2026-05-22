'use client'

import dynamic from 'next/dynamic'

const ReactECharts = dynamic(() => import('echarts-for-react'), { ssr: false })

const SERIES_COLORS = [
  '#6366f1', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6',
  '#06b6d4', '#ec4899', '#84cc16', '#f97316', '#14b8a6',
]

interface CurvePoint {
  time: string
  value: number
}

interface CompareData {
  labels: string[]
  curves: CurvePoint[][]
}

export function EquityCurveOverlay({ data }: { data: CompareData }) {
  if (!data.curves.length) return null

  // Build unified time axis (use first curve's timestamps)
  const times = data.curves[0]?.map((p) => p.time) ?? []

  const series = data.curves.map((curve, i) => ({
    name: data.labels[i] || `Run ${i + 1}`,
    type: 'line',
    smooth: true,
    symbol: 'none',
    data: curve.map((p) => p.value),
    lineStyle: { color: SERIES_COLORS[i % SERIES_COLORS.length], width: 2 },
  }))

  const option = {
    backgroundColor: 'transparent',
    legend: {
      data: data.labels,
      textStyle: { color: '#94a3b8', fontSize: 11 },
      bottom: 0,
    },
    grid: { left: 70, right: 20, top: 10, bottom: 50 },
    xAxis: {
      type: 'category',
      data: times,
      axisLabel: {
        color: '#64748b',
        fontSize: 10,
        interval: Math.floor(times.length / 8),
      },
      axisLine: { lineStyle: { color: '#334155' } },
    },
    yAxis: {
      type: 'value',
      name: 'Normalized (base 100)',
      nameTextStyle: { color: '#475569', fontSize: 10 },
      axisLabel: {
        color: '#64748b',
        fontSize: 10,
        formatter: (v: number) => `${v.toFixed(0)}`,
      },
      splitLine: { lineStyle: { color: '#1e293b' } },
    },
    series,
    tooltip: {
      trigger: 'axis',
      backgroundColor: '#0f172a',
      borderColor: '#334155',
      textStyle: { color: '#e2e8f0', fontSize: 11 },
      formatter: (params: { seriesName: string; value: number }[]) => {
        const rows = params.map((p) => `<div>${p.seriesName}: <b>${p.value.toFixed(2)}</b></div>`).join('')
        return `<div style="font-size:11px">${rows}</div>`
      },
    },
  }

  return (
    <div className="rounded-xl border border-surface-border bg-surface p-4">
      <div className="text-sm font-semibold text-zinc-300 mb-3">Equity Curve Comparison (Normalized)</div>
      <ReactECharts option={option} style={{ height: 320 }} theme="dark" />
    </div>
  )
}

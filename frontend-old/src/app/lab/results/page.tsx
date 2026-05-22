'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { listBacktests, getEquityCurve, listModels } from '@/lib/api'
import { BacktestResult, AIModel } from '@/store/appStore'
import dynamic from 'next/dynamic'

const ReactECharts = dynamic(() => import('echarts-for-react'), { ssr: false })

const COLORS = ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4']

interface CurveEntry { time: string; value: number }

export default function ResultsPage() {
  const { data: backtests = [] } = useQuery<BacktestResult[]>({ queryKey: ['backtests'], queryFn: () => listBacktests().then(r => r.data) })
  const { data: models = [] } = useQuery<AIModel[]>({ queryKey: ['models'], queryFn: () => listModels().then(r => r.data) })

  const completed = backtests.filter(b => b.status === 'completed')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [curves, setCurves] = useState<Record<string, CurveEntry[]>>({})
  const [loading, setLoading] = useState(false)

  function toggleSelect(id: string) {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  async function loadCurves() {
    if (selected.size === 0) return
    setLoading(true)
    const results: Record<string, CurveEntry[]> = {}
    for (const id of selected) {
      if (!curves[id]) {
        try {
          const res = await getEquityCurve(id)
          results[id] = res.data
        } catch { /* skip */ }
      }
    }
    setCurves(prev => ({ ...prev, ...results }))
    setLoading(false)
  }

  const chartSeries = Array.from(selected).map((id, i) => {
    const curve = curves[id] ?? []
    const bt = completed.find(b => b.id === id)
    const m = models.find(mo => mo.id === bt?.model_id)
    const label = m ? `${m.model_type} · ${m.target_column}` : id.slice(0, 8)
    return {
      type: 'line', smooth: true, symbol: 'none',
      name: label,
      data: curve.map(p => [p.time, p.value]),
      lineStyle: { color: COLORS[i % COLORS.length], width: 2 },
    }
  })

  const echartsOption = {
    backgroundColor: 'transparent',
    legend: { textStyle: { color: '#94a3b8', fontSize: 11 }, top: 0 },
    grid: { top: 50, bottom: 40, left: 60, right: 20 },
    tooltip: { trigger: 'axis' },
    xAxis: { type: 'time', axisLine: { lineStyle: { color: '#334155' } }, axisLabel: { color: '#64748b', fontSize: 10 } },
    yAxis: { type: 'value', axisLine: { lineStyle: { color: '#334155' } }, axisLabel: { color: '#64748b', fontSize: 10 }, splitLine: { lineStyle: { color: '#1e293b' } } },
    series: chartSeries,
  }

  const metricKeys = ['total_return', 'sharpe_ratio', 'sortino_ratio', 'calmar_ratio', 'max_drawdown', 'win_rate', 'n_trades', 'profit_factor']

  return (
    <div className="p-6 space-y-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-zinc-100">Results & Comparison</h1>
          <p className="text-xs text-zinc-500 mt-1">Select multiple backtests to compare equity curves and metrics</p>
        </div>
        <button
          onClick={loadCurves}
          disabled={selected.size === 0 || loading}
          className="btn-primary text-sm px-4 py-2"
        >
          {loading ? 'Loading...' : `Compare (${selected.size})`}
        </button>
      </div>

      {/* Selection table */}
      <div className="rounded-xl border border-white/[0.06] overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-surface-card border-b border-white/[0.06]">
              <th className="w-8 px-3 py-2"></th>
              <th className="px-3 py-2 text-left text-xs text-zinc-500 font-normal">Model</th>
              <th className="px-3 py-2 text-left text-xs text-zinc-500 font-normal">Target</th>
              <th className="px-3 py-2 text-right text-xs text-zinc-500 font-normal">Return %</th>
              <th className="px-3 py-2 text-right text-xs text-zinc-500 font-normal">Sharpe</th>
              <th className="px-3 py-2 text-right text-xs text-zinc-500 font-normal">Max DD %</th>
              <th className="px-3 py-2 text-right text-xs text-zinc-500 font-normal">Win Rate %</th>
              <th className="px-3 py-2 text-right text-xs text-zinc-500 font-normal">Trades</th>
              <th className="px-3 py-2 text-left text-xs text-zinc-500 font-normal">Date</th>
            </tr>
          </thead>
          <tbody>
            {completed.length === 0 && (
              <tr><td colSpan={9} className="px-3 py-8 text-center text-xs text-zinc-600">No completed backtests yet</td></tr>
            )}
            {completed.map((b, i) => {
              const m = models.find(mo => mo.id === b.model_id)
              const metrics = b.metrics as Record<string, number> | null | undefined
              const active = selected.has(b.id)
              return (
                <tr
                  key={b.id}
                  className={`border-b border-white/[0.06] cursor-pointer transition-colors ${active ? 'bg-brand/[0.08]' : i % 2 === 0 ? 'bg-surface/20' : ''} hover:bg-surface`}
                  onClick={() => toggleSelect(b.id)}
                >
                  <td className="px-3 py-2">
                    <div className={`w-4 h-4 rounded border-2 flex items-center justify-center ${active ? 'bg-brand-500 border-brand-500' : 'border-zinc-600'}`}>
                      {active && <span className="text-white text-[9px]">✓</span>}
                    </div>
                  </td>
                  <td className="px-3 py-2 font-mono text-xs text-zinc-300">{m?.model_type ?? '—'}</td>
                  <td className="px-3 py-2 font-mono text-xs text-zinc-400">{m?.target_column ?? '—'}</td>
                  <td className={`px-3 py-2 text-right text-xs font-mono ${metrics?.total_return != null && metrics.total_return > 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                    {metrics?.total_return != null ? `${metrics.total_return.toFixed(2)}%` : '—'}
                  </td>
                  <td className={`px-3 py-2 text-right text-xs font-mono ${metrics?.sharpe_ratio != null && metrics.sharpe_ratio > 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                    {metrics?.sharpe_ratio != null ? metrics.sharpe_ratio.toFixed(3) : '—'}
                  </td>
                  <td className="px-3 py-2 text-right text-xs font-mono text-red-400">
                    {metrics?.max_drawdown != null ? `${metrics.max_drawdown.toFixed(2)}%` : '—'}
                  </td>
                  <td className="px-3 py-2 text-right text-xs font-mono text-zinc-300">
                    {metrics?.win_rate != null ? `${metrics.win_rate.toFixed(1)}%` : '—'}
                  </td>
                  <td className="px-3 py-2 text-right text-xs font-mono text-zinc-400">
                    {metrics?.n_trades ?? '—'}
                  </td>
                  <td className="px-3 py-2 text-xs text-zinc-600">{new Date(b.created_at).toLocaleDateString()}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Overlay chart */}
      {selected.size > 0 && Object.keys(curves).length > 0 && (
        <div className="rounded-xl border border-white/[0.06] bg-surface-card p-5">
          <div className="text-xs text-zinc-500 mb-3 font-semibold uppercase tracking-wider">Equity Curve Overlay</div>
          <ReactECharts option={echartsOption} style={{ height: 350 }} />
        </div>
      )}

      {/* Metrics comparison table */}
      {selected.size > 1 && (
        <div className="rounded-xl border border-white/[0.06] overflow-hidden">
          <div className="bg-surface-card px-4 py-2 text-xs text-zinc-500 font-semibold uppercase tracking-wider border-b border-white/[0.06]">
            Metrics Comparison
          </div>
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-white/[0.06]">
                <th className="px-4 py-2 text-left text-zinc-500 font-normal">Metric</th>
                {Array.from(selected).map((id, i) => {
                  const bt = completed.find(b => b.id === id)
                  const m = models.find(mo => mo.id === bt?.model_id)
                  return (
                    <th key={id} className="px-4 py-2 text-right font-normal" style={{ color: COLORS[i % COLORS.length] }}>
                      {m?.model_type ?? id.slice(0, 8)}
                    </th>
                  )
                })}
              </tr>
            </thead>
            <tbody>
              {metricKeys.map((key, ri) => (
                <tr key={key} className={`border-b border-white/[0.06] ${ri % 2 === 0 ? 'bg-surface/20' : ''}`}>
                  <td className="px-4 py-2 text-zinc-400">{key}</td>
                  {Array.from(selected).map(id => {
                    const bt = completed.find(b => b.id === id)
                    const metrics = bt?.metrics as Record<string, number> | null | undefined
                    const val = metrics?.[key]
                    return (
                      <td key={id} className="px-4 py-2 text-right font-mono text-zinc-300">
                        {val != null ? (Math.abs(val) < 10 ? val.toFixed(3) : val.toFixed(0)) : '—'}
                        {(key === 'total_return' || key === 'max_drawdown' || key === 'win_rate') && val != null ? '%' : ''}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

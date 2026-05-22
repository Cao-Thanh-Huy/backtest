'use client'

import { useEffect, useState } from 'react'
import { listExperiments, compareExperiments } from '@/lib/api'
import { ExperimentsTable } from '@/components/experiments/ExperimentsTable'
import { EquityCurveOverlay } from '@/components/experiments/EquityCurveOverlay'

interface Experiment {
  id: string
  symbol: string
  timeframe: string
  model_type: string
  target_column: string
  sharpe_ratio: number | null
  cagr: number | null
  max_drawdown: number | null
  win_rate: number | null
  profit_factor: number | null
  total_return: number | null
  n_trades: number | null
  created_at: string
  dataset_id: string
  pipeline_id: string
  model_id: string
}

export default function ExperimentsPage() {
  const [experiments, setExperiments] = useState<Experiment[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<string[]>([])
  const [comparing, setComparing] = useState(false)
  const [compareData, setCompareData] = useState<{ labels: string[]; curves: { time: string; value: number }[][] } | null>(null)
  const [compareError, setCompareError] = useState<string | null>(null)

  useEffect(() => {
    listExperiments()
      .then((r) => setExperiments(r.data))
      .catch(() => setError('Failed to load experiments'))
      .finally(() => setLoading(false))
  }, [])

  function toggleSelect(id: string) {
    setSelected((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    )
    // Reset compare data on selection change
    setCompareData(null)
    setCompareError(null)
  }

  async function handleCompare() {
    if (selected.length < 2) return
    setComparing(true)
    setCompareError(null)
    try {
      const res = await compareExperiments(selected)
      const rows: { label: string; curve: { time: string; value: number }[] }[] = res.data
      setCompareData({
        labels: rows.map((r) => r.label),
        curves: rows.map((r) => r.curve),
      })
    } catch {
      setCompareError('Failed to compare equity curves. Make sure backtests have equity curve data.')
    } finally {
      setComparing(false)
    }
  }

  return (
    <div className="min-h-screen bg-surface-card">
      {/* Header */}
      <div className="border-b border-surface-border px-6 py-4 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-zinc-200">Experiments</h1>
          <p className="text-xs text-zinc-500 mt-0.5">
            {experiments.length} saved experiment{experiments.length !== 1 ? 's' : ''}
          </p>
        </div>
        <button
          onClick={handleCompare}
          disabled={selected.length < 2 || comparing}
          className="px-4 py-2 bg-brand-500 hover:bg-brand-600 disabled:opacity-40 text-white rounded-lg text-sm font-semibold transition-colors"
        >
          {comparing ? 'Comparing...' : `Compare (${selected.length})`}
        </button>
      </div>

      <div className="max-w-7xl mx-auto px-4 py-6 space-y-6">
        {/* Selection hint */}
        {selected.length > 0 && (
          <div className="flex items-center gap-3 rounded-lg bg-brand-500/10 border border-brand-500/20 px-4 py-2.5">
            <span className="text-xs text-brand-400">
              {selected.length} experiment{selected.length !== 1 ? 's' : ''} selected
            </span>
            {selected.length >= 2 && (
              <span className="text-xs text-zinc-500">· Click "Compare" to overlay equity curves</span>
            )}
            <button
              onClick={() => { setSelected([]); setCompareData(null) }}
              className="ml-auto text-xs text-zinc-500 hover:text-zinc-300"
            >
              Clear
            </button>
          </div>
        )}

        {/* Table */}
        {loading ? (
          <div className="py-12 text-center text-zinc-500">Loading experiments...</div>
        ) : error ? (
          <div className="py-8 text-center text-red-400">{error}</div>
        ) : (
          <ExperimentsTable
            experiments={experiments}
            selected={selected}
            onToggleSelect={toggleSelect}
          />
        )}

        {/* Compare error */}
        {compareError && (
          <div className="rounded-lg bg-red-500/10 border border-red-500/30 p-3 text-sm text-red-400">
            {compareError}
          </div>
        )}

        {/* Overlay chart */}
        {compareData && (
          <EquityCurveOverlay data={compareData} />
        )}
      </div>
    </div>
  )
}

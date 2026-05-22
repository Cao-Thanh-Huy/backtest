'use client'

import { useState } from 'react'

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

const SORT_KEYS: { key: keyof Experiment; label: string }[] = [
  { key: 'sharpe_ratio', label: 'Sharpe' },
  { key: 'cagr', label: 'CAGR' },
  { key: 'max_drawdown', label: 'Max DD' },
  { key: 'win_rate', label: 'Win %' },
  { key: 'profit_factor', label: 'PF' },
  { key: 'total_return', label: 'Return %' },
  { key: 'n_trades', label: '# Trades' },
]

function fmt(val: number | null | undefined, unit = '', decimals = 2) {
  if (val === null || val === undefined || isNaN(val)) return '—'
  return `${val.toFixed(decimals)}${unit}`
}

function colorNum(val: number | null, higherBetter = true) {
  if (val === null || val === undefined) return 'text-zinc-600'
  return (higherBetter ? val > 0 : val < 0) ? 'text-emerald-400' : 'text-red-400'
}

export function ExperimentsTable({
  experiments,
  selected,
  onToggleSelect,
}: {
  experiments: Experiment[]
  selected: string[]
  onToggleSelect: (id: string) => void
}) {
  const [sortKey, setSortKey] = useState<keyof Experiment>('sharpe_ratio')
  const [sortDesc, setSortDesc] = useState(true)
  const [search, setSearch] = useState('')

  function toggleSort(k: keyof Experiment) {
    if (sortKey === k) setSortDesc((v) => !v)
    else { setSortKey(k); setSortDesc(true) }
  }

  const filtered = experiments
    .filter((e) => {
      const q = search.toLowerCase()
      return (
        e.symbol?.toLowerCase().includes(q) ||
        e.timeframe?.toLowerCase().includes(q) ||
        e.model_type?.toLowerCase().includes(q) ||
        e.target_column?.toLowerCase().includes(q)
      )
    })
    .sort((a, b) => {
      const av = a[sortKey] as number | null
      const bv = b[sortKey] as number | null
      if (av === null) return 1
      if (bv === null) return -1
      return sortDesc ? bv - av : av - bv
    })

  const SortHeader = ({ k, label }: { k: keyof Experiment; label: string }) => (
    <th
      onClick={() => toggleSort(k)}
      className="px-3 py-2 text-xs text-zinc-500 cursor-pointer hover:text-zinc-300 text-right whitespace-nowrap select-none"
    >
      {label}
      {sortKey === k && (
        <span className="ml-1 text-brand-400">{sortDesc ? '↓' : '↑'}</span>
      )}
    </th>
  )

  return (
    <div className="space-y-3">
      <input
        className="w-full bg-surface border border-surface-border rounded-lg px-3 py-2 text-sm text-zinc-200 placeholder-slate-600 focus:outline-none focus:border-brand-500"
        placeholder="Search symbol, model, target..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />

      <div className="overflow-x-auto rounded-xl border border-surface-border">
        <table className="w-full text-sm">
          <thead className="bg-surface">
            <tr>
              <th className="px-3 py-2 w-8" />
              <th className="px-3 py-2 text-xs text-zinc-500 text-left">Symbol</th>
              <th className="px-3 py-2 text-xs text-zinc-500 text-left">Timeframe</th>
              <th className="px-3 py-2 text-xs text-zinc-500 text-left">Model</th>
              <th className="px-3 py-2 text-xs text-zinc-500 text-left">Target</th>
              {SORT_KEYS.map((k) => <SortHeader key={k.key} k={k.key} label={k.label} />)}
              <th className="px-3 py-2 text-xs text-zinc-500 text-left">Date</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-surface-border">
            {filtered.length === 0 && (
              <tr>
                <td colSpan={12} className="px-4 py-8 text-center text-sm text-zinc-600">
                  {search ? 'No matching experiments.' : 'No experiments yet. Run the Research Wizard to create one.'}
                </td>
              </tr>
            )}
            {filtered.map((e) => {
              const isSelected = selected.includes(e.id)
              return (
                <tr
                  key={e.id}
                  onClick={() => onToggleSelect(e.id)}
                  className={`cursor-pointer transition-colors ${isSelected ? 'bg-brand-500/10' : 'hover:bg-surface'}`}
                >
                  <td className="px-3 py-2.5">
                    <div className={`w-4 h-4 rounded border-2 flex items-center justify-center ${isSelected ? 'bg-brand-500 border-brand-500' : 'border-zinc-600'}`}>
                      {isSelected && <span className="text-white text-xs leading-none">✓</span>}
                    </div>
                  </td>
                  <td className="px-3 py-2.5 text-zinc-200 font-medium">{e.symbol || '—'}</td>
                  <td className="px-3 py-2.5 text-zinc-400">{e.timeframe || '—'}</td>
                  <td className="px-3 py-2.5">
                    <span className="text-xs bg-surface-border px-2 py-0.5 rounded text-zinc-300">{e.model_type?.toUpperCase() || '—'}</span>
                  </td>
                  <td className="px-3 py-2.5 font-mono text-xs text-zinc-400">{e.target_column || '—'}</td>
                  <td className={`px-3 py-2.5 text-right ${colorNum(e.sharpe_ratio)}`}>{fmt(e.sharpe_ratio)}</td>
                  <td className={`px-3 py-2.5 text-right ${colorNum(e.cagr)}`}>{fmt(e.cagr, '%')}</td>
                  <td className={`px-3 py-2.5 text-right ${colorNum(e.max_drawdown, false)}`}>{fmt(e.max_drawdown, '%')}</td>
                  <td className={`px-3 py-2.5 text-right ${colorNum(e.win_rate)}`}>{fmt(e.win_rate, '%')}</td>
                  <td className={`px-3 py-2.5 text-right ${colorNum(e.profit_factor)}`}>{fmt(e.profit_factor)}</td>
                  <td className={`px-3 py-2.5 text-right ${colorNum(e.total_return)}`}>{fmt(e.total_return, '%')}</td>
                  <td className="px-3 py-2.5 text-right text-zinc-400">{e.n_trades ?? '—'}</td>
                  <td className="px-3 py-2.5 text-xs text-zinc-600 whitespace-nowrap">
                    {e.created_at ? new Date(e.created_at).toLocaleDateString() : '—'}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

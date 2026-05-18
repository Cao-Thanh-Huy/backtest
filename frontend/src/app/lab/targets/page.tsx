'use client'

import { useState, useEffect, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  listDataPreps,
  listLabeledDatasets,
  createLabeledDataset,
  deleteLabeledDataset,
  getLabeledTargetStats,
  connectTaskWS,
  TaskProgress,
} from '@/lib/api'
import { useAppStore, DataPreparation, LabeledDataset } from '@/store/appStore'
import { LabPage, StatusBadge, EmptyState } from '@/components/ui/LabPage'
import { Trash2, Plus, ChevronRight } from 'lucide-react'

interface TargetStat {
  name: string
  type: 'regression' | 'classification'
  method: string
  params: Record<string, unknown>
  nullCount: number
  totalRows: number
  labelCounts?: Record<string, number>
  min?: number; max?: number; mean?: number; std?: number
}

const parseNumberList = (str: string) =>
  [...new Set(str.split(',').map(s => parseInt(s.trim())).filter(n => !isNaN(n) && n > 0))].sort((a, b) => a - b)

export default function TargetsPage() {
  const queryClient = useQueryClient()
  const { activeLabeledDatasetId, setActiveLabeledDataset } = useAppStore()

  // --- Step 1 input: list completed DataPreparations ---
  const { data: dataPreps = [], isLoading: prefsLoading } = useQuery<DataPreparation[]>({
    queryKey: ['data-preps'],
    queryFn: () => listDataPreps().then(r => r.data),
  })
  const completedPreps = dataPreps.filter(p => p.status === 'completed' && p.s3_prepared_path)

  // --- Step 2 output: list LabeledDatasets ---
  const { data: labeledDatasets = [] } = useQuery<LabeledDataset[]>({
    queryKey: ['labeled-datasets'],
    queryFn: () => listLabeledDatasets().then(r => r.data),
    refetchInterval: 5000,
  })

  const [selectedPrepId, setSelectedPrepId] = useState<string>('')
  const [activeLdId, setActiveLdId] = useState<string | null>(activeLabeledDatasetId)
  const activeLd = labeledDatasets.find(ld => ld.id === activeLdId) ?? null

  // Sync to global store
  useEffect(() => {
    setActiveLabeledDataset(activeLdId)
  }, [activeLdId, setActiveLabeledDataset])

  // Auto-select first labeled dataset if none selected
  useEffect(() => {
    if (!activeLdId && labeledDatasets.length > 0) {
      setActiveLdId(labeledDatasets[0].id)
    }
  }, [labeledDatasets, activeLdId])

  // --- Generator state ---
  const [labelType, setLabelType] = useState<'direction' | 'return' | 'triple_barrier'>('return')
  const [horizonsStr, setHorizonsStr] = useState('1, 5, 20')
  const horizonsList = useMemo(() => parseNumberList(horizonsStr), [horizonsStr])
  const [tbMode, setTbMode] = useState<'fixed' | 'atr' | 'volatility'>('atr')
  const [tbTp, setTbTp] = useState('2.0')
  const [tbSl, setTbSl] = useState('1.0')
  const [taskState, setTaskState] = useState<TaskProgress | null>(null)
  const [targetStats, setTargetStats] = useState<TargetStat[]>([])
  const [loadingStats, setLoadingStats] = useState(false)

  const isGenerating = activeLd?.status === 'pending' || activeLd?.status === 'running' || taskState?.status === 'PROGRESS'

  // --- Load target stats when active labeled dataset changes ---
  useEffect(() => {
    if (!activeLd || activeLd.status !== 'completed') { setTargetStats([]); return }
    setLoadingStats(true)
    getLabeledTargetStats(activeLd.id)
      .then(res => setTargetStats(res.data.stats || []))
      .catch(() => setTargetStats([]))
      .finally(() => setLoadingStats(false))
  }, [activeLd?.id, activeLd?.status])

  // --- WebSocket for running task ---
  useEffect(() => {
    if (activeLd?.status === 'pending' && activeLd.celery_task_id) {
      setTaskState({ task_id: activeLd.celery_task_id, status: 'PROGRESS', progress: 0, message: 'Connecting...' })
      const ws = connectTaskWS(
        activeLd.celery_task_id,
        (data) => setTaskState(data),
        () => {
          queryClient.invalidateQueries({ queryKey: ['labeled-datasets'] })
          setTimeout(() => setTaskState(null), 2000)
        }
      )
      return () => ws.close()
    }
  }, [activeLd?.status, activeLd?.celery_task_id, queryClient])

  // --- Generate Targets ---
  const generateMutation = useMutation({
    mutationFn: async () => {
      if (!selectedPrepId) throw new Error('Please select a Data Preparation first')
      const targets = []
      for (const hz of horizonsList) {
        if (labelType === 'direction') {
          targets.push({ name: `y_direction_${hz}`, method: 'n_bar', params: { shift: hz, type: 'classification' } })
        } else if (labelType === 'return') {
          targets.push({ name: `y_return_${hz}`, method: 'n_bar', params: { shift: hz, type: 'regression' } })
        } else {
          targets.push({ name: `y_tb_${tbMode}_${tbTp}_${tbSl}_${hz}`, method: 'triple_barrier', params: { max_bars: hz, mode: tbMode, tp: parseFloat(tbTp), sl: parseFloat(tbSl) } })
        }
      }
      const res = await createLabeledDataset({ data_prep_id: selectedPrepId, targets })
      return res.data as LabeledDataset
    },
    onSuccess: (newLd) => {
      queryClient.invalidateQueries({ queryKey: ['labeled-datasets'] })
      setActiveLdId(newLd.id)
    },
  })

  // --- Delete ---
  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      if (!confirm('Delete this Labeled Dataset? Feature Sets linked to it will also be removed. Data Preparation is NOT affected.')) return
      await deleteLabeledDataset(id)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['labeled-datasets'] })
      setActiveLdId(null)
    },
  })

  function balanceScore(counts: Record<string, number>) {
    const vals = Object.values(counts); const total = vals.reduce((a, b) => a + b, 0)
    return total ? 1 - (Math.max(...vals) / total - 1 / vals.length) : 0
  }

  return (
    <LabPage
      title="Labeling System"
      subtitle="Generate ML targets from prepared data — each run creates an independent Labeled Dataset"
    >
      <div className="flex gap-6 max-w-7xl mx-auto p-4">
        
        {/* LEFT: List of Labeled Datasets */}
        <div className="w-64 flex-shrink-0 space-y-2">
          <div className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-3">Labeled Datasets</div>
          {labeledDatasets.length === 0 && (
            <div className="text-xs text-zinc-600 italic">No labeled datasets yet</div>
          )}
          {labeledDatasets.map(ld => (
            <button
              key={ld.id}
              onClick={() => setActiveLdId(ld.id)}
              className={`w-full text-left px-3 py-2.5 rounded-lg border text-sm transition-colors group ${
                activeLdId === ld.id
                  ? 'bg-brand-500/10 border-brand-500/40 text-brand-300'
                  : 'bg-black/20 border-white/5 text-zinc-400 hover:border-white/10 hover:text-zinc-200'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="truncate font-medium">{ld.name ?? `Labeled ${ld.id.slice(0, 8)}`}</span>
                <StatusBadge status={ld.status} />
              </div>
              <div className="text-[10px] text-zinc-600 mt-1">
                {ld.target_columns?.length ?? 0} targets · {ld.feature_columns?.length ?? 0} features
              </div>
            </button>
          ))}
        </div>

        {/* RIGHT: Main content */}
        <div className="flex-1 space-y-6">
          {/* Generator Card */}
          <div className="bg-surface border border-white/[0.06] rounded-xl p-5 shadow-lg">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-lg font-bold text-zinc-100 flex items-center gap-2">
                <span className="bg-brand-500/20 text-brand-400 p-1.5 rounded-md">🎯</span> Target Generator
              </h2>
              {activeLd && (
                <button
                  onClick={() => deleteMutation.mutate(activeLd.id)}
                  className="text-xs text-red-500 hover:text-red-400 flex items-center gap-1 transition-colors"
                >
                  <Trash2 className="w-3 h-3" /> Delete Selected
                </button>
              )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-[1fr_2fr] gap-6">
              {/* Left: Input selector */}
              <div className="space-y-4 border-r border-white/5 pr-6">
                <div className="space-y-2">
                  <label className="text-xs font-semibold text-zinc-300 uppercase tracking-wider">
                    Input: Data Preparation
                  </label>
                  <select
                    className="w-full bg-black border border-white/10 rounded-lg px-3 py-2.5 text-sm text-zinc-200 focus:border-brand-500 outline-none"
                    value={selectedPrepId}
                    onChange={e => setSelectedPrepId(e.target.value)}
                    disabled={isGenerating}
                  >
                    <option value="">Select a Data Preparation...</option>
                    {completedPreps.map(p => (
                      <option key={p.id} value={p.id}>
                        {p.name ?? `Prep ${p.id.slice(0, 8)}`}
                      </option>
                    ))}
                  </select>
                  {completedPreps.length === 0 && !prefsLoading && (
                    <p className="text-xs text-amber-500 mt-1">No completed Data Preparations. Run Data Preparation first.</p>
                  )}
                </div>

                {activeLd && (
                  <div className="p-3 bg-black/30 rounded-lg border border-white/5 space-y-2">
                    <div className="text-[10px] text-zinc-500 uppercase tracking-wider font-semibold mb-2">Selected Dataset</div>
                    <div className="flex justify-between text-xs">
                      <span className="text-zinc-500">Status</span>
                      <StatusBadge status={activeLd.status} />
                    </div>
                    <div className="flex justify-between text-xs">
                      <span className="text-zinc-500">Targets</span>
                      <span className="text-brand-400 font-mono font-bold">{activeLd.target_columns?.length ?? 0}</span>
                    </div>
                    <div className="flex justify-between text-xs">
                      <span className="text-zinc-500">Features</span>
                      <span className="text-zinc-200 font-mono font-bold">{activeLd.feature_columns?.length ?? 0}</span>
                    </div>
                    <div className="text-[10px] text-zinc-600 font-mono truncate mt-1">
                      ID: {activeLd.id.slice(0, 16)}...
                    </div>
                  </div>
                )}
              </div>

              {/* Right: Target config */}
              <div className="space-y-5">
                <div className="space-y-2">
                  <label className="text-xs font-semibold text-zinc-300 uppercase tracking-wider">1. Label Type</label>
                  <div className="flex gap-2">
                    {(['return', 'direction', 'triple_barrier'] as const).map(t => (
                      <button
                        key={t}
                        onClick={() => setLabelType(t)}
                        className={`flex-1 p-2.5 rounded-lg border text-center transition-colors text-xs ${
                          labelType === t
                            ? 'bg-brand-500/10 border-brand-500/50 text-brand-400 font-medium'
                            : 'bg-black/30 border-white/5 text-zinc-400 hover:border-white/10'
                        }`}
                      >
                        {t === 'return' ? 'Future Return' : t === 'direction' ? 'Direction' : 'Triple Barrier'}
                      </button>
                    ))}
                  </div>
                </div>

                {labelType === 'triple_barrier' && (
                  <div className="grid grid-cols-3 gap-3 p-3 rounded-lg border border-amber-500/20 bg-amber-500/5">
                    <div className="space-y-1">
                      <label className="text-[10px] text-zinc-400 uppercase tracking-wider">Mode</label>
                      <select value={tbMode} onChange={e => setTbMode(e.target.value as any)} className="w-full px-2 py-1.5 bg-black border border-white/10 rounded-md text-xs text-zinc-200 outline-none">
                        <option value="atr">ATR</option>
                        <option value="volatility">Volatility</option>
                        <option value="fixed">Fixed %</option>
                      </select>
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] text-zinc-400 uppercase tracking-wider">Take Profit</label>
                      <input type="text" value={tbTp} onChange={e => setTbTp(e.target.value)} className="w-full px-2 py-1.5 bg-black border border-white/10 rounded-md text-xs text-zinc-200 outline-none" />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] text-zinc-400 uppercase tracking-wider">Stop Loss</label>
                      <input type="text" value={tbSl} onChange={e => setTbSl(e.target.value)} className="w-full px-2 py-1.5 bg-black border border-white/10 rounded-md text-xs text-zinc-200 outline-none" />
                    </div>
                  </div>
                )}

                <div className="space-y-2">
                  <label className="text-xs font-semibold text-zinc-300 uppercase tracking-wider">2. Horizons (Bars)</label>
                  <div className="flex items-center gap-3">
                    <input
                      type="text"
                      value={horizonsStr}
                      onChange={e => setHorizonsStr(e.target.value)}
                      placeholder="e.g. 1, 5, 20"
                      className="flex-1 px-3 py-2.5 bg-black border border-white/10 rounded-lg text-sm text-zinc-200 outline-none focus:border-brand-500"
                    />
                    <button
                      onClick={() => generateMutation.mutate()}
                      disabled={isGenerating || horizonsList.length === 0 || !selectedPrepId}
                      className="px-5 py-2.5 bg-brand-500 hover:bg-brand-400 text-white font-semibold rounded-lg disabled:opacity-50 transition-colors shadow-lg shadow-brand-500/20 flex items-center gap-2 whitespace-nowrap"
                    >
                      <Plus className="w-4 h-4" />
                      {isGenerating ? 'Generating...' : `Generate ${horizonsList.length} Targets`}
                    </button>
                  </div>
                  <div className="text-[10px] text-zinc-500">Comma-separated integers. Each run creates a new independent Labeled Dataset.</div>
                </div>

                {generateMutation.isError && (
                  <div className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg p-3">
                    {String((generateMutation.error as Error)?.message)}
                  </div>
                )}

                {isGenerating && taskState && (
                  <div className="mt-4 rounded-lg border border-brand-500/30 bg-brand-500/5 p-4">
                    <div className="flex items-center justify-between text-xs mb-2">
                      <span className="font-semibold text-brand-400">{taskState.message}</span>
                      <span className="text-zinc-500">{taskState.progress}%</span>
                    </div>
                    <div className="h-1.5 w-full rounded-full bg-black overflow-hidden">
                      <div className="h-full bg-brand-500 transition-all duration-300" style={{ width: `${taskState.progress}%` }} />
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Target Statistics */}
          <div>
            <h3 className="text-lg font-bold text-zinc-100 mb-4 px-1">Generated Target Statistics</h3>

            {!activeLd && <EmptyState message="Select a Labeled Dataset from the left to view statistics." />}
            {activeLd && loadingStats && <div className="text-sm text-zinc-500 px-1">Loading statistics...</div>}
            {activeLd && !loadingStats && targetStats.length === 0 && activeLd.status === 'completed' && (
              <EmptyState message="No target columns found in this labeled dataset." />
            )}
            {activeLd && activeLd.status === 'pending' && (
              <EmptyState message="Waiting for target generation to complete..." />
            )}
            {activeLd && activeLd.status === 'failed' && (
              <div className="rounded-xl border border-red-500/20 bg-red-500/5 p-4 text-sm text-red-400">
                Error: {activeLd.error_message}
              </div>
            )}

            {!loadingStats && targetStats.length > 0 && (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {targetStats.map(stat => (
                  <div key={stat.name} className="rounded-xl border border-white/[0.06] bg-surface p-5 shadow-lg">
                    <div className="flex items-start justify-between mb-5 border-b border-white/5 pb-4">
                      <div>
                        <div className="font-mono font-bold text-zinc-100 text-[15px]">{stat.name}</div>
                        <div className="flex gap-1.5 mt-2 flex-wrap">
                          <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${stat.type === 'classification' ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/20' : 'bg-blue-500/15 text-blue-400 border border-blue-500/20'}`}>
                            {stat.type.toUpperCase()}
                          </span>
                          <span className="text-[10px] px-2 py-0.5 rounded-full bg-black border border-white/10 text-zinc-400 font-mono">{stat.method}</span>
                          {Object.entries(stat.params).map(([k, v]) => (
                            <span key={k} className="text-[10px] text-zinc-500 font-mono px-1">[{k}={String(v)}]</span>
                          ))}
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-xs font-semibold text-zinc-300">{(stat.totalRows - stat.nullCount).toLocaleString()} rows</div>
                        {stat.nullCount > 0 && <div className="text-[10px] text-amber-500 mt-1 bg-amber-500/10 px-1.5 py-0.5 rounded border border-amber-500/20">{stat.nullCount} NaN (Look-ahead)</div>}
                      </div>
                    </div>

                    {stat.type === 'classification' && stat.labelCounts && (
                      <div className="space-y-3">
                        <div className="flex justify-between items-end">
                          <div className="text-xs text-zinc-500 font-semibold uppercase tracking-wider">Class Distribution</div>
                          {(() => {
                            const balance = balanceScore(stat.labelCounts)
                            const isBalanced = balance > 0.7
                            return (
                              <div className={`text-[10px] px-1.5 py-0.5 rounded border ${isBalanced ? 'text-emerald-400 border-emerald-500/20 bg-emerald-500/10' : 'text-amber-400 border-amber-500/20 bg-amber-500/10'}`}>
                                Score: {(balance * 100).toFixed(0)}%
                              </div>
                            )
                          })()}
                        </div>
                        <div className="space-y-2">
                          {Object.entries(stat.labelCounts).sort((a, b) => Number(a[0]) - Number(b[0])).map(([label, count]) => {
                            const pctVal = count / (stat.totalRows - stat.nullCount) * 100
                            const color = label === '1' ? 'bg-emerald-500' : label === '-1' ? 'bg-red-500' : 'bg-slate-500'
                            return (
                              <div key={label}>
                                <div className="flex justify-between text-[11px] mb-1.5">
                                  <span className="font-mono font-medium text-zinc-300">
                                    {label === '1' ? 'Long (+1)' : label === '-1' ? 'Short (-1)' : label === '0' ? 'Flat (0)' : label}
                                  </span>
                                  <span className="text-zinc-400 font-mono">{pctVal.toFixed(1)}% ({count})</span>
                                </div>
                                <div className="h-1.5 w-full bg-black rounded-full overflow-hidden">
                                  <div className={`h-full rounded-full ${color}`} style={{ width: `${pctVal}%` }} />
                                </div>
                              </div>
                            )
                          })}
                        </div>
                      </div>
                    )}

                    {stat.type === 'regression' && (
                      <div className="grid grid-cols-4 gap-2 pt-2">
                        {[
                          { label: 'Min', value: stat.min, color: 'text-red-400' },
                          { label: 'Max', value: stat.max, color: 'text-emerald-400' },
                          { label: 'Mean', value: stat.mean, color: 'text-brand-400' },
                          { label: 'Std Dev', value: stat.std, color: 'text-zinc-300' },
                        ].map(({ label, value, color }) => (
                          <div key={label} className="rounded-lg border border-white/[0.04] bg-black/40 p-2.5 text-center">
                            <div className={`text-sm font-bold font-mono ${color}`}>
                              {value != null ? (Math.abs(value) < 0.01 ? value.toExponential(2) : value.toFixed(4)) : '—'}
                            </div>
                            <div className="text-[9px] text-zinc-500 mt-1 uppercase tracking-wider">{label}</div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </LabPage>
  )
}

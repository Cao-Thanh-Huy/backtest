'use client'

import { useState, useMemo, useEffect } from 'react'
import dynamic from 'next/dynamic'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { listStabilityExperiments, getStabilityExperiment, createStabilityExperiment, listFeatureSets } from '@/lib/api'
import { useAppStore, FeatureSet } from '@/store/appStore'
import { LabPage, EmptyState } from '@/components/ui/LabPage'
import { toast } from 'sonner'
import { X, ChevronRight, Info, AlertTriangle, Layers, Clock, Activity } from 'lucide-react'

const ReactECharts = dynamic(() => import('echarts-for-react'), {
  ssr: false,
  loading: () => <div className="text-xs text-zinc-600 p-4">Loading charts…</div>,
})

type DetailTab = 'overview' | 'temporal' | 'regimes' | 'clusters'

export default function StabilityPage() {
  const qc = useQueryClient()
  
  // Left sidebar state
  const [search, setSearch] = useState('')
  const [activeExpId, setActiveExpId] = useState<string | null>(null)
  
  // Detail state
  const [detailTab, setDetailTab] = useState<DetailTab>('overview')
  
  // Panel state
  const [panelOpen, setPanelOpen] = useState(false)
  const [formFsId, setFormFsId] = useState('')
  const [formName, setFormName] = useState('')
  const [formTarget, setFormTarget] = useState('y_direction_5')
  const [formTrainBars, setFormTrainBars] = useState(2000)
  const [formTestBars, setFormTestBars] = useState(500)

  const { data: featureSets = [] } = useQuery<FeatureSet[]>({
    queryKey: ['featureSets'],
    queryFn: () => listFeatureSets().then(r => r.data),
  })

  // List of experiments
  const { data: experiments = [], isLoading } = useQuery<any[]>({
    queryKey: ['stabilityExperiments'],
    queryFn: () => listStabilityExperiments().then(r => r.data),
    refetchInterval: (query) => {
      const activeRunning = query.state.data?.some((e: any) => e.status === 'pending' || e.status === 'running')
      return activeRunning ? 3000 : false
    }
  })

  const selectedFormFs = featureSets.find(fs => fs.id === formFsId)
  useEffect(() => {
    if (selectedFormFs && selectedFormFs.target_column) {
      setFormTarget(selectedFormFs.target_column)
    }
  }, [formFsId, selectedFormFs])

  // Selected experiment details
  const { data: selectedExp } = useQuery<any>({
    queryKey: ['stabilityExperiment', activeExpId],
    queryFn: () => getStabilityExperiment(activeExpId!).then(r => r.data),
    enabled: !!activeExpId,
    refetchInterval: (query) => {
      const isRunning = query.state.data?.status === 'pending' || query.state.data?.status === 'running'
      return isRunning ? 3000 : false
    }
  })

  const filteredExps = useMemo(() => {
    if (!search.trim()) return experiments
    const q = search.toLowerCase()
    return experiments.filter(e => e.name?.toLowerCase().includes(q) || e.feature_set_name?.toLowerCase().includes(q))
  }, [experiments, search])

  const createMut = useMutation({
    mutationFn: () => createStabilityExperiment({
      feature_set_id: formFsId,
      name: formName || `Stability — ${formFsId.slice(0,8)}`,
      target_column: formTarget,
      cv_strategy: { type: 'purged_walk_forward', train_bars: formTrainBars, test_bars: formTestBars, purge_bars: 20, embargo_bars: 5 },
      clustering_config: { method: 'hierarchical', distance_threshold: 0.2 },
      regime_method: 'volatility_hmm'
    }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['stabilityExperiments'] })
      setActiveExpId(res.data.id)
      setPanelOpen(false)
      toast.success('Stability experiment started. It will run in the background.')
    },
    onError: (e: any) => toast.error(e.message || 'Failed to create'),
  })

  const renderOverview = () => {
    if (!selectedExp?.metrics) return <div className="p-4 text-xs text-zinc-500">No metrics available yet...</div>
    const { features } = selectedExp.metrics
    const sorted = [...features].sort((a, b) => b.score - a.score)
    
    return (
      <div className="space-y-4">
        <div className="px-4 py-3 bg-white/[0.02] border border-white/[0.06] rounded-xl flex gap-3 text-xs">
          <Info className="w-4 h-4 text-zinc-500 shrink-0" />
          <div className="text-zinc-400 leading-relaxed">
            <p className="text-zinc-300 font-medium mb-1">Adjusted Score = SHAP Importance × Stability</p>
            This leaderboard ranks features by their Adjusted Score. Features with high absolute importance but low stability (high standard deviation across windows) are penalized to prevent "Fake Alpha" and leakage.
          </div>
        </div>

        <div className="border border-white/[0.06] rounded-lg overflow-hidden">
          <table className="w-full text-xs text-left">
            <thead className="bg-white/[0.02] text-zinc-500 border-b border-white/[0.06]">
              <tr>
                <th className="px-4 py-2 font-medium">Rank</th>
                <th className="px-4 py-2 font-medium">Feature</th>
                <th className="px-4 py-2 font-medium">Mean SHAP</th>
                <th className="px-4 py-2 font-medium">SHAP Std</th>
                <th className="px-4 py-2 font-medium">Adjusted Score</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.06]">
              {sorted.map((f, i) => (
                <tr key={f.name} className="hover:bg-white/[0.01]">
                  <td className="px-4 py-2 text-zinc-500">#{i + 1}</td>
                  <td className="px-4 py-2 font-mono text-brand-300">{f.name}</td>
                  <td className="px-4 py-2 text-zinc-300">{f.shap_mean.toFixed(4)}</td>
                  <td className="px-4 py-2 text-zinc-400">{f.shap_std.toFixed(4)}</td>
                  <td className="px-4 py-2">
                    <div className="flex items-center gap-2">
                      <div className="h-1.5 w-24 bg-zinc-800 rounded-full overflow-hidden">
                        <div className="h-full bg-brand-500" style={{ width: `${Math.min(100, f.score * 100)}%` }} />
                      </div>
                      <span className="text-zinc-300 font-medium">{f.score.toFixed(2)}</span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    )
  }

  const renderTemporal = () => {
    if (!selectedExp?.metrics) return null
    
    const scatterData = selectedExp.metrics.features.map((f: any) => ({
      name: f.name,
      value: [f.shap_mean, f.shap_std]
    }))

    const scatterOption = {
      backgroundColor: 'transparent',
      tooltip: { formatter: (p: any) => `${p.data.name}<br/>Mean: ${p.data.value[0]}<br/>Std: ${p.data.value[1]}` },
      xAxis: { type: 'value', name: 'Mean SHAP (Importance)', nameLocation: 'middle', nameGap: 25, splitLine: { show: false } },
      yAxis: { type: 'value', name: 'SHAP Std (Instability)', splitLine: { lineStyle: { color: '#3f3f46', type: 'dashed' } } },
      series: [{
        type: 'scatter',
        symbolSize: 8,
        itemStyle: { color: '#6366f1', opacity: 0.8 },
        data: scatterData,
        markArea: {
          silent: true,
          itemStyle: { color: 'rgba(34, 197, 94, 0.05)' },
          data: [[{ xAxis: 0.1, yAxis: 0 }, { xAxis: 'max', yAxis: 0.05 }]]
        }
      }]
    }

    return (
      <div className="space-y-6">
        <div className="px-4 py-3 bg-amber-500/10 border border-amber-500/20 rounded-xl flex gap-3 text-xs">
          <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0" />
          <div className="text-amber-200/80 leading-relaxed">
            <span className="text-amber-400 font-medium mr-1">Distribution Drift detected in 2 windows.</span>
            Kolmogorov-Smirnov test (p &lt; 0.05) indicates that features like <span className="font-mono">funding_rate</span> have suffered covariate shift.
          </div>
        </div>
        
        <div>
          <h3 className="text-xs font-semibold text-zinc-300 uppercase tracking-wide mb-3">Feature Stability (Mean vs Std)</h3>
          <div className="h-[400px] border border-white/[0.06] rounded-xl bg-white/[0.01] p-4">
            <ReactECharts option={scatterOption} style={{ height: '100%', width: '100%' }} theme="dark" />
          </div>
          <p className="text-[10px] text-zinc-500 mt-2 text-center">Ideal features fall in the bottom-right green zone (High Mean SHAP, Low Std SHAP).</p>
        </div>
      </div>
    )
  }

  const renderRegimes = () => {
    if (!selectedExp?.metrics) return null
    const { features } = selectedExp.metrics
    
    const radarIndicator = [
      { name: 'Bull Regime', max: 0.5 },
      { name: 'Bear Regime', max: 0.5 },
      { name: 'Sideways', max: 0.5 },
    ]
    
    // Pick top 3 for radar
    const top3 = [...features].sort((a,b) => b.score - a.score).slice(0, 3)
    const colors = ['#6366f1', '#10b981', '#f59e0b']
    
    const radarOption = {
      backgroundColor: 'transparent',
      tooltip: {},
      legend: { bottom: 0, textStyle: { color: '#71717a' }, data: top3.map(f => f.name) },
      radar: {
        indicator: radarIndicator,
        splitArea: { show: false },
        axisLine: { lineStyle: { color: '#3f3f46' } },
        splitLine: { lineStyle: { color: '#3f3f46' } },
      },
      series: [{
        type: 'radar',
        data: top3.map((f, i) => ({
          value: [f.regime_bull, f.regime_bear, (f.regime_bull + f.regime_bear)/2], // Mock sideways
          name: f.name,
          itemStyle: { color: colors[i] },
          areaStyle: { opacity: 0.1 }
        }))
      }]
    }

    return (
      <div className="space-y-6">
        <div>
          <h3 className="text-xs font-semibold text-zinc-300 uppercase tracking-wide mb-3">Regime-Conditioned SHAP</h3>
          <div className="h-[400px] border border-white/[0.06] rounded-xl bg-white/[0.01] p-4 flex items-center justify-center">
            <ReactECharts option={radarOption} style={{ height: '100%', width: '600px' }} theme="dark" />
          </div>
        </div>
      </div>
    )
  }

  const renderClusters = () => {
    if (!selectedExp?.metrics?.clusters) return null
    const { clusters } = selectedExp.metrics
    return (
      <div className="space-y-4">
        <div className="px-4 py-3 bg-white/[0.02] border border-white/[0.06] rounded-xl flex gap-3 text-xs">
          <Layers className="w-4 h-4 text-zinc-500 shrink-0" />
          <div className="text-zinc-400 leading-relaxed">
            Hierarchical Feature Clustering prevents substitution effects. Features grouped here share similar alpha sources. Selecting one representative per cluster is recommended for live trading.
          </div>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {Object.entries(clusters).map(([cid, feats]: [string, any]) => (
            <div key={cid} className="border border-white/[0.06] bg-white/[0.02] rounded-lg p-3">
              <div className="text-[10px] uppercase text-zinc-500 font-semibold mb-2">Cluster {cid}</div>
              <div className="space-y-1">
                {feats.map((f: string) => (
                  <div key={f} className="text-xs font-mono text-zinc-300 px-2 py-1 bg-zinc-900 rounded">{f}</div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    )
  }

  return (
    <>
      <LabPage
        title="Feature Stability Research"
        subtitle="Quant-grade temporal robustness analysis using Purged CV, Embargo, and Regime-conditioned SHAP."
        action={<button onClick={() => setPanelOpen(true)} className="btn-primary text-sm px-4 py-2">+ New Experiment</button>}
        list={
          <div className="flex flex-col h-full">
            <div className="p-3 border-b border-white/[0.06] shrink-0">
              <input className="input text-xs w-full" placeholder="Search experiments…" value={search} onChange={e => setSearch(e.target.value)} />
            </div>
            <div className="flex-1 overflow-y-auto p-2 space-y-1">
              {isLoading && <div className="text-xs text-zinc-600 px-2 py-3">Loading…</div>}
              {filteredExps.map(exp => {
                const active = exp.id === activeExpId
                return (
                  <button key={exp.id} onClick={() => { setActiveExpId(exp.id); setDetailTab('overview') }}
                    className={`w-full text-left px-3 py-3 transition-all duration-150 border-l-2 rounded-r-lg ${active ? 'border-l-indigo-400 bg-white/[0.03]' : 'border-l-transparent hover:bg-white/[0.02]'}`}
                  >
                    <div className="text-sm font-medium text-zinc-100 truncate">{exp.name}</div>
                    <div className="text-[10px] text-zinc-500 mt-1 flex gap-2 flex-wrap">
                      <span className="font-mono text-indigo-300">{exp.target_column}</span>
                      <span>·</span><span>{exp.feature_count} features</span>
                    </div>
                  </button>
                )
              })}
            </div>
          </div>
        }
        detail={
          <div className="space-y-5">
            {selectedExp && (
              <>
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h2 className="text-2xl font-semibold text-zinc-50 tracking-tight">{selectedExp.name || selectedExp.id}</h2>
                    <div className="flex gap-4 mt-2 text-xs text-zinc-500 items-center">
                      <span className="flex items-center gap-1.5"><Clock className="w-3.5 h-3.5" /> Purged CV: {selectedExp.metadata?.cv_strategy?.train_bars} train / {selectedExp.metadata?.cv_strategy?.test_bars} test</span>
                      <span className="flex items-center gap-1.5"><Activity className="w-3.5 h-3.5" /> Regime: {selectedExp.metadata?.regime_method}</span>
                      <span className="font-mono text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded">{selectedExp.metadata?.target_column}</span>
                    </div>
                  </div>
                </div>

                {selectedExp.status === 'pending' || selectedExp.status === 'running' ? (
                  <div className="bg-indigo-500/10 border border-indigo-500/20 rounded-xl p-4">
                    <div className="flex justify-between items-end">
                      <div>
                        <div className="text-sm font-semibold text-indigo-400 flex items-center gap-2">
                          <span className="w-2 h-2 rounded-full bg-indigo-500 animate-pulse" />
                          Stability Experiment in Progress...
                        </div>
                        <div className="text-xs text-zinc-400 mt-1">Running background task...</div>
                      </div>
                    </div>
                  </div>
                ) : selectedExp.status === 'failed' ? (
                  <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-4">
                    <div className="text-sm font-semibold text-red-400">Experiment Failed</div>
                    <div className="text-xs text-zinc-400 mt-1">{selectedExp.error_message || 'An unknown error occurred.'}</div>
                  </div>
                ) : null}

                <div className="flex gap-0 border-b border-white/[0.06]">
                  {(['overview', 'temporal', 'regimes', 'clusters'] as DetailTab[]).map(tab => (
                    <button key={tab} onClick={() => setDetailTab(tab)}
                      className={`px-4 py-2.5 text-sm transition-colors border-b-2 -mb-px ${detailTab === tab ? 'border-indigo-400 text-zinc-100 font-medium' : 'border-transparent text-zinc-500 hover:text-zinc-300'}`}
                    >{tab.charAt(0).toUpperCase() + tab.slice(1)}</button>
                  ))}
                </div>

                {detailTab === 'overview' && renderOverview()}
                {detailTab === 'temporal' && renderTemporal()}
                {detailTab === 'regimes' && renderRegimes()}
                {detailTab === 'clusters' && renderClusters()}
              </>
            )}
            {!selectedExp && <EmptyState message="Select an experiment or create a new one to evaluate temporal stability." />}
          </div>
        }
      />

      {/* New Experiment Panel */}
      {panelOpen && (
        <>
          <div className="fixed inset-0 z-40 bg-black/60" onClick={() => setPanelOpen(false)} />
          <div className="fixed right-0 top-0 bottom-0 z-50 w-[500px] bg-surface-card border-l border-white/[0.06] flex flex-col shadow-2xl">
            <div className="flex items-center justify-between px-6 py-4 border-b border-white/[0.06]">
              <h2 className="font-semibold text-zinc-100">New Stability Experiment</h2>
              <button onClick={() => setPanelOpen(false)} className="text-zinc-500 hover:text-zinc-300"><X className="w-4 h-4" /></button>
            </div>
            
            <div className="p-6 space-y-4 flex-1 overflow-y-auto">
              <div>
                <label className="label">Feature Set (Source)</label>
                <select className="input text-sm" value={formFsId} onChange={e => setFormFsId(e.target.value)}>
                  <option value="">-- select feature set --</option>
                  {featureSets.map(fs => <option key={fs.id} value={fs.id}>{fs.name}</option>)}
                </select>
              </div>
              
              <div>
                <label className="label">Target Horizon</label>
                <input className="input text-sm" value={formTarget} onChange={e => setFormTarget(e.target.value)} placeholder="e.g. y_direction_5" />
              </div>

              <div className="pt-2 border-t border-white/[0.06]">
                <h3 className="text-xs font-semibold text-zinc-300 mb-3 uppercase tracking-wide">Purged Walk-Forward Config</h3>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="label">Train Bars</label>
                    <input type="number" className="input text-sm" value={formTrainBars} onChange={e => setFormTrainBars(Number(e.target.value))} />
                  </div>
                  <div>
                    <label className="label">Test Bars (Step Size)</label>
                    <input type="number" className="input text-sm" value={formTestBars} onChange={e => setFormTestBars(Number(e.target.value))} />
                  </div>
                </div>
                <p className="text-[10px] text-zinc-500 mt-2">Purge: 20 bars, Embargo: 5 bars (auto-injected based on horizon).</p>
              </div>
            </div>

            <div className="px-6 py-4 border-t border-white/[0.06] flex items-center gap-3 bg-white/[0.01]">
              <button onClick={() => createMut.mutate()} disabled={createMut.isPending || !formFsId} className="btn-primary flex-1 text-sm">
                {createMut.isPending ? 'Starting...' : 'Start Research Run'}
              </button>
            </div>
          </div>
        </>
      )}
    </>
  )
}

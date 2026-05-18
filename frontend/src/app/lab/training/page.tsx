'use client'

import { useEffect, useMemo, useState } from 'react'
import dynamic from 'next/dynamic'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  listFeatureSets, listModels, trainModel, connectTaskWS, TaskProgress,
} from '@/lib/api'
import { useAppStore, FeatureSet, AIModel } from '@/store/appStore'
import { LabPage, StatusBadge, TaskBar, EmptyState } from '@/components/ui/LabPage'
import { toast } from 'sonner'
import { getApiErrorMessage } from '@/lib/api-error'

const MODEL_TYPES = [
  { id: 'lightgbm',      label: 'LightGBM',      desc: 'Fast gradient boosting' },
  { id: 'xgboost',       label: 'XGBoost',       desc: 'Reliable boosting' },
  { id: 'random_forest', label: 'Random Forest', desc: 'Ensemble baseline' },
]
const CV_PRESETS = {
  fast:     { label: 'Fast',         splits: 3, gap: 5 },
  standard: { label: 'Standard',     splits: 5, gap: 10 },
  robust:   { label: 'Robust',       splits: 7, gap: 20 },
}

const ReactECharts = dynamic(() => import('echarts-for-react'), { ssr: false })

interface TuningTrial {
  trial: number
  score: number
  hyperparameters: Record<string, unknown>
  aggregate: Record<string, number>
}

interface TuningSummary {
  enabled?: boolean
  n_trials?: number
  optimize_metric?: string
  best_score?: number
  best_hyperparameters?: Record<string, unknown>
  trials?: TuningTrial[]
}

interface ExplainabilitySummary {
  method?: string
  n_samples?: number
  mean_abs?: Record<string, number>
  top_features?: Record<string, number>
}

function shouldMinimizeMetric(metric?: string): boolean {
  const m = (metric || '').toLowerCase()
  return m.includes('rmse') || m.includes('mae') || m.includes('loss') || m.includes('error')
}

function formatParamValue(v: unknown): string {
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : v.toFixed(6)
  if (v === null) return 'null'
  return String(v)
}

function inferDefaultOptimizeMetric(targetColumn?: string): string {
  const name = (targetColumn || '').toLowerCase()
  return /(dir|tb|class|label|signal|side)/.test(name) ? 'accuracy_mean' : 'r2_mean'
}

export default function TrainingPage() {
  const qc = useQueryClient()
  const { activeFeatureSetId, activeModelId, setActiveModel, setTaskProgress, taskProgress, taskMessage, taskStatus, activeTaskId } = useAppStore()

  const { data: featureSets = [] } = useQuery<FeatureSet[]>({ queryKey: ['featureSets'], queryFn: () => listFeatureSets().then(r => r.data) })
  const { data: models = [], isLoading } = useQuery<AIModel[]>({
    queryKey: ['models'],
    queryFn: () => listModels().then(r => r.data),
    refetchInterval: (q) => {
      const data = q.state.data as AIModel[] | undefined
      return data?.some(m => m.status === 'pending' || m.status === 'running') ? 3000 : false
    },
  })

  const selected = models.find(m => m.id === activeModelId) ?? models[0] ?? null
  const [formOpen, setFormOpen] = useState(false)
  const [formFsId, setFormFsId] = useState(activeFeatureSetId ?? featureSets[0]?.id ?? '')
  const [modelType, setModelType] = useState('lightgbm')
  const [nSplits, setNSplits] = useState(5)
  const [gap, setGap] = useState(10)
  const [autoTune, setAutoTune] = useState(true)
  const [tuneTrials, setTuneTrials] = useState(20)
  const [optimizeMetric, setOptimizeMetric] = useState('accuracy_mean')
  const [training, setTraining] = useState(false)
  const [trainError, setTrainError] = useState<string | null>(null)

  const activeFs = featureSets.find(fs => fs.id === formFsId)

  useEffect(() => {
    if (activeFs) setOptimizeMetric(inferDefaultOptimizeMetric(activeFs.target_column))
  }, [activeFs?.target_column])

  async function handleTrain() {
    if (!formFsId || !activeFs) { toast.error('Select a feature set'); return }
    setTraining(true); setTrainError(null)
    try {
      const res = await trainModel({
        feature_set_id: formFsId,
        target_column: activeFs.target_column,
        model_type: modelType,
        auto_tune: autoTune,
        tune_trials: tuneTrials,
        optimize_metric: optimizeMetric,
        n_splits: nSplits,
        gap,
      })
      const task_id = res.data.celery_task_id as string
      setTaskProgress(task_id, 5, 'Starting training...', 'PROGRESS')
      await new Promise<void>((resolve, reject) => {
        connectTaskWS(task_id, async (data: TaskProgress) => {
          setTaskProgress(data.task_id, data.progress, data.message, data.status, data.step, data.sub as Record<string, unknown>)
          if (data.status === 'SUCCESS' && data.result) {
            const mid = data.result.model_id as string
            setActiveModel(mid)
            qc.invalidateQueries({ queryKey: ['models'] })
            setTraining(false); setFormOpen(false)
            toast.success('Training complete')
            resolve()
          } else if (data.status === 'FAILURE') {
            const err = data.error || 'Training failed'
            setTrainError(err); toast.error(err); setTraining(false); reject()
          }
        })
      })
    } catch (e) {
      setTraining(false); setTrainError(getApiErrorMessage(e, 'Training failed'))
    }
  }

  function selectModel(m: AIModel) {
    setActiveModel(m.id)
  }

  const isRunning = training || (activeTaskId != null && (taskStatus === 'PROGRESS' || taskStatus === 'STARTED'))

  const tuning = ((selected?.cv_metrics as Record<string, unknown> | null)?.tuning ?? null) as TuningSummary | null
  const explainability = ((selected?.cv_metrics as Record<string, unknown> | null)?.explainability ?? null) as ExplainabilitySummary | null
  const tuningTrials = tuning?.trials ?? []
  const sortAsc = shouldMinimizeMetric(tuning?.optimize_metric)

  const sortedTrials = useMemo(() => {
    const copy = tuningTrials.slice()
    copy.sort((a, b) => (sortAsc ? a.score - b.score : b.score - a.score))
    return copy
  }, [sortAsc, tuningTrials])

  const bestTrial = sortedTrials[0] ?? null
  const runnerUpTrial = sortedTrials[1] ?? null
  const topTrials = sortedTrials.slice(0, 8)

  const tuningChartOption = useMemo(() => {
    if (!tuning || tuningTrials.length === 0) return null
    const metricName = tuning.optimize_metric || 'score'
    const points = tuningTrials
      .slice()
      .sort((a, b) => a.trial - b.trial)
      .map((t) => [t.trial, Number(t.score)])

    return {
      backgroundColor: 'transparent',
      grid: { top: 24, left: 48, right: 20, bottom: 40 },
      tooltip: { trigger: 'axis' },
      xAxis: {
        type: 'category',
        name: 'Trial',
        nameLocation: 'middle',
        nameGap: 28,
        axisLabel: { color: '#64748b', fontSize: 10 },
        axisLine: { lineStyle: { color: '#334155' } },
        data: points.map((p) => String(p[0])),
      },
      yAxis: {
        type: 'value',
        name: metricName,
        nameTextStyle: { color: '#64748b', fontSize: 10 },
        axisLabel: { color: '#64748b', fontSize: 10 },
        splitLine: { lineStyle: { color: '#1e293b' } },
      },
      series: [{
        type: 'line',
        smooth: true,
        symbol: 'circle',
        symbolSize: 5,
        lineStyle: { color: '#8b5cf6', width: 2 },
        itemStyle: { color: '#a78bfa' },
        areaStyle: {
          color: {
            type: 'linear',
            x: 0,
            y: 0,
            x2: 0,
            y2: 1,
            colorStops: [
              { offset: 0, color: 'rgba(139,92,246,0.24)' },
              { offset: 1, color: 'rgba(139,92,246,0.02)' },
            ],
          },
        },
        data: points.map((p) => p[1]),
      }],
    }
  }, [tuning, tuningTrials])

  const topTrialsBarOption = useMemo(() => {
    if (topTrials.length === 0) return null
    return {
      backgroundColor: 'transparent',
      grid: { top: 24, left: 48, right: 20, bottom: 50 },
      tooltip: { trigger: 'axis' },
      xAxis: {
        type: 'category',
        axisLabel: { color: '#64748b', fontSize: 10 },
        axisLine: { lineStyle: { color: '#334155' } },
        data: topTrials.map((t) => `T${t.trial}`),
      },
      yAxis: {
        type: 'value',
        axisLabel: { color: '#64748b', fontSize: 10 },
        splitLine: { lineStyle: { color: '#1e293b' } },
      },
      series: [{
        type: 'bar',
        data: topTrials.map((t, idx) => ({
          value: t.score,
          itemStyle: { color: idx === 0 ? '#22c55e' : '#8b5cf6' },
        })),
      }],
    }
  }, [topTrials])

  const bestVsRunnerDiff = useMemo(() => {
    if (!bestTrial || !runnerUpTrial) return [] as Array<{ key: string; best: string; runner: string; changed: boolean }>
    const keys = Array.from(new Set([
      ...Object.keys(bestTrial.hyperparameters || {}),
      ...Object.keys(runnerUpTrial.hyperparameters || {}),
    ])).sort()
    return keys.map((k) => {
      const b = bestTrial.hyperparameters?.[k]
      const r = runnerUpTrial.hyperparameters?.[k]
      return {
        key: k,
        best: formatParamValue(b),
        runner: formatParamValue(r),
        changed: formatParamValue(b) !== formatParamValue(r),
      }
    })
  }, [bestTrial, runnerUpTrial])

  const shapChartOption = useMemo(() => {
    const feats = Object.entries(explainability?.top_features || {})
    if (feats.length === 0) return null
    const labels = feats.map(([k]) => k).reverse()
    const vals = feats.map(([, v]) => Number(v)).reverse()
    return {
      backgroundColor: 'transparent',
      grid: { top: 18, left: 140, right: 22, bottom: 24 },
      tooltip: { trigger: 'axis' },
      xAxis: {
        type: 'value',
        axisLabel: { color: '#64748b', fontSize: 10 },
        splitLine: { lineStyle: { color: '#1e293b' } },
      },
      yAxis: {
        type: 'category',
        axisLabel: { color: '#94a3b8', fontSize: 10 },
        axisLine: { lineStyle: { color: '#334155' } },
        data: labels,
      },
      series: [{
        type: 'bar',
        data: vals,
        itemStyle: { color: '#06b6d4' },
      }],
    }
  }, [explainability])

  // Render feature importances bar chart (inline, no echarts dep)
  function ImportancesBar({ importances }: { importances: Record<string, number> }) {
    const sorted = Object.entries(importances).sort((a, b) => b[1] - a[1]).slice(0, 20)
    const max = sorted[0]?.[1] ?? 1
    return (
      <div className="space-y-1.5">
        {sorted.map(([feat, val]) => (
          <div key={feat} className="flex items-center gap-2">
            <div className="w-40 text-xs font-mono text-zinc-400 truncate text-right">{feat}</div>
            <div className="flex-1 h-4 bg-surface rounded overflow-hidden">
              <div className="h-full bg-brand-500/70 rounded" style={{ width: `${(val / max) * 100}%` }} />
            </div>
            <div className="w-16 text-xs text-zinc-500 font-mono text-right">{val.toFixed(4)}</div>
          </div>
        ))}
      </div>
    )
  }

  return (
    <LabPage
      title="Model Training"
      subtitle="Train an ML model from a feature set"
      action={
        <button onClick={() => setFormOpen(true)} className="btn-primary text-sm px-4 py-2">
          + Train Model
        </button>
      }
      list={
        <div className="p-3 space-y-1">
          {isLoading && <div className="text-xs text-zinc-600 p-2">Loading...</div>}
          {!isLoading && models.length === 0 && <div className="text-xs text-zinc-600 p-2">No models yet.</div>}
          {models.map(m => {
            const active = m.id === selected?.id
                const sharpe = (m.cv_metrics as Record<string, Record<string, number>>)?.aggregate?.sharpe_mean ?? (m.cv_metrics as Record<string, number>)?.sharpe_mean
            return (
              <button
                key={m.id}
                onClick={() => selectModel(m)}
                className={`w-full text-left rounded-lg px-3 py-2.5 transition-colors ${active ? 'bg-brand/[0.10] border border-brand-500/30' : 'hover:bg-surface border border-transparent'}`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold text-zinc-200 font-mono">{m.model_type}</span>
                  <StatusBadge status={m.status} />
                </div>
                <div className="text-[10px] text-zinc-500 mt-0.5">
                  target: <span className="font-mono text-zinc-400">{m.target_column}</span>
                  {sharpe != null && <span className="ml-2">Sharpe: {Number(sharpe).toFixed(3)}</span>}
                </div>
                <div className="text-[10px] text-zinc-700">{new Date(m.created_at).toLocaleDateString()}</div>
              </button>
            )
          })}
        </div>
      }
      detail={
        <div className="space-y-5">
          {isRunning && <TaskBar progress={taskProgress} message={taskMessage} status={taskStatus} />}

          {formOpen && (
            <div className="rounded-xl border border-white/[0.06] bg-surface-card p-5 space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="font-semibold text-zinc-200">Train New Model</h2>
                <button onClick={() => setFormOpen(false)} className="text-zinc-500 hover:text-zinc-300 text-sm">✕</button>
              </div>

              <div>
                <label className="label">Feature Set</label>
                <select className="input text-sm" value={formFsId} onChange={e => setFormFsId(e.target.value)}>
                  <option value="">-- select feature set --</option>
                  {featureSets.map(fs => (
                    <option key={fs.id} value={fs.id}>{fs.name} (target: {fs.target_column})</option>
                  ))}
                </select>
                {activeFs && (
                  <div className="mt-1 text-xs text-zinc-600">{activeFs.selected_columns.length} features · target: <span className="font-mono text-zinc-400">{activeFs.target_column}</span></div>
                )}
              </div>

              <div>
                <label className="label">Model Type</label>
                <div className="flex gap-2">
                  {MODEL_TYPES.map(mt => (
                    <button
                      key={mt.id}
                      onClick={() => setModelType(mt.id)}
                      className={`flex-1 py-2 rounded-lg border text-xs transition-colors ${modelType === mt.id ? 'bg-brand/[0.10] border-brand-500/40 text-brand-300' : 'border-white/[0.06] text-zinc-500 hover:bg-surface'}`}
                    >
                      <div className="font-semibold">{mt.label}</div>
                      <div className="text-[10px] mt-0.5 opacity-70">{mt.desc}</div>
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="label">CV Preset</label>
                <div className="flex gap-2">
                  {Object.entries(CV_PRESETS).map(([k, p]) => (
                    <button
                      key={k}
                      onClick={() => { setNSplits(p.splits); setGap(p.gap) }}
                      className={`px-3 py-1.5 rounded-lg border text-xs transition-colors ${nSplits === p.splits && gap === p.gap ? 'bg-surface-card border-brand-500/40 text-brand-300' : 'border-white/[0.06] text-zinc-500 hover:bg-surface'}`}
                    >
                      {p.label} ({p.splits}-fold, gap={p.gap})
                    </button>
                  ))}
                </div>
              </div>

              <div className="rounded-lg border border-white/[0.06] bg-surface p-3 space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-xs font-semibold text-zinc-300">Auto Hyperparameter Tune</div>
                    <div className="text-[10px] text-zinc-500 mt-0.5">Try multiple hyperparameter candidates and pick the best before final training</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setAutoTune(v => !v)}
                    className={`text-xs px-2.5 py-1 rounded border ${autoTune ? 'border-violet-500/40 text-violet-300 bg-violet-500/10' : 'border-white/[0.08] text-zinc-500'}`}
                  >
                    {autoTune ? 'ON' : 'OFF'}
                  </button>
                </div>

                {autoTune && (
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-[11px] text-zinc-500">Tune trials</label>
                      <input
                        type="number"
                        min={1}
                        max={100}
                        className="input text-sm mt-1"
                        value={tuneTrials}
                        onChange={(e) => setTuneTrials(Math.max(1, Math.min(100, Number(e.target.value) || 1)))}
                      />
                    </div>
                    <div>
                      <label className="text-[11px] text-zinc-500">Optimize metric</label>
                      <select
                        className="input text-sm mt-1"
                        value={optimizeMetric}
                        onChange={(e) => setOptimizeMetric(e.target.value)}
                      >
                        <option value="accuracy_mean">accuracy_mean</option>
                        <option value="f1_weighted_mean">f1_weighted_mean</option>
                        <option value="roc_auc_mean">roc_auc_mean</option>
                        <option value="r2_mean">r2_mean</option>
                        <option value="rmse_mean">rmse_mean</option>
                        <option value="mae_mean">mae_mean</option>
                      </select>
                    </div>
                  </div>
                )}
              </div>

              {trainError && <div className="text-xs text-red-400">{trainError}</div>}
              <button onClick={handleTrain} disabled={training || !formFsId} className="btn-primary w-full text-sm">
                {training ? 'Training...' : 'Start Training'}
              </button>
            </div>
          )}

          {!formOpen && selected && (
            <>
              <div className="flex items-start justify-between">
                <div>
                  <h2 className="text-xl font-bold text-zinc-100 font-mono">{selected.model_type}</h2>
                  <div className="flex gap-3 mt-1 text-xs text-zinc-500 items-center">
                    <StatusBadge status={selected.status} />
                    <span>target: <span className="font-mono text-zinc-300">{selected.target_column}</span></span>
                    <span>{new Date(selected.created_at).toLocaleString()}</span>
                  </div>
                  {selected.error_message && <div className="text-xs text-red-400 mt-1">{selected.error_message}</div>}
                </div>
              </div>

              {selected.status === 'completed' && (
                <>
                  {/* CV Metrics */}
                  {selected.cv_metrics && (() => {
                    const agg = (selected.cv_metrics as Record<string, unknown>)?.aggregate as Record<string, number> | undefined
                    const oosIdx = (selected.cv_metrics as Record<string, unknown>)?.oos_start_index as number | undefined
                    if (!agg) return null
                    return (
                      <div>
                        <div className="flex items-center justify-between mb-2">
                          <div className="text-xs text-zinc-500 font-semibold uppercase tracking-wider">CV Metrics (aggregate)</div>
                          {oosIdx != null && <div className="text-xs text-zinc-600">OOS from row <span className="text-zinc-400">{oosIdx}</span></div>}
                        </div>
                        <div className="grid grid-cols-3 gap-2">
                          {Object.entries(agg)
                            .filter(([, v]) => typeof v === 'number')
                            .map(([k, v]) => (
                            <div key={k} className="rounded-lg border border-white/[0.06] bg-surface p-3 text-center">
                              <div className="text-lg font-bold text-brand-400">{Number(v).toFixed(3)}</div>
                              <div className="text-[10px] text-zinc-500 mt-0.5">{k.replace(/_/g, ' ')}</div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )
                  })()}

                  {/* Feature importances */}
                  {selected.feature_importances && Object.keys(selected.feature_importances).length > 0 && (
                    <div>
                      <div className="text-xs text-zinc-500 mb-3 font-semibold uppercase tracking-wider">Feature Importances (top 20)</div>
                      <ImportancesBar importances={selected.feature_importances} />
                    </div>
                  )}

                  {tuning && (
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <div className="text-xs text-zinc-500 font-semibold uppercase tracking-wider">Hyperparameter Tuning Summary</div>
                        <div className="text-xs text-zinc-600">
                          trials: <span className="text-zinc-300">{tuning.n_trials ?? tuningTrials.length}</span>
                          {' · '}
                          metric: <span className="text-zinc-300">{tuning.optimize_metric ?? 'score'}</span>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-2">
                        <div className="rounded-lg border border-white/[0.06] bg-surface p-3 text-center">
                          <div className="text-[10px] text-zinc-500">Best score</div>
                          <div className="text-lg font-bold text-violet-300">
                            {typeof tuning.best_score === 'number' ? tuning.best_score.toFixed(6) : '—'}
                          </div>
                        </div>
                        <div className="rounded-lg border border-white/[0.06] bg-surface p-3">
                          <div className="text-[10px] text-zinc-500 mb-1">Best hyperparameters</div>
                          <div className="text-[11px] text-zinc-300 font-mono break-all">
                            {tuning.best_hyperparameters ? JSON.stringify(tuning.best_hyperparameters) : '—'}
                          </div>
                        </div>
                      </div>

                      {tuningChartOption && (
                        <div className="rounded-lg border border-white/[0.06] bg-surface p-3">
                          <div className="text-[11px] text-zinc-500 mb-2">Trial score progression</div>
                          <ReactECharts option={tuningChartOption} style={{ height: 260 }} />
                        </div>
                      )}

                      {topTrialsBarOption && (
                        <div className="rounded-lg border border-white/[0.06] bg-surface p-3">
                          <div className="text-[11px] text-zinc-500 mb-2">Top trials by objective score</div>
                          <ReactECharts option={topTrialsBarOption} style={{ height: 220 }} />
                        </div>
                      )}

                      {topTrials.length > 0 && (
                        <div className="rounded-lg border border-white/[0.06] bg-surface p-3">
                          <div className="text-[11px] text-zinc-500 mb-2">Top trial leaderboard</div>
                          <div className="overflow-x-auto">
                            <table className="w-full text-xs">
                              <thead>
                                <tr className="border-b border-white/[0.06]">
                                  <th className="text-left py-2 px-2 text-zinc-500 font-normal">Trial</th>
                                  <th className="text-right py-2 px-2 text-zinc-500 font-normal">Score</th>
                                  <th className="text-left py-2 px-2 text-zinc-500 font-normal">Hyperparameters</th>
                                </tr>
                              </thead>
                              <tbody>
                                {topTrials.map((t, i) => (
                                  <tr key={t.trial} className="border-b border-white/[0.04] align-top">
                                    <td className="py-2 px-2 text-zinc-300 font-mono">
                                      T{t.trial} {i === 0 ? '★' : ''}
                                    </td>
                                    <td className="py-2 px-2 text-right text-zinc-300 font-mono">{t.score.toFixed(6)}</td>
                                    <td className="py-2 px-2 text-zinc-400 font-mono break-all">{JSON.stringify(t.hyperparameters)}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      )}

                      {bestVsRunnerDiff.length > 0 && (
                        <div className="rounded-lg border border-white/[0.06] bg-surface p-3">
                          <div className="text-[11px] text-zinc-500 mb-2">Best vs runner-up parameter delta</div>
                          <div className="grid grid-cols-1 gap-1 text-xs">
                            {bestVsRunnerDiff.map((r) => (
                              <div key={r.key} className={`flex justify-between px-2 py-1 rounded ${r.changed ? 'bg-violet-500/10' : 'bg-white/[0.02]'}`}>
                                <span className="font-mono text-zinc-400">{r.key}</span>
                                <span className="font-mono text-zinc-300">best={r.best} | runner={r.runner}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {explainability && (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <div className="text-xs text-zinc-500 font-semibold uppercase tracking-wider">Model Explainability</div>
                        <div className="text-xs text-zinc-600">
                          method: <span className="text-zinc-300">{explainability.method ?? '—'}</span>
                          {' · '}
                          samples: <span className="text-zinc-300">{explainability.n_samples ?? '—'}</span>
                        </div>
                      </div>

                      {shapChartOption && (
                        <div className="rounded-lg border border-white/[0.06] bg-surface p-3">
                          <div className="text-[11px] text-zinc-500 mb-2">SHAP mean absolute contribution (top features)</div>
                          <ReactECharts option={shapChartOption} style={{ height: 340 }} />
                        </div>
                      )}
                    </div>
                  )}

                  {selected.mlflow_run_id && (
                    <div className="text-xs text-zinc-600">MLflow run: <code className="font-mono">{selected.mlflow_run_id}</code></div>
                  )}
                </>
              )}
            </>
          )}

          {!formOpen && !selected && !isRunning && (
            <EmptyState message="Train a model using a feature set from the Feature Selection page" />
          )}
        </div>
      }
    />
  )
}

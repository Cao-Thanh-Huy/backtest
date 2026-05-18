'use client'
/**
 * Hyperparameter Tuning page (Enhanced)
 * ─────────────────────────────────────
 * Grid-search over hyperparameters with visual analysis:
 *   - Pick a feature set, choose model type, define parameter grid
 *   - View combination breakdown (e.g. 4×3×3 = 36 jobs)
 *   - Smart parameter descriptions & ranges
 *   - After results: sensitivity analysis, top 5 models, best params export
 */
import { useState, useEffect, useRef } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { listFeatureSets, trainModel, listModels, createSweep, addSweepJob, updateSweepJob } from '@/lib/api'
import { useAppStore, FeatureSet, AIModel } from '@/store/appStore'
import { LabPage, EmptyState } from '@/components/ui/LabPage'
import { toast } from 'sonner'
import { getApiErrorMessage } from '@/lib/api-error'

// ── Hyperparameter grid definition with descriptions ─────────────────────────

interface ParamDef {
  key: string
  label: string
  values: string
  description?: string
  range?: string
}

const PARAM_DESCRIPTIONS: Record<string, Record<string, { desc: string; range: string }>> = {
  lightgbm: {
    n_estimators: { desc: 'Number of boosting trees. Higher = longer training but may overfit', range: '50-400' },
    num_leaves: { desc: 'Max leaves per tree. Higher = more complex trees', range: '15-127' },
    learning_rate: { desc: 'Shrinkage rate. Lower = slower but often better generalization', range: '0.01-0.3' },
    min_child_samples: { desc: 'Min samples needed to split leaf. Higher = less overfitting', range: '5-50' },
    max_depth: { desc: 'Max tree depth (-1 = unlimited). Limits model complexity', range: '3-15' },
    reg_alpha: { desc: 'L1 regularization. Encourages sparsity', range: '0-1.0' },
    reg_lambda: { desc: 'L2 regularization. Reduces weights', range: '0-1.0' },
  },
  xgboost: {
    n_estimators: { desc: 'Number of boosting iterations', range: '50-400' },
    max_depth: { desc: 'Maximum tree depth', range: '3-10' },
    learning_rate: { desc: 'Shrinkage rate (eta)', range: '0.01-0.3' },
    subsample: { desc: 'Subsample ratio of training data', range: '0.5-1.0' },
    colsample_bytree: { desc: 'Subsample ratio of features', range: '0.5-1.0' },
    gamma: { desc: 'Min loss reduction to split', range: '0-10' },
  },
  random_forest: {
    n_estimators: { desc: 'Number of trees in forest', range: '50-500' },
    max_depth: { desc: 'Max tree depth (null = unlimited)', range: '5-20' },
    min_samples_split: { desc: 'Min samples to split node', range: '2-10' },
    max_features: { desc: 'Features to consider per split', range: 'sqrt,log2,0.5-1.0' },
  },
}

const PARAM_TEMPLATES: Record<string, ParamDef[]> = {
  lightgbm: [
    { key: 'n_estimators',     label: 'n_estimators',    values: '50,100,200,400' },
    { key: 'num_leaves',       label: 'num_leaves',       values: '15,31,63' },
    { key: 'learning_rate',    label: 'learning_rate',    values: '0.05,0.1,0.2' },
    { key: 'min_child_samples',label: 'min_child_samples',values: '10,20,50' },
    { key: 'max_depth',        label: 'max_depth',        values: '-1,5,10' },
    { key: 'reg_alpha',        label: 'reg_alpha (L1)',   values: '0,0.1,1.0' },
    { key: 'reg_lambda',       label: 'reg_lambda (L2)',  values: '0,0.1,1.0' },
  ],
  xgboost: [
    { key: 'n_estimators',  label: 'n_estimators', values: '50,100,200,400' },
    { key: 'max_depth',     label: 'max_depth',    values: '3,5,7' },
    { key: 'learning_rate', label: 'learning_rate',values: '0.05,0.1,0.2' },
    { key: 'subsample',     label: 'subsample',    values: '0.7,0.85,1.0' },
    { key: 'colsample_bytree', label: 'colsample_bytree', values: '0.7,0.85,1.0' },
    { key: 'gamma',         label: 'gamma',        values: '0,0.1,0.5' },
  ],
  random_forest: [
    { key: 'n_estimators', label: 'n_estimators', values: '50,100,200' },
    { key: 'max_depth',    label: 'max_depth',    values: 'null,5,10,20' },
    { key: 'min_samples_split', label: 'min_samples_split', values: '2,5,10' },
    { key: 'max_features', label: 'max_features', values: 'sqrt,log2,0.5' },
  ],
}

const MODEL_TYPES = ['lightgbm', 'xgboost', 'random_forest'] as const
const CV_PRESETS = {
  fast:     { label: 'Fast',     splits: 3, gap: 5 },
  standard: { label: 'Standard', splits: 5, gap: 10 },
}

// ── Job state ────────────────────────────────────────────────────────────────

interface SweepJob {
  modelId: string
  taskId: string
  sweepId?: string
  sweepJobId?: string
  hyperparams: Record<string, unknown>
  status: 'pending' | 'running' | 'completed' | 'failed'
  progress: number
  message: string
  cvMetrics: Record<string, number> | null
  metricsSynced?: boolean
  syncStatus?: 'pending' | 'running' | 'completed' | 'failed'
  error: string | null
}

function parseValues(raw: string): unknown[] {
  return raw.split(',').map(s => {
    const t = s.trim()
    if (t === 'null') return null
    const n = Number(t)
    return isNaN(n) ? t : n
  })
}

function cartesianProduct(arrays: unknown[][]): unknown[][] {
  return arrays.reduce<unknown[][]>(
    (a, b) => a.flatMap(x => b.map(y => [...(x as unknown[]), y])),
    [[]]
  )
}

export default function TuningPage() {
  const qc = useQueryClient()
  const { activeFeatureSetId, setActiveModel } = useAppStore()

  const { data: featureSets = [] } = useQuery<FeatureSet[]>({
    queryKey: ['featureSets'],
    queryFn: () => listFeatureSets().then(r => r.data),
  })
  const { data: allModels = [] } = useQuery<AIModel[]>({
    queryKey: ['models'],
    queryFn: () => listModels().then(r => r.data),
    refetchInterval: 5000,
  })

  const [descModalParam, setDescModalParam] = useState<string | null>(null)

  const [formFsId, setFormFsId] = useState(activeFeatureSetId ?? '')
  const [modelType, setModelType] = useState<string>('lightgbm')
  const [cvPreset, setCvPreset] = useState<'fast' | 'standard'>('fast')
  const [params, setParams] = useState<ParamDef[]>(PARAM_TEMPLATES['lightgbm'])
  const [enabled, setEnabled] = useState<Set<string>>(new Set(['n_estimators', 'num_leaves', 'learning_rate']))
  const [launching, setLaunching] = useState(false)

  const [jobs, setJobs] = useState<SweepJob[]>([])
  const [sortKey, setSortKey] = useState<string>('accuracy_mean')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')

  const wsRefs = useRef<Record<string, WebSocket>>({})

  // Sync param template when model type changes
  useEffect(() => {
    setParams(PARAM_TEMPLATES[modelType] ?? [])
    setEnabled(new Set(
      modelType === 'lightgbm' ? ['n_estimators', 'num_leaves', 'learning_rate'] :
      modelType === 'xgboost'  ? ['n_estimators', 'max_depth', 'learning_rate'] :
                                  ['n_estimators', 'max_depth']
    ))
  }, [modelType])

  // Compute total combinations
  const enabledParams = params.filter(p => enabled.has(p.key))
  const totalCombos = enabledParams.length === 0 ? 1 : enabledParams.reduce((acc, p) => acc * parseValues(p.values).length, 1)

  const activeFs = featureSets.find(fs => fs.id === formFsId)

  // Track a job via WebSocket
  function trackJob(jobId: string, taskId: string, hyperparams: Record<string, unknown>, sweepId?: string, sweepJobId?: string) {
    const { NEXT_PUBLIC_WS_URL } = process.env as unknown as { NEXT_PUBLIC_WS_URL: string }
    const ws = new WebSocket(`${NEXT_PUBLIC_WS_URL}/api/v1/ws/task/${taskId}`)
    wsRefs.current[jobId] = ws
    ws.onmessage = (e) => {
      const data = JSON.parse(e.data)

      if (data.status === 'SUCCESS' && sweepId && sweepJobId) {
        updateSweepJob(sweepId, sweepJobId, { status: 'completed', model_id: jobId }).catch(() => null)
      }
      if (data.status === 'FAILURE' && sweepId && sweepJobId) {
        updateSweepJob(sweepId, sweepJobId, { status: 'failed' }).catch(() => null)
      }

      setJobs(prev => prev.map(j => {
        if (j.modelId !== jobId) return j
        if (data.status === 'SUCCESS') {
          ws.close()
          // Refresh models to get updated cv_metrics
          qc.invalidateQueries({ queryKey: ['models'] })
          return { ...j, status: 'completed', progress: 100, message: 'Done' }
        }
        if (data.status === 'FAILURE') {
          ws.close()
          return { ...j, status: 'failed', progress: 0, message: data.error ?? 'Failed', error: data.error ?? 'Failed' }
        }
        return { ...j, status: 'running', progress: data.progress ?? j.progress, message: data.message ?? j.message }
      }))
    }
    ws.onerror = () => {
      if (sweepId && sweepJobId) {
        updateSweepJob(sweepId, sweepJobId, { status: 'failed' }).catch(() => null)
      }
      setJobs(prev => prev.map(j => j.modelId === jobId ? { ...j, status: 'failed', error: 'WebSocket error' } : j))
    }
  }

  async function handleLaunch() {
    if (!formFsId || !activeFs) { toast.error('Select a feature set'); return }
    if (totalCombos > 50) { toast.error(`${totalCombos} combinations is too many (max 50)`); return }

    setLaunching(true)
    setJobs([])

    try {
      const { splits, gap } = CV_PRESETS[cvPreset]

      // Build param grid
      const paramKeys = enabledParams.map(p => p.key)
      const paramValueArrays = enabledParams.map(p => parseValues(p.values))
      const combos = enabledParams.length === 0
        ? [{}]
        : cartesianProduct(paramValueArrays).map(vals => Object.fromEntries(paramKeys.map((k, i) => [k, vals[i]])))

      const paramGrid: Record<string, unknown[]> = {}
      enabledParams.forEach(p => {
        paramGrid[p.key] = parseValues(p.values)
      })

      const sweepRes = await createSweep({
        feature_set_id: formFsId,
        model_type: modelType,
        param_grid: paramGrid,
        cv_splits: String(splits),
        cv_gap: String(gap),
      })
      const sweepId = sweepRes.data.id as string

      const newJobs: SweepJob[] = []
      for (const combo of combos) {
        let sweepJobId: string | undefined
        try {
          const sweepJobRes = await addSweepJob(sweepId, { hyperparameters: combo })
          sweepJobId = sweepJobRes.data.id as string

          const res = await trainModel({
            feature_set_id: formFsId,
            target_column: activeFs.target_column,
            model_type: modelType,
            hyperparameters: combo,
            n_splits: splits,
            gap,
          })
          const taskId = res.data.celery_task_id as string
          const modelId = res.data.id as string

          if (sweepJobId) {
            await updateSweepJob(sweepId, sweepJobId, { status: 'running', model_id: modelId })
          }

          const job: SweepJob = {
            modelId,
            taskId,
            sweepId,
            sweepJobId,
            hyperparams: combo as Record<string, unknown>,
            status: 'pending',
            syncStatus: 'pending',
            progress: 0,
            message: 'Queued',
            cvMetrics: null,
            metricsSynced: false,
            error: null,
          }
          newJobs.push(job)
          trackJob(modelId, taskId, combo as Record<string, unknown>, sweepId, sweepJobId)
        } catch (e) {
          if (sweepId && sweepJobId) {
            await updateSweepJob(sweepId, sweepJobId, { status: 'failed' }).catch(() => null)
          }
          toast.error(`Failed to launch combo: ${getApiErrorMessage(e, 'Error')}`)
        }
      }
      setJobs(newJobs)
      toast.success(`Launched ${newJobs.length} training jobs`)
      qc.invalidateQueries({ queryKey: ['sweeps'] })
    } finally {
      setLaunching(false)
    }
  }

  // Merge live model data into jobs
  const enrichedJobs = jobs.map(job => {
    const model = allModels.find(m => m.id === job.modelId)
    const agg = (model?.cv_metrics as Record<string, Record<string, number>>)?.aggregate ?? null
    return { ...job, cvMetrics: agg, status: model?.status === 'failed' ? 'failed' : model?.status === 'completed' ? 'completed' : job.status } as SweepJob
  })

  useEffect(() => {
    enrichedJobs.forEach((job) => {
      if (!job.sweepId || !job.sweepJobId || !job.cvMetrics || job.metricsSynced !== false) return
      updateSweepJob(job.sweepId, job.sweepJobId, { cv_metrics: job.cvMetrics })
        .then(() => {
          setJobs((prev) => prev.map((j) => (j.sweepJobId === job.sweepJobId ? { ...j, metricsSynced: true } : j)))
        })
        .catch(() => null)
    })
  }, [enrichedJobs])

  useEffect(() => {
    enrichedJobs.forEach((job) => {
      if (!job.sweepId || !job.sweepJobId) return
      if (job.status !== 'running' && job.status !== 'completed' && job.status !== 'failed') return
      if (job.syncStatus === job.status) return

      updateSweepJob(job.sweepId, job.sweepJobId, {
        status: job.status,
        model_id: job.modelId,
      })
        .then(() => {
          setJobs((prev) => prev.map((j) => (j.sweepJobId === job.sweepJobId ? { ...j, syncStatus: job.status } : j)))
        })
        .catch(() => null)
    })
  }, [enrichedJobs])

  const sortedJobs = [...enrichedJobs].sort((a, b) => {
    const av = a.cvMetrics?.[sortKey] ?? -Infinity
    const bv = b.cvMetrics?.[sortKey] ?? -Infinity
    return sortDir === 'desc' ? bv - av : av - bv
  })

  const bestJob = sortedJobs.find(j => j.status === 'completed' && j.cvMetrics != null)
  const doneCount = enrichedJobs.filter(j => j.status === 'completed').length
  const failedCount = enrichedJobs.filter(j => j.status === 'failed').length
  const runningCount = enrichedJobs.filter(j => j.status === 'running').length

  function handleSort(key: string) {
    if (sortKey === key) setSortDir(d => d === 'desc' ? 'asc' : 'desc')
    else { setSortKey(key); setSortDir('desc') }
  }

  async function handleUseBest() {
    if (!bestJob) return
    setActiveModel(bestJob.modelId)
    toast.success('Best model set as active — go to Backtest to run simulation')
  }

  const metricCols = bestJob?.cvMetrics ? Object.keys(bestJob.cvMetrics).slice(0, 5) : ['accuracy_mean', 'accuracy_std', 'f1_weighted_mean']

  return (
    <LabPage
      title="Hyperparameter Tuning"
      subtitle="Grid-search over hyperparameters — all combinations train in parallel"
      list={
        <div className="p-3 space-y-4">
          {/* Feature set selector */}
          <div>
            <label className="label">Feature Set</label>
            <select className="input text-sm" value={formFsId} onChange={e => setFormFsId(e.target.value)}>
              <option value="">-- select --</option>
              {featureSets.map(fs => (
                <option key={fs.id} value={fs.id}>{fs.name}</option>
              ))}
            </select>
            {activeFs && <div className="text-[10px] text-zinc-600 mt-1">{activeFs.selected_columns.length} features · {activeFs.target_column}</div>}
          </div>

          {/* Model type */}
          <div>
            <label className="label">Model Type</label>
            <div className="flex flex-col gap-1">
              {MODEL_TYPES.map(mt => (
                <button key={mt} onClick={() => setModelType(mt)}
                  className={`px-3 py-1.5 rounded-lg border text-xs text-left transition-colors ${modelType === mt ? 'bg-brand/[0.10] border-brand-500/40 text-brand-300' : 'border-white/[0.06] text-zinc-500 hover:bg-surface'}`}>
                  {mt}
                </button>
              ))}
            </div>
          </div>

          {/* CV preset */}
          <div>
            <label className="label">CV Preset</label>
            {Object.entries(CV_PRESETS).map(([k, p]) => (
              <button key={k} onClick={() => setCvPreset(k as 'fast' | 'standard')}
                className={`w-full mb-1 px-3 py-1.5 rounded-lg border text-xs text-left transition-colors ${cvPreset === k ? 'bg-surface-card border-brand-500/40 text-brand-300' : 'border-white/[0.06] text-zinc-500 hover:bg-surface'}`}>
                {p.label} ({p.splits}-fold, gap={p.gap})
              </button>
            ))}
          </div>

          {/* Combinations Breakdown */}
          <div className="rounded-lg border border-white/[0.06] bg-surface p-4">
            <div className="text-xs text-zinc-500 font-semibold uppercase mb-2">Combinations Breakdown</div>
            <div className="flex items-end gap-3">
              <div className="flex-1 space-y-1">
                {enabledParams.map(p => (
                  <div key={p.key} className="text-[11px] text-zinc-400">
                    <span className="font-mono">{p.key}</span>: <span className="text-emerald-400 font-semibold">{parseValues(p.values).length}</span> values
                  </div>
                ))}
              </div>
              <div className="text-right">
                <div className="text-[10px] text-zinc-500 mb-1">Total</div>
                <div className={`text-3xl font-bold ${totalCombos > 50 ? 'text-red-400' : totalCombos > 20 ? 'text-amber-400' : 'text-emerald-400'}`}>
                  {totalCombos}
                </div>
                <div className="text-[9px] text-zinc-600 mt-0.5">
                  {enabledParams.length > 0 ? `${enabledParams.map(p => parseValues(p.values).length).join(' × ')} = ${totalCombos}` : 'jobs'}
                </div>
              </div>
            </div>
            {totalCombos > 50 && <div className="text-[10px] text-red-400 mt-2 pt-2 border-t border-white/[0.06]">⚠️ Max 50 combinations — reduce parameter values</div>}
          </div>

          <button onClick={handleLaunch} disabled={launching || !formFsId || totalCombos > 50 || totalCombos === 0}
            className="btn-primary w-full text-sm">
            {launching ? 'Launching...' : `🚀 Launch ${totalCombos} Job${totalCombos !== 1 ? 's' : ''}`}
          </button>
          <button
            onClick={() => { window.location.href = '/lab/sweep-history' }}
            className="btn-secondary w-full text-xs py-2"
          >
            View Sweep History
          </button>
        </div>
      }
      detail={
        <div className="space-y-5">
          {/* Param grid builder */}
          <div className="rounded-xl border border-white/[0.06] bg-surface-card p-5">
            <div className="text-sm font-semibold text-zinc-200 mb-3">Parameter Grid</div>
            <div className="space-y-2">
              {params.map(p => {
                const desc = PARAM_DESCRIPTIONS[modelType]?.[p.key]
                return (
                  <div key={p.key} className="flex items-center gap-3 p-2 rounded hover:bg-white/[0.02] transition-colors">
                    <button
                      onClick={() => setEnabled(prev => { const n = new Set(prev); n.has(p.key) ? n.delete(p.key) : n.add(p.key); return n })}
                      className={`w-4 h-4 rounded border-2 flex items-center justify-center shrink-0 transition-colors ${enabled.has(p.key) ? 'bg-brand-500 border-brand-500' : 'border-zinc-600'}`}
                    >
                      {enabled.has(p.key) && <span className="text-white text-[9px]">✓</span>}
                    </button>
                    <button
                      onClick={() => setDescModalParam(desc ? p.key : null)}
                      title={desc?.desc}
                      className={`text-xs font-mono w-36 text-left transition-colors ${desc ? 'text-zinc-300 hover:text-brand-300 cursor-help' : 'text-zinc-400'}`}
                    >
                      {p.label}
                      {desc && <span className="text-[10px] text-zinc-600 ml-1">ⓘ</span>}
                    </button>
                    <input
                      className={`flex-1 input text-xs font-mono py-1 ${!enabled.has(p.key) ? 'opacity-40' : ''}`}
                      value={p.values}
                      disabled={!enabled.has(p.key)}
                      onChange={e => setParams(prev => prev.map(pp => pp.key === p.key ? { ...pp, values: e.target.value } : pp))}
                      placeholder="comma-separated values"
                    />
                    {enabled.has(p.key) && (
                      <span className="text-[10px] text-zinc-600 shrink-0">{parseValues(p.values).length}×</span>
                    )}
                  </div>
                )
              })}
            </div>
          </div>

          {/* Parameter Description Modal */}
          {descModalParam && (
            <div className="rounded-lg border border-white/[0.06] bg-surface-card p-4 space-y-2">
              <div className="flex items-center justify-between">
                <div className="text-xs font-mono font-semibold text-zinc-300">{descModalParam}</div>
                <button onClick={() => setDescModalParam(null)} className="text-xs text-zinc-500 hover:text-zinc-300">✕</button>
              </div>
              {PARAM_DESCRIPTIONS[modelType]?.[descModalParam] && (
                <>
                  <div className="text-xs text-zinc-400">
                    {PARAM_DESCRIPTIONS[modelType][descModalParam].desc}
                  </div>
                  <div className="text-[10px] text-zinc-600 pt-2 border-t border-white/[0.06]">
                    <span className="text-zinc-500">Typical range: </span>
                    <span className="font-mono text-emerald-400">{PARAM_DESCRIPTIONS[modelType][descModalParam].range}</span>
                  </div>
                </>
              )}
            </div>
          )}

          {/* Results */}
          {jobs.length === 0 && (
            <EmptyState message="Configure parameters above and click Launch to start a sweep" />
          )}

          {jobs.length > 0 && (
            <div className="space-y-5">
              {/* Summary bar */}
              <div className="flex items-center gap-4 text-xs text-zinc-500 p-3 rounded-lg bg-surface-card/50">
                <span><span className="text-emerald-400 font-semibold">{doneCount}</span> completed</span>
                <span><span className="text-brand-400 font-semibold">{runningCount}</span> running</span>
                {failedCount > 0 && <span><span className="text-red-400 font-semibold">{failedCount}</span> failed</span>}
                {bestJob && (
                  <button onClick={handleUseBest} className="ml-auto btn-primary text-xs px-3 py-1.5">
                    ✓ Use Best Model
                  </button>
                )}
              </div>

              {/* Best Model Analysis */}
              {bestJob && bestJob.cvMetrics && (
                <div className="space-y-3">
                  {/* Top 5 Models */}
                  <div className="rounded-lg border border-white/[0.06] bg-surface-card p-4">
                    <div className="text-xs font-semibold text-zinc-300 mb-3">🏆 Top 5 Models by {sortKey.replace(/_/g, ' ')}</div>
                    <div className="space-y-2">
                      {sortedJobs.slice(0, 5).map((job, idx) => (
                        <div key={job.modelId} className="flex items-center justify-between p-2.5 rounded bg-white/[0.02] hover:bg-white/[0.04] transition-colors">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-bold text-zinc-400 w-5">#{idx + 1}</span>
                            {idx === 0 && <span className="text-xs text-emerald-400">★ Best</span>}
                            <span className="text-[10px] text-zinc-600">
                              {enabledParams.map(p => `${p.key}=${job.hyperparams[p.key]}`).join(', ')}
                            </span>
                          </div>
                          <div className="text-xs font-mono text-emerald-300 font-semibold">
                            {job.cvMetrics?.[sortKey]?.toFixed(4)}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Parameter Sensitivity - Most impactful params */}
                  <div className="rounded-lg border border-white/[0.06] bg-surface-card p-4">
                    <div className="text-xs font-semibold text-zinc-300 mb-3">📊 Parameter Impact (variance by param)</div>
                    <div className="space-y-2 text-[10px]">
                      {(() => {
                        const sensitivity = enabledParams.map(p => {
                          const values = new Map<unknown, number[]>()
                          sortedJobs.forEach(job => {
                            const val = job.hyperparams[p.key]
                            if (!values.has(val)) values.set(val, [])
                            const metric = job.cvMetrics?.[sortKey] ?? 0
                            values.get(val)!.push(metric)
                          })
                          const means = Array.from(values.values()).map(v => v.reduce((a, b) => a + b, 0) / v.length)
                          const variance = means.length > 1 
                            ? means.reduce((sum, m) => sum + Math.pow(m - means.reduce((a, b) => a + b) / means.length, 2), 0) / means.length
                            : 0
                          return { param: p.key, variance, impact: Math.sqrt(variance) }
                        }).sort((a, b) => b.impact - a.impact)
                        
                        return sensitivity.map((s, idx) => (
                          <div key={s.param} className="flex items-center gap-2">
                            <span className="w-20 text-zinc-500">{s.param}</span>
                            <div className="flex-1 h-2 bg-white/[0.05] rounded overflow-hidden">
                              <div 
                                className="h-full bg-gradient-to-r from-brand-500 to-brand-400 rounded" 
                                style={{ width: `${(s.impact / sensitivity[0].impact) * 100}%` }}
                              />
                            </div>
                            <span className="text-zinc-600 w-12 text-right">{s.impact.toFixed(3)}</span>
                          </div>
                        ))
                      })()}
                    </div>
                  </div>

                  {/* Export Best Params */}
                  <button
                    onClick={() => {
                      const json = JSON.stringify(bestJob.hyperparams, null, 2)
                      const blob = new Blob([json], { type: 'application/json' })
                      const url = URL.createObjectURL(blob)
                      const a = document.createElement('a')
                      a.href = url
                      a.download = `best_params_${modelType}.json`
                      a.click()
                      URL.revokeObjectURL(url)
                      toast.success('Best params exported')
                    }}
                    className="w-full btn-secondary text-xs py-2">
                    📥 Export Best Hyperparameters
                  </button>
                </div>
              )}

              {/* Results table */}
              <div className="space-y-2">
                <div className="text-xs font-semibold text-zinc-400">All Results</div>
                <div className="overflow-auto rounded-xl border border-white/[0.06]">
                  <table className="min-w-full text-xs">
                    <thead className="bg-surface-card">
                      <tr>
                        <th className="px-3 py-2 text-left text-zinc-500 border-b border-white/[0.06]">Rank</th>
                        {enabledParams.map(p => (
                          <th key={p.key} className="px-3 py-2 text-left text-zinc-400 border-b border-white/[0.06] font-mono whitespace-nowrap">{p.key}</th>
                        ))}
                        {metricCols.map(col => (
                          <th key={col}
                            className="px-3 py-2 text-right text-zinc-400 border-b border-white/[0.06] cursor-pointer hover:text-zinc-200 whitespace-nowrap transition-colors"
                            onClick={() => handleSort(col)}>
                            {col.replace(/_/g, ' ')} {sortKey === col ? (sortDir === 'desc' ? '↓' : '↑') : ''}
                          </th>
                        ))}
                        <th className="px-3 py-2 text-left text-zinc-500 border-b border-white/[0.06]">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sortedJobs.map((job, idx) => {
                        const isBest = job.modelId === bestJob?.modelId
                        return (
                          <tr key={job.modelId}
                            className={`border-b border-white/[0.06] transition-colors ${isBest ? 'bg-emerald-500/10' : idx % 2 === 0 ? 'bg-surface' : 'bg-surface-card'}`}>
                            <td className="px-3 py-2 text-xs text-zinc-500 font-semibold">
                              {idx + 1}{isBest && <span className="text-emerald-400 ml-1">★</span>}
                            </td>
                            {enabledParams.map(p => (
                              <td key={p.key} className="px-3 py-2 font-mono text-zinc-300 whitespace-nowrap text-[10px]">
                                {String(job.hyperparams[p.key] ?? '—')}
                              </td>
                            ))}
                            {metricCols.map(col => (
                              <td key={col} className="px-3 py-2 text-right font-mono text-zinc-300 whitespace-nowrap">
                                {job.cvMetrics?.[col] != null ? job.cvMetrics[col].toFixed(4) : '—'}
                              </td>
                            ))}
                            <td className="px-3 py-2 min-w-[100px]">
                              {job.status === 'running' && (
                                <div className="flex items-center gap-2">
                                  <div className="flex-1 h-1.5 bg-surface rounded overflow-hidden">
                                    <div className="h-full bg-brand-500 rounded" style={{ width: `${job.progress}%` }} />
                                  </div>
                                  <span className="text-[9px] text-zinc-600">{job.progress}%</span>
                                </div>
                              )}
                              {job.status === 'failed' && <span className="text-red-400 text-[10px]">Failed</span>}
                              {job.status === 'completed' && <span className="text-emerald-500 text-[10px]">✓</span>}
                              {job.status === 'pending' && <span className="text-zinc-600 text-[10px]">Queued</span>}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </div>
      }
    />
  )
}

'use client'

import { useState } from 'react'
import { trainModel, connectTaskWS, TaskProgress } from '@/lib/api'
import { useAppStore } from '@/store/appStore'
import { GranularProgress } from '@/components/ui/GranularProgress'
import { toast } from 'sonner'
import { getApiErrorMessage } from '@/lib/api-error'

const MODELS = [
  { id: 'lightgbm', label: 'LightGBM', tier: 'beginner', desc: 'Fast, robust gradient boosting' },
  { id: 'xgboost', label: 'XGBoost', tier: 'beginner', desc: 'Reliable, well-tuned boosting' },
  { id: 'random_forest', label: 'Random Forest', tier: 'beginner', desc: 'Stable ensemble baseline' },
]

const CV_PRESETS = {
  fast: { label: 'Fast Test', splits: 3, gap: 5, desc: '3-fold, small gap, quick iteration' },
  research: { label: 'Research Grade', splits: 5, gap: 10, desc: '5-fold, purged gap, rigorous' },
  robust: { label: 'Robust', splits: 7, gap: 20, desc: '7-fold, large gap, conservative' },
}

export function TrainingStep({
  pipelineId,
  featureColumns,
  onComplete,
}: {
  pipelineId: string
  featureColumns: string[]
  onComplete: (model: object) => void
}) {
  const { setTaskProgress, clearTask, setWizardModel, taskProgress, taskMessage, taskStep, taskSub, taskStatus } = useAppStore()

  const targetColumns = featureColumns.filter((c) => c.startsWith('y_'))
  const [selectedTarget, setSelectedTarget] = useState(targetColumns[0] || '')
  const [selectedModels, setSelectedModels] = useState<string[]>(['lightgbm'])
  const [nSplits, setNSplits] = useState(5)
  const [gap, setGap] = useState(10)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function toggleModel(id: string) {
    setSelectedModels((prev) => prev.includes(id) ? prev.filter((m) => m !== id) : [...prev, id])
  }

  function applyPreset(k: keyof typeof CV_PRESETS) {
    const p = CV_PRESETS[k]
    setNSplits(p.splits)
    setGap(p.gap)
  }

  async function handleTrain() {
    if (!selectedTarget || selectedModels.length === 0) return
    setLoading(true)
    setError(null)

    // Train first selected model (batch is Phase 2)
    const modelType = selectedModels[0]
    try {
      const res = await trainModel({
        pipeline_id: pipelineId,
        target_column: selectedTarget,
        model_type: modelType,
        hyperparameters: {},
        n_splits: nSplits,
        gap,
      })
      const { task_id } = res.data
      setTaskProgress(task_id, 5, 'Starting training...', 'PROGRESS', 'STEP 4/6 Training')

      await new Promise<void>((resolve, reject) => {
        connectTaskWS(task_id, (data: TaskProgress) => {
          setTaskProgress(data.task_id, data.progress, data.message, data.status, data.step, data.sub as Record<string, unknown>)
          if (data.status === 'SUCCESS' && data.result) {
            // Fetch full model
            import('@/lib/api').then(({ getModel }) =>
              getModel(data.result!.model_id as string).then((r) => {
                setWizardModel(r.data)
                setLoading(false)
                toast.success('Model training completed')
                onComplete(r.data)
                resolve()
              })
            )
          } else if (data.status === 'FAILURE') {
            const err = data.error || 'Training failed'
            setError(err)
            toast.error(err)
            setLoading(false)
            reject()
          }
        })
      })
    } catch (e: unknown) {
      setLoading(false)
      toast.error(getApiErrorMessage(e, 'Training failed'))
    }
  }

  return (
    <div className="space-y-5">
      {/* Target selector */}
      <div>
        <label className="block text-xs text-zinc-400 mb-2">Target Column</label>
        {targetColumns.length === 0 ? (
          <div className="text-xs text-red-400">No target columns found. Go back to Step 3 and generate targets.</div>
        ) : (
          <div className="flex flex-wrap gap-2">
            {targetColumns.map((col) => (
              <button
                key={col}
                onClick={() => setSelectedTarget(col)}
                className={`px-3 py-1.5 rounded-lg text-xs font-mono transition-colors ${
                  selectedTarget === col
                    ? 'bg-brand-500/30 text-brand-300 border border-brand-500/50'
                    : 'bg-surface border border-surface-border text-zinc-500 hover:text-zinc-300'
                }`}
              >
                {col}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Model selection */}
      <div>
        <label className="block text-xs text-zinc-400 mb-2">Model</label>
        <div className="space-y-2">
          {MODELS.map((m) => (
            <div
              key={m.id}
              onClick={() => toggleModel(m.id)}
              className={`flex items-center justify-between p-3 rounded-xl border cursor-pointer transition-colors ${
                selectedModels.includes(m.id)
                  ? 'border-brand-500/40 bg-brand-500/10'
                  : 'border-surface-border bg-surface hover:border-zinc-600'
              }`}
            >
              <div className="flex items-center gap-3">
                <div className={`w-4 h-4 rounded border-2 flex items-center justify-center ${selectedModels.includes(m.id) ? 'bg-brand-500 border-brand-500' : 'border-zinc-600'}`}>
                  {selectedModels.includes(m.id) && <span className="text-white text-xs">✓</span>}
                </div>
                <div>
                  <div className="text-sm font-medium text-zinc-200">{m.label}</div>
                  <div className="text-xs text-zinc-500">{m.desc}</div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* CV Presets */}
      <div>
        <label className="block text-xs text-zinc-400 mb-2">Cross-Validation Preset</label>
        <div className="flex gap-2 flex-wrap">
          {(Object.entries(CV_PRESETS) as [keyof typeof CV_PRESETS, typeof CV_PRESETS[keyof typeof CV_PRESETS]][]).map(([key, p]) => (
            <button
              key={key}
              onClick={() => applyPreset(key)}
              className="px-3 py-1.5 rounded-lg border border-surface-border bg-surface hover:bg-surface-card text-xs text-zinc-300 transition-colors"
            >
              <div className="font-medium">{p.label}</div>
              <div className="text-zinc-500">{p.desc}</div>
            </button>
          ))}
        </div>
      </div>

      {/* CV params */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-xs text-zinc-400 mb-1">CV Folds</label>
          <input
            type="number"
            min={2} max={10}
            className="w-full bg-surface border border-surface-border rounded-lg px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:border-brand-500"
            value={nSplits}
            onChange={(e) => setNSplits(Number(e.target.value))}
          />
        </div>
        <div>
          <label className="block text-xs text-zinc-400 mb-1">Purge Gap (bars)</label>
          <input
            type="number"
            min={0}
            className="w-full bg-surface border border-surface-border rounded-lg px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:border-brand-500"
            value={gap}
            onChange={(e) => setGap(Number(e.target.value))}
          />
        </div>
      </div>

      {/* Train button */}
      <button
        onClick={handleTrain}
        disabled={loading || !selectedTarget || selectedModels.length === 0}
        className="w-full py-2.5 bg-brand-500 hover:bg-brand-600 disabled:opacity-40 text-white rounded-lg text-sm font-semibold transition-colors"
      >
        {loading ? 'Training...' : `Train ${selectedModels[0]?.toUpperCase() || 'Model'} on ${selectedTarget || 'target'}`}
      </button>

      {/* Progress */}
      {(loading || taskProgress > 0) && (
        <GranularProgress
          progress={taskProgress}
          message={taskMessage}
          step={taskStep}
          sub={taskSub as Record<string, unknown>}
          status={taskStatus}
        />
      )}

      {error && (
        <div className="rounded-lg bg-red-500/10 border border-red-500/30 p-3 text-sm text-red-400">{error}</div>
      )}
    </div>
  )
}

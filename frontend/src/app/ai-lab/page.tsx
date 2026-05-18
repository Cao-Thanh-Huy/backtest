'use client'
import { useState } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { listPipelines, trainModel, connectTaskWS } from '@/lib/api'
import { useAppStore } from '@/store/appStore'
import ReactECharts from 'echarts-for-react'

export default function AILabPage() {
  const { setTaskProgress, clearTask, taskProgress, taskMessage, taskStatus } = useAppStore()
  const [pipelineId, setPipelineId] = useState('')
  const [targetCol, setTargetCol] = useState('')
  const [modelType, setModelType] = useState('lightgbm')
  const [nSplits, setNSplits] = useState(5)
  const [gap, setGap] = useState(10)
  const [trainedModel, setTrainedModel] = useState<any>(null)

  const { data: pipelines } = useQuery({
    queryKey: ['pipelines'],
    queryFn: () => listPipelines().then(r => r.data),
  })

  const selectedPipeline = pipelines?.find((p: any) => p.id === pipelineId)

  const trainMut = useMutation({
    mutationFn: () => trainModel({ feature_set_id: pipelineId, target_column: targetCol, model_type: modelType, n_splits: nSplits, gap }),
    onSuccess: (res) => {
      const model = res.data
      const taskId = model.celery_task_id
      setTrainedModel(model)
      setTaskProgress(taskId, 0, 'Task queued…', 'PENDING')
      connectTaskWS(taskId, (msg) => {
        setTaskProgress(msg.task_id, msg.progress, msg.message, msg.status)
        if (msg.status === 'SUCCESS') setTrainedModel((prev: any) => ({ ...prev, ...msg.result }))
      }, clearTask)
    },
  })

  // Feature importance chart
  const importances: Record<string, number> = trainedModel?.feature_importances || {}
  const sortedImportances = Object.entries(importances).sort((a, b) => b[1] - a[1]).slice(0, 20)

  const chartOption = {
    backgroundColor: 'transparent',
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
    grid: { left: '30%', right: '5%', top: '5%', bottom: '5%' },
    xAxis: { type: 'value', axisLabel: { color: '#94a3b8' } },
    yAxis: {
      type: 'category',
      data: sortedImportances.map(([k]) => k),
      axisLabel: { color: '#94a3b8', fontSize: 10 },
    },
    series: [{
      type: 'bar',
      data: sortedImportances.map(([, v]) => v),
      itemStyle: { color: '#6366f1' },
    }],
  }

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <h1 className="text-2xl font-bold">Auto-ML Lab</h1>

      <div className="grid grid-cols-2 gap-6">
        <div className="space-y-4">
          <div className="card space-y-4">
            <h2 className="font-semibold">Training Configuration</h2>
            <div>
              <label className="label">Select Pipeline</label>
              <select className="input" value={pipelineId} onChange={e => setPipelineId(e.target.value)}>
                <option value="">-- choose --</option>
                {pipelines?.filter((p: any) => p.status === 'completed').map((p: any) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>
            {selectedPipeline?.feature_columns && (
              <div>
                <label className="label">Target Column</label>
                <select className="input" value={targetCol} onChange={e => setTargetCol(e.target.value)}>
                  <option value="">-- choose --</option>
                  {selectedPipeline.feature_columns
                    .filter((c: string) => c.startsWith('y_'))
                    .map((c: string) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
            )}
            <div>
              <label className="label">Model Type</label>
              <select className="input" value={modelType} onChange={e => setModelType(e.target.value)}>
                <option value="xgboost">XGBoost</option>
                <option value="lightgbm">LightGBM</option>
                <option value="random_forest">Random Forest</option>
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">CV Splits</label>
                <input type="number" className="input" value={nSplits} onChange={e => setNSplits(+e.target.value)} min={2} max={10} />
              </div>
              <div>
                <label className="label">Purge Gap (bars)</label>
                <input type="number" className="input" value={gap} onChange={e => setGap(+e.target.value)} min={0} />
              </div>
            </div>

            {taskMessage && (
              <div>
                <div className="flex justify-between text-sm mb-1">
                  <span className="text-zinc-400">{taskMessage}</span>
                  <span className="text-brand-500">{taskProgress}%</span>
                </div>
                <div className="h-2 bg-surface rounded-full overflow-hidden">
                  <div className="h-full bg-brand-500 transition-all" style={{ width: `${taskProgress}%` }} />
                </div>
              </div>
            )}

            <button
              className="btn-primary w-full"
              disabled={!pipelineId || !targetCol || trainMut.isPending}
              onClick={() => trainMut.mutate()}
            >
              {trainMut.isPending ? 'Training…' : '🤖 Train AI Model'}
            </button>
          </div>

          {/* MLflow embed */}
          <div className="card">
            <h2 className="font-semibold mb-3">MLflow Experiments</h2>
            <a
              href={process.env.NEXT_PUBLIC_MLFLOW_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="text-brand-500 hover:underline text-sm"
            >
              Open MLflow UI →
            </a>
          </div>
        </div>

        {/* Feature Importance Chart */}
        <div className="card">
          <h2 className="font-semibold mb-4">Top 20 Feature Importances</h2>
          {sortedImportances.length > 0 ? (
            <ReactECharts option={chartOption} style={{ height: 500 }} />
          ) : (
            <div className="flex items-center justify-center h-64 text-zinc-500 text-sm">
              Train a model to see feature importances
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

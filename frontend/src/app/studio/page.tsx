'use client'
import { useState } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { listDatasets, generatePipeline, connectTaskWS } from '@/lib/api'
import { useAppStore } from '@/store/appStore'

const INDICATOR_PRESETS: Record<string, Record<string, number>> = {
  rsi: { length: 14 },
  macd: { fast: 12, slow: 26, signal: 9 },
  bbands: { length: 20, std: 2 },
  atr: { length: 14 },
  ema: { length: 21 },
  sma: { length: 50 },
  stoch: { k: 14, d: 3 },
  adx: { length: 14 },
}

export default function StudioPage() {
  const { setTaskProgress, clearTask, taskProgress, taskMessage, taskStatus } = useAppStore()

  const [datasetId, setDatasetId] = useState('')
  const [indicators, setIndicators] = useState<{ name: string; params: Record<string, number> }[]>([])
  const [targets, setTargets] = useState<{ name: string; method: string; params: Record<string, unknown> }[]>([])
  const [lags, setLags] = useState('1,2,3')
  const [error, setError] = useState('')

  const { data: datasets } = useQuery({
    queryKey: ['datasets'],
    queryFn: () => listDatasets().then(r => r.data),
  })

  const addIndicator = (name: string) => {
    setIndicators(prev => [...prev, { name, params: { ...INDICATOR_PRESETS[name] } }])
  }

  const addTarget = () => {
    setTargets(prev => [...prev, { name: `y_return_${prev.length + 1}d`, method: 'n_bar', params: { shift: 3, type: 'regression' } }])
  }

  const generateMut = useMutation({
    mutationFn: () => generatePipeline({
      dataset_id: datasetId,
      indicators,
      targets,
      lags: lags.split(',').map(Number).filter(Boolean),
    }),
    onSuccess: (res) => {
      const taskId = res.data.celery_task_id
      setTaskProgress(taskId, 0, 'Task queued…', 'PENDING')
      connectTaskWS(taskId, (msg) => {
        setTaskProgress(msg.task_id, msg.progress, msg.message, msg.status)
      }, clearTask)
    },
    onError: (e: any) => setError(e.response?.data?.detail || 'Failed'),
  })

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <h1 className="text-2xl font-bold">Strategy Studio</h1>

      <div className="grid grid-cols-2 gap-6">
        {/* Left Panel */}
        <div className="space-y-4">
          <div className="card">
            <label className="label">Select Dataset</label>
            <select className="input" value={datasetId} onChange={e => setDatasetId(e.target.value)}>
              <option value="">-- choose --</option>
              {datasets?.map((d: any) => (
                <option key={d.id} value={d.id}>{d.symbol} / {d.timeframe}</option>
              ))}
            </select>
          </div>

          <div className="card">
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-semibold">Indicators</h2>
            </div>
            <div className="flex flex-wrap gap-2 mb-3">
              {Object.keys(INDICATOR_PRESETS).map(name => (
                <button key={name} className="btn-ghost text-xs" onClick={() => addIndicator(name)}>
                  + {name.toUpperCase()}
                </button>
              ))}
            </div>
            <div className="space-y-2">
              {indicators.map((ind, i) => (
                <div key={i} className="flex items-center gap-2 bg-surface rounded p-2 text-sm">
                  <span className="text-brand-500 font-medium w-16">{ind.name}</span>
                  <span className="text-zinc-400 text-xs flex-1">
                    {Object.entries(ind.params).map(([k, v]) => `${k}=${v}`).join(', ')}
                  </span>
                  <button className="text-red-400 hover:text-red-300" onClick={() =>
                    setIndicators(prev => prev.filter((_, j) => j !== i))
                  }>✕</button>
                </div>
              ))}
            </div>
            <div className="mt-3">
              <label className="label">Lag Periods (comma-separated)</label>
              <input className="input" value={lags} onChange={e => setLags(e.target.value)} />
            </div>
          </div>
        </div>

        {/* Right Panel */}
        <div className="space-y-4">
          <div className="card">
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-semibold">Targets</h2>
              <button className="btn-ghost text-xs" onClick={addTarget}>+ Add Target</button>
            </div>
            <div className="space-y-3">
              {targets.map((t, i) => (
                <div key={i} className="bg-surface rounded p-3 space-y-2 text-sm">
                  <div className="flex gap-2">
                    <input
                      className="input text-xs flex-1"
                      value={t.name}
                      onChange={e => setTargets(prev => prev.map((x, j) => j === i ? { ...x, name: e.target.value } : x))}
                    />
                    <select
                      className="input text-xs w-36"
                      value={t.method}
                      onChange={e => setTargets(prev => prev.map((x, j) => j === i ? { ...x, method: e.target.value } : x))}
                    >
                      <option value="n_bar">N-Bar Return</option>
                      <option value="triple_barrier">Triple Barrier</option>
                    </select>
                    <button className="text-red-400" onClick={() => setTargets(prev => prev.filter((_, j) => j !== i))}>✕</button>
                  </div>
                  <div className="text-xs text-zinc-400">
                    {t.method === 'n_bar'
                      ? `Shift: ${(t.params as any).shift} bars | Type: ${(t.params as any).type}`
                      : `TP: ${(t.params as any).tp} | SL: ${(t.params as any).sl} | Max: ${(t.params as any).max_bars} bars`
                    }
                  </div>
                </div>
              ))}
              {!targets.length && <p className="text-zinc-500 text-sm">No targets defined.</p>}
            </div>
          </div>

          {/* Progress */}
          {taskMessage && (
            <div className="card">
              <div className="flex justify-between text-sm mb-2">
                <span className="text-zinc-400">{taskMessage}</span>
                <span className="text-brand-500">{taskProgress}%</span>
              </div>
              <div className="h-2 bg-surface rounded-full overflow-hidden">
                <div
                  className="h-full bg-brand-500 transition-all duration-500"
                  style={{ width: `${taskProgress}%` }}
                />
              </div>
              {taskStatus === 'SUCCESS' && <p className="text-green-400 text-sm mt-2">✓ Pipeline generated!</p>}
              {taskStatus === 'FAILURE' && <p className="text-red-400 text-sm mt-2">✗ Pipeline failed.</p>}
            </div>
          )}

          {error && <p className="text-red-400 text-sm">{error}</p>}
          <button
            className="btn-primary w-full"
            disabled={!datasetId || !indicators.length || generateMut.isPending}
            onClick={() => generateMut.mutate()}
          >
            {generateMut.isPending ? 'Dispatching…' : '⚡ Generate Pipeline'}
          </button>
        </div>
      </div>
    </div>
  )
}

'use client'

import { useEffect, useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  listModels, listBacktests, runBacktest, getEquityCurve, connectTaskWS, TaskProgress, listFeatureSets,
} from '@/lib/api'
import { useAppStore, AIModel, BacktestResult, FeatureSet } from '@/store/appStore'
import { LabPage, StatusBadge, TaskBar, EmptyState } from '@/components/ui/LabPage'
import dynamic from 'next/dynamic'
import { toast } from 'sonner'
import { getApiErrorMessage } from '@/lib/api-error'

const ReactECharts = dynamic(() => import('echarts-for-react'), { ssr: false })

function KpiCard({ label, value, unit = '', higherBetter = true }: { label: string; value: number | undefined; unit?: string; higherBetter?: boolean }) {
  const display = value !== undefined && !isNaN(value) ? `${value.toFixed(2)}${unit}` : '—'
  const color = value === undefined || isNaN(value) ? 'text-zinc-400' : higherBetter ? (value > 0 ? 'text-emerald-400' : 'text-red-400') : (value < 0 ? 'text-emerald-400' : 'text-red-400')
  return (
    <div className="rounded-xl border border-white/[0.06] bg-surface p-3 text-center">
      <div className={`text-xl font-bold ${color}`}>{display}</div>
      <div className="text-xs text-zinc-500 mt-1">{label}</div>
    </div>
  )
}

function ExplainTag({ label, tone }: { label: string; tone: 'good' | 'warn' | 'bad' | 'neutral' }) {
  const toneCls = {
    good: 'text-emerald-300 bg-emerald-500/10 border-emerald-500/20',
    warn: 'text-amber-300 bg-amber-500/10 border-amber-500/20',
    bad: 'text-red-300 bg-red-500/10 border-red-500/20',
    neutral: 'text-zinc-300 bg-zinc-500/10 border-zinc-500/20',
  }[tone]
  return <span className={`text-[10px] px-2 py-0.5 rounded border ${toneCls}`}>{label}</span>
}

type ExplainSignal = { label: string; tone: 'good' | 'warn' | 'bad' | 'neutral' }

function formatMaybe(value: unknown, digits = 3, suffix = ''): string {
  const n = Number(value)
  if (!Number.isFinite(n)) return '—'
  return `${n.toFixed(digits)}${suffix}`
}

export default function BacktestPage() {
  const qc = useQueryClient()
  const { activeModelId, activeBacktestId, setActiveBacktest, setTaskProgress, taskProgress, taskMessage, taskStatus, activeTaskId } = useAppStore()

  const { data: models = [] } = useQuery<AIModel[]>({ queryKey: ['models'], queryFn: () => listModels().then(r => r.data) })
  const { data: featureSets = [] } = useQuery<FeatureSet[]>({ queryKey: ['featureSets'], queryFn: () => listFeatureSets().then(r => r.data) })
  const { data: backtests = [], isLoading } = useQuery<BacktestResult[]>({
    queryKey: ['backtests'],
    queryFn: () => listBacktests().then(r => r.data),
    refetchInterval: (q) => {
      const data = q.state.data as BacktestResult[] | undefined
      return data?.some(b => b.status === 'pending' || b.status === 'running') ? 3000 : false
    },
  })

  const completedModels = models.filter(m => m.status === 'completed')

  function modelLabel(m: AIModel) {
    const fsName = featureSets.find((fs) => fs.id === m.feature_set_id)?.name ?? 'no-fs'
    const hp = m.hyperparameters ?? {}
    const hpKeys = Object.keys(hp).slice(0, 3)
    const hpShort = hpKeys.length > 0
      ? hpKeys.map((k) => `${k}=${String(hp[k])}`).join(', ')
      : 'default-hparams'
    return `${m.model_type} | ${m.target_column} | ${fsName} | ${hpShort} | id:${m.id.slice(0, 8)} | ${new Date(m.created_at).toLocaleString()}`
  }

  function backtestModelLabel(modelId: string) {
    const m = models.find((x) => x.id === modelId)
    if (!m) return `model:${modelId.slice(0, 8)}`
    const fsName = featureSets.find((fs) => fs.id === m.feature_set_id)?.name ?? 'no-fs'
    return `${m.model_type} | ${m.target_column} | ${fsName} | id:${m.id.slice(0, 8)}`
  }

  const selected = backtests.find(b => b.id === activeBacktestId) ?? backtests[0] ?? null
  const selectedModel = selected ? models.find((m) => m.id === selected.model_id) ?? null : null
  const [formOpen, setFormOpen] = useState(false)
  const [formModelId, setFormModelId] = useState(activeModelId ?? completedModels[0]?.id ?? '')
  const [capital, setCapital] = useState(10000)
  const [fee, setFee] = useState(0.1)
  const [slippage, setSlippage] = useState(0.05)
  const [longThresh, setLongThresh] = useState(0.6)
  const [shortThresh, setShortThresh] = useState(0.4)
  const [running, setRunning] = useState(false)
  const [runError, setRunError] = useState<string | null>(null)

  const [equityCurve, setEquityCurve] = useState<{ time: string; value: number }[] | null>(null)
  const [curveLoading, setCurveLoading] = useState(false)

  async function handleRun() {
    if (!formModelId) { toast.error('Select a model'); return }
    if (longThresh <= shortThresh) { toast.error('Long threshold must be greater than short threshold'); return }
    setRunning(true); setRunError(null)
    try {
      const res = await runBacktest({
        model_id: formModelId,
        initial_capital: capital,
        fee_pct: fee / 100,
        slippage_pct: slippage / 100,
        long_threshold: longThresh,
        short_threshold: shortThresh,
      })
      const task_id = res.data.celery_task_id as string
      setTaskProgress(task_id, 5, 'Starting backtest...', 'PROGRESS')
      await new Promise<void>((resolve, reject) => {
        let settled = false

        const failFast = (message: string) => {
          if (settled) return
          settled = true
          const fullMsg = `${message}. Please retry.`
          setRunError(fullMsg)
          toast.error(fullMsg)
          setRunning(false)
          reject(new Error(fullMsg))
        }

        connectTaskWS(
          task_id,
          async (data: TaskProgress) => {
            setTaskProgress(data.task_id, data.progress, data.message, data.status, data.step, data.sub as Record<string, unknown>)
            if (data.status === 'SUCCESS' && data.result) {
              if (settled) return
              settled = true
              const btId = data.result.backtest_id as string
              setActiveBacktest(btId)
              qc.invalidateQueries({ queryKey: ['backtests'] })
              setRunning(false)
              setFormOpen(false)
              toast.success('Backtest complete')
              loadCurve(btId)
              resolve()
            } else if (data.status === 'FAILURE') {
              failFast(data.error || 'Backtest failed')
            }
          },
          undefined,
          {
            onError: (message) => failFast(message),
            onClose: () => {
              if (!settled) failFast('Task stream closed before completion')
            },
          },
        )
      })
    } catch (e) {
      setRunning(false)
      setRunError(getApiErrorMessage(e, 'Backtest failed'))
    }
  }

  async function loadCurve(btId: string) {
    setCurveLoading(true); setEquityCurve(null)
    try {
      const res = await getEquityCurve(btId)
      setEquityCurve(res.data)
    } catch { /* no curve yet */ }
    finally { setCurveLoading(false) }
  }

  function selectBacktest(b: BacktestResult) {
    setActiveBacktest(b.id)
    if (b.status === 'completed' && b.s3_equity_curve_path) loadCurve(b.id)
    else setEquityCurve(null)
  }

  useEffect(() => {
    if (!selected || selected.status !== 'completed' || !selected.s3_equity_curve_path) return
    if (equityCurve || curveLoading) return
    loadCurve(selected.id)
  }, [selected?.id, selected?.status, selected?.s3_equity_curve_path, equityCurve, curveLoading])

  const isRunning = running || (activeTaskId != null && (taskStatus === 'PROGRESS' || taskStatus === 'STARTED'))
  const metrics = selected?.metrics as Record<string, number> | null | undefined

  const explainSignals = useMemo<ExplainSignal[]>(() => {
    if (!metrics) return []
    const sharpe = Number(metrics.sharpe_ratio ?? 0)
    const mdd = Number(metrics.max_drawdown ?? 0)
    const wr = Number(metrics.win_rate ?? 0)
    const pf = Number(metrics.profit_factor ?? 0)
    const tr = Number(metrics.total_return ?? 0)

    return [
      {
        label: sharpe >= 1.5 ? 'Sharpe mạnh' : sharpe >= 1.0 ? 'Sharpe ổn' : sharpe >= 0.3 ? 'Sharpe yếu' : 'Sharpe rất thấp',
        tone: (sharpe >= 1.0 ? 'good' : sharpe >= 0.3 ? 'warn' : 'bad') as ExplainSignal['tone'],
      },
      {
        label: mdd <= 10 ? 'Drawdown thấp' : mdd <= 20 ? 'Drawdown trung bình' : 'Drawdown cao',
        tone: (mdd <= 10 ? 'good' : mdd <= 20 ? 'warn' : 'bad') as ExplainSignal['tone'],
      },
      {
        label: wr >= 55 ? 'Tỷ lệ thắng tốt' : wr >= 45 ? 'Tỷ lệ thắng trung tính' : 'Tỷ lệ thắng thấp',
        tone: (wr >= 55 ? 'good' : wr >= 45 ? 'neutral' : 'warn') as ExplainSignal['tone'],
      },
      {
        label: pf >= 1.4 ? 'Profit factor tốt' : pf >= 1.1 ? 'Profit factor chấp nhận được' : 'Profit factor yếu',
        tone: (pf >= 1.4 ? 'good' : pf >= 1.1 ? 'warn' : 'bad') as ExplainSignal['tone'],
      },
      {
        label: tr >= 0 ? 'Total return dương' : 'Total return âm',
        tone: (tr >= 0 ? 'good' : 'bad') as ExplainSignal['tone'],
      },
    ]
  }, [metrics])

  const drawdownCurve = Array.isArray(metrics?.drawdown_curve) ? metrics?.drawdown_curve as { time: string; value: number }[] : []
  const rollingSharpe = Array.isArray(metrics?.rolling_sharpe) ? metrics?.rolling_sharpe as { time: string; value: number }[] : []
  const tradeDistribution = Array.isArray(metrics?.trade_distribution) ? metrics?.trade_distribution as number[] : []

  const drawdownOption = drawdownCurve.length > 0 ? {
    backgroundColor: 'transparent',
    grid: { top: 20, bottom: 32, left: 56, right: 16 },
    tooltip: { trigger: 'axis' },
    xAxis: { type: 'category', data: drawdownCurve.map(p => p.time), axisLabel: { color: '#64748b', fontSize: 10, showMaxLabel: false } },
    yAxis: { type: 'value', axisLabel: { color: '#64748b', fontSize: 10, formatter: '{value}%' }, splitLine: { lineStyle: { color: '#1e293b' } } },
    series: [{ type: 'line', symbol: 'none', smooth: true, data: drawdownCurve.map(p => p.value), lineStyle: { color: '#ef4444', width: 2 } }],
  } : null

  const rollingSharpeOption = rollingSharpe.length > 0 ? {
    backgroundColor: 'transparent',
    grid: { top: 20, bottom: 32, left: 56, right: 16 },
    tooltip: { trigger: 'axis' },
    xAxis: { type: 'category', data: rollingSharpe.map(p => p.time), axisLabel: { color: '#64748b', fontSize: 10, showMaxLabel: false } },
    yAxis: { type: 'value', axisLabel: { color: '#64748b', fontSize: 10 }, splitLine: { lineStyle: { color: '#1e293b' } } },
    series: [{ type: 'line', symbol: 'none', smooth: true, data: rollingSharpe.map(p => p.value), lineStyle: { color: '#22c55e', width: 2 } }],
  } : null

  const tradeDistOption = tradeDistribution.length > 0 ? {
    backgroundColor: 'transparent',
    grid: { top: 20, bottom: 32, left: 40, right: 16 },
    tooltip: { trigger: 'axis' },
    xAxis: { type: 'category', data: tradeDistribution.map((_, i) => String(i + 1)), axisLabel: { color: '#64748b', fontSize: 9 } },
    yAxis: { type: 'value', axisLabel: { color: '#64748b', fontSize: 10, formatter: '{value}%' }, splitLine: { lineStyle: { color: '#1e293b' } } },
    series: [{ type: 'bar', data: tradeDistribution, itemStyle: { color: '#6366f1' } }],
  } : null

  const echartsOption = equityCurve ? {
    backgroundColor: 'transparent',
    grid: { top: 20, bottom: 40, left: 60, right: 20 },
    tooltip: { trigger: 'axis' },
    xAxis: { type: 'time', axisLine: { lineStyle: { color: '#334155' } }, axisLabel: { color: '#64748b', fontSize: 10 } },
    yAxis: { type: 'value', axisLine: { lineStyle: { color: '#334155' } }, axisLabel: { color: '#64748b', fontSize: 10 }, splitLine: { lineStyle: { color: '#1e293b' } } },
    series: [{
      type: 'line', smooth: true, symbol: 'none',
      data: equityCurve.map(p => [p.time, p.value]),
      lineStyle: { color: '#6366f1', width: 2 },
      areaStyle: { color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: 'rgba(99,102,241,0.25)' }, { offset: 1, color: 'rgba(99,102,241,0)' }] } },
    }],
  } : null

  return (
    <LabPage
      title="Backtest"
      subtitle="Run portfolio simulations on trained models"
      action={
        <button onClick={() => setFormOpen(true)} className="btn-primary text-sm px-4 py-2">
          + Run Backtest
        </button>
      }
      list={
        <div className="p-3 space-y-1">
          {isLoading && <div className="text-xs text-zinc-600 p-2">Loading...</div>}
          {!isLoading && backtests.length === 0 && <div className="text-xs text-zinc-600 p-2">No backtests yet.</div>}
          {backtests.map(b => {
            const active = b.id === selected?.id
            const m = b.metrics as Record<string, number> | null | undefined
            return (
              <button
                key={b.id}
                onClick={() => selectBacktest(b)}
                className={`w-full text-left rounded-lg px-3 py-2.5 transition-colors ${active ? 'bg-brand/[0.10] border border-brand-500/30' : 'hover:bg-surface border border-transparent'}`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold text-zinc-200">Backtest</span>
                  <StatusBadge status={b.status} />
                </div>
                <div className="text-[10px] text-zinc-500 mt-0.5 truncate" title={backtestModelLabel(b.model_id)}>
                  {backtestModelLabel(b.model_id)}
                </div>
                  {m && (
                  <div className="text-[10px] text-zinc-500 mt-0.5 flex gap-2">
                    {m.sharpe_ratio != null && <span>Sharpe: {m.sharpe_ratio.toFixed(2)}</span>}
                    {m.max_drawdown != null && <span>DD: {m.max_drawdown.toFixed(1)}%</span>}
                    {m.total_return != null && <span>Ret: {m.total_return.toFixed(1)}%</span>}
                  </div>
                )}
                <div className="text-[10px] text-zinc-700">{new Date(b.created_at).toLocaleDateString()}</div>
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
                <h2 className="font-semibold text-zinc-200">New Backtest</h2>
                <button onClick={() => setFormOpen(false)} className="text-zinc-500 hover:text-zinc-300 text-sm">✕</button>
              </div>

              <div>
                <label className="label">Model</label>
                <select className="input text-sm" value={formModelId} onChange={e => setFormModelId(e.target.value)}>
                  <option value="">-- select model --</option>
                  {completedModels.map(m => (
                    <option key={m.id} value={m.id} title={modelLabel(m)}>
                      {modelLabel(m)}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="label">Capital ($)</label>
                  <input type="number" className="input text-sm" value={capital} onChange={e => setCapital(Number(e.target.value))} />
                </div>
                <div>
                  <label className="label">Fee %</label>
                  <input type="number" step="0.01" className="input text-sm" value={fee} onChange={e => setFee(Number(e.target.value))} />
                </div>
                <div>
                  <label className="label">Slippage %</label>
                  <input type="number" step="0.01" className="input text-sm" value={slippage} onChange={e => setSlippage(Number(e.target.value))} />
                </div>
                <div>
                  <label className="label">Long Threshold</label>
                  <input type="number" step="0.05" min="0" max="1" className="input text-sm" value={longThresh} onChange={e => setLongThresh(Number(e.target.value))} />
                </div>
                <div>
                  <label className="label">Short Threshold</label>
                  <input type="number" step="0.05" min="0" max="1" className="input text-sm" value={shortThresh} onChange={e => setShortThresh(Number(e.target.value))} />
                </div>
              </div>

              {runError && <div className="text-xs text-red-400">{runError}</div>}
              <button onClick={handleRun} disabled={running || !formModelId} className="btn-primary w-full text-sm">
                {running ? 'Running...' : 'Run Backtest'}
              </button>
            </div>
          )}

          {!formOpen && selected && (
            <>
              <div className="flex items-start justify-between">
                <div>
                  <h2 className="text-xl font-bold text-zinc-100">Backtest</h2>
                  <div className="flex gap-3 mt-1 text-xs text-zinc-500 items-center">
                    <StatusBadge status={selected.status} />
                    <span>{new Date(selected.created_at).toLocaleString()}</span>
                  </div>
                  {selectedModel && (
                    <div className="text-[11px] text-zinc-500 mt-1.5">
                      {backtestModelLabel(selected.model_id)}
                    </div>
                  )}
                </div>
                <button onClick={() => loadCurve(selected.id)} disabled={selected.status !== 'completed'} className="btn-ghost text-xs px-3 py-1.5">Refresh</button>
              </div>

              {selected.status === 'completed' && metrics && (
                <>
                  <div className="rounded-xl border border-white/[0.06] bg-surface-card p-4 space-y-3">
                    <div className="text-xs text-zinc-400">Backtest Explainability</div>
                    <div className="flex flex-wrap gap-2">
                      {explainSignals.map((s, i) => <ExplainTag key={`${s.label}-${i}`} label={s.label} tone={s.tone} />)}
                    </div>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-[11px] text-zinc-500">
                      <div>Expectancy: <span className="text-zinc-300">{formatMaybe(metrics.expectancy, 3, '%')}</span></div>
                      <div>Long/Short: <span className="text-zinc-300">{Number(metrics.n_long ?? 0)} / {Number(metrics.n_short ?? 0)}</span></div>
                      <div>Avg Win/Loss: <span className="text-zinc-300">{formatMaybe(metrics.avg_win_pct, 3, '%')} / {formatMaybe(metrics.avg_loss_pct, 3, '%')}</span></div>
                      <div>Equity R2: <span className="text-zinc-300">{formatMaybe(metrics.equity_r2, 3)}</span></div>
                    </div>
                  </div>

                  <div className="rounded-xl border border-white/[0.06] bg-surface-card p-4 space-y-3">
                    <div className="text-xs text-zinc-400">Run Configuration</div>
                    <div className="grid grid-cols-2 md:grid-cols-5 gap-2 text-[11px] text-zinc-500">
                      <div>Capital: <span className="text-zinc-300">${Number(selected.strategy_config?.initial_capital ?? 0).toLocaleString()}</span></div>
                      <div>Fee: <span className="text-zinc-300">{(Number(selected.strategy_config?.fee_pct ?? 0) * 100).toFixed(3)}%</span></div>
                      <div>Slippage: <span className="text-zinc-300">{(Number(selected.strategy_config?.slippage_pct ?? 0) * 100).toFixed(3)}%</span></div>
                      <div>Long threshold: <span className="text-zinc-300">{Number(selected.strategy_config?.long_threshold ?? 0).toFixed(2)}</span></div>
                      <div>Short threshold: <span className="text-zinc-300">{Number(selected.strategy_config?.short_threshold ?? 0).toFixed(2)}</span></div>
                    </div>
                  </div>

                  <div className="grid grid-cols-4 gap-3">
                    <KpiCard label="Total Return" value={metrics.total_return} unit="%" />
                    <KpiCard label="Sharpe Ratio" value={metrics.sharpe_ratio} />
                    <KpiCard label="Max Drawdown" value={metrics.max_drawdown} unit="%" higherBetter={false} />
                    <KpiCard label="Win Rate" value={metrics.win_rate} unit="%" />
                    <KpiCard label="Sortino" value={metrics.sortino_ratio} />
                    <KpiCard label="Calmar" value={metrics.calmar_ratio} />
                    <KpiCard label="Profit Factor" value={metrics.profit_factor} />
                    <KpiCard label="# Trades" value={metrics.n_trades} unit="" />
                  </div>

                  {curveLoading && <div className="text-xs text-zinc-600">Loading equity curve...</div>}
                  {echartsOption && (
                    <div className="rounded-xl border border-white/[0.06] bg-surface-card p-4">
                      <div className="text-xs text-zinc-500 mb-3">Equity Curve</div>
                      <ReactECharts option={echartsOption} style={{ height: 280 }} />
                    </div>
                  )}

                  <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
                    {drawdownOption && (
                      <div className="rounded-xl border border-white/[0.06] bg-surface-card p-4">
                        <div className="text-xs text-zinc-500 mb-3">Drawdown Curve (%)</div>
                        <ReactECharts option={drawdownOption} style={{ height: 220 }} />
                      </div>
                    )}
                    {rollingSharpeOption && (
                      <div className="rounded-xl border border-white/[0.06] bg-surface-card p-4">
                        <div className="text-xs text-zinc-500 mb-3">Rolling Sharpe (30 bars)</div>
                        <ReactECharts option={rollingSharpeOption} style={{ height: 220 }} />
                      </div>
                    )}
                  </div>

                  {tradeDistOption && (
                    <div className="rounded-xl border border-white/[0.06] bg-surface-card p-4">
                      <div className="text-xs text-zinc-500 mb-3">Trade PnL Distribution (%)</div>
                      <ReactECharts option={tradeDistOption} style={{ height: 220 }} />
                    </div>
                  )}
                </>
              )}
            </>
          )}

          {!formOpen && !selected && !isRunning && (
            <EmptyState message="Run a backtest on a trained model" />
          )}
        </div>
      }
    />
  )
}

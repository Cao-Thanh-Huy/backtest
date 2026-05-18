'use client'
import { useState, useEffect, useRef } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { listModels, runBacktest, getEquityCurve, connectTaskWS } from '@/lib/api'
import { useAppStore } from '@/store/appStore'
import { createChart, IChartApi, ISeriesApi } from 'lightweight-charts'
import ReactECharts from 'echarts-for-react'

export default function BacktesterPage() {
  const { setTaskProgress, clearTask, taskProgress, taskMessage, taskStatus } = useAppStore()
  const [modelId, setModelId] = useState('')
  const [capital, setCapital] = useState(10000)
  const [feePct, setFeePct] = useState(0.001)
  const [longThresh, setLongThresh] = useState(0.6)
  const [shortThresh, setShortThresh] = useState(0.4)
  const [metrics, setMetrics] = useState<Record<string, number> | null>(null)
  const [equityCurve, setEquityCurve] = useState<{ time: string; value: number }[]>([])
  const chartRef = useRef<HTMLDivElement>(null)
  const chartApi = useRef<IChartApi | null>(null)
  const lineSeries = useRef<ISeriesApi<'Line'> | null>(null)

  const { data: models } = useQuery({
    queryKey: ['models'],
    queryFn: () => listModels().then(r => r.data),
  })

  // Initialize lightweight-charts equity chart
  useEffect(() => {
    if (!chartRef.current) return
    const chart = createChart(chartRef.current, {
      width: chartRef.current.clientWidth,
      height: 280,
      layout: { background: { color: '#1e293b' }, textColor: '#94a3b8' },
      grid: { vertLines: { color: '#334155' }, horzLines: { color: '#334155' } },
    })
    lineSeries.current = chart.addLineSeries({ color: '#6366f1', lineWidth: 2 })
    chartApi.current = chart
    return () => chart.remove()
  }, [])

  useEffect(() => {
    if (lineSeries.current && equityCurve.length) {
      lineSeries.current.setData(equityCurve)
    }
  }, [equityCurve])

  const backtestMut = useMutation({
    mutationFn: () => runBacktest({
      model_id: modelId,
      initial_capital: capital,
      fee_pct: feePct,
      long_threshold: longThresh,
      short_threshold: shortThresh,
    }),
    onSuccess: (res) => {
      const bt = res.data
      const taskId = bt.celery_task_id
      setTaskProgress(taskId, 0, 'Dispatched…', 'PENDING')
      connectTaskWS(taskId, (msg) => {
        setTaskProgress(msg.task_id, msg.progress, msg.message, msg.status)
        if (msg.status === 'SUCCESS') {
          setMetrics((msg.result as any)?.metrics)
          getEquityCurve(bt.id).then(r => setEquityCurve(r.data))
        }
      }, clearTask)
    },
  })

  // ECharts equity curve option
  const echartsOption = {
    backgroundColor: 'transparent',
    tooltip: { trigger: 'axis' },
    xAxis: { type: 'category', data: equityCurve.map(p => p.time), axisLabel: { color: '#94a3b8', rotate: 30 } },
    yAxis: { type: 'value', axisLabel: { color: '#94a3b8' } },
    series: [{
      type: 'line',
      data: equityCurve.map(p => p.value),
      areaStyle: { color: 'rgba(99,102,241,0.15)' },
      lineStyle: { color: '#6366f1' },
      symbol: 'none',
      smooth: true,
    }],
    grid: { left: '10%', right: '5%', top: '10%', bottom: '20%' },
  }

  const kpi = [
    { label: 'Total Return', value: metrics ? `${metrics.total_return}%` : '—', color: 'text-green-400' },
    { label: 'Max Drawdown', value: metrics ? `${metrics.max_drawdown}%` : '—', color: 'text-red-400' },
    { label: 'Win Rate', value: metrics ? `${metrics.win_rate}%` : '—', color: 'text-yellow-400' },
    { label: 'Sharpe Ratio', value: metrics ? metrics.sharpe_ratio : '—', color: 'text-brand-500' },
  ]

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <h1 className="text-2xl font-bold">Backtest Simulator</h1>

      <div className="grid grid-cols-3 gap-6">
        {/* Config */}
        <div className="card space-y-4">
          <h2 className="font-semibold">Configuration</h2>
          <div>
            <label className="label">Select Trained Model</label>
            <select className="input" value={modelId} onChange={e => setModelId(e.target.value)}>
              <option value="">-- choose --</option>
              {models?.filter((m: any) => m.status === 'completed').map((m: any) => (
                <option key={m.id} value={m.id}>{m.target_column} / {m.model_type}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Initial Capital ($)</label>
            <input type="number" className="input" value={capital} onChange={e => setCapital(+e.target.value)} />
          </div>
          <div>
            <label className="label">Fee % (e.g. 0.001 = 0.1%)</label>
            <input type="number" className="input" step="0.0001" value={feePct} onChange={e => setFeePct(+e.target.value)} />
          </div>
          <div>
            <label className="label">Long Entry Threshold</label>
            <input type="number" className="input" step="0.05" min="0.5" max="1" value={longThresh} onChange={e => setLongThresh(+e.target.value)} />
          </div>
          <div>
            <label className="label">Short Entry Threshold</label>
            <input type="number" className="input" step="0.05" min="0" max="0.5" value={shortThresh} onChange={e => setShortThresh(+e.target.value)} />
          </div>

          {taskMessage && (
            <div>
              <div className="flex justify-between text-xs mb-1">
                <span className="text-zinc-400">{taskMessage}</span>
                <span className="text-brand-500">{taskProgress}%</span>
              </div>
              <div className="h-1.5 bg-surface rounded-full overflow-hidden">
                <div className="h-full bg-brand-500 transition-all" style={{ width: `${taskProgress}%` }} />
              </div>
            </div>
          )}

          <button
            className="btn-primary w-full"
            disabled={!modelId || backtestMut.isPending}
            onClick={() => backtestMut.mutate()}
          >
            {backtestMut.isPending ? 'Running…' : '▶ Run Simulation'}
          </button>
        </div>

        {/* Results */}
        <div className="col-span-2 space-y-4">
          {/* KPI Cards */}
          <div className="grid grid-cols-4 gap-3">
            {kpi.map(k => (
              <div key={k.label} className="card text-center">
                <p className="text-xs text-zinc-400 mb-1">{k.label}</p>
                <p className={`text-xl font-bold ${k.color}`}>{k.value}</p>
              </div>
            ))}
          </div>

          {/* Equity Curve */}
          <div className="card">
            <h2 className="font-semibold mb-3">Portfolio Equity Curve</h2>
            {equityCurve.length > 0 ? (
              <ReactECharts option={echartsOption} style={{ height: 280 }} />
            ) : (
              <div className="flex items-center justify-center h-48 text-zinc-500 text-sm">
                Run a backtest to see results
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

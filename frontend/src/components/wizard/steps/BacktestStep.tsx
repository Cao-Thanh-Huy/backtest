'use client'

import { useState } from 'react'
import { runBacktest, connectTaskWS, getEquityCurve, TaskProgress } from '@/lib/api'
import { useAppStore } from '@/store/appStore'
import { GranularProgress } from '@/components/ui/GranularProgress'
import { toast } from 'sonner'
import { getApiErrorMessage } from '@/lib/api-error'

export function BacktestStep({
  modelId,
  onComplete,
}: {
  modelId: string
  onComplete: (backtest: object, curve: { time: string; value: number }[]) => void
}) {
  const { setTaskProgress, setWizardBacktest, taskProgress, taskMessage, taskStep, taskSub, taskStatus } = useAppStore()

  const [capital, setCapital] = useState(10000)
  const [fee, setFee] = useState(0.1)
  const [slippage, setSlippage] = useState(0.05)
  const [longThresh, setLongThresh] = useState(0.6)
  const [shortThresh, setShortThresh] = useState(0.4)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleRun() {
    setLoading(true)
    setError(null)

    try {
      const res = await runBacktest({
        model_id: modelId,
        initial_capital: capital,
        fee_pct: fee / 100,
        slippage_pct: slippage / 100,
        long_threshold: longThresh,
        short_threshold: shortThresh,
      })
      const { task_id } = res.data
      setTaskProgress(task_id, 5, 'Starting backtest...', 'PROGRESS', 'STEP 5/6 Backtesting')

      await new Promise<void>((resolve, reject) => {
        connectTaskWS(task_id, async (data: TaskProgress) => {
          setTaskProgress(data.task_id, data.progress, data.message, data.status, data.step, data.sub as Record<string, unknown>)
          if (data.status === 'SUCCESS' && data.result) {
            const btId = data.result.backtest_id as string
            try {
              const curveRes = await getEquityCurve(btId)
              const curve: { time: string; value: number }[] = curveRes.data
              // Fetch full backtest record
              const { getBacktest } = await import('@/lib/api')
              const btRes = await getBacktest(btId)
              setWizardBacktest(btRes.data, curve)
              setLoading(false)
              toast.success('Backtest completed')
              onComplete(btRes.data, curve)
              resolve()
            } catch (e) {
              setError('Failed to load results')
              toast.error('Failed to load backtest results')
              setLoading(false)
              reject(e)
            }
          } else if (data.status === 'FAILURE') {
            const err = data.error || 'Backtest failed'
            setError(err)
            toast.error(err)
            setLoading(false)
            reject()
          }
        })
      })
    } catch (e: unknown) {
      setLoading(false)
      toast.error(getApiErrorMessage(e, 'Backtest failed'))
    }
  }

  return (
    <div className="space-y-5">
      <div className="text-xs text-zinc-500">
        Configure portfolio simulation parameters. The model generates long/short signals based on probability thresholds.
      </div>

      {/* Capital & fees */}
      <div className="grid grid-cols-3 gap-4">
        <div>
          <label className="block text-xs text-zinc-400 mb-1">Initial Capital ($)</label>
          <input
            type="number"
            className="w-full bg-surface border border-surface-border rounded-lg px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:border-brand-500"
            value={capital}
            onChange={(e) => setCapital(Number(e.target.value))}
          />
        </div>
        <div>
          <label className="block text-xs text-zinc-400 mb-1">Fee %</label>
          <input
            type="number"
            step="0.01"
            className="w-full bg-surface border border-surface-border rounded-lg px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:border-brand-500"
            value={fee}
            onChange={(e) => setFee(Number(e.target.value))}
          />
        </div>
        <div>
          <label className="block text-xs text-zinc-400 mb-1">Slippage %</label>
          <input
            type="number"
            step="0.01"
            className="w-full bg-surface border border-surface-border rounded-lg px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:border-brand-500"
            value={slippage}
            onChange={(e) => setSlippage(Number(e.target.value))}
          />
        </div>
      </div>

      {/* Thresholds */}
      <div className="rounded-xl border border-surface-border bg-surface p-4 space-y-3">
        <div className="text-xs font-semibold text-zinc-400">Signal Thresholds</div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs text-zinc-500 mb-1">Long Entry (prob ≥)</label>
            <input
              type="range" min={0.5} max={0.95} step={0.05}
              className="w-full accent-emerald-500"
              value={longThresh}
              onChange={(e) => setLongThresh(Number(e.target.value))}
            />
            <div className="text-xs text-emerald-400 text-center">{longThresh.toFixed(2)}</div>
          </div>
          <div>
            <label className="block text-xs text-zinc-500 mb-1">Short Entry (prob ≤)</label>
            <input
              type="range" min={0.05} max={0.5} step={0.05}
              className="w-full accent-red-500"
              value={shortThresh}
              onChange={(e) => setShortThresh(Number(e.target.value))}
            />
            <div className="text-xs text-red-400 text-center">{shortThresh.toFixed(2)}</div>
          </div>
        </div>
      </div>

      <button
        onClick={handleRun}
        disabled={loading}
        className="w-full py-2.5 bg-brand-500 hover:bg-brand-600 disabled:opacity-40 text-white rounded-lg text-sm font-semibold transition-colors"
      >
        {loading ? 'Running Backtest...' : 'Run Backtest'}
      </button>

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

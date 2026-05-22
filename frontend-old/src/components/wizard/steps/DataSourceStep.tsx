'use client'

import { useState } from 'react'
import { fetchMarketData, uploadDataset, connectTaskWS, TaskProgress } from '@/lib/api'
import { useAppStore } from '@/store/appStore'
import { GranularProgress } from '@/components/ui/GranularProgress'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { getApiErrorMessage } from '@/lib/api-error'

const SOURCES = [
  { id: 'binance', label: 'Binance', hint: 'e.g. BTCUSDT, ETHUSDT' },
  { id: 'yahoo', label: 'Yahoo Finance', hint: 'e.g. BTC-USD, AAPL, SPY' },
  { id: 'upload', label: 'Upload CSV / Parquet', hint: 'Your own OHLCV file' },
]

const BINANCE_TIMEFRAMES = ['1m', '5m', '15m', '30m', '1h', '2h', '4h', '6h', '12h', '1d', '1w']
const YAHOO_TIMEFRAMES = ['1m', '5m', '15m', '30m', '60m', '1d', '1wk', '1mo']

const POPULAR_SYMBOLS = {
  binance: ['BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'ADAUSDT'],
  yahoo: ['BTC-USD', 'ETH-USD', 'AAPL', 'MSFT', 'SPY', 'QQQ', 'GLD'],
}

interface DataPreview {
  row_count: number
  column_count: number
  missing_values: number
  duplicate_timestamps: number
  date_from: string | null
  date_to: string | null
  columns: { name: string; type: string }[]
}

export function DataSourceStep({ onComplete }: { onComplete: () => void }) {
  const { setWizardDataset, setTaskProgress, clearTask, taskProgress, taskMessage, taskStep, taskSub, taskStatus, activeTaskId } = useAppStore()

  const [source, setSource] = useState<string>('binance')
  const [symbol, setSymbol] = useState('BTCUSDT')
  const [timeframe, setTimeframe] = useState('1h')
  const [dateFrom, setDateFrom] = useState('2022-01-01')
  const [dateTo, setDateTo] = useState(new Date().toISOString().slice(0, 10))
  const [uploadFile, setUploadFile] = useState<File | null>(null)
  const [uploadSymbol, setUploadSymbol] = useState('')
  const [uploadTimeframe, setUploadTimeframe] = useState('1d')
  const [preview, setPreview] = useState<DataPreview | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const timeframes = source === 'yahoo' ? YAHOO_TIMEFRAMES : BINANCE_TIMEFRAMES

  async function handleFetch() {
    setError(null)
    setPreview(null)
    setLoading(true)

    try {
      const res = await fetchMarketData({ source, symbol, timeframe, date_from: dateFrom, date_to: dateTo })
      const { task_id } = res.data
      setTaskProgress(task_id, 5, 'Starting fetch...', 'PROGRESS', 'STEP 1/6 Data Source')

      connectTaskWS(task_id,
        (data: TaskProgress) => {
          setTaskProgress(data.task_id, data.progress, data.message, data.status, data.step, data.sub as Record<string, unknown>)
        },
        () => {
          // re-fetch from store once done
        }
      )

      // Poll for completion via WS result
      await new Promise<void>((resolve, reject) => {
        const ws = connectTaskWS(task_id,
          (data: TaskProgress) => {
            setTaskProgress(data.task_id, data.progress, data.message, data.status, data.step, data.sub as Record<string, unknown>)
            if (data.status === 'SUCCESS' && data.result) {
              const result = data.result as { dataset_id: string; preview: DataPreview }
              setPreview(result.preview)
              setWizardDataset(
                {
                  id: result.dataset_id,
                  symbol,
                  timeframe,
                  row_count: String(result.preview.row_count),
                  date_from: result.preview.date_from ?? undefined,
                  date_to: result.preview.date_to ?? undefined,
                  created_at: new Date().toISOString(),
                },
                result.preview as unknown as Record<string, unknown>
              )
              setLoading(false)
              toast.success(`Fetched ${symbol} ${timeframe} successfully`)
              resolve()
            } else if (data.status === 'FAILURE') {
              const err = data.error || 'Fetch failed'
              setError(err)
              toast.error(err)
              setLoading(false)
              reject(new Error(data.error))
            }
          }
        )
      })
    } catch (e: unknown) {
      const msg = getApiErrorMessage(e, 'Fetch failed')
      setError(msg)
      toast.error(msg)
      setLoading(false)
    }
  }

  async function handleUpload() {
    if (!uploadFile || !uploadSymbol) return
    setError(null)
    setPreview(null)
    setLoading(true)

    try {
      const form = new FormData()
      form.append('file', uploadFile)
      form.append('symbol', uploadSymbol)
      form.append('timeframe', uploadTimeframe)
      const res = await uploadDataset(form)
      const dataset = res.data
      setWizardDataset(dataset)
      setPreview({
        row_count: Number(dataset.row_count),
        column_count: 6,
        missing_values: 0,
        duplicate_timestamps: 0,
        date_from: dataset.date_from,
        date_to: dataset.date_to,
        columns: [
          { name: 'timestamp', type: 'datetime' },
          { name: 'open', type: 'float' },
          { name: 'high', type: 'float' },
          { name: 'low', type: 'float' },
          { name: 'close', type: 'float' },
          { name: 'volume', type: 'float' },
        ],
      })
      toast.success(`Uploaded ${uploadSymbol || dataset.symbol} dataset`)
    } catch (e: unknown) {
      const msg = getApiErrorMessage(e, 'Upload failed')
      setError(msg)
      toast.error(msg)
    } finally {
      setLoading(false)
    }
  }

  const canProceed = preview !== null && !loading

  return (
    <div className="space-y-6">
      {/* Source tabs */}
      <div className="flex gap-2">
        {SOURCES.map((s) => (
          <button
            key={s.id}
            onClick={() => { setSource(s.id); setSymbol(s.id === 'yahoo' ? 'BTC-USD' : 'BTCUSDT') }}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              source === s.id
                ? 'bg-brand-500 text-white'
                : 'bg-surface border border-surface-border text-zinc-400 hover:text-zinc-200'
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>

      {source !== 'upload' ? (
        <div className="space-y-4">
          {/* Symbol quick picks */}
          <div>
            <label className="block text-xs text-zinc-400 mb-1">Symbol</label>
            <div className="flex flex-wrap gap-2 mb-2">
              {(POPULAR_SYMBOLS[source as keyof typeof POPULAR_SYMBOLS] || []).map((s) => (
                <button
                  key={s}
                  onClick={() => setSymbol(s)}
                  className={`px-2 py-1 rounded text-xs ${symbol === s ? 'bg-brand-500/30 text-brand-400 border border-brand-500/50' : 'bg-surface border border-surface-border text-zinc-500 hover:text-zinc-300'}`}
                >
                  {s}
                </button>
              ))}
            </div>
            <input
              className="w-full bg-surface border border-surface-border rounded-lg px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:border-brand-500"
              value={symbol}
              onChange={(e) => setSymbol(e.target.value.toUpperCase())}
              placeholder={SOURCES.find(s => s.id === source)?.hint}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-zinc-400 mb-1">Timeframe</label>
              <select
                className="w-full bg-surface border border-surface-border rounded-lg px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:border-brand-500"
                value={timeframe}
                onChange={(e) => setTimeframe(e.target.value)}
              >
                {timeframes.map((tf) => <option key={tf} value={tf}>{tf}</option>)}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-zinc-400 mb-1">From</label>
              <input
                type="date"
                className="w-full bg-surface border border-surface-border rounded-lg px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:border-brand-500"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-xs text-zinc-400 mb-1">To</label>
              <input
                type="date"
                className="w-full bg-surface border border-surface-border rounded-lg px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:border-brand-500"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
              />
            </div>
          </div>

          <Button
            onClick={handleFetch}
            disabled={loading || !symbol}
            className="w-full"
          >
            {loading ? 'Fetching...' : `Fetch ${symbol} Data`}
          </Button>
        </div>
      ) : (
        <div className="space-y-4">
          <div>
            <label className="block text-xs text-zinc-400 mb-1">Symbol</label>
            <input
              className="w-full bg-surface border border-surface-border rounded-lg px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:border-brand-500"
              value={uploadSymbol}
              onChange={(e) => setUploadSymbol(e.target.value.toUpperCase())}
              placeholder="BTCUSDT"
            />
          </div>
          <div>
            <label className="block text-xs text-zinc-400 mb-1">Timeframe</label>
            <input
              className="w-full bg-surface border border-surface-border rounded-lg px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:border-brand-500"
              value={uploadTimeframe}
              onChange={(e) => setUploadTimeframe(e.target.value)}
              placeholder="1d"
            />
          </div>
          <label className="block border-2 border-dashed border-surface-border rounded-xl p-6 text-center cursor-pointer hover:border-brand-500/50 transition-colors">
            <input
              type="file"
              accept=".csv,.parquet"
              className="hidden"
              onChange={(e) => setUploadFile(e.target.files?.[0] || null)}
            />
            {uploadFile ? (
              <div className="text-sm text-emerald-400">{uploadFile.name}</div>
            ) : (
              <div className="text-sm text-zinc-500">Drop CSV or Parquet file here, or click to browse</div>
            )}
          </label>
          <Button
            onClick={handleUpload}
            disabled={loading || !uploadFile || !uploadSymbol}
            className="w-full"
          >
            {loading ? 'Uploading...' : 'Upload File'}
          </Button>
        </div>
      )}

      {/* Progress */}
      {loading && (
        <GranularProgress
          progress={taskProgress}
          message={taskMessage}
          step={taskStep}
          sub={taskSub as Record<string, unknown>}
          status={taskStatus}
        />
      )}

      {/* Error */}
      {error && (
        <div className="rounded-lg bg-red-500/10 border border-red-500/30 p-3 text-sm text-red-400">{error}</div>
      )}

      {/* Data Preview */}
      {preview && (
        <div className="rounded-xl border border-surface-border bg-surface p-4 space-y-4">
          <div className="text-sm font-semibold text-zinc-200">Data Preview</div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: 'Rows', value: preview.row_count.toLocaleString() },
              { label: 'Missing', value: String(preview.missing_values) },
              { label: 'Duplicates', value: String(preview.duplicate_timestamps) },
              { label: 'Columns', value: String(preview.column_count) },
            ].map((kpi) => (
              <div key={kpi.label} className="bg-surface-card rounded-lg p-2 text-center">
                <div className="text-lg font-bold text-zinc-100">{kpi.value}</div>
                <div className="text-xs text-zinc-500">{kpi.label}</div>
              </div>
            ))}
          </div>

          {(preview.date_from || preview.date_to) && (
            <div className="text-xs text-zinc-400">
              Date range: <span className="text-zinc-300">{preview.date_from}</span> → <span className="text-zinc-300">{preview.date_to}</span>
            </div>
          )}

          <table className="w-full text-xs">
            <thead>
              <tr className="text-zinc-500 border-b border-surface-border">
                <th className="text-left py-1">Column</th>
                <th className="text-left py-1">Type</th>
              </tr>
            </thead>
            <tbody>
              {preview.columns.map((col) => (
                <tr key={col.name} className="border-b border-surface-border/50">
                  <td className="py-1 text-zinc-300 font-mono">{col.name}</td>
                  <td className="py-1 text-zinc-500">{col.type}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Continue */}
      {canProceed && (
        <Button
          onClick={onComplete}
          className="w-full bg-emerald-600 hover:bg-emerald-700"
        >
          Continue → Configure Indicators
        </Button>
      )}
    </div>
  )
}

'use client'

import dynamic from 'next/dynamic'
import { useEffect, useRef, useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  listDatasets, listPipelines, generatePipeline, previewPipeline,
  deletePipeline, downloadPipeline, getDatasetStats, getDatasetChartData,
  connectTaskWS, TaskProgress, preflightPipeline, PipelinePreflightReport,
} from '@/lib/api'
import { useAppStore, Dataset, Pipeline } from '@/store/appStore'
import { LabPage, StatusBadge, PreviewTable, EmptyState } from '@/components/ui/LabPage'
import { GranularProgress } from '@/components/ui/GranularProgress'
import { toast } from 'sonner'
import { getApiErrorMessage } from '@/lib/api-error'
import { X } from 'lucide-react'
import type { ChartBar } from '@/components/charts/OHLCVChart'

const ReactECharts = dynamic(() => import('echarts-for-react'), { ssr: false })

// ── Constants ────────────────────────────────────────────────────────────────
interface ParamSweep { min: number; max: number; step: number }
interface IndicatorConfig {
  name: string; enabled: boolean
  label_vi?: string
  description_vi?: string
  params: Record<string, number>
  params_sweep: Record<string, ParamSweep>
  useSweep: boolean
  label: string
  description: string
}

const IND_DEFAULTS: Omit<IndicatorConfig, 'enabled' | 'useSweep'>[] = [
  { name: 'rsi',    label: 'RSI',          description: 'Relative Strength Index — momentum oscillator', description_vi: 'Chỉ số Sức mạnh Tương đối — động lượng',
    params: { length: 14 }, params_sweep: { length: { min: 6, max: 30, step: 2 } } },
  { name: 'ema',    label: 'EMA',          description: 'Exponential Moving Average — trend direction', description_vi: 'Đường Trung bình Động theo Hàm mũ — hướng xu hướng',
    params: { length: 21 }, params_sweep: { length: { min: 5, max: 200, step: 5 } } },
  { name: 'ema_distance', label: 'EMA Distance', description: 'Relational trend strength: (EMA_fast - EMA_slow) / close', description_vi: 'Sức mạnh xu hướng tương quan: (EMA nhanh - EMA chậm) / giá đóng cửa',
    params: { fast: 20, slow: 50 }, params_sweep: { fast: { min: 5, max: 50, step: 5 }, slow: { min: 20, max: 200, step: 10 } } },
  { name: 'ema_compression', label: 'EMA Compression', description: 'Breakout potential: abs(EMA_fast - EMA_slow) / ATR', description_vi: 'Tiềm năng phá vỡ (breakout): abs(EMA nhanh - EMA chậm) / ATR',
    params: { fast: 20, slow: 50, atr_length: 14 }, params_sweep: { fast: { min: 5, max: 30, step: 5 }, slow: { min: 20, max: 100, step: 10 } } },
  { name: 'trend_regime', label: 'Trend Regime', description: 'Regime state: EMA_fast > EMA_slow', description_vi: 'Trạng thái xu hướng: EMA nhanh > EMA chậm',
    params: { fast: 50, slow: 200 }, params_sweep: {} },
  { name: 'volatility_regime', label: 'Volatility Regime', description: 'High-vol / low-vol state via volatility z-score threshold', description_vi: 'Biến động cao/thấp theo ngưỡng Z-score',
    params: { length: 20, z_window: 100, threshold: 1 }, params_sweep: { length: { min: 10, max: 50, step: 10 } } },
  { name: 'sma',    label: 'SMA',          description: 'Simple Moving Average — trend baseline', description_vi: 'Đường Trung bình Động Đơn giản — đường cơ sở xu hướng',
    params: { length: 50 }, params_sweep: { length: { min: 10, max: 200, step: 10 } } },
  { name: 'macd',   label: 'MACD',         description: 'Moving Average Convergence Divergence — trend momentum', description_vi: 'Phân kỳ Hội tụ Trung bình Động — động lượng xu hướng',
    params: { fast: 12, slow: 26, signal: 9 }, params_sweep: { fast: { min: 8, max: 16, step: 2 }, slow: { min: 20, max: 32, step: 2 } } },
  { name: 'roc', label: 'ROC', description: 'Rate of change momentum', description_vi: 'Tỷ lệ thay đổi động lượng',
    params: { length: 10 }, params_sweep: { length: { min: 5, max: 50, step: 5 } } },
  { name: 'bbands', label: 'Bollinger Bands', description: 'Volatility bands around a moving average', description_vi: 'Dải băng biến động quanh đường trung bình động',
    params: { length: 20, std: 2.0 }, params_sweep: { length: { min: 10, max: 50, step: 5 }, std: { min: 1.5, max: 3.0, step: 0.5 } } },
  { name: 'atr',    label: 'ATR',          description: 'Average True Range — volatility measure', description_vi: 'Khoảng dao động thực tế trung bình — thước đo biến động',
    params: { length: 14 }, params_sweep: { length: { min: 7, max: 28, step: 7 } } },
  { name: 'returns', label: 'Returns', description: 'Simple returns over n bars', description_vi: 'Lợi nhuận đơn giản trong n cây nến',
    params: { length: 1 }, params_sweep: { length: { min: 1, max: 12, step: 1 } } },
  { name: 'log_return', label: 'Log Returns', description: 'Log returns for stable statistical modeling', description_vi: 'Lợi nhuận logarit để mô hình thống kê ổn định hơn',
    params: { length: 1 }, params_sweep: { length: { min: 1, max: 12, step: 1 } } },
  { name: 'rolling_std', label: 'Rolling Std', description: 'Rolling volatility of returns', description_vi: 'Độ lệch chuẩn trượt của lợi nhuận',
    params: { length: 20 }, params_sweep: { length: { min: 10, max: 100, step: 10 } } },
  { name: 'zscore', label: 'Rolling Z-score', description: 'Mean-reversion distance from rolling mean', description_vi: 'Khoảng cách đảo chiều trung bình so với đường trung bình trượt',
    params: { length: 20 }, params_sweep: { length: { min: 10, max: 80, step: 10 } } },
  { name: 'skew', label: 'Rolling Skewness', description: 'Distribution asymmetry feature', description_vi: 'Đặc tính bất đối xứng của phân phối',
    params: { length: 50 }, params_sweep: { length: { min: 20, max: 120, step: 10 } } },
  { name: 'kurtosis', label: 'Rolling Kurtosis', description: 'Tail-risk feature for return distribution', description_vi: 'Đặc tính rủi ro đuôi cho phân phối lợi nhuận',
    params: { length: 50 }, params_sweep: { length: { min: 20, max: 120, step: 10 } } },
  { name: 'autocorr', label: 'Autocorrelation', description: 'Return persistence over rolling window', description_vi: 'Độ bền vững lợi nhuận qua cửa sổ trượt',
    params: { length: 50, lag: 1 }, params_sweep: { length: { min: 20, max: 120, step: 10 } } },
  { name: 'stoch',  label: 'Stochastic',   description: 'Stochastic Oscillator — overbought/oversold', description_vi: 'Dao động ngẫu nhiên — vùng quá mua/quá bán',
    params: { k: 14, d: 3 }, params_sweep: { k: { min: 5, max: 21, step: 2 } } },
  { name: 'adx',    label: 'ADX',          description: 'Average Directional Index — trend strength', description_vi: 'Chỉ số Hướng Trung bình — độ mạnh xu hướng',
    params: { length: 14 }, params_sweep: { length: { min: 7, max: 28, step: 7 } } },
  { name: 'vwap', label: 'VWAP', description: 'Volume-weighted average price context', description_vi: 'Giá trung bình gia quyền khối lượng',
    params: { length: 20 }, params_sweep: { length: { min: 10, max: 80, step: 10 } } },
  { name: 'obv', label: 'OBV', description: 'On-balance volume pressure accumulator', description_vi: 'Khối lượng cân bằng — áp lực tích luỹ',
    params: {}, params_sweep: {} },
  { name: 'funding_zscore', label: 'Funding Z-score', description: 'Crowding feature from funding-rate extremes (requires funding data)', description_vi: 'Đặc điểm đám đông từ cực đoan funding rate (cần dữ liệu funding)',
    params: { length: 50 }, params_sweep: { length: { min: 20, max: 200, step: 20 } } },
  { name: 'oi_change', label: 'OI Change', description: 'Leverage build-up via open-interest changes (requires OI data)', description_vi: 'Sự tích luỹ đòn bẩy thông qua thay đổi OI (cần dữ liệu Open Interest)',
    params: { length: 1 }, params_sweep: { length: { min: 1, max: 24, step: 1 } } },
  { name: 'oi_momentum', label: 'OI Momentum', description: 'Smoothed momentum of open-interest flow (requires OI data)', description_vi: 'Động lượng dòng tiền Open Interest được làm mượt',
    params: { length: 12 }, params_sweep: { length: { min: 4, max: 48, step: 4 } } },
  { name: 'basis_spread', label: 'Basis Spread', description: 'Futures - spot spread (requires futures/spot prices)', description_vi: 'Khoảng cách giữa giá tương lai và giao ngay',
    params: {}, params_sweep: {} },
  { name: 'liquidation_imbalance', label: 'Liquidation Imbalance', description: 'Long-vs-short liquidation pressure (requires liquidation data)', description_vi: 'Áp lực thanh lý Long/Short',
    params: {}, params_sweep: {} },
  { name: 'bid_ask_imbalance', label: 'Bid/Ask Imbalance', description: 'Orderbook pressure (requires bid/ask volume)', description_vi: 'Áp lực sổ lệnh (cần volume Bid/Ask)',
    params: {}, params_sweep: {} },
  { name: 'delta_volume', label: 'Delta Volume', description: 'Aggressive flow: buy volume - sell volume', description_vi: 'Dòng tiền chủ động: Khối lượng Mua - Bán',
    params: {}, params_sweep: {} },
  { name: 'cvd', label: 'CVD', description: 'Cumulative volume delta', description_vi: 'Khối lượng delta tích luỹ',
    params: {}, params_sweep: {} },
]


type DetailTab = 'preview' | 'features' | 'config' | 'quality'
type StatusFilter = 'all' | 'completed' | 'running' | 'failed' | 'pending'

interface PreviewData {
  row_count: number; column_count: number
  columns: { name: string; type: string }[]
  rows: Record<string, unknown>[]
}

interface DatasetStats {
  row_count: number
  column_count: number
  null_counts: Record<string, number>
  quality?: {
    duplicate_candles: number
    missing_candles: number
    gap_segments: number
    corrupted_rows: number
    spikes: number
    null_cells: number
    null_rows_estimate: number
    missing_funding: number | null
    expected_interval_sec: number | null
    observed_rows: number
    expected_rows: number | null
  }
}

interface QualityInsights {
  duplicateCandles: number
  missingCandles: number
  gapSegments: number
  corruptedRows: number
  spikes: number
  nullCells: number
  nullRowsEstimate: number
  missingFunding: number | null
  expectedIntervalSec: number | null
  observedRows: number
  expectedRows: number | null
  issueTimeline: { time: number; type: string }[]
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function categorizeFeatures(cols: string[]): Record<string, string[]> {
  const cats: Record<string, string[]> = {
    OHLCV: [], TrendMomentum: [], Statistical: [], Regime: [], Futures: [], Orderflow: [], Lags: [], Targets: [], Other: [],
  }
  for (const c of cols) {
    if (/^(open|high|low|close|volume)$/i.test(c)) cats.OHLCV.push(c)
    else if (/_lag\d+$/.test(c)) cats.Lags.push(c)
    else if (/^y_/.test(c)) cats.Targets.push(c)
    else if (/^(rsi|ema|sma|macd|bb|atr|stoch|adx|roc|vwap|obv)/.test(c)) cats.TrendMomentum.push(c)
    else if (/^(returns|log_return|rolling_std|zscore|skew|kurtosis|autocorr)/.test(c)) cats.Statistical.push(c)
    else if (/^(trend_regime|vol_regime|ema_distance|ema_compression)/.test(c)) cats.Regime.push(c)
    else if (/^(funding|oi_|basis_spread|liquidation_imbalance|long_short)/.test(c)) cats.Futures.push(c)
    else if (/^(bid_ask_imbalance|delta_volume|cvd)/.test(c)) cats.Orderflow.push(c)
    else cats.Other.push(c)
  }
  return cats
}

const CAT_COLORS: Record<string, string> = {
  OHLCV:      'bg-zinc-800 text-zinc-300 border-zinc-600',
  TrendMomentum: 'bg-brand-500/15 text-brand-300 border-brand-500/30',
  Statistical: 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30',
  Regime: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  Futures: 'bg-fuchsia-500/15 text-fuchsia-300 border-fuchsia-500/30',
  Orderflow: 'bg-teal-500/15 text-teal-300 border-teal-500/30',
  Lags:       'bg-indigo-500/15 text-indigo-300 border-indigo-500/30',
  Targets:    'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  Other:      'bg-zinc-800 text-zinc-400 border-zinc-700',
}

function _comboCountFromSweep(sweep: Record<string, ParamSweep>): number {
  const keys = Object.keys(sweep)
  if (keys.length === 0) return 1

  let total = 1
  for (const k of keys) {
    const s = sweep[k]
    const lo = Number(s.min)
    const hi = Number(s.max)
    const step = Number(s.step)
    if (!Number.isFinite(lo) || !Number.isFinite(hi) || !Number.isFinite(step) || step <= 0 || hi < lo) {
      return 1
    }
    const n = Math.floor((hi - lo) / step) + 1
    total *= Math.min(Math.max(n, 1), 50)
  }
  return total
}

function _indicatorColumnMultiplier(name: string): number {
  if (name === 'macd') return 5
  if (name === 'bbands') return 4
  if (name === 'stoch') return 2
  return 1
}

function formatBytes(numBytes: number | null | undefined): string {
  if (numBytes == null || !Number.isFinite(numBytes)) return 'unknown'
  let value = Number(numBytes)
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let idx = 0
  while (value >= 1024 && idx < units.length - 1) {
    value /= 1024
    idx += 1
  }
  return `${value.toFixed(1)}${units[idx]}`
}

function _estimateBaseFeatureCount(indicators: IndicatorConfig[]): number {
  return indicators.reduce((sum, ind) => {
    if (!ind.enabled) return sum
    const comboCount = ind.useSweep ? _comboCountFromSweep(ind.params_sweep) : 1
    return sum + comboCount * _indicatorColumnMultiplier(ind.name)
  }, 0)
}

function computeQualityInsights(chartData: ChartBar[] | null, stats: DatasetStats | null): QualityInsights | null {
  if (!stats || !stats.quality) return null

  const timeline: { time: number; type: string }[] = []
  if (chartData && chartData.length > 1) {
    const sorted = [...chartData].sort((a, b) => Number(a.time) - Number(b.time))
    const expected = stats.quality.expected_interval_sec
    if (expected != null) {
      for (let i = 1; i < sorted.length; i += 1) {
        const dt = Number(sorted[i].time) - Number(sorted[i - 1].time)
        if (dt > expected * 1.5) timeline.push({ time: Number(sorted[i].time), type: 'gap' })
      }
    }
  }

  return {
    duplicateCandles: Number(stats.quality.duplicate_candles || 0),
    missingCandles: Number(stats.quality.missing_candles || 0),
    gapSegments: Number(stats.quality.gap_segments || 0),
    corruptedRows: Number(stats.quality.corrupted_rows || 0),
    spikes: Number(stats.quality.spikes || 0),
    nullCells: Number(stats.quality.null_cells || 0),
    nullRowsEstimate: Number(stats.quality.null_rows_estimate || 0),
    missingFunding: stats.quality.missing_funding == null ? null : Number(stats.quality.missing_funding),
    expectedIntervalSec: stats.quality.expected_interval_sec == null ? null : Number(stats.quality.expected_interval_sec),
    observedRows: Number(stats.quality.observed_rows || stats.row_count || 0),
    expectedRows: stats.quality.expected_rows == null ? null : Number(stats.quality.expected_rows),
    issueTimeline: timeline,
  }
}

function issueOverviewOption(q: QualityInsights) {
  const rows = [
    ['Duplicates', q.duplicateCandles],
    ['Corrupted', q.corruptedRows],
    ['Spikes', q.spikes],
    ['Gap Segments', q.gapSegments],
    ['Missing Candles', q.missingCandles],
    ['NaN Cells', q.nullCells],
    ['Missing Funding', q.missingFunding ?? 0],
  ]
  return {
    backgroundColor: 'transparent',
    tooltip: { trigger: 'axis' },
    grid: { top: 10, right: 8, bottom: 28, left: 90 },
    xAxis: {
      type: 'value',
      axisLabel: { color: '#71717a', fontSize: 10 },
      splitLine: { lineStyle: { color: 'rgba(255,255,255,0.04)' } },
    },
    yAxis: {
      type: 'category',
      data: rows.map((r) => r[0]),
      axisLabel: { color: '#a1a1aa', fontSize: 10 },
      axisLine: { lineStyle: { color: 'rgba(255,255,255,0.06)' } },
    },
    series: [{
      type: 'bar',
      data: rows.map((r) => r[1]),
      itemStyle: { color: '#06b6d4', borderRadius: [0, 4, 4, 0] },
      barMaxWidth: 18,
    }],
  }
}

function issueTimelineOption(q: QualityInsights) {
  const points = q.issueTimeline.map((x, idx) => [x.time, idx + 1, x.type])
  return {
    backgroundColor: 'transparent',
    tooltip: {
      trigger: 'item',
      formatter: (p: { value: [number, number, string] }) => {
        const ts = new Date(p.value[0] * 1000).toISOString().slice(0, 19).replace('T', ' ')
        return `${p.value[2]}<br/>${ts}`
      },
    },
    grid: { top: 10, right: 8, bottom: 35, left: 10, containLabel: true },
    xAxis: {
      type: 'time',
      axisLabel: { color: '#71717a', fontSize: 10 },
      splitLine: { lineStyle: { color: 'rgba(255,255,255,0.04)' } },
      axisLine: { lineStyle: { color: 'rgba(255,255,255,0.06)' } },
    },
    yAxis: {
      type: 'value',
      min: 0,
      axisLabel: { color: '#71717a', fontSize: 10 },
      splitLine: { lineStyle: { color: 'rgba(255,255,255,0.04)' } },
    },
    series: [{
      type: 'scatter',
      symbolSize: 8,
      data: points,
      itemStyle: { color: '#f59e0b' },
      encode: { x: 0, y: 1 },
    }],
  }
}

// ── Main component ────────────────────────────────────────────────────────────
export default function FeatureFactoryPage() {
  const qc = useQueryClient()
  const {
    activeDatasetId, activePipelineId, setActivePipeline,
    setTaskProgress, taskProgress, taskMessage, taskStatus, activeTaskId, taskStep, taskSub,
  } = useAppStore()

  const { data: datasets = [] } = useQuery<Dataset[]>({
    queryKey: ['datasets'],
    queryFn: () => listDatasets().then(r => r.data),
  })
  const { data: pipelines = [], isLoading } = useQuery<Pipeline[]>({
    queryKey: ['pipelines'],
    queryFn: () => listPipelines().then(r => r.data),
    refetchInterval: (q) => {
      const data = q.state.data as Pipeline[] | undefined
      return data?.some(p => p.status === 'pending' || p.status === 'running') ? 3000 : false
    },
  })

  // ── UI state ──
  const [search, setSearch]                   = useState('')
  const [statusFilter, setStatusFilter]       = useState<StatusFilter>('all')
  const [drawerOpen, setDrawerOpen]           = useState(false)
  const [activeTab, setActiveTab]             = useState<DetailTab>('preview')
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)

  // ── Form state ──
  const [formDatasetId, setFormDatasetId]     = useState(activeDatasetId ?? '')
  const [pipelineName, setPipelineName]       = useState('')
  const [progressLog, setProgressLog] = useState<Array<{progress: number, message: string, step?: string}>>([])
  const [indicators, setIndicators]           = useState<IndicatorConfig[]>(
    IND_DEFAULTS.map(d => ({ ...d, enabled: false, useSweep: false }))
  )
  const [lags, setLags]         = useState('1,2,3')
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)

  // ── Detail data ──
  const [preview, setPreview]               = useState<PreviewData | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)

  const wsRef      = useRef<WebSocket | null>(null)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false; wsRef.current?.close() }
  }, [])

  // Deduplicate and sort lag values to avoid redundant columns in the pipeline
  const lagList = useMemo(() => {
    const seen = new Set<number>()
    return lags.split(',').map(s => parseInt(s.trim())).filter(n => {
      if (isNaN(n) || n <= 0 || n > 200) return false
      if (seen.has(n)) return false
      seen.add(n); return true
    })
  }, [lags])
  const enabledIndicatorsPayload = useMemo(
    () => indicators.filter(i => i.enabled).map(i => ({
      name: i.name,
      params: i.useSweep ? {} : i.params,
      params_sweep: i.useSweep ? i.params_sweep : {},
    })),
    [indicators],
  )

  const filteredPipelines = useMemo(() => {
    let list = [...pipelines]
    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter(p => (p.name ?? '').toLowerCase().includes(q))
    }
    if (statusFilter !== 'all') list = list.filter(p => p.status === statusFilter)
    return list
  }, [pipelines, search, statusFilter])

  const selected = pipelines.find(p => p.id === activePipelineId) ?? pipelines[0] ?? null
  const datasetForSelected = datasets.find(d => d.id === selected?.dataset_id)
  const selectedGeneratedFeatures = useMemo(
    () => (selected?.feature_columns ?? []).filter((c) => !/^y_/i.test(c)),
    [selected?.feature_columns],
  )

  function handleTaskEvent(data: TaskProgress) {
    if (!mountedRef.current) return
    setTaskProgress(data.task_id, data.progress, data.message, data.status, data.step, data.sub as Record<string, unknown>)
    setProgressLog((log) => {
      const next = [...log, { progress: data.progress, message: data.message, step: data.step }]
      return next.slice(-40)
    })
    if (data.status === 'SUCCESS' && data.result) {
      const pid = data.result.pipeline_id as string
      setActivePipeline(pid)
      qc.invalidateQueries({ queryKey: ['pipelines'] })
      toast.success('Pipeline created successfully')
    } else if (data.status === 'FAILURE') {
      const err = data.error || 'Pipeline generation failed'
      toast.error(err)
      qc.invalidateQueries({ queryKey: ['pipelines'] })
    }
  }

  const { data: stats = null } = useQuery<DatasetStats | null>({
    queryKey: ['dataset-stats', selected?.dataset_id],
    queryFn: async () => {
      if (!selected?.dataset_id) return null
      const res = await getDatasetStats(selected.dataset_id)
      return res.data as DatasetStats
    },
    enabled: Boolean(selected?.dataset_id && selected?.status === 'completed'),
  })

  const { data: chartData = null } = useQuery<ChartBar[] | null>({
    queryKey: ['dataset-chart', selected?.dataset_id],
    queryFn: async () => {
      if (!selected?.dataset_id) return null
      const res = await getDatasetChartData(selected.dataset_id)
      return (res.data?.data ?? null) as ChartBar[] | null
    },
    enabled: Boolean(selected?.dataset_id && selected?.status === 'completed'),
  })

  const quality = useMemo(() => computeQualityInsights(chartData, stats), [chartData, stats])

  const preflightPayload = useMemo(() => {
    if (!formDatasetId) return null
    return {
      dataset_id: formDatasetId,
      indicators: enabledIndicatorsPayload,
      lags: lagList,
    }
  }, [formDatasetId, enabledIndicatorsPayload, lagList])

  const preflightKey = useMemo(
    () => (preflightPayload ? JSON.stringify(preflightPayload) : ''),
    [preflightPayload],
  )

  const {
    data: preflight = null,
    isFetching: preflightLoading,
    error: preflightError,
  } = useQuery<PipelinePreflightReport | null>({
    queryKey: ['pipeline-preflight', preflightKey],
    queryFn: async () => {
      if (!preflightPayload) return null
      const res = await preflightPipeline(preflightPayload)
      return res.data as PipelinePreflightReport
    },
    enabled: Boolean(preflightPayload),
    staleTime: 5000,
    retry: false,
  })

  // Auto-load preview when selected pipeline changes
  useEffect(() => {
    if (!selected || selected.status !== 'completed') { setPreview(null); return }
    loadPreview(selected.id)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.id, selected?.status])

  useEffect(() => {
    if (!selected?.celery_task_id) return
    if (!(selected.status === 'pending' || selected.status === 'running')) return
    if (activeTaskId === selected.celery_task_id && wsRef.current) return

    setProgressLog([])
    wsRef.current?.close()
    wsRef.current = connectTaskWS(
      selected.celery_task_id,
      handleTaskEvent,
      () => {
        qc.invalidateQueries({ queryKey: ['pipelines'] })
      },
      {
        onError: () => {
          qc.invalidateQueries({ queryKey: ['pipelines'] })
        },
      },
    )
  }, [selected?.id, selected?.celery_task_id, selected?.status, activeTaskId, qc])

  async function loadPreview(pid: string) {
    setPreview(null); setPreviewLoading(true)
    try { setPreview((await previewPipeline(pid)).data) }
    catch { /* pipeline might still be processing */ }
    finally { if (mountedRef.current) setPreviewLoading(false) }
  }

  function selectPipeline(p: Pipeline) {
    setActivePipeline(p.id)
    setConfirmDeleteId(null)
    setActiveTab('preview')
  }

  async function handleDownload() {
    if (!selected) return
    try {
      const res = await downloadPipeline(selected.id)
      window.open(res.data.url, '_blank')
    } catch (e) { toast.error(getApiErrorMessage(e, 'Download failed')) }
  }

  const deleteMut = useMutation({
    mutationFn: (id: string) => deletePipeline(id),
    onSuccess: (_, id) => {
      qc.invalidateQueries({ queryKey: ['pipelines'] })
      if (activePipelineId === id) setActivePipeline(null)
      setPreview(null); setConfirmDeleteId(null)
      toast.success('Pipeline deleted')
    },
    onError: (e) => toast.error(getApiErrorMessage(e, 'Delete failed')),
  })

  function toggleInd(name: string) {
    setIndicators(prev => prev.map(i => i.name === name ? { ...i, enabled: !i.enabled } : i))
  }
  function updateIndParam(name: string, param: string, value: number) {
    setIndicators(prev => prev.map(i => {
      if (i.name !== name) return i
      return { ...i, params: { ...i.params, [param]: value } }
    }))
  }
  function updateIndSweep(name: string, param: string, field: keyof ParamSweep, value: number) {
    setIndicators(prev => prev.map(i => {
      if (i.name !== name) return i
      return {
        ...i,
        params_sweep: {
          ...i.params_sweep,
          [param]: {
            ...(i.params_sweep[param] ?? { min: 1, max: 1, step: 1 }),
            [field]: value,
          },
        },
      }
    }))
  }
  function openDrawer() {
    // Reset form to clean state each time the drawer is opened
    setIndicators(IND_DEFAULTS.map(d => ({ ...d, enabled: false, useSweep: false })))
    setLags('1,2,3')
    setPipelineName('')
    setCreateError(null)
    setDrawerOpen(true)
  }

  async function handleCreate() {
    if (!formDatasetId) { toast.error('Select a dataset first'); return }
    if (preflight && !preflight.accepted) {
      setCreateError(preflight.message ?? 'Server preflight rejected. Reduce sweep ranges or lags.')
      return
    }
    setCreating(true); setCreateError(null)
    try {
      const ds = datasets.find(d => d.id === formDatasetId)
      const res = await generatePipeline({
        dataset_id: formDatasetId,
        name: pipelineName || `${ds?.symbol ?? 'pipeline'} ${ds?.timeframe ?? ''} pipeline`,
        indicators: enabledIndicatorsPayload,
        lags: lagList,
        targets: [],
      })
      const task_id = res.data.celery_task_id as string
      setProgressLog([])
      setTaskProgress(task_id, 5, 'Generating features...', 'PROGRESS')
      setDrawerOpen(false)
      setCreating(false)

      wsRef.current?.close()
      wsRef.current = connectTaskWS(task_id, handleTaskEvent, () => {
        qc.invalidateQueries({ queryKey: ['pipelines'] })
      }, {
        onError: () => {
          qc.invalidateQueries({ queryKey: ['pipelines'] })
        },
      })
    } catch (e) {
      setCreating(false)
      setCreateError(getApiErrorMessage(e, 'Failed to create pipeline'))
    }
  }

  const isRunning = creating || (activeTaskId != null && (taskStatus === 'PROGRESS' || taskStatus === 'STARTED'))
  const estimatedBaseFeatures = useMemo(() => _estimateBaseFeatureCount(indicators), [indicators])
  const estimatedTotalFeatures = useMemo(
    () => estimatedBaseFeatures * (1 + lagList.length),
    [estimatedBaseFeatures, lagList.length],
  )

  const featureCategories  = selectedGeneratedFeatures.length > 0 ? categorizeFeatures(selectedGeneratedFeatures) : null

  const STATUS_FILTERS: { value: StatusFilter; label: string }[] = [
    { value: 'all', label: 'All' },
    { value: 'completed', label: 'Done' },
    { value: 'running', label: 'Running' },
    { value: 'failed', label: 'Failed' },
    { value: 'pending', label: 'Pending' },
  ]

  return (
    <>
      <LabPage
        title="Feature Factory"
        subtitle="Generate indicator columns from raw OHLCV — Technical, Statistical, Regime, Futures, Orderflow. Limit: 1,000 columns."
        action={
          <button onClick={openDrawer} className="btn-primary text-sm px-4 py-2" title="Tạo Pipeline Mới">
            + New Pipeline
          </button>
        }
        list={
          <div className="flex flex-col h-full">
            {/* Search + status filter */}
            <div className="p-3 space-y-2 border-b border-white/[0.06] shrink-0">
              <input
                className="input text-xs w-full"
                placeholder="Search pipeline name…" title="Tìm tên pipeline…"
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
              <div className="flex gap-1 flex-wrap">
                {STATUS_FILTERS.map(f => (
                  <button
                    key={f.value}
                    onClick={() => setStatusFilter(f.value)}
                    className={`text-[10px] px-2 py-0.5 rounded-full border transition-colors ${
                      statusFilter === f.value
                        ? 'bg-brand-500/30 text-brand-300 border-brand-500/40'
                        : 'text-zinc-500 border-white/[0.06] hover:text-zinc-300'
                    }`}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Pipeline list */}
            <div className="flex-1 overflow-y-auto p-2 space-y-1">
              {isLoading && <div className="text-xs text-zinc-600 px-2 py-3">Loading…</div>}
              {!isLoading && filteredPipelines.length === 0 && (
                <div className="text-xs text-zinc-600 px-2 py-3">
                  {pipelines.length === 0
                    ? 'No pipelines yet. Click "+ New Pipeline" to create one.'
                    : 'No matches.'}
                </div>
              )}
              {filteredPipelines.map(p => {
                const active = p.id === selected?.id
                const ds = datasets.find(d => d.id === p.dataset_id)
                const generatedCount = (p.feature_columns ?? []).filter((c) => !/^y_/i.test(c)).length
                return (
                  <button
                    key={p.id}
                    onClick={() => selectPipeline(p)}
                    className={`w-full text-left px-3 py-3 transition-all duration-150 border-l-2 rounded-r-lg ${
                      active ? 'border-l-brand-400 bg-white/[0.03]' : 'border-l-transparent hover:bg-white/[0.02]'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium text-zinc-100 truncate flex-1 tracking-tight">{p.name ?? 'Pipeline'}</span>
                      <StatusBadge status={p.status} />
                    </div>
                    <div className="text-[10px] text-zinc-500 mt-0.5 flex gap-2 flex-wrap">
                      {ds && <span className="text-brand-400 font-mono">{ds.symbol} {ds.timeframe}</span>}
                      <span>{generatedCount} generated</span>
                      <span>·</span>
                      <span>{new Date(p.created_at).toLocaleDateString()}</span>
                    </div>
                  </button>
                )
              })}
            </div>
          </div>
        }
        detail={
          <div className="space-y-5">
            {isRunning && (
              <div className="space-y-2">
                <GranularProgress
                  progress={taskProgress}
                  message={taskMessage}
                  step={taskStep}
                  sub={taskSub}
                  status={taskStatus}
                />
                {progressLog.length > 0 && (
                  <div className="bg-surface-card/40 border border-white/[0.07] rounded-lg p-3 max-h-48 overflow-y-auto text-xs text-zinc-300 mt-2">
                    <div className="font-bold text-zinc-400 mb-1">Progress Log</div>
                    <ul className="space-y-1">
                      {progressLog.map((entry, i) => (
                        <li key={i} className="flex gap-2 items-baseline">
                          <span className="text-zinc-500">{entry.progress}%</span>
                          <span>{entry.message}</span>
                          {entry.step && <span className="text-zinc-600 ml-2">[{entry.step}]</span>}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}

            {selected && (
              <>
                {/* Header */}
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <h2 className="text-2xl font-semibold text-zinc-50 tracking-tight">{selected.name ?? 'Pipeline'}</h2>
                    <div className="flex gap-3 mt-1 text-xs text-zinc-500 items-center flex-wrap">
                      <StatusBadge status={selected.status} />
                      {datasetForSelected && (
                        <span className="font-mono bg-surface px-2 py-0.5 rounded text-brand-400">
                          {datasetForSelected.symbol} {datasetForSelected.timeframe}
                        </span>
                      )}
                      <span>{selectedGeneratedFeatures.length} generated features</span>
                      <span>{new Date(selected.created_at).toLocaleString()}</span>
                    </div>
                    {selected.error_message && (
                      <div className="text-xs text-red-400 mt-2 p-2 bg-red-950/30 rounded border border-red-900">
                        {selected.error_message}
                      </div>
                    )}
                  </div>

                  <div className="flex gap-2 shrink-0 flex-wrap justify-end">
                    {selected.status === 'completed' && (
                      <button onClick={handleDownload} className="btn-ghost text-xs px-3 py-1.5">
                        ↓ Download
                      </button>
                    )}
                    {confirmDeleteId === selected.id ? (
                      <div className="flex gap-2 items-center">
                        <span className="text-xs text-zinc-400">Delete pipeline?</span>
                        <button
                          onClick={() => deleteMut.mutate(selected.id)}
                          disabled={deleteMut.isPending}
                          className="btn-danger text-xs px-3 py-1.5"
                        >
                          {deleteMut.isPending ? '…' : 'Confirm'}
                        </button>
                        <button
                          onClick={() => setConfirmDeleteId(null)}
                          className="btn-secondary text-xs px-3 py-1.5"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => setConfirmDeleteId(selected.id)}
                        className="btn-danger text-xs px-3 py-1.5"
                      >
                        Delete
                      </button>
                    )}
                  </div>
                </div>

                {/* Tabs */}
                {selected.status === 'completed' && (
                  <>
                    {/* Tabs */}
                    <div className="flex gap-0 border-b border-white/[0.06]">
                      {(['preview', 'features', 'quality', 'config'] as DetailTab[]).map(tab => (
                        <button
                          key={tab}
                          onClick={() => setActiveTab(tab)}
                          title={tab === 'preview' ? 'Xem Trước' : tab === 'features' ? 'Đặc Trưng' : tab === 'quality' ? 'Chất Lượng' : 'Cấu Hình'}
                          className={`px-4 py-2.5 text-sm transition-colors border-b-2 -mb-px ${
                            activeTab === tab
                              ? 'border-brand-400 text-zinc-100 font-medium'
                              : 'border-transparent text-zinc-500 hover:text-zinc-300 hover:border-white/[0.10]'
                          }`}
                        >
                          {tab.charAt(0).toUpperCase() + tab.slice(1)}
                        </button>
                      ))}
                    </div>

                    {/* Preview tab */}
                    {activeTab === 'preview' && (
                      <div className="space-y-3">
                        <div className="flex gap-2 items-center justify-between">
                          <div className="flex gap-4 text-xs text-zinc-500">
                            {preview && (
                              <>
                                <span><span className="text-zinc-300">{preview.row_count.toLocaleString()}</span> rows</span>
                                <span><span className="text-zinc-300">{preview.column_count}</span> columns</span>
                              </>
                            )}
                          </div>
                          <button
                            onClick={() => loadPreview(selected.id)}
                            className="text-xs text-zinc-500 hover:text-zinc-300"
                          >
                            ↺ Refresh
                          </button>
                        </div>
                        {previewLoading && <div className="text-xs text-zinc-600">Loading preview…</div>}
                        {preview && <PreviewTable columns={preview.columns} rows={preview.rows} />}
                      </div>
                    )}

                    {/* Features tab */}
                    {activeTab === 'features' && featureCategories && (
                      <div className="space-y-4">
                        <div className="text-xs text-zinc-500 space-y-1">
                          <div><span className="text-zinc-300">Generated feature columns:</span> {selectedGeneratedFeatures.length}</div>
                          {preview && (
                            <div><span className="text-zinc-300">Total columns in processed preview:</span> {preview.column_count}</div>
                          )}
                          <div className="text-zinc-600">Note: Preview includes base/enrichment columns and targets; Features lists generated feature columns only.</div>
                        </div>
                        {Object.entries(featureCategories).map(([cat, cols]) => cols.length > 0 && (
                          <div key={cat}>
                            <div className="text-xs font-medium text-zinc-400 mb-2">
                              {cat} <span className="text-zinc-600 font-normal">({cols.length})</span>
                            </div>
                            <div className="flex flex-wrap gap-1.5">
                              {cols.map(col => (
                                <span
                                  key={col}
                                  className={`text-[11px] font-mono px-2 py-0.5 rounded border ${CAT_COLORS[cat]}`}
                                >
                                  {col}
                                </span>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Config tab */}
                    {activeTab === 'config' && (
                      <div className="space-y-5">
                        {/* Feature generators */}
                        <div>
                          <div className="section-label mb-3" title="Các bộ tạo đặc trưng đã dùng">Feature Generators Used</div>
                          {(selected.indicators_config?.length ?? 0) === 0 ? (
                            <div className="text-xs text-zinc-600 italic">No config recorded (legacy pipeline)</div>
                          ) : (
                            <div className="space-y-2">
                              {selected.indicators_config!.map((ind, i) => (
                                <div key={i} className="flex items-center gap-3 p-2.5 rounded-lg border border-white/[0.06] bg-surface/50">
                                  <span className="font-mono text-sm text-brand-300 w-16">{String(ind.name)}</span>
                                  {Object.keys(ind.params_sweep as object || {}).length > 0 ? (
                                    <span className="text-[10px] px-1.5 py-0.5 rounded border border-indigo-500/40 text-indigo-400">sweep</span>
                                  ) : (
                                    <span className="text-[10px] px-1.5 py-0.5 rounded border border-zinc-600 text-zinc-500">fixed</span>
                                  )}
                                  <div className="text-xs text-zinc-500 font-mono">
                                    {Object.entries(ind.params as Record<string, unknown> || {}).map(([k, v]) => `${k}=${v}`).join(', ')}
                                    {Object.entries(ind.params_sweep as Record<string, unknown> || {}).map(([k, v]) => {
                                      const s = v as { min: number; max: number; step: number }
                                      return `${k}=[${s.min}..${s.max} step ${s.step}]`
                                    }).join(', ')}
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>

                        {/* Targets */}
                        <div>
                          <div className="section-label mb-3" title="Mục Tiêu">Targets</div>
                          {(selected.targets_config?.length ?? 0) === 0 ? (
                            <div className="text-xs text-zinc-600 italic">No config recorded (legacy pipeline)</div>
                          ) : (
                            <div className="space-y-2">
                              {selected.targets_config!.map((t, i) => (
                                <div key={i} className="flex items-center gap-3 p-2.5 rounded-lg border border-white/[0.06] bg-surface/50">
                                  <span className="font-mono text-sm text-emerald-300">{String(t.name)}</span>
                                  <span className={`text-[10px] px-1.5 py-0.5 rounded border ${t.method === 'triple_barrier' ? 'border-purple-500/40 text-purple-400' : 'border-blue-500/40 text-blue-400'}`}>
                                    {String(t.method)}
                                  </span>
                                  <div className="text-xs text-zinc-500 font-mono">
                                    {Object.entries(t.params as Record<string, unknown> || {}).map(([k, v]) => `${k}=${v}`).join(', ')}
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>

                        {/* Lags */}
                        <div>
                          <div className="text-xs font-semibold text-zinc-400 mb-2" title="Các Khoảng Trễ">Lag Periods</div>
                          {(selected.lags?.length ?? 0) === 0 ? (
                            <div className="text-xs text-zinc-600 italic">No lags recorded</div>
                          ) : (
                            <div className="flex gap-1.5 flex-wrap">
                              {selected.lags!.map(l => (
                                <span key={l} className="text-xs font-mono px-2 py-0.5 rounded border border-indigo-500/30 text-indigo-300 bg-indigo-500/10">
                                  lag {l}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    )}

                    {/* Quality tab */}
                    {activeTab === 'quality' && quality && (
                      <div className="space-y-4">
                        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
                          <div className="rounded-[14px] border border-white/[0.07] p-4" style={{ background: 'linear-gradient(145deg, #131e30 0%, #0e1724 100%)' }}>
                            <div className="section-label mb-2" title="Nến trùng lặp">Duplicate Candles</div>
                            <div className="text-3xl font-bold tabular-nums tracking-tight text-emerald-400">{quality.duplicateCandles.toLocaleString()}</div>
                            <div className="text-[11px] text-zinc-600 mt-1">same timestamp appears multiple times</div>
                          </div>
                          <div className="rounded-[14px] border border-white/[0.07] p-4" style={{ background: 'linear-gradient(145deg, #131e30 0%, #0e1724 100%)' }}>
                            <div className="section-label mb-2" title="Hàng lỗi">Corrupted Rows</div>
                            <div className={`text-3xl font-bold tabular-nums tracking-tight ${quality.corruptedRows > 0 ? 'text-red-400' : 'text-emerald-400'}`}>{quality.corruptedRows.toLocaleString()}</div>
                            <div className="text-[11px] text-zinc-600 mt-1">invalid OHLC / volume values</div>
                          </div>
                          <div className="rounded-[14px] border border-white/[0.07] p-4" style={{ background: 'linear-gradient(145deg, #131e30 0%, #0e1724 100%)' }}>
                            <div className="section-label mb-2" title="Biến động đột biến">Spikes</div>
                            <div className={`text-3xl font-bold tabular-nums tracking-tight ${quality.spikes > 0 ? 'text-amber-400' : 'text-emerald-400'}`}>{quality.spikes.toLocaleString()}</div>
                            <div className="text-[11px] text-zinc-600 mt-1">extreme returns outlier candles</div>
                          </div>
                          <div className="rounded-[14px] border border-white/[0.07] p-4" style={{ background: 'linear-gradient(145deg, #131e30 0%, #0e1724 100%)' }}>
                            <div className="section-label mb-2" title="Thiếu nến">Missing Candles</div>
                            <div className={`text-3xl font-bold tabular-nums tracking-tight ${quality.missingCandles > 0 ? 'text-red-400' : 'text-emerald-400'}`}>{quality.missingCandles.toLocaleString()}</div>
                            <div className="text-[11px] text-zinc-600 mt-1">expected bars not present</div>
                          </div>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
                          <div className="rounded-[14px] border border-white/[0.07] p-4" style={{ background: 'linear-gradient(145deg, #131e30 0%, #0e1724 100%)' }}>
                            <div className="section-label mb-2" title="Phân đoạn đứt gãy">Gap Segments</div>
                            <div className={`text-3xl font-bold tabular-nums tracking-tight ${quality.gapSegments > 0 ? 'text-amber-400' : 'text-emerald-400'}`}>{quality.gapSegments.toLocaleString()}</div>
                            <div className="text-[11px] text-zinc-600 mt-1">discontinuity segments in time</div>
                          </div>
                          <div className="rounded-[14px] border border-white/[0.07] p-4" style={{ background: 'linear-gradient(145deg, #131e30 0%, #0e1724 100%)' }}>
                            <div className="section-label mb-2" title="Ô dữ liệu trống (NaN)">NaN Cells</div>
                            <div className={`text-3xl font-bold tabular-nums tracking-tight ${quality.nullCells > 0 ? 'text-amber-400' : 'text-emerald-400'}`}>{quality.nullCells.toLocaleString()}</div>
                            <div className="text-[11px] text-zinc-600 mt-1">sum of null values across columns</div>
                          </div>
                          <div className="rounded-[14px] border border-white/[0.07] p-4" style={{ background: 'linear-gradient(145deg, #131e30 0%, #0e1724 100%)' }}>
                            <div className="section-label mb-2" title="Số hàng ước tính chứa NaN">Rows With NaN (Est.)</div>
                            <div className="text-3xl font-bold tabular-nums tracking-tight text-amber-400">{quality.nullRowsEstimate.toLocaleString()}</div>
                            <div className="text-[11px] text-zinc-600 mt-1">upper-bound estimate from null profile</div>
                          </div>
                          <div className="rounded-[14px] border border-white/[0.07] p-4" style={{ background: 'linear-gradient(145deg, #131e30 0%, #0e1724 100%)' }}>
                            <div className="section-label mb-2" title="Thiếu dữ liệu Funding">Missing Funding</div>
                            <div className={`text-3xl font-bold tabular-nums tracking-tight ${(quality.missingFunding ?? 0) > 0 ? 'text-amber-400' : 'text-emerald-400'}`}>{(quality.missingFunding ?? 0).toLocaleString()}</div>
                            <div className="text-[11px] text-zinc-600 mt-1">null count of funding_rate column</div>
                          </div>
                        </div>

                        <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
                          <div className="rounded-[14px] border border-white/[0.07] p-3" style={{ background: 'linear-gradient(145deg, #121a29 0%, #0d1420 100%)' }}>
                            <div className="section-label mb-2" title="Phân bổ lỗi">Issue Distribution</div>
                            <div className="h-72">
                              <ReactECharts option={issueOverviewOption(quality)} notMerge lazyUpdate style={{ height: '100%', width: '100%' }} />
                            </div>
                          </div>
                          <div className="rounded-[14px] border border-white/[0.07] p-3" style={{ background: 'linear-gradient(145deg, #121a29 0%, #0d1420 100%)' }}>
                            <div className="section-label mb-2" title="Dòng thời gian lỗi">Issue Timeline (sampled)</div>
                            <div className="h-72">
                              <ReactECharts option={issueTimelineOption(quality)} notMerge lazyUpdate style={{ height: '100%', width: '100%' }} />
                            </div>
                          </div>
                        </div>

                        <div className="rounded-[14px] border border-white/[0.07] p-3 text-xs text-zinc-500" style={{ background: 'linear-gradient(145deg, #121a29 0%, #0d1420 100%)' }}>
                          <div className="mb-1 text-zinc-600">Quality source: input dataset stats (not processed pipeline preview columns).</div>
                          <span className="text-zinc-300">Observed:</span> {quality.observedRows.toLocaleString()} rows
                          {' · '}
                          <span className="text-zinc-300">Expected:</span> {quality.expectedRows == null ? 'n/a' : quality.expectedRows.toLocaleString()}
                          {' · '}
                          <span className="text-zinc-300">Interval:</span> {quality.expectedIntervalSec == null ? 'n/a' : `${quality.expectedIntervalSec}s`}
                        </div>
                      </div>
                    )}
                  </>
                )}

                {/* Non-completed status message */}
                {(selected.status === 'pending' || selected.status === 'running') && (
                  <div className="text-xs text-zinc-500 p-3 rounded-lg border border-white/[0.06] bg-surface/30">
                    Pipeline is <span className="text-yellow-400">{selected.status}</span> — results will appear automatically when done.
                  </div>
                )}
              </>
            )}

            {!selected && !isRunning && (
              <EmptyState message="Create a pipeline from market intake, or select one from the list" />
            )}
          </div>
        }
      />

      {/* Slide-over drawer */}
      {drawerOpen && (
        <>
          <div className="fixed inset-0 z-40 bg-black/50" onClick={() => setDrawerOpen(false)} />
          <div className="fixed right-0 top-0 bottom-0 z-50 w-[440px] bg-surface-card border-l border-white/[0.06] overflow-y-auto p-6 space-y-5 shadow-2xl">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold text-zinc-100" title="Pipeline Đặc Trưng Mới">New Feature Pipeline</h2>
              <button onClick={() => setDrawerOpen(false)} className="text-zinc-500 hover:text-zinc-300 p-1.5 hover:bg-white/[0.06] rounded-lg transition-colors"><X className="w-4 h-4" /></button>
            </div>

            {/* Dataset */}
            <div>
              <label className="label" title="Tập dữ liệu đầu vào">Input Dataset</label>
              <select
                className="input text-sm"
                value={formDatasetId}
                onChange={e => setFormDatasetId(e.target.value)}
              >
                <option value="">-- select dataset --</option>
                {datasets.map(d => (
                  <option key={d.id} value={d.id}>
                    {d.symbol} {d.timeframe} ({Number(d.row_count ?? 0).toLocaleString()} rows)
                  </option>
                ))}
              </select>
            </div>

            {/* Name */}
            <div>
              <label className="label" title="Tên Pipeline (tuỳ chọn)">Pipeline Name <span className="text-zinc-600">(optional)</span></label>
              <input
                className="input text-sm"
                value={pipelineName}
                onChange={e => setPipelineName(e.target.value)}
                placeholder="Auto-generated if blank"
              />
            </div>

            {/* Indicators */}
            <div>
              <label className="label mb-2 block" title="Các Bộ Tạo Đặc Trưng">Feature Generators</label>
              <div className="text-[11px] text-zinc-500 mb-2" title="Hỗ trợ kỹ thuật, thống kê, regime, futures và orderflow. Các thông số futures/orderflow chỉ chạy khi có cột gốc tương ứng.">
                Technical, statistical, regime, futures, and orderflow generators. Futures/orderflow items run only when matching source columns exist.
              </div>
              <div className="space-y-1">
                {indicators.map(ind => (
                  <div
                    key={ind.name}
                    className={`flex items-start gap-3 p-2.5 rounded-lg border transition-colors ${
                      ind.enabled ? 'border-brand-500/30 bg-brand-500/5' : 'border-white/[0.06]'
                    }`}
                  >
                    <button
                      onClick={() => toggleInd(ind.name)}
                      className={`mt-0.5 w-4 h-4 rounded border-2 flex items-center justify-center shrink-0 ${
                        ind.enabled ? 'bg-brand-500 border-brand-500' : 'border-zinc-600'
                      }`}
                    >
                      {ind.enabled && <span className="text-white text-[9px]">✓</span>}
                    </button>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-mono text-zinc-300 w-16">{ind.name}</span>
                        <span className="text-xs text-zinc-500">{ind.label}</span>
                        {ind.enabled && (
                          <button
                            onClick={() => setIndicators(prev => prev.map(i => i.name === ind.name ? { ...i, useSweep: !i.useSweep } : i))}
                            className={`ml-auto text-[10px] px-2 py-0.5 rounded border ${
                              ind.useSweep
                                ? 'border-indigo-500/40 text-indigo-400 bg-indigo-500/10'
                                : 'border-white/[0.06] text-zinc-500'
                            }`}
                          >
                            {ind.useSweep ? '⟳ sweep' : '= fixed'}
                          </button>
                        )}
                      </div>
                      {ind.enabled && (
                        <>
                          <div className="text-[10px] text-zinc-600 mt-0.5" title={ind.description_vi}>{ind.description}</div>
                          <div className="text-[10px] text-zinc-500 mt-1">
                            ~{(ind.useSweep ? _comboCountFromSweep(ind.params_sweep) : 1) * _indicatorColumnMultiplier(ind.name)}
                            {' '}feature cols from {ind.name.toUpperCase()}
                          </div>
                        </>
                      )}

                      {ind.enabled && (
                        <div className="mt-2 space-y-2">
                          {ind.useSweep ? (
                            <div className="space-y-2">
                              {Object.entries(ind.params_sweep).map(([param, sweep]) => (
                                <div key={param} className="rounded border border-white/[0.06] p-2">
                                  <div className="text-[10px] text-zinc-400 uppercase mb-1">{param}</div>
                                  <div className="grid grid-cols-3 gap-2">
                                    {(['min', 'max', 'step'] as const).map(field => (
                                      <div key={field}>
                                        <label className="text-[10px] text-zinc-600">{field}</label>
                                        <input
                                          type="number"
                                          step={field === 'step' ? '0.1' : '1'}
                                          value={sweep[field]}
                                          onChange={e => updateIndSweep(ind.name, param, field, Number(e.target.value))}
                                          className="input text-xs h-8"
                                        />
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <div className="grid grid-cols-3 gap-2">
                              {Object.entries(ind.params).map(([param, value]) => (
                                <div key={param}>
                                  <label className="text-[10px] text-zinc-600 uppercase">{param}</label>
                                  <input
                                    type="number"
                                    step="0.1"
                                    value={value}
                                    onChange={e => updateIndParam(ind.name, param, Number(e.target.value))}
                                    className="input text-xs h-8"
                                  />
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Estimated feature count + server preflight summary */}
            <div className="rounded-lg border border-brand-500/20 bg-brand-500/10 px-3 py-2 space-y-2">
              <div>
                <div className="text-xs text-zinc-300" title="Ước tính số lượng cột đặc trưng">Estimated feature columns (local)</div>
                <div className="text-sm text-brand-300 font-semibold">
                  {estimatedTotalFeatures.toLocaleString()} total
                  <span className="text-zinc-500 font-normal"> ({estimatedBaseFeatures.toLocaleString()} base + {(estimatedBaseFeatures * lagList.length).toLocaleString()} lags)</span>
                </div>
              </div>

              <div className="border-t border-white/[0.06] pt-2">
                <div className="text-xs text-zinc-300" title="Kiểm tra tiền trạm từ Server">Server preflight</div>
                {preflightLoading && (
                  <div className="text-[11px] text-zinc-500 mt-1">Checking resource estimate…</div>
                )}
                {!preflightLoading && preflight && (
                  <div className="space-y-1 text-[11px] text-zinc-400 mt-1">
                    <div>
                      <span className="text-zinc-300">Rows:</span> {preflight.row_count?.toLocaleString() ?? 'unknown'}
                      {' · '}
                      <span className={preflight.over_columns ? 'text-red-400 font-semibold' : 'text-zinc-300'}>Cols:</span>
                      {' '}
                      <span className={preflight.over_columns ? 'text-red-400 font-semibold' : ''}>
                        {preflight.total_feature_columns.toLocaleString()}
                      </span>
                      <span className="text-zinc-600"> / {preflight.column_limit.toLocaleString()} limit</span>
                    </div>
                    <div>
                      <span className="text-zinc-300">Working set:</span>
                      {' '}
                      <span className={preflight.over_bytes ? 'text-red-400 font-semibold' : ''}>
                        {formatBytes(preflight.estimated_bytes)}
                      </span>
                      <span className="text-zinc-600"> / {formatBytes(preflight.estimated_bytes_limit)}</span>
                    </div>
                    <div className={preflight.accepted ? 'text-emerald-400' : 'text-red-400'}>
                      {preflight.accepted ? '✓ Preflight passed' : `✗ Rejected: ${preflight.message ?? 'over limits'}`}
                    </div>
                  </div>
                )}
                {!preflightLoading && preflightError && (
                  <div className="text-[11px] text-amber-400 mt-1">
                    Could not fetch preflight preview. Submission is still validated server-side.
                  </div>
                )}
              </div>
            </div>

            {/* Lags */}
            <div>
              <label className="label" title="Khoảng Trễ (cách nhau dấu phẩy)">Lag Periods <span className="text-zinc-600">(comma-separated, 1–200)</span></label>
              <input
                className="input text-sm font-mono"
                value={lags}
                onChange={e => setLags(e.target.value)}
                placeholder="1,2,3"
              />
              {lagList.length > 0 && (
                <div className="flex gap-1 mt-1.5 flex-wrap">
                  {lagList.map(l => (
                    <span key={l} className="text-[10px] font-mono px-1.5 py-0.5 rounded border border-indigo-500/30 text-indigo-400">
                      lag {l}
                    </span>
                  ))}
                </div>
              )}
            </div>

            {createError && <p className="text-xs text-red-400">{createError}</p>}

            <button
              onClick={handleCreate}
              disabled={creating || !formDatasetId || Boolean(preflight && !preflight.accepted)}
              className="btn-primary w-full text-sm disabled:opacity-50"
            >
              {creating ? 'Generating…' : 'Generate Pipeline'}
            </button>
          </div>
        </>
      )}
    </>
  )
}

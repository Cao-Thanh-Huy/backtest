'use client'

import dynamic from 'next/dynamic'
import { useEffect, useRef, useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  listDatasets, fetchMarketData, previewDataset,
  getDatasetStats, getDatasetChartData, getDatasetDownloadUrl,
  deleteDataset, connectTaskWS, getTaskStatus,
} from '@/lib/api'
import type { TaskProgress } from '@/lib/api'
import { useAppStore } from '@/store/appStore'
import type { Dataset } from '@/store/appStore'
import { LabPage, PreviewTable, TaskBar, EmptyState } from '@/components/ui/LabPage'
import { OHLCVChart } from '@/components/charts/OHLCVChart'
import type { ChartBar } from '@/components/charts/OHLCVChart'
import { toast } from 'sonner'
import { getApiErrorMessage } from '@/lib/api-error'
import {
  ClipboardList, X, Download, Trash2, RefreshCw, Bitcoin,
  CheckCircle2, AlertTriangle, ChevronDown, ChevronUp, Zap,
  AlertCircle, Database, Activity,
} from 'lucide-react'

const ReactECharts = dynamic(() => import('echarts-for-react'), { ssr: false })

// ─── Constants ────────────────────────────────────────────────────────────────

const TIMEFRAMES = ['5m', '15m', '30m', '1h', '2h', '4h', '6h', '12h', '1d']

type EnrichGroup = { label: string; label_vi?: string; items: { id: string; label: string; desc: string; label_vi?: string; desc_vi?: string }[] }

const ENRICH_GROUPS: EnrichGroup[] = [
  {
    label: 'Technical Indicators (Free)', label_vi: 'Chỉ Báo Kỹ Thuật (Miễn Phí)',
    items: [
      { id: 'log_return', label: 'Log Return', label_vi: 'Log Return', desc: 'Natural log of price change, standardized for ML', desc_vi: 'Log tự nhiên biến động giá, chuẩn hoá cho ML' },
      { id: 'atr', label: 'ATR (14)', label_vi: 'ATR (14)', desc: 'Average true range, volatility measure', desc_vi: 'Biên độ dao động trung bình, đo lường biến động' },
      { id: 'realized_volatility', label: 'Realized Vol (24h)', label_vi: 'Realized Vol (24h)', desc: 'Log return rolling std, actual volatility', desc_vi: 'Độ lệch chuẩn log return rolling, biến động thực tế' },
      { id: 'rolling_std', label: 'Rolling Std (24h)', label_vi: 'Rolling Std (24h)', desc: 'Price return std, regime volatility', desc_vi: 'Độ lệch chuẩn return giá, biến động theo chế độ' },
      { id: 'rsi_14', label: 'RSI (14)', label_vi: 'RSI (14)', desc: 'Relative strength index, momentum', desc_vi: 'Chỉ số sức mạnh tương đối, động lượng' },
      { id: 'ema_12', label: 'EMA (12)', label_vi: 'EMA (12)', desc: 'Fast exponential moving average', desc_vi: 'Đường trung bình động hàm mũ nhanh' },
      { id: 'ema_26', label: 'EMA (26)', label_vi: 'EMA (26)', desc: 'Slow exponential moving average', desc_vi: 'Đường trung bình động hàm mũ chậm' },
      { id: 'ema_spread', label: 'EMA Spread', label_vi: 'EMA Spread', desc: 'MACD-like, trend signal', desc_vi: 'Tương tự MACD, tín hiệu xu hướng' },
    ],
  },
  {
    label: 'Time Features (Free)', label_vi: 'Đặc Trưng Thời Gian (Miễn Phí)',
    items: [
      { id: 'hour_of_day', label: 'Hour of Day', label_vi: 'Giờ Trong Ngày', desc: 'Trading session: UTC 0-23', desc_vi: 'Phiên giao dịch: UTC 0-23' },
      { id: 'day_of_week', label: 'Day of Week', label_vi: 'Ngày Trong Tuần', desc: 'Weekday effect: Mon(0) - Sun(6)', desc_vi: 'Hiệu ứng ngày trong tuần: T2(0) - CN(6)' },
    ],
  },
  {
    label: 'Futures & Derivatives', label_vi: 'Hợp Đồng Tương Lai & Phái Sinh',
    items: [
      { id: 'funding_rate', label: 'Funding Rate', label_vi: 'Funding Rate', desc: 'Perpetual premium/discount vs spot', desc_vi: 'Phần bù/chiết khấu hợp đồng vĩnh cửu so với spot' },
      { id: 'funding_change', label: 'Funding Change', label_vi: 'Biến Động Funding', desc: 'Sentiment shift in derivative market', desc_vi: 'Thay đổi tâm lý thị trường phái sinh' },
      { id: 'open_interest', label: 'Open Interest', label_vi: 'Open Interest', desc: 'Total open futures contracts', desc_vi: 'Tổng số hợp đồng tương lai đang mở' },
      { id: 'oi_change', label: 'OI Change', label_vi: 'Biến Động OI', desc: 'Leverage building/unwinding', desc_vi: 'Tích lũy/giải phóng đòn bẩy' },
      { id: 'long_short_ratio', label: 'Long/Short Ratio', label_vi: 'Tỷ Lệ Long/Short', desc: 'Aggregated trader positioning', desc_vi: 'Vị thế tổng hợp của nhà giao dịch' },
      { id: 'liquidations', label: 'Liquidations', label_vi: 'Thanh Lý Cưỡng Bức', desc: 'Forced close volume pressure', desc_vi: 'Áp lực khối lượng từ lệnh đóng cưỡng bức' },
      { id: 'basis', label: 'Futures Basis', label_vi: 'Futures Basis', desc: 'Spot-futures spread signal', desc_vi: 'Tín hiệu chênh lệch spot-futures' },
    ],
  },
  {
    label: 'Market Sentiment', label_vi: 'Tâm Lý Thị Trường',
    items: [
      { id: 'fear_greed', label: 'Fear & Greed Index', label_vi: 'Chỉ Số Fear & Greed', desc: 'Composite sentiment 0-100', desc_vi: 'Tâm lý tổng hợp 0-100' },
      { id: 'google_trends', label: 'Google Trends', label_vi: 'Google Trends', desc: 'Bitcoin search volume', desc_vi: 'Khối lượng tìm kiếm Bitcoin' },
      { id: 'social_volume', label: 'Social Volume', label_vi: 'Khối Lượng Mạng Xã Hội', desc: 'Social media mentions', desc_vi: 'Lượt đề cập trên mạng xã hội' },
    ],
  },
  {
    label: 'On-chain Metrics', label_vi: 'Chỉ Số On-chain',
    items: [
      { id: 'mvrv', label: 'MVRV Z-Score', label_vi: 'MVRV Z-Score', desc: 'Market vs realised value divergence', desc_vi: 'Phân kỳ giá trị thị trường vs giá trị thực hoá' },
      { id: 'sopr', label: 'SOPR', label_vi: 'SOPR', desc: 'Spent output profit ratio', desc_vi: 'Tỷ lệ lợi nhuận đầu ra đã chi' },
      { id: 'exchange_flows', label: 'Exchange Net Flow', label_vi: 'Dòng Tiền Ròng Sàn', desc: 'BTC in/outflow to exchanges', desc_vi: 'Luồng BTC vào/ra các sàn giao dịch' },
      { id: 'active_addresses', label: 'Active Addresses', label_vi: 'Địa Chỉ Hoạt Động', desc: 'Daily unique addresses', desc_vi: 'Số địa chỉ duy nhất hàng ngày' },
      { id: 'nvt', label: 'NVT Ratio', label_vi: 'NVT Ratio', desc: 'Network value to transactions', desc_vi: 'Giá trị mạng lưới so với giao dịch' },
      { id: 'puell_multiple', label: 'Puell Multiple', label_vi: 'Puell Multiple', desc: 'Miner revenue multiple', desc_vi: 'Bội số doanh thu thợ đào' },
      { id: 'hash_rate', label: 'Hash Rate', label_vi: 'Hash Rate', desc: 'Network difficulty proxy', desc_vi: 'Đại diện độ khó mạng lưới' },
      { id: 'realized_price', label: 'Realized Price', label_vi: 'Realized Price', desc: 'All-time cost basis', desc_vi: 'Giá vốn trung bình toàn thời gian' },
    ],
  },
  {
    label: 'Macro / Risk', label_vi: 'Vĩ Mô / Rủi Ro',
    items: [
      { id: 'dxy', label: 'DXY (Dollar Index)', label_vi: 'DXY (Chỉ Số Đô La)', desc: 'USD strength vs major currencies', desc_vi: 'Sức mạnh USD so với các đồng tiền chính' },
      { id: 'sp500', label: 'S&P 500', label_vi: 'S&P 500', desc: 'Equity risk-on correlation proxy', desc_vi: 'Đại diện tương quan rủi ro cổ phiếu' },
      { id: 'gold', label: 'Gold (XAU/USD)', label_vi: 'Gold (XAU/USD)', desc: 'Safe-haven asset correlation', desc_vi: 'Tương quan tài sản trú ẩn an toàn' },
      { id: 'vix', label: 'VIX', label_vi: 'VIX', desc: 'Equity volatility / fear gauge', desc_vi: 'Biến động cổ phiếu / thước đo sợ hãi' },
      { id: 'us10y', label: 'US 10Y Yield', label_vi: 'US 10Y Yield', desc: 'Risk-free rate signal', desc_vi: 'Tín hiệu lãi suất phi rủi ro' },
    ],
  },
]

const DEFAULT_ENRICHMENTS = ENRICH_GROUPS.flatMap((group) => group.items.map((item) => item.id))

// ─── Types ────────────────────────────────────────────────────────────────────

interface PreviewData {
  row_count: number
  column_count: number
  columns: { name: string; type: string }[]
  rows: Record<string, unknown>[]
}

interface DatasetStats {
  row_count: number
  column_count: number
  null_counts: Record<string, number>
  price_range: { min: number; max: number } | null
  volume_avg: number | null
  coverage_pct: number
  gap_count: number
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
    observed_unique_timestamps: number | null
    expected_rows: number | null
  }
}

type DetailTab = 'chart' | 'preview' | 'stats' | 'quality'

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

// ─── Helpers ──────────────────────────────────────────────────────────────────

function StatCard({ label, value, sub, color, title }: {
  title?: string
  label: string; value: string; sub?: string
  color?: 'green' | 'yellow' | 'red'
}) {
  const vc = color === 'green' ? 'text-emerald-400' : color === 'yellow' ? 'text-amber-400' : color === 'red' ? 'text-red-400' : 'text-white'
  return (
    <div className="rounded-[14px] border border-white/[0.07] p-4" style={{ background: 'linear-gradient(145deg, #131e30 0%, #0e1724 100%)' }} title={title}>
      <div className="section-label mb-2">{label}</div>
      <div className={"text-2xl font-bold tabular-nums tracking-tight " + vc}>{value}</div>
      {sub && <div className="text-[11px] text-zinc-600 mt-1">{sub}</div>}
    </div>
  )
}

function nullCoverageOption(stats: DatasetStats) {
  const entries = Object.entries(stats.null_counts).slice(0, 24)
  return {
    backgroundColor: 'transparent',
    tooltip: {
      trigger: 'axis',
      formatter: (p: { name: string; value: number }[]) =>
        `${p[0].name}<br/>${p[0].value}% null`,
    },
    grid: { top: 8, bottom: 40, left: 8, right: 8, containLabel: true },
    xAxis: {
      type: 'category',
      data: entries.map(([k]) => k),
      axisLabel: { color: '#52525b', fontSize: 9, rotate: 40, interval: 0 },
      axisLine: { lineStyle: { color: 'rgba(255,255,255,0.06)' } },
    },
    yAxis: {
      type: 'value', min: 0, max: 100,
      axisLabel: { color: '#52525b', fontSize: 9, formatter: '{value}%' },
      splitLine: { lineStyle: { color: 'rgba(255,255,255,0.04)' } },
    },
    series: [{
      type: 'bar', barMaxWidth: 22,
      data: entries.map(([, v]) => {
        const pct = Math.round((v / stats.row_count) * 100)
        return {
          value: pct,
          itemStyle: {
            color: pct === 0 ? '#22c55e' : pct < 5 ? '#06b6d4' : pct < 20 ? '#f59e0b' : '#ef4444',
            borderRadius: [3, 3, 0, 0],
          },
        }
      }),
    }],
  }
}

function columnTypePieOption(columns: { name: string; type: string }[]) {
  const counts: Record<string, number> = {}
  for (const col of columns) {
    const t = col.type.toLowerCase().includes('float') || col.type.toLowerCase().includes('int') ? 'Numeric'
      : col.type.toLowerCase().includes('date') || col.type.toLowerCase().includes('time') ? 'Datetime'
      : col.type.toLowerCase().includes('bool') ? 'Boolean'
      : 'Other'
    counts[t] = (counts[t] ?? 0) + 1
  }
  const COLORS: Record<string, string> = { Numeric: '#06b6d4', Datetime: '#8b5cf6', Boolean: '#f59e0b', Other: '#3f3f46' }
  return {
    backgroundColor: 'transparent',
    tooltip: { trigger: 'item', formatter: '{b}: {c} cols ({d}%)' },
    legend: { orient: 'vertical', right: 0, top: 'center', textStyle: { color: '#71717a', fontSize: 10 } },
    series: [{
      type: 'pie', radius: ['48%', '72%'], center: ['42%', '50%'],
      label: { show: false },
      data: Object.entries(counts).map(([name, value]) => ({ name, value, itemStyle: { color: COLORS[name] } })),
    }],
  }
}

function timeframeToSeconds(tf?: string | null): number | null {
  if (!tf) return null
  const m = tf.match(/^(\d+)([mhdw])$/i)
  if (!m) return null
  const n = Number(m[1])
  const u = m[2].toLowerCase()
  if (!Number.isFinite(n) || n <= 0) return null
  if (u === 'm') return n * 60
  if (u === 'h') return n * 3600
  if (u === 'd') return n * 86400
  if (u === 'w') return n * 7 * 86400
  return null
}

function computeQualityInsights(
  timeframe: string | null | undefined,
  chartData: ChartBar[] | null,
  stats: DatasetStats | null,
): QualityInsights | null {
  if (!stats) return null

  // Source of truth comes from backend full-dataset stats (timeframe-aware, no chart downsampling bias).
  if (stats.quality) {
    const timeline: { time: number; type: string }[] = []
    if (chartData && chartData.length > 1) {
      const sortedChart = [...chartData].sort((a, b) => Number(a.time) - Number(b.time))
      const expected = stats.quality.expected_interval_sec ?? timeframeToSeconds(timeframe)
      if (expected != null) {
        for (let i = 1; i < sortedChart.length; i += 1) {
          const dt = Number(sortedChart[i].time) - Number(sortedChart[i - 1].time)
          if (dt > expected * 1.5) timeline.push({ time: Number(sortedChart[i].time), type: 'gap' })
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

  // Backward-compatible fallback for old backend responses.
  if (!chartData || chartData.length === 0) return null

  const sorted = [...chartData].sort((a, b) => Number(a.time) - Number(b.time))
  const expected = timeframeToSeconds(timeframe)
  const timeCounts = new Map<number, number>()
  const issueTimeline: { time: number; type: string }[] = []
  let corruptedRows = 0
  let spikes = 0

  const closeRets: number[] = []
  for (let i = 1; i < sorted.length; i += 1) {
    const prev = Number(sorted[i - 1].close)
    const curr = Number(sorted[i].close)
    if (Number.isFinite(prev) && Number.isFinite(curr) && prev > 0) {
      closeRets.push(Math.abs(curr / prev - 1))
    }
  }
  const meanRet = closeRets.length ? closeRets.reduce((a, b) => a + b, 0) / closeRets.length : 0
  const stdRet = closeRets.length
    ? Math.sqrt(closeRets.reduce((acc, v) => acc + (v - meanRet) ** 2, 0) / closeRets.length)
    : 0
  const spikeThreshold = Math.max(0.15, meanRet + 4 * stdRet)

  for (let i = 0; i < sorted.length; i += 1) {
    const r = sorted[i]
    const t = Number(r.time)
    timeCounts.set(t, (timeCounts.get(t) ?? 0) + 1)

    const o = Number(r.open)
    const h = Number(r.high)
    const l = Number(r.low)
    const c = Number(r.close)
    const v = Number(r.volume ?? 0)

    const finite = [o, h, l, c, v].every((x) => Number.isFinite(x))
    const invalidOhlc = !finite || h < l || o < l || o > h || c < l || c > h || v < 0
    if (invalidOhlc) {
      corruptedRows += 1
      issueTimeline.push({ time: t, type: 'corrupted' })
    }

    if (i > 0) {
      const prev = Number(sorted[i - 1].close)
      const ret = prev > 0 && Number.isFinite(prev) && Number.isFinite(c) ? Math.abs(c / prev - 1) : 0
      if (ret > spikeThreshold) {
        spikes += 1
        issueTimeline.push({ time: t, type: 'spike' })
      }
    }
  }

  let duplicateCandles = 0
  for (const cnt of timeCounts.values()) {
    if (cnt > 1) duplicateCandles += cnt - 1
  }

  let gapSegments = 0
  let missingCandles = 0
  if (expected != null) {
    for (let i = 1; i < sorted.length; i += 1) {
      const dt = Number(sorted[i].time) - Number(sorted[i - 1].time)
      if (dt > expected * 1.5) {
        gapSegments += 1
        const missing = Math.max(Math.round(dt / expected) - 1, 0)
        missingCandles += missing
        issueTimeline.push({ time: Number(sorted[i].time), type: 'gap' })
      }
    }
  }

  const observedRows = sorted.length
  const expectedRows = expected != null
    ? Math.max(Math.floor((Number(sorted[sorted.length - 1].time) - Number(sorted[0].time)) / expected) + 1, 0)
    : null

  const nullCells = Object.values(stats.null_counts).reduce((a, b) => a + Number(b || 0), 0)
  const maxNullPerRow = Math.max(...Object.values(stats.null_counts).map((n) => Number(n || 0)), 0)
  const nullRowsEstimate = Math.min(stats.row_count, maxNullPerRow)

  let missingFunding: number | null = null
  const fundingCol = Object.keys(stats.null_counts).find((k) => k.toLowerCase() === 'funding_rate')
  if (fundingCol) missingFunding = Number(stats.null_counts[fundingCol] || 0)

  return {
    duplicateCandles,
    missingCandles,
    gapSegments,
    corruptedRows,
    spikes,
    nullCells,
    nullRowsEstimate,
    missingFunding,
    expectedIntervalSec: expected,
    observedRows,
    expectedRows,
    issueTimeline,
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
      axisLabel: { color: '#71717a', fontSize: 9 },
      axisLine: { lineStyle: { color: 'rgba(255,255,255,0.06)' } },
    },
    yAxis: { type: 'value', show: false },
    series: [{
      type: 'scatter',
      symbolSize: 9,
      data: points,
      itemStyle: {
        color: (p: { value: [number, number, string] }) => {
          const t = p.value[2]
          if (t === 'corrupted') return '#ef4444'
          if (t === 'gap') return '#f59e0b'
          return '#8b5cf6'
        },
      },
    }],
  }
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function BTCIntakePage() {
  const qc = useQueryClient()
  const {
    activeDatasetId, setActiveDataset,
    setTaskProgress, taskProgress, taskMessage, taskStatus, activeTaskId,
    clearTask,
  } = useAppStore()

  const { data: datasets = [], isLoading } = useQuery<Dataset[]>({
    queryKey: ['datasets'],
    queryFn: () => listDatasets().then((r) => r.data),
    refetchInterval: false,
  })

  const marketDatasets = useMemo(() => datasets, [datasets])

  const [search, setSearch] = useState('')
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [activeTab, setActiveTab] = useState<DetailTab>('chart')
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)

  // Fetch form
  const [symbol, setSymbol] = useState('BTCUSDT')
  const [timeframe, setTimeframe] = useState('1h')
  const [dateFrom, setDateFrom] = useState('2022-01-01')
  const [dateTo, setDateTo] = useState(new Date().toISOString().slice(0, 10))
  const [enrichments, setEnrichments] = useState<string[]>(DEFAULT_ENRICHMENTS)
  const [fetching, setFetching] = useState(false)
  const [fetchError, setFetchError] = useState<string | null>(null)
  const [expandedGroup, setExpandedGroup] = useState<string | null>('Futures & Derivatives')

  // Detail panel
  const [preview, setPreview] = useState<PreviewData | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [chartData, setChartData] = useState<ChartBar[] | null>(null)
  const [chartLoading, setChartLoading] = useState(false)
  const [stats, setStats] = useState<DatasetStats | null>(null)
  const [statsLoading, setStatsLoading] = useState(false)

  const wsRef = useRef<WebSocket | null>(null)
  const dismissFnRef = useRef<(() => void) | null>(null)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      wsRef.current?.close()
      dismissFnRef.current?.()
    }
  }, [])

  const filteredDatasets = useMemo(() => {
    if (!search.trim()) return marketDatasets
    const q = search.trim().toLowerCase()
    return marketDatasets.filter(d =>
      d.symbol.toLowerCase().includes(q) || d.timeframe?.toLowerCase().includes(q)
    )
  }, [marketDatasets, search])

  const selected = marketDatasets.find(d => d.id === activeDatasetId) ?? marketDatasets[0] ?? null

  useEffect(() => {
    if (!selected) return
    setPreview(null); setChartData(null); setStats(null)
    loadPreview(selected.id)
    loadChart(selected.id)
    loadStats(selected.id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.id])

  async function loadPreview(id: string) {
    setPreviewLoading(true)
    try { setPreview((await previewDataset(id, 200)).data) }
    catch (e) { toast.error(getApiErrorMessage(e, 'Preview failed')) }
    finally { setPreviewLoading(false) }
  }

  async function loadChart(id: string) {
    setChartLoading(true)
    try { setChartData((await getDatasetChartData(id)).data) }
    catch (e) { toast.error(getApiErrorMessage(e, 'Chart failed')) }
    finally { setChartLoading(false) }
  }

  async function loadStats(id: string) {
    setStatsLoading(true)
    try { setStats((await getDatasetStats(id)).data) }
    catch (e) { toast.error(getApiErrorMessage(e, 'Stats failed')) }
    finally { setStatsLoading(false) }
  }

  function selectDataset(d: Dataset) {
    setActiveDataset(d.id)
    setConfirmDeleteId(null)
  }

  async function handleDownload() {
    if (!selected) return
    try { window.open((await getDatasetDownloadUrl(selected.id)).data.url, '_blank') }
    catch (e) { toast.error(getApiErrorMessage(e, 'Download failed')) }
  }

  const deleteMut = useMutation({
    mutationFn: (id: string) => deleteDataset(id),
    onSuccess: (_, id) => {
      qc.invalidateQueries({ queryKey: ['datasets'] })
      if (activeDatasetId === id) setActiveDataset(null)
      setPreview(null); setChartData(null); setStats(null)
      setConfirmDeleteId(null)
      toast.success('Dataset deleted')
    },
    onError: (e) => toast.error(getApiErrorMessage(e, 'Delete failed')),
  })

  function monitorTaskProgress(
    task_id: string,
    onSuccess: (dataset_id: string) => void,
    onFailure: (errorMsg: string) => void,
    onCleanup: () => void,
  ) {
    let isFinished = false
    let pollInterval: any = null

    const stopMonitoring = () => {
      isFinished = true
      if (pollInterval) {
        clearInterval(pollInterval)
        pollInterval = null
      }
      wsRef.current?.close()
      onCleanup()
    }

    const handleSuccess = (datasetId: string) => {
      if (isFinished) return
      onSuccess(datasetId)
      stopMonitoring()
    }

    const handleFailure = (error: string) => {
      if (isFinished) return
      onFailure(error)
      stopMonitoring()
    }

    // Connect WebSocket
    wsRef.current?.close()
    wsRef.current = connectTaskWS(
      task_id,
      (data: TaskProgress) => {
        if (!mountedRef.current || isFinished) return
        setTaskProgress(data.task_id, data.progress, data.message, data.status, data.step, data.sub as Record<string, unknown>)
        if (data.status === 'SUCCESS' && data.result) {
          const result = data.result as { dataset_id: string }
          handleSuccess(result.dataset_id)
        } else if (data.status === 'FAILURE') {
          handleFailure(data.error || 'Task failed')
        }
      },
      undefined,
      {
        onError: (msg) => {
          if (isFinished) return
          console.warn('WS Error, falling back to HTTP Polling:', msg)
          startPolling()
        }
      }
    )

    const startPolling = () => {
      if (pollInterval || isFinished) return
      wsRef.current?.close() // Close WS if we fallback to polling
      
      pollInterval = setInterval(async () => {
        if (isFinished) return
        try {
          const response = await getTaskStatus(task_id)
          const data = response.data
          if (!mountedRef.current || isFinished) return

          setTaskProgress(data.task_id, data.progress, data.message, data.status, data.step, data.sub as Record<string, unknown>)
          
          if (data.status === 'SUCCESS' && data.result) {
            const result = data.result as { dataset_id: string }
            handleSuccess(result.dataset_id)
          } else if (data.status === 'FAILURE') {
            handleFailure(data.error || 'Task failed')
          }
        } catch (err) {
          console.error('Polling error:', err)
        }
      }, 2000)
    }

    return stopMonitoring
  }

  async function handleFetch() {
    if (!symbol.trim()) { setFetchError('Please enter a Symbol'); return }
    if (dateFrom >= dateTo) { setFetchError('"From" must be before "To"'); return }
    setFetchError(null); setFetching(true)
    try {
      const res = await fetchMarketData({
        source: 'binance',
        symbol,
        timeframe,
        date_from: dateFrom,
        date_to: dateTo,
        enrich_columns: enrichments,
      })
      const { task_id } = res.data
      setTaskProgress(task_id, 5, 'Starting market data fetch...', 'PROGRESS', 'Fetching')
      setDrawerOpen(false)

      const dismissProgress = monitorTaskProgress(
        task_id,
        (dataset_id) => {
          setActiveDataset(dataset_id)
          qc.invalidateQueries({ queryKey: ['datasets'] })
          toast.success('Fetched ' + symbol + ' ' + timeframe)
        },
        (errorMsg) => {
          toast.error(errorMsg || 'Fetch failed')
        },
        () => {
          setFetching(false)
        }
      )

      dismissFnRef.current = dismissProgress
    } catch (e) {
      setFetchError(getApiErrorMessage(e, 'Fetch failed'))
      setFetching(false)
    }
  }

  async function handleFetchSample() {
    setFetching(true)
    setFetchError(null)
    
    const now = new Date()
    const oneMonthAgo = new Date(now.getFullYear(), now.getMonth() - 1, now.getDate())
    const dateFromStr = oneMonthAgo.toISOString().slice(0, 10)
    const dateToStr = now.toISOString().slice(0, 10)

    try {
      const res = await fetchMarketData({
        source: 'binance',
        symbol: 'BTCUSDT',
        timeframe: '1m',
        date_from: dateFromStr,
        date_to: dateToStr,
        enrich_columns: DEFAULT_ENRICHMENTS,
      })
      const { task_id } = res.data
      setTaskProgress(task_id, 5, 'Starting sample data fetch...', 'PROGRESS', 'Fetching')

      const dismissProgress = monitorTaskProgress(
        task_id,
        (dataset_id) => {
          setActiveDataset(dataset_id)
          qc.invalidateQueries({ queryKey: ['datasets'] })
          toast.success('Sample data loaded!')
        },
        (errorMsg) => {
          toast.error(errorMsg || 'Fetch sample failed')
        },
        () => {
          setFetching(false)
        }
      )

      dismissFnRef.current = dismissProgress
    } catch (e) {
      toast.error(getApiErrorMessage(e, 'Fetch sample failed'))
      setFetching(false)
    }
  }

  function toggleEnrich(id: string) {
    setEnrichments(curr => curr.includes(id) ? curr.filter(e => e !== id) : [...curr, id])
  }

  const isFetching = fetching || (activeTaskId != null && (taskStatus === 'PROGRESS' || taskStatus === 'STARTED'))
  const quality = useMemo(
    () => computeQualityInsights(selected?.timeframe, chartData, stats),
    [selected?.timeframe, chartData, stats],
  )

  const TABS: { id: DetailTab; label: string; title?: string }[] = [
    { id: 'chart', label: 'Chart', title: 'Biểu Đồ' },
    { id: 'preview', label: 'Preview', title: 'Xem Trước' },
    { id: 'stats', label: 'Statistics', title: 'Thống Kê' },
    { id: 'quality', label: 'Quality', title: 'Chất Lượng' },
  ]

  return (
    <>
      <LabPage
        title="Market Intake & Setup"
        subtitle="Fetch comprehensive training data — historical load with enrichment columns"
        icon={<ClipboardList className="w-5 h-5" />}
        action={
          <div className="flex items-center gap-2.5">
            <button
              onClick={handleFetchSample}
              disabled={isFetching}
              className="relative group overflow-hidden px-3.5 py-1.5 text-xs font-semibold rounded-xl border border-violet-500/30 hover:border-violet-400 bg-violet-950/20 hover:bg-violet-900/30 text-violet-300 hover:text-violet-200 transition-all duration-300 shadow-[0_0_15px_rgba(139,92,246,0.05)] hover:shadow-[0_0_20px_rgba(139,92,246,0.15)] backdrop-blur-md flex items-center gap-2 disabled:opacity-40 disabled:pointer-events-none"
              title="Tải Dữ Liệu Mẫu BTCUSDT 1m (1 Tháng Gần Nhất)"
            >
              <Zap className="w-3.5 h-3.5 animate-pulse text-violet-400" />
              <span>Sample Data</span>
            </button>

            <button
              onClick={() => setDrawerOpen(true)}
              disabled={isFetching}
              className="btn-cta disabled:opacity-40 disabled:pointer-events-none"
              title="Tải Dữ Liệu Thị Trường"
            >
              <Bitcoin className="w-3.5 h-3.5" />
              Fetch Market Data
            </button>
          </div>
        }

        list={
          <div className="flex flex-col h-full">
            <div className="p-3 space-y-2 border-b border-white/[0.06]">
              <div className="section-label" title="Tập Dữ Liệu">Datasets</div>
              <input
                className="input text-xs w-full"
                placeholder="Search symbol / timeframe..." title="Tìm symbol / khung thời gian..."
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
            </div>

            <div className="flex-1 overflow-y-auto p-2 space-y-1">
              {isLoading && <div className="text-xs text-zinc-600 px-2 py-4">Loading...</div>}
              {!isLoading && filteredDatasets.length === 0 && (
                <div className="text-xs text-zinc-600 px-2 py-4 leading-relaxed">
                  {marketDatasets.length === 0
                    ? 'No datasets yet. Click "Fetch Market Data" to load historical data.'
                    : 'No matches.'}
                </div>
              )}
              {filteredDatasets.map(d => {
                const active = d.id === selected?.id
                return (
                  <button
                    key={d.id}
                    onClick={() => selectDataset(d)}
                    className={
                      'w-full text-left px-3 py-3 rounded-xl transition-all duration-150 group ' +
                      (active
                        ? 'bg-white/[0.06] border border-white/[0.09]'
                        : 'border border-transparent hover:bg-white/[0.03] hover:border-white/[0.05]')
                    }
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <Bitcoin className="w-3 h-3 text-amber-500 shrink-0" />
                      <span className={
                        'text-sm font-bold truncate flex-1 tracking-tight ' +
                        (active ? 'text-white' : 'text-zinc-200 group-hover:text-white')
                      }>{d.symbol}</span>
                      <span className="text-[10px] font-mono font-semibold px-1.5 py-0.5 rounded bg-white/[0.05] text-zinc-400 shrink-0">{d.timeframe}</span>
                    </div>
                    <div className="flex gap-2 items-center flex-wrap">
                      <span className="text-[11px] text-zinc-600">{Number(d.row_count ?? 0).toLocaleString()} rows</span>
                      {(d.pipeline_count ?? 0) > 0 && (
                        <span className="text-[11px] text-brand-400 font-medium">{d.pipeline_count} pipeline{d.pipeline_count === 1 ? '' : 's'}</span>
                      )}
                    </div>
                    {d.date_from && (
                      <div className="text-[10px] text-zinc-600 mt-1 font-mono">
                        {d.date_from.slice(0, 10)} to {d.date_to?.slice(0, 10)}
                      </div>
                    )}
                  </button>
                )
              })}
            </div>
          </div>
        }

        detail={
          <div className="space-y-5">
            {isFetching && (
              <TaskBar
                progress={taskProgress}
                message={taskMessage}
                status={taskStatus}
                onDismiss={() => {
                  dismissFnRef.current?.()
                  clearTask()
                }}
              />
            )}

            {selected ? (
              <>
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2.5 flex-wrap">
                      <Bitcoin className="w-6 h-6 text-amber-500 shrink-0" />
                      <h2 className="text-3xl font-bold text-white tracking-tight">{selected.symbol}</h2>
                      <span className="text-xs font-mono font-semibold px-2 py-0.5 rounded-md bg-white/[0.06] border border-white/[0.08] text-zinc-300">
                        {selected.timeframe}
                      </span>
                    </div>
                    <div className="flex gap-3 mt-1.5 text-xs text-zinc-500 flex-wrap items-center">
                      <span>{Number(selected.row_count ?? 0).toLocaleString()} rows</span>
                      {selected.date_from && (
                        <span className="font-mono">{selected.date_from.slice(0, 10)} to {selected.date_to?.slice(0, 10)}</span>
                      )}
                        {(selected.pipeline_count ?? 0) > 0 && (
                        <span className="text-brand-400 font-medium">{selected.pipeline_count} pipeline{selected.pipeline_count === 1 ? '' : 's'}</span>
                      )}
                    </div>
                  </div>

                  <div className="flex gap-2 shrink-0 flex-wrap justify-end items-start">
                    <button onClick={handleDownload} className="btn-ghost text-xs px-3 py-1.5 flex items-center gap-1.5">
                      <Download className="w-3.5 h-3.5" /> <span title="Tải Xuống">Download</span>
                    </button>
                    <button
                      onClick={() => { loadPreview(selected.id); loadChart(selected.id); loadStats(selected.id) }}
                      className="btn-ghost text-xs px-3 py-1.5 flex items-center gap-1.5"
                    >
                      <RefreshCw className="w-3.5 h-3.5" /> <span title="Làm Mới">Refresh</span>
                    </button>
                    {confirmDeleteId === selected.id ? (
                      <div className="flex gap-2 items-center">
                        <span className="text-xs text-zinc-400" title="Xoá?">Delete?</span>
                        <button onClick={() => deleteMut.mutate(selected.id)} disabled={deleteMut.isPending}
                          className="btn-danger text-xs px-3 py-1.5">{deleteMut.isPending ? '...' : <span title="Xác Nhận">Confirm</span>}</button>
                        <button onClick={() => setConfirmDeleteId(null)} className="btn-secondary text-xs px-3 py-1.5" title="Huỷ">Cancel</button>
                      </div>
                    ) : (
                      <button onClick={() => setConfirmDeleteId(selected.id)} className="btn-danger text-xs px-3 py-1.5 flex items-center gap-1.5">
                        <Trash2 className="w-3.5 h-3.5" /> <span title="Xoá">Delete</span>
                      </button>
                    )}
                  </div>
                </div>

                <div className="flex gap-0 border-b border-white/[0.06]">
                  {TABS.map(t => (
                    <button
                      key={t.id}
                      onClick={() => setActiveTab(t.id)}
                      className={
                        'px-5 py-3 text-sm font-medium transition-all border-b-2 -mb-px ' +
                        (activeTab === t.id
                          ? 'border-cyan-400 text-white'
                          : 'border-transparent text-zinc-500 hover:text-zinc-300 hover:border-white/[0.15]')
                      }
                     title={t.title}>{t.label}</button>
                  ))}
                </div>

                {activeTab === 'chart' && (
                  chartLoading ? (
                    <div className="h-80 flex flex-col items-center justify-center space-y-3 rounded-2xl border border-white/[0.04] bg-slate-900/30 backdrop-blur-md">
                      <div className="w-8 h-8 rounded-full border-2 border-violet-500/20 border-t-violet-500 animate-spin" />
                      <span className="text-[10px] font-semibold text-zinc-500 tracking-wider">LOADING MARKET CHART DATA...</span>
                    </div>
                  ) : chartData && chartData.length > 0 ? (
                    <div className="rounded-2xl border border-white/[0.04] p-5 bg-slate-900/30 backdrop-blur-md shadow-[inset_0_0_20px_rgba(255,255,255,0.015)]">
                      <div className="flex items-center justify-between gap-2 mb-4">
                        <div className="flex items-center gap-2">
                          <div className="w-5 h-5 rounded-lg flex items-center justify-center bg-violet-500/10 text-violet-400">
                            <Activity className="w-3.5 h-3.5 animate-pulse" />
                          </div>
                          <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest">OHLCV Candle Chart</span>
                        </div>
                        <span className="text-[10px] text-zinc-500 font-mono">Total {chartData.length.toLocaleString()} points</span>
                      </div>
                      <OHLCVChart data={chartData} height={360} />
                    </div>
                  ) : (
                    <div className="h-80 flex flex-col items-center justify-center space-y-2 rounded-2xl border border-white/[0.04] bg-slate-900/20 backdrop-blur-md">
                      <AlertCircle className="w-6 h-6 text-zinc-600" />
                      <span className="text-xs text-zinc-500 font-medium">No OHLCV data available</span>
                    </div>
                  )
                )}

                {activeTab === 'preview' && (
                  <div className="space-y-4">
                    {previewLoading && (
                      <div className="h-80 flex flex-col items-center justify-center space-y-3 rounded-2xl border border-white/[0.04] bg-slate-900/30 backdrop-blur-md">
                        <div className="w-8 h-8 rounded-full border-2 border-violet-500/20 border-t-violet-500 animate-spin" />
                        <span className="text-[10px] font-semibold text-zinc-500 tracking-wider">LOADING RAW DATA PREVIEW...</span>
                      </div>
                    )}
                    {preview && (
                      <>
                        <div className="rounded-2xl border border-white/[0.04] p-5 bg-slate-900/30 backdrop-blur-md space-y-4">
                          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-white/[0.04]">
                            <div className="flex items-center gap-2">
                              <div className="w-5 h-5 rounded-lg flex items-center justify-center bg-violet-500/10 text-violet-400">
                                <Database className="w-3.5 h-3.5" />
                              </div>
                              <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Dataset Raw Preview</span>
                            </div>
                            <div className="flex items-center gap-3 text-[10px] text-zinc-500 font-semibold flex-wrap">
                              <span className="bg-emerald-500/10 text-emerald-400 px-2.5 py-0.5 rounded-full border border-emerald-500/20">
                                {preview.row_count.toLocaleString()} rows
                              </span>
                              <span className="bg-cyan-500/10 text-cyan-400 px-2.5 py-0.5 rounded-full border border-cyan-500/20">
                                {preview.column_count} columns
                              </span>
                            </div>
                          </div>

                          <div className="space-y-2">
                            <div className="text-[9px] font-bold text-zinc-500 uppercase tracking-widest">Schema Fields</div>
                            <div className="flex flex-wrap gap-1.5">
                              {preview.columns.slice(0, 14).map(c => {
                                const isNumeric = c.type.toLowerCase().includes('float') || c.type.toLowerCase().includes('int')
                                const isTime = c.type.toLowerCase().includes('date') || c.type.toLowerCase().includes('time')
                                const dotColor = isNumeric ? 'bg-cyan-400 shadow-[0_0_6px_rgba(34,211,238,0.4)]' : isTime ? 'bg-violet-400 shadow-[0_0_6px_rgba(167,139,250,0.4)]' : 'bg-amber-400 shadow-[0_0_6px_rgba(251,191,36,0.4)]'
                                return (
                                  <span key={c.name} className="inline-flex items-center gap-1.5 text-[10px] px-2.5 py-0.5 rounded-full bg-white/[0.02] border border-white/[0.05] text-zinc-400 hover:border-zinc-700/50 hover:text-zinc-300 transition-all font-mono">
                                    <span className={`w-1 h-1 rounded-full ${dotColor}`} />
                                    {c.name} <span className="text-[8px] text-zinc-600 font-semibold uppercase">{c.type}</span>
                                  </span>
                                )
                              })}
                              {preview.column_count > 14 && (
                                <span className="inline-flex items-center text-[10px] text-zinc-600 font-semibold px-2 py-0.5">
                                  +{preview.column_count - 14} more fields
                                </span>
                              )}
                            </div>
                          </div>
                        </div>

                        <div className="rounded-2xl border border-white/[0.04] p-4 bg-slate-900/30 backdrop-blur-md">
                          <PreviewTable columns={preview.columns} rows={preview.rows} />
                        </div>
                      </>
                    )}
                  </div>
                )}

                {activeTab === 'stats' && (
                  <div className="space-y-4">
                    {statsLoading && (
                      <div className="h-80 flex flex-col items-center justify-center space-y-3 rounded-2xl border border-white/[0.04] bg-slate-900/30 backdrop-blur-md">
                        <div className="w-8 h-8 rounded-full border-2 border-violet-500/20 border-t-violet-500 animate-spin" />
                        <span className="text-[10px] font-semibold text-zinc-500 tracking-wider">LOADING DATA STATISTICS...</span>
                      </div>
                    )}
                    {stats && (
                      <>
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3.5">
                          <StatCard
                            label="Coverage" title="Độ Phủ Sóng"
                            value={stats.coverage_pct.toFixed(1) + '%'}
                            sub="of expected bars"
                            color={stats.coverage_pct >= 99 ? 'green' : stats.coverage_pct >= 95 ? 'yellow' : 'red'}
                          />
                          <StatCard label="Rows" title="Số Dòng" value={stats.row_count.toLocaleString()} sub="total records" />
                          <StatCard label="Columns" title="Số Cột" value={String(stats.column_count)} sub="data fields" />
                          <StatCard
                            label="Gaps" title="Lỗ Hổng"
                            value={String(stats.gap_count)}
                            sub="missing bars"
                            color={stats.gap_count === 0 ? 'green' : stats.gap_count < 10 ? 'yellow' : 'red'}
                          />
                        </div>

                        {stats.price_range && (
                          <div className="rounded-2xl border border-white/[0.04] p-5 bg-slate-900/30 backdrop-blur-md shadow-[inset_0_0_20px_rgba(255,255,255,0.015)]">
                            <div className="flex items-center gap-2 mb-4">
                              <div className="w-5 h-5 rounded-lg flex items-center justify-center bg-violet-500/10 text-violet-400">
                                <Bitcoin className="w-3.5 h-3.5" />
                              </div>
                              <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Price & Volume Summary</span>
                            </div>
                            <div className="grid grid-cols-3 gap-6">
                              <div className="space-y-1">
                                <div className="text-[9px] font-bold text-zinc-500 uppercase tracking-wider">Close Low</div>
                                <div className="text-xl font-extrabold text-emerald-400 font-mono tracking-tight">
                                  ${stats.price_range.min.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                </div>
                              </div>
                              <div className="space-y-1">
                                <div className="text-[9px] font-bold text-zinc-500 uppercase tracking-wider">Close High</div>
                                <div className="text-xl font-extrabold text-cyan-400 font-mono tracking-tight">
                                  ${stats.price_range.max.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                </div>
                              </div>
                              {stats.volume_avg != null && (
                                <div className="space-y-1">
                                  <div className="text-[9px] font-bold text-zinc-500 uppercase tracking-wider">Avg Volume / bar</div>
                                  <div className="text-xl font-extrabold text-violet-400 font-mono tracking-tight">
                                    {stats.volume_avg.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                                  </div>
                                </div>
                              )}
                            </div>
                          </div>
                        )}

                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                          {Object.keys(stats.null_counts).length > 0 && (
                            <div className="rounded-2xl border border-white/[0.04] p-5 bg-slate-900/30 backdrop-blur-md">
                              <div className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest mb-1">Null coverage per column</div>
                              <div className="text-[10px] text-zinc-500 mb-3">Lower is better. Green = 0% null values.</div>
                              <ReactECharts option={nullCoverageOption(stats)} style={{ height: 220 }} />
                              <div className="flex gap-3 mt-3 text-[10px] text-zinc-500 flex-wrap">
                                {[
                                  ['#22c55e', '0% null'],
                                  ['#06b6d4', '<5% null'],
                                  ['#f59e0b', '5-20% null'],
                                  ['#ef4444', '>20% null']
                                ].map(([c, l]) => (
                                  <div key={l} className="flex items-center gap-1.5">
                                    <div className="w-2.5 h-2.5 rounded-sm shadow-sm" style={{ background: c }} />
                                    <span className="font-semibold">{l}</span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}

                          {preview && preview.columns.length > 0 && (
                            <div className="rounded-2xl border border-white/[0.04] p-5 bg-slate-900/30 backdrop-blur-md flex flex-col justify-between">
                              <div>
                                <div className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest mb-1">Column type distribution</div>
                                <div className="text-[10px] text-zinc-500 mb-3">Categorization of fields in schema dataset</div>
                              </div>
                              <div className="flex-1 flex items-center justify-center min-h-[220px]">
                                <ReactECharts option={columnTypePieOption(preview.columns)} style={{ height: 200, width: '100%' }} />
                              </div>
                            </div>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                )}

                {activeTab === 'quality' && (
                  <div className="space-y-4">
                    {!quality && (
                      <div className="h-60 flex items-center justify-center text-xs text-zinc-500 bg-slate-900/20 border border-white/[0.04] rounded-2xl backdrop-blur-sm">
                        Load chart and stats data to analyze quality.
                      </div>
                    )}
                    {quality && (
                      <>
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3.5">
                          <StatCard
                            label="Duplicate Candles" title="Nến Trùng Lặp"
                            value={quality.duplicateCandles.toLocaleString()}
                            sub="same timestamp appears multiple times"
                            color={quality.duplicateCandles === 0 ? 'green' : 'red'}
                          />
                          <StatCard
                            label="Corrupted Rows" title="Dòng Hỏng"
                            value={quality.corruptedRows.toLocaleString()}
                            sub="invalid OHLC / volume values"
                            color={quality.corruptedRows === 0 ? 'green' : 'red'}
                          />
                          <StatCard
                            label="Spikes" title="Biến Động Đột Biến"
                            value={quality.spikes.toLocaleString()}
                            sub="extreme returns outlier candles"
                            color={quality.spikes < 3 ? 'green' : quality.spikes < 10 ? 'yellow' : 'red'}
                          />
                          <StatCard
                            label="Missing Candles" title="Nến Bị Thiếu"
                            value={quality.missingCandles.toLocaleString()}
                            sub="expected bars not present"
                            color={quality.missingCandles === 0 ? 'green' : 'red'}
                          />
                        </div>

                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3.5">
                          <StatCard
                            label="Gap Segments" title="Đoạn Lỗ Hổng"
                            value={quality.gapSegments.toLocaleString()}
                            sub="discontinuity segments in time"
                            color={quality.gapSegments === 0 ? 'green' : 'yellow'}
                          />
                          <StatCard
                            label="NaN Cells" title="Ô Giá Trị Null"
                            value={quality.nullCells.toLocaleString()}
                            sub="sum of null values across columns"
                            color={quality.nullCells === 0 ? 'green' : 'yellow'}
                          />
                          <StatCard
                            label="Rows With NaN (est.)"
                            value={quality.nullRowsEstimate.toLocaleString()}
                            sub="upper-bound estimate from null profile"
                            color={quality.nullRowsEstimate === 0 ? 'green' : 'yellow'}
                          />
                          <StatCard
                            label="Missing Funding" title="Funding Rất Thiếu"
                            value={quality.missingFunding == null ? 'N/A' : quality.missingFunding.toLocaleString()}
                            sub="null count of funding_rate column"
                            color={quality.missingFunding == null || quality.missingFunding === 0 ? 'green' : 'yellow'}
                          />
                        </div>

                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                          <div className="rounded-2xl border border-white/[0.04] p-5 bg-slate-900/30 backdrop-blur-md">
                            <div className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest mb-1">Issue Breakdown</div>
                            <div className="text-[10px] text-zinc-500 mb-3">Counts by anomaly type for the selected dataset</div>
                            <ReactECharts option={issueOverviewOption(quality)} style={{ height: 230 }} />
                          </div>

                          <div className="rounded-2xl border border-white/[0.04] p-5 bg-slate-900/30 backdrop-blur-md">
                            <div className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest mb-1">Anomaly Timeline</div>
                            <div className="text-[10px] text-zinc-500 mb-3">Where spikes, gaps, and corrupted candles occur over time</div>
                            <ReactECharts option={issueTimelineOption(quality)} style={{ height: 230 }} />
                          </div>
                        </div>

                        <div className="rounded-2xl border border-white/[0.04] p-5 bg-slate-900/30 backdrop-blur-md shadow-[inset_0_0_20px_rgba(255,255,255,0.015)]">
                          <div className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest mb-4">Integrity Summary</div>
                          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs">
                            <div className="rounded-xl border border-white/[0.05] p-3.5 bg-white/[0.01] hover:bg-white/[0.02] transition-colors">
                              <div className="text-zinc-500 text-[10px] font-semibold uppercase tracking-wider mb-1">Expected Interval</div>
                              <div className="text-zinc-200 font-mono font-bold text-base">
                                {quality.expectedIntervalSec == null ? 'Unknown' : `${quality.expectedIntervalSec}s`}
                              </div>
                            </div>
                            <div className="rounded-xl border border-white/[0.05] p-3.5 bg-white/[0.01] hover:bg-white/[0.02] transition-colors">
                              <div className="text-zinc-500 text-[10px] font-semibold uppercase tracking-wider mb-1">Observed Rows</div>
                              <div className="text-zinc-200 font-mono font-bold text-base">{quality.observedRows.toLocaleString()}</div>
                            </div>
                            <div className="rounded-xl border border-white/[0.05] p-3.5 bg-white/[0.01] hover:bg-white/[0.02] transition-colors">
                              <div className="text-zinc-500 text-[10px] font-semibold uppercase tracking-wider mb-1">Expected Rows (range)</div>
                              <div className="text-zinc-200 font-mono font-bold text-base">
                                {quality.expectedRows == null ? 'N/A' : quality.expectedRows.toLocaleString()}
                              </div>
                            </div>
                          </div>
                        </div>
                      </>
                    )}
                  </div>
                )}
              </>
            ) : !isFetching ? (
              <EmptyState message='No dataset selected. Click "Fetch Market Data" to load historical data.' />
            ) : null}
          </div>
        }
      />

      {drawerOpen && (
        <>
          <div className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm" onClick={() => setDrawerOpen(false)} />
          <div
            className="fixed right-0 top-0 bottom-0 z-50 w-[460px] border-l border-white/[0.06] overflow-hidden shadow-2xl flex flex-col"
            style={{ background: 'linear-gradient(180deg, #0c1018 0%, #0a0f1a 100%)' }}
          >
            <div className="flex items-center justify-between px-6 py-4 border-b border-white/[0.06] shrink-0">
              <div>
                <h2 className="font-semibold text-zinc-100 flex items-center gap-2">
                  <Bitcoin className="w-4 h-4 text-amber-500" />
                  <span title="Tải Dữ Liệu Lịch Sử">Fetch Historical Data</span>
                </h2>
                <p className="text-[11px] text-zinc-600 mt-0.5">Full historical load — select symbol, timeframe, date range</p>
              </div>
              <button onClick={() => setDrawerOpen(false)} className="text-zinc-500 hover:text-zinc-300 p-1.5 hover:bg-white/[0.06] rounded-lg transition-colors">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">

              <div className="space-y-4">
                <div className="section-label">Core config</div>
                <div className="grid grid-cols-2 gap-3">
                  <label className="block space-y-1.5 col-span-2">
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500" title="Mã Giao Dịch">Symbol</span>
                    <input
                      className="input text-sm w-full"
                      value={symbol}
                      onChange={e => setSymbol(e.target.value.toUpperCase())}
                      placeholder="BTCUSDT"
                    />
                  </label>
                  <label className="block space-y-1.5">
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500" title="Khung Thời Gian">Timeframe</span>
                    <select className="input text-sm w-full" value={timeframe} onChange={e => setTimeframe(e.target.value)}>
                      {TIMEFRAMES.map(t => <option key={t}>{t}</option>)}
                    </select>
                  </label>
                  <label className="block space-y-1.5">
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500" title="Nguồn">Source</span>
                    <input className="input text-sm w-full opacity-60 cursor-not-allowed" value="Binance" readOnly />
                  </label>
                  <label className="block space-y-1.5">
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500" title="Ngày bắt đầu">Date from</span>
                    <input type="date" className="input text-sm w-full" value={dateFrom}
                      max={dateTo}
                      onChange={e => { setDateFrom(e.target.value); setFetchError(null) }} />
                  </label>
                  <label className="block space-y-1.5">
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500" title="Ngày kết thúc">Date to</span>
                    <input type="date" className="input text-sm w-full" value={dateTo}
                      max={new Date().toISOString().slice(0, 10)}
                      onChange={e => { setDateTo(e.target.value); setFetchError(null) }} />
                  </label>
                </div>
                {fetchError && (
                  <div className="flex items-center gap-2 text-xs text-red-400 bg-red-900/20 border border-red-900/40 rounded-lg px-3 py-2">
                    <AlertTriangle className="w-3.5 h-3.5 shrink-0" />{fetchError}
                  </div>
                )}
              </div>

              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div className="section-label" title="Cột Làm Giàu Dữ Liệu">Enrichment columns</div>
                  <span className="text-[10px] text-zinc-500 font-mono" title="đã chọn">{enrichments.length} selected</span>
                </div>
                <div className="text-[11px] text-zinc-600" title="Ngoài OHLCV cơ bản. Nhiều cột = đặc trưng phong phú hơn cho mô hình.">
                  Beyond basic OHLCV. More columns = richer features for the model.
                </div>
                <div className="space-y-2">
                  {ENRICH_GROUPS.map(group => {
                    const open = expandedGroup === group.label
                    const groupSelected = group.items.filter(i => enrichments.includes(i.id)).length
                    return (
                      <div key={group.label} className="rounded-xl border border-white/[0.06] overflow-hidden">
                        <button
                          type="button"
                          onClick={() => setExpandedGroup(open ? null : group.label)}
                          className="w-full flex items-center justify-between px-4 py-3 hover:bg-white/[0.03] transition-colors"
                        >
                          <div className="flex items-center gap-2.5">
                            <span className="text-sm font-medium text-zinc-300" title={group.label_vi}>{group.label}</span>
                            {groupSelected > 0 && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-cyan-500/20 border border-cyan-500/30 text-cyan-400 font-mono">
                                {groupSelected}
                              </span>
                            )}
                          </div>
                          {open ? <ChevronUp className="w-4 h-4 text-zinc-600" /> : <ChevronDown className="w-4 h-4 text-zinc-600" />}
                        </button>
                        {open && (
                          <div className="border-t border-white/[0.06] px-4 py-3 space-y-2.5">
                            {group.items.map(item => {
                              const checked = enrichments.includes(item.id)
                              return (
                                <label key={item.id} className="flex items-start gap-3 cursor-pointer">
                                  <div
                                    onClick={() => toggleEnrich(item.id)}
                                    className={
                                      'mt-0.5 w-4 h-4 rounded border shrink-0 flex items-center justify-center transition-all cursor-pointer ' +
                                      (checked ? 'bg-cyan-500 border-cyan-500' : 'border-white/[0.20] hover:border-cyan-500/50')
                                    }
                                  >
                                    {checked && <CheckCircle2 className="w-3 h-3 text-white" strokeWidth={3} />}
                                  </div>
                                  <div onClick={() => toggleEnrich(item.id)} className="flex-1 cursor-pointer">
                                    <div className={'text-xs font-medium ' + (checked ? 'text-zinc-200' : 'text-zinc-400 hover:text-zinc-300')} title={item.label_vi}>
                                      {item.label}
                                    </div>
                                    <div className="text-[10px] text-zinc-600 mt-0.5" title={item.desc_vi}>{item.desc}</div>
                                  </div>
                                </label>
                              )
                            })}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>

              <div className="rounded-xl border border-white/[0.06] p-4 space-y-1.5" style={{ background: 'rgba(255,255,255,0.01)' }}>
                <div className="section-label mb-2">Fetch summary</div>
                {[
                  ['Symbol', symbol],
                  ['Timeframe', timeframe],
                  ['Range', dateFrom + ' to ' + dateTo],
                  ['Columns', '5 OHLCV + ' + enrichments.length + ' enrichments'],
                ].map(([k, v]) => (
                  <div key={k} className="flex justify-between text-xs">
                    <span className="text-zinc-500">{k}</span>
                    <span className="text-zinc-200 font-mono">{v}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="px-6 py-4 border-t border-white/[0.06] shrink-0 space-y-2">
              <button
                onClick={handleFetch}
                disabled={fetching}
                className="btn-cta w-full text-sm py-2.5 flex items-center justify-center gap-2"
              >
                {fetching
                  ? <><RefreshCw className="w-4 h-4 animate-spin" /> Fetching...</>
                  : <><Bitcoin className="w-4 h-4" /> Fetch {symbol} {timeframe}</>}
              </button>
              <button onClick={() => setDrawerOpen(false)} className="btn-ghost w-full text-sm">Cancel</button>
            </div>
          </div>
        </>
      )}
    </>
  )
}

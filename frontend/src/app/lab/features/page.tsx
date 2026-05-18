'use client'

import { useState, useEffect, useRef, useMemo } from 'react'
import dynamic from 'next/dynamic'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  listLabeledDatasets, listFeatureSets, createFeatureSet, previewFeatureSet, deleteFeatureSet,
  previewLabeledDataset, connectTaskWS
} from '@/lib/api'
import { useAppStore, LabeledDataset, FeatureSet } from '@/store/appStore'
import { LabPage, StatusBadge, PreviewTable, EmptyState } from '@/components/ui/LabPage'
import { toast } from 'sonner'
import { getApiErrorMessage } from '@/lib/api-error'
import { X, ChevronRight, Info, Download } from 'lucide-react'

const ReactECharts = dynamic(() => import('echarts-for-react'), {
  ssr: false,
  loading: () => <div className="text-xs text-zinc-600 p-4">Loading charts…</div>,
})

interface PreviewData {
  row_count: number; column_count: number
  columns: { name: string; type: string }[]
  rows: Record<string, unknown>[]
}
interface AnalysisData {
  vif_scores: Record<string, number>
  dropped_vif: string[]
  spearman_with_target: Record<string, number>
  inter_feature_corr: Record<string, Record<string, number>>
  dropped_corr: string[]
  dropped_corr_reasons?: Record<string, { with: string; corr: number }>
  mutual_information: Record<string, number>
  feature_importance: Record<string, number>
  final_selected: string[]
  stage_counts?: Record<string, number>
}
interface AnalysisConfig {
  task: 'regression' | 'classification'
  mi_top_k: number
  tree_top_k: number
  vif_threshold: number
  corr_threshold: number
}
type DetailTab   = 'preview' | 'columns' | 'analysis'
type AnalysisTab = 'funnel' | 'corr' | 'mi' | 'importance' | 'vif' | 'heatmap'

const CHART_BG    = 'transparent'
const LABEL_COLOR = '#71717a'
const AXIS_COLOR  = '#3f3f46'
const GRID_OPT    = { left: 160, right: 72, top: 12, bottom: 30 }

function corrBarOption(
  spearman: Record<string, number>,
  finalSelected: string[],
  dropped: string[],
): object {
  const sorted = Object.entries(spearman)
    .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
    .slice(0, 50)
  const names  = sorted.map(([n]) => n)
  const values = sorted.map(([, v]) => v)
  const selSet  = new Set(finalSelected)
  const dropSet = new Set(dropped)
  return {
    backgroundColor: CHART_BG,
    grid: GRID_OPT,
    tooltip: { trigger: 'axis', formatter: (p: {name:string;value:number}[]) => `${p[0].name}: ${p[0].value.toFixed(4)}` },
    xAxis: { type: 'value', min: -1, max: 1, axisLine: { lineStyle: { color: AXIS_COLOR } }, axisLabel: { color: LABEL_COLOR, fontSize: 10 }, splitLine: { lineStyle: { color: AXIS_COLOR } } },
    yAxis: { type: 'category', data: names, axisLabel: { color: LABEL_COLOR, fontSize: 9, width: 150, overflow: 'truncate' } },
    series: [{
      type: 'bar',
      data: values.map((v, i) => ({
        value: v,
        itemStyle: {
          color: dropSet.has(names[i]) ? '#52525240'
            : selSet.has(names[i])     ? (v >= 0 ? '#22c55e' : '#ef4444')
                                       : (v >= 0 ? '#22c55e60' : '#ef444460'),
          borderRadius: 2,
        },
      })),
      markLine: { silent: true, lineStyle: { color: '#52525280', type: 'dashed', width: 1 }, data: [{ xAxis: 0 }], label: { show: false } },
    }],
  }
}

function miBarOption(mi: Record<string, number>, finalSelected: string[]): object {
  const sorted = Object.entries(mi).sort((a, b) => b[1] - a[1]).slice(0, 50)
  const names  = sorted.map(([n]) => n)
  const values = sorted.map(([, v]) => v)
  const max    = values[0] ?? 1
  const selSet = new Set(finalSelected)
  return {
    backgroundColor: CHART_BG,
    grid: GRID_OPT,
    tooltip: { trigger: 'axis', formatter: (p: {name:string;value:number}[]) => `${p[0].name}: ${p[0].value.toFixed(4)}` },
    xAxis: { type: 'value', axisLine: { lineStyle: { color: AXIS_COLOR } }, axisLabel: { color: LABEL_COLOR, fontSize: 10 }, splitLine: { lineStyle: { color: AXIS_COLOR } } },
    yAxis: { type: 'category', data: names, axisLabel: { color: LABEL_COLOR, fontSize: 9, width: 150, overflow: 'truncate' } },
    series: [{ type: 'bar', data: values.map((v, i) => ({ value: v, itemStyle: { color: selSet.has(names[i]) ? `rgba(99,102,241,${0.4 + 0.6 * (v / max)})` : `rgba(99,102,241,${0.15 + 0.25 * (v / max)})`, borderRadius: 2 } })) }],
  }
}

function importanceBarOption(imp: Record<string, number>): object {
  const sorted = Object.entries(imp).sort((a, b) => b[1] - a[1]).slice(0, 30)
  const names  = sorted.map(([n]) => n)
  const values = sorted.map(([, v]) => v)
  const max    = values[0] ?? 1
  return {
    backgroundColor: CHART_BG,
    grid: GRID_OPT,
    tooltip: { trigger: 'axis', formatter: (p: {name:string;value:number}[]) => `${p[0].name}: ${p[0].value.toFixed(4)}` },
    xAxis: { type: 'value', axisLine: { lineStyle: { color: AXIS_COLOR } }, axisLabel: { color: LABEL_COLOR, fontSize: 10 }, splitLine: { lineStyle: { color: AXIS_COLOR } } },
    yAxis: { type: 'category', data: names, axisLabel: { color: LABEL_COLOR, fontSize: 9, width: 150, overflow: 'truncate' } },
    series: [{ type: 'bar', data: values.map(v => ({ value: v, itemStyle: { color: `rgba(245,158,11,${0.4 + 0.6 * (v / max)})`, borderRadius: 2 } })) }],
  }
}

function vifBarOption(vif: Record<string, number>, dropped: string[], threshold: number): object {
  const sorted  = Object.entries(vif).sort((a, b) => b[1] - a[1]).slice(0, 50)
  const names   = sorted.map(([n]) => n)
  const values  = sorted.map(([, v]) => v)
  const dropSet = new Set(dropped)
  return {
    backgroundColor: CHART_BG,
    grid: GRID_OPT,
    tooltip: { trigger: 'axis', formatter: (p: {name:string;value:number}[]) => `${p[0].name}: ${p[0].value.toFixed(2)}` },
    xAxis: { type: 'value', axisLine: { lineStyle: { color: AXIS_COLOR } }, axisLabel: { color: LABEL_COLOR, fontSize: 10 }, splitLine: { lineStyle: { color: AXIS_COLOR } } },
    yAxis: { type: 'category', data: names, axisLabel: { color: LABEL_COLOR, fontSize: 9, width: 150, overflow: 'truncate' } },
    series: [{
      type: 'bar',
      data: values.map((v, i) => ({ value: v, itemStyle: { color: dropSet.has(names[i]) ? '#ef4444aa' : '#22c55e60', borderRadius: 2 } })),
      markLine: { silent: true, lineStyle: { color: '#ef4444', type: 'dashed', width: 1.5 }, data: [{ xAxis: threshold, label: { formatter: `VIF=${threshold}`, color: '#ef4444', fontSize: 9 } }] },
    }],
  }
}

function heatmapOption(corrMatrix: Record<string, Record<string, number>>): object {
  const cols = Object.keys(corrMatrix)
  const data: [number, number, number][] = []
  cols.forEach((row, yi) => {
    cols.forEach((col, xi) => {
      data.push([xi, yi, parseFloat((corrMatrix[row]?.[col] ?? 0).toFixed(2))])
    })
  })
  const short = (s: string) => s.length > 12 ? s.slice(0, 11) + '…' : s
  return {
    backgroundColor: CHART_BG,
    tooltip: { trigger: 'item', formatter: (p: {data:[number,number,number]}) => `${cols[p.data[1]]} × ${cols[p.data[0]]}<br/>corr = <b>${p.data[2]}</b>` },
    grid: { left: 100, right: 80, top: 30, bottom: 100 },
    xAxis: { type: 'category', data: cols.map(short), axisLabel: { rotate: 45, color: LABEL_COLOR, fontSize: 8 }, axisLine: { lineStyle: { color: AXIS_COLOR } } },
    yAxis: { type: 'category', data: cols.map(short), axisLabel: { color: LABEL_COLOR, fontSize: 8 }, axisLine: { lineStyle: { color: AXIS_COLOR } } },
    visualMap: { min: -1, max: 1, calculable: true, orient: 'vertical', right: 0, top: 'center', textStyle: { color: LABEL_COLOR, fontSize: 9 }, inRange: { color: ['#ef4444', '#27272a', '#22c55e'] } },
    series: [{ type: 'heatmap', data, emphasis: { itemStyle: { borderColor: '#fff', borderWidth: 1 } } }],
  }
}

function getAnalysisInputCount(data: AnalysisData, fallback: number): number {
  if (data.stage_counts?.input !== undefined) return data.stage_counts.input
  const byVif = Object.keys(data.vif_scores).length
  return Math.max(byVif, fallback)
}

function downloadTextFile(filename: string, content: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

function toAnalysisCsv(data: AnalysisData, config: AnalysisConfig | null, inputFallback: number): string {
  const inputCount = getAnalysisInputCount(data, inputFallback)
  const threshold = config?.vif_threshold ?? 10
  const corrReason = data.dropped_corr_reasons ?? {}

  const allFeatures = new Set<string>([
    ...Object.keys(data.vif_scores),
    ...Object.keys(data.spearman_with_target),
    ...Object.keys(data.mutual_information),
    ...Object.keys(data.feature_importance),
    ...data.final_selected,
    ...data.dropped_vif,
    ...data.dropped_corr,
  ])

  const finalSet = new Set(data.final_selected)
  const dropVifSet = new Set(data.dropped_vif)
  const dropCorrSet = new Set(data.dropped_corr)
  const miSet = new Set(Object.keys(data.mutual_information))

  const rows: string[] = []
  rows.push('feature,status,stage,reason,vif,spearman,mi,importance,correlated_with,correlation')

  Array.from(allFeatures).sort().forEach((f) => {
    let status = 'kept'
    let stage = 'n/a'
    let reason = 'kept'

    if (dropVifSet.has(f)) {
      status = 'dropped'
      stage = 'vif'
      reason = `VIF > ${threshold}`
    } else if (dropCorrSet.has(f)) {
      status = 'dropped'
      stage = 'corr'
      reason = 'High pairwise correlation'
    } else if (miSet.has(f) && !finalSet.has(f)) {
      status = 'dropped'
      stage = 'tree'
      reason = 'Not in final top-k by LightGBM importance'
    } else if (finalSet.has(f)) {
      status = 'selected'
      stage = 'final'
      reason = 'Final selected feature'
    }

    const withFeature = corrReason[f]?.with ?? ''
    const corr = corrReason[f]?.corr ?? ''
    const vif = data.vif_scores[f] ?? ''
    const rho = data.spearman_with_target[f] ?? ''
    const mi = data.mutual_information[f] ?? ''
    const imp = data.feature_importance[f] ?? ''

    rows.push([
      JSON.stringify(f),
      status,
      stage,
      JSON.stringify(reason),
      vif,
      rho,
      mi,
      imp,
      JSON.stringify(withFeature),
      corr,
    ].join(','))
  })

  rows.push('')
  rows.push('metric,value')
  rows.push(`input,${inputCount}`)
  rows.push(`dropped_vif,${data.dropped_vif.length}`)
  rows.push(`dropped_corr,${data.dropped_corr.length}`)
  rows.push(`after_mi,${Object.keys(data.mutual_information).length}`)
  rows.push(`final,${data.final_selected.length}`)

  return rows.join('\n')
}

function getChartInsights(tab: AnalysisTab, data: AnalysisData): string[] {
  if (tab === 'vif') {
    const highVif = Object.entries(data.vif_scores)
      .filter(([, v]) => v > 10)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([n, v]) => `${n} (VIF=${v.toFixed(1)})`)
    return [
      `Bước này đo đa cộng tuyến. Cột có VIF cao bị loại trước để tránh nhiễu cho các bước sau.`,
      `Đã loại ${data.dropped_vif.length} cột ở stage VIF.`,
      highVif.length ? `Các cột đa cộng tuyến nặng nhất: ${highVif.join(', ')}.` : 'Không có cột nào vượt ngưỡng VIF.',
    ]
  }
  if (tab === 'corr') {
    const sorted = Object.entries(data.spearman_with_target)
      .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
      .slice(0, 3)
      .map(([n, v]) => `${n} (${v >= 0 ? '+' : ''}${v.toFixed(3)})`)
    return [
      `Spearman cho biết cột nào đi cùng chiều hoặc ngược chiều với target.`,
      `Đã loại ${data.dropped_corr.length} cột bị trùng thông tin ở bước corr.`,
      sorted.length ? `Tương quan mạnh nhất với target: ${sorted.join(', ')}.` : 'Không có dữ liệu tương quan đủ mạnh để kết luận.',
    ]
  }
  if (tab === 'mi') {
    const top = Object.entries(data.mutual_information)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([n, v]) => `${n} (${v.toFixed(4)})`)
    return [
      `Mutual Information bắt quan hệ phi tuyến, bổ sung cho Spearman.`,
      `Bước này lấy top ${Object.keys(data.mutual_information).length} cột theo MI.`,
      top.length ? `Top MI: ${top.join(', ')}.` : 'Không có cột nào có MI đáng kể.',
    ]
  }
  if (tab === 'importance') {
    const top = Object.entries(data.feature_importance)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([n, v]) => `${n} (${v.toFixed(0)})`)
    return [
      `LightGBM importance chọn cột có giá trị thực tế khi đi qua mô hình cây.`,
      `Kết quả cuối cùng còn ${data.final_selected.length} cột.`,
      top.length ? `Cột có trọng số cây cao nhất: ${top.join(', ')}.` : 'Không có dữ liệu importance để xếp hạng.',
    ]
  }
  if (tab === 'heatmap') {
    return [
      `Heatmap giúp nhìn cụm cột đang mang tín hiệu giống nhau.`,
      `Cụm màu đậm (đỏ/xanh) nghĩa là đang trùng thông tin mạnh.`,
      `Nếu thấy nhiều cụm đậm, nên giảm tương quan hoặc tăng ngưỡng lọc ở stage 2.`,
    ]
  }
  return [
    `Pipeline này là tuần tự có phụ thuộc, không phải các stage độc lập.`,
    `Stage sau chỉ chạy trên tập cột còn lại từ stage trước.`,
    `Mục tiêu là giảm rủi ro overfit theo từng loại lỗi: đa cộng tuyến → trùng tín hiệu → nhiễu phi tuyến → giá trị dự báo thực chiến.`,
  ]
}

function FunnelBreakdown({ data, inputCols, vifThreshold }: { data: AnalysisData; inputCols: string[]; vifThreshold: number }): JSX.Element {
  const [expandedStage, setExpandedStage] = useState<number | null>(1)
  const totalInput = getAnalysisInputCount(data, inputCols.length)
  const afterCorr = totalInput - data.dropped_corr.length
  const afterVIF = afterCorr - data.dropped_vif.length
  const miCount = Object.keys(data.mutual_information).length
  const finalCount = data.final_selected.length
  const droppedByTree = Math.max(0, miCount - finalCount)

  return (
    <div className="space-y-3 p-4">
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-2">
        <div className="rounded-lg border border-white/[0.08] bg-zinc-900/40 px-3 py-2">
          <div className="text-[10px] uppercase tracking-wide text-zinc-500">Input</div>
          <div className="text-sm font-semibold text-zinc-100">{totalInput}</div>
        </div>
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2">
          <div className="text-[10px] uppercase tracking-wide text-amber-300">Drop Corr</div>
          <div className="text-sm font-semibold text-amber-200">-{data.dropped_corr.length}</div>
        </div>
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2">
          <div className="text-[10px] uppercase tracking-wide text-red-300">Drop VIF</div>
          <div className="text-sm font-semibold text-red-200">-{data.dropped_vif.length}</div>
        </div>
        <div className="rounded-lg border border-indigo-500/30 bg-indigo-500/10 px-3 py-2">
          <div className="text-[10px] uppercase tracking-wide text-indigo-300">MI Keep</div>
          <div className="text-sm font-semibold text-indigo-200">{miCount}</div>
        </div>
        <div className="rounded-lg border border-brand-500/30 bg-brand-500/10 px-3 py-2">
          <div className="text-[10px] uppercase tracking-wide text-brand-300">Final</div>
          <div className="text-sm font-semibold text-brand-200">{finalCount}</div>
        </div>
      </div>

      <div className="rounded-lg border border-white/[0.08] bg-white/[0.02] p-3">
        <div className="text-xs font-semibold text-zinc-200 mb-1">Vì sao thứ tự stage là tuần tự?</div>
        <p className="text-[11px] text-zinc-400 leading-relaxed">
          Đây là pipeline phụ thuộc theo chuỗi: Stage 2 chỉ chạy trên kết quả Stage 1, Stage 3 chạy trên kết quả Stage 2, và Stage 4 chạy trên kết quả Stage 3.
          Không cộng trọng số giữa các stage vì mỗi stage xử lý một loại rủi ro khác nhau.
        </p>
        <div className="text-[11px] text-zinc-500 mt-2">Luồng: Corr (trùng tín hiệu cặp) → VIF (đa cộng tuyến) → MI (độ liên quan phi tuyến) → Tree Importance (giá trị dự báo thực tế).</div>
      </div>

      <div className="border border-zinc-800 rounded-lg overflow-hidden">
        <button
          onClick={() => setExpandedStage(expandedStage === 1 ? null : 1)}
          className="w-full px-4 py-3 bg-amber-500/10 border-b border-zinc-800 flex items-center justify-between hover:bg-amber-500/15 transition-colors"
        >
          <div className="flex items-center gap-2">
            <div className="inline-block w-2 h-2 rounded-full bg-amber-400" />
            <div className="text-xs font-semibold text-zinc-300 uppercase tracking-wide">Stage 1: Correlation Filter</div>
            <span className="text-[11px] text-amber-400/70 ml-1">High pairwise correlation</span>
          </div>
          <div className="flex items-center gap-3 text-sm">
            <span className="text-amber-400 font-semibold">-{data.dropped_corr.length}</span>
            <span className="text-zinc-600">→ {afterCorr} left</span>
            <span className="text-xs text-zinc-600">{expandedStage === 1 ? '▼' : '▶'}</span>
          </div>
        </button>
        {expandedStage === 1 && (
          <div className="px-4 py-3 bg-zinc-950/50 border-t border-zinc-800">
            {data.dropped_corr.length === 0 ? (
              <div className="text-[11px] text-zinc-600 italic">Không có cột bị loại ở stage corr.</div>
            ) : (
              <div className="max-h-52 overflow-y-auto grid grid-cols-1 md:grid-cols-2 gap-1.5">
                {data.dropped_corr.map(col => {
                  const reason = data.dropped_corr_reasons?.[col]
                  return (
                  <div key={col} className="text-[10px] font-mono px-2 py-1 rounded bg-amber-500/20 text-amber-200 border border-amber-500/30 flex items-center justify-between gap-2">
                    <span>{col}</span>
                    {reason ? (
                      <span className="text-amber-300/80">vs {reason.with} ({reason.corr.toFixed(3)})</span>
                    ) : (
                      <span className="text-zinc-500">corr &gt; threshold</span>
                    )}
                  </div>
                  )
                })}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="border border-zinc-800 rounded-lg overflow-hidden">
        <button
          onClick={() => setExpandedStage(expandedStage === 2 ? null : 2)}
          className="w-full px-4 py-3 bg-red-500/10 border-b border-zinc-800 flex items-center justify-between hover:bg-red-500/15 transition-colors"
        >
          <div className="flex items-center gap-2">
            <div className="inline-block w-2 h-2 rounded-full bg-red-400" />
            <div className="text-xs font-semibold text-zinc-300 uppercase tracking-wide">Stage 2: VIF Filter</div>
            <span className="text-[11px] text-red-400/70 ml-1">Multicollinearity (VIF &gt; {vifThreshold})</span>
          </div>
          <div className="flex items-center gap-3 text-sm">
            <span className="text-red-400 font-semibold">-{data.dropped_vif.length}</span>
            <span className="text-zinc-600">→ {afterVIF} left</span>
            <span className="text-xs text-zinc-600">{expandedStage === 2 ? '▼' : '▶'}</span>
          </div>
        </button>
        {expandedStage === 2 && (
          <div className="px-4 py-3 bg-zinc-950/50 border-t border-zinc-800 space-y-2">
            <div className="text-[11px] text-zinc-500">Dropped columns ({data.dropped_vif.length}) with VIF:</div>
            <div className="max-h-52 overflow-y-auto grid grid-cols-1 md:grid-cols-2 gap-1.5">
              {data.dropped_vif.map(col => (
                <div key={col} className="text-[10px] font-mono px-2 py-1 rounded bg-red-500/20 text-red-200 border border-red-500/30 flex items-center justify-between">
                  <span>{col}</span>
                  <span className="text-red-300/80">{(data.vif_scores[col] ?? 0).toFixed(2)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="border border-zinc-800 rounded-lg overflow-hidden">
        <button
          onClick={() => setExpandedStage(expandedStage === 3 ? null : 3)}
          className="w-full px-4 py-3 bg-indigo-500/10 border-b border-zinc-800 flex items-center justify-between hover:bg-indigo-500/15 transition-colors"
        >
          <div className="flex items-center gap-2">
            <div className="inline-block w-2 h-2 rounded-full bg-indigo-400" />
            <div className="text-xs font-semibold text-zinc-300 uppercase tracking-wide">Stage 3: Mutual Information Top-K</div>
          </div>
          <div className="flex items-center gap-3 text-sm">
            <span className="text-indigo-400 font-semibold">{miCount} selected</span>
            <span className="text-xs text-zinc-600">{expandedStage === 3 ? '▼' : '▶'}</span>
          </div>
        </button>
        {expandedStage === 3 && (
          <div className="px-4 py-3 bg-zinc-950/50 border-t border-zinc-800 max-h-52 overflow-y-auto space-y-1.5">
            {Object.entries(data.mutual_information)
              .sort((a, b) => b[1] - a[1])
              .map(([col, mi], idx) => (
                <div key={col} className="flex items-center justify-between text-[10px] px-2 py-1 rounded bg-zinc-900/50">
                  <span className="font-mono text-indigo-300">{idx + 1}. {col}</span>
                  <span className="text-zinc-500">MI: {mi.toFixed(4)}</span>
                </div>
              ))}
          </div>
        )}
      </div>

      <div className="border border-zinc-800 rounded-lg overflow-hidden">
        <button
          onClick={() => setExpandedStage(expandedStage === 4 ? null : 4)}
          className="w-full px-4 py-3 bg-brand-500/10 border-b border-zinc-800 flex items-center justify-between hover:bg-brand-500/15 transition-colors"
        >
          <div className="flex items-center gap-2">
            <div className="inline-block w-2 h-2 rounded-full bg-brand-400" />
            <div className="text-xs font-semibold text-zinc-300 uppercase tracking-wide">Stage 4: LightGBM Importance</div>
          </div>
          <div className="flex items-center gap-3 text-sm">
            <span className="text-brand-400 font-semibold">{finalCount} final</span>
            {droppedByTree > 0 && <span className="text-zinc-600 text-xs">(-{droppedByTree} from MI set)</span>}
            <span className="text-xs text-zinc-600">{expandedStage === 4 ? '▼' : '▶'}</span>
          </div>
        </button>
        {expandedStage === 4 && (
          <div className="px-4 py-3 bg-zinc-950/50 border-t border-zinc-800 max-h-52 overflow-y-auto space-y-1.5">
            {data.final_selected.map((col, idx) => {
              const imp = data.feature_importance[col]
              return (
                <div key={col} className="flex items-center justify-between text-[10px] px-2 py-1 rounded bg-brand-900/30 border border-brand-500/20">
                  <span className="font-mono text-brand-200">{idx + 1}. {col}</span>
                  {imp !== undefined && <span className="text-zinc-500">Importance: {imp.toFixed(0)}</span>}
                </div>
              )
            })}
          </div>
        )}
      </div>

      <div className="px-4 py-3 rounded-lg bg-gradient-to-r from-zinc-900/50 to-transparent border border-zinc-800 text-[11px] text-zinc-400">
        {totalInput} input → {data.dropped_corr.length} drop Corr → {data.dropped_vif.length} drop VIF → {miCount} pass MI → {finalCount} final
      </div>
    </div>
  )
}

function categorizeColumns(cols: string[]): { label: string; cols: string[]; chipClass: string }[] {
  const ohlcv: string[] = [], inds: string[] = [], lags: string[] = [], other: string[] = []
  for (const c of cols) {
    if (/^(open|high|low|close|volume)$/i.test(c)) ohlcv.push(c)
    else if (/_lag\d+$/.test(c)) lags.push(c)
    else if (/^(rsi|ema|sma|macd|bb|atr|stoch|adx|obv|cci|cmf|vwap)/.test(c)) inds.push(c)
    else other.push(c)
  }
  return [
    { label: 'OHLCV', cols: ohlcv, chipClass: 'bg-zinc-800 text-zinc-300 border-zinc-600' },
    { label: 'Indicators', cols: inds, chipClass: 'bg-brand-500/15 text-brand-300 border-brand-500/30' },
    { label: 'Lags', cols: lags, chipClass: 'bg-indigo-500/15 text-indigo-300 border-indigo-500/30' },
    { label: 'Other', cols: other, chipClass: 'bg-zinc-800 text-zinc-400 border-zinc-700' },
  ].filter(g => g.cols.length > 0)
}

const ANALYSIS_TABS: { key: AnalysisTab; label: string; desc: string }[] = [
  { key: 'funnel',     label: 'Funnel Breakdown',     desc: 'Xem chính xác số lượng và lý do cột bị loại ở từng stage, theo đúng thứ tự pipeline.' },
  { key: 'corr',       label: 'Target Corr',       desc: 'Độ mạnh và chiều quan hệ đơn biến với target (Spearman). Dùng để hiểu tín hiệu, không phải quyết định cuối một mình.' },
  { key: 'heatmap',    label: 'Corr Matrix',        desc: 'Nhìn cụm feature trùng thông tin để giải thích vì sao corr filter/VIF loại bỏ.' },
  { key: 'vif',        label: 'VIF (Đa cộng tuyến)', desc: 'Đo mức cột bị giải thích bởi cột khác. VIF cao bị loại sớm để tránh nhiễu cho các stage sau.' },
  { key: 'mi',         label: 'Mutual Info',        desc: 'Độ liên quan phi tuyến giữa feature và target. Dùng để giữ lại top feature trước khi qua model-based ranking.' },
  { key: 'importance', label: 'Tree Importance',    desc: 'Xếp hạng cuối theo đóng góp trong LightGBM để ra bộ feature final.' },
]

export default function FeaturesPage() {
  const qc = useQueryClient()
  const { activeLabeledDatasetId, activeFeatureSetId, setActiveFeatureSet, setTaskProgress, clearTask, taskProgress, taskMessage, taskStatus } = useAppStore()

  const { data: labeledDatasets = [] } = useQuery<LabeledDataset[]>({
    queryKey: ['labeled-datasets'],
    queryFn: () => listLabeledDatasets().then(r => r.data),
  })
  const { data: featureSets = [], isLoading } = useQuery<FeatureSet[]>({
    queryKey: ['featureSets'],
    queryFn: () => listFeatureSets().then(r => r.data),
  })

  const completedLabeledDatasets = labeledDatasets.filter(ld => ld.status === 'completed' && ld.s3_labeled_path)
  const selected = featureSets.find(fs => fs.id === activeFeatureSetId) ?? featureSets[0] ?? null

  const [search, setSearch]                   = useState('')
  const [detailTab, setDetailTab]             = useState<DetailTab>('preview')
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [panelOpen, setPanelOpen]             = useState(false)

  const [formLabeledDatasetId, setFormLabeledDatasetId] = useState(activeLabeledDatasetId ?? '')
  const [fsName, setFsName]                   = useState('')
  const [targetColumn, setTargetColumn]       = useState('')
  const [selectorTask, setSelectorTask]       = useState<'regression' | 'classification'>('regression')
  const [selectorTopK, setSelectorTopK]       = useState(20)
  const [selectedCols, setSelectedCols]       = useState<Set<string>>(new Set())
  const [analysisTab, setAnalysisTab]         = useState<AnalysisTab>('funnel')
  const vifThreshold = 10.0

  const [fsPreview, setFsPreview]             = useState<PreviewData | null>(null)
  const [fsPreviewLoading, setFsPreviewLoading] = useState(false)

  const mountedRef = useRef(true)
  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false } }, [])

  useEffect(() => {
    if (!selected) { setFsPreview(null); return }
    loadFsPreview(selected.id)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.id])

  const activeLabeledDataset = completedLabeledDatasets.find(ld => ld.id === formLabeledDatasetId)
  const featureCols    = activeLabeledDataset?.feature_columns ?? []
  const targetCols     = activeLabeledDataset?.target_columns ?? []
  const inputCols      = featureCols

  const filteredSets = useMemo(() => {
    if (!search.trim()) return featureSets
    const q = search.toLowerCase()
    return featureSets.filter(fs => fs.name.toLowerCase().includes(q))
  }, [featureSets, search])

  function defaultTargetForLabeledDataset(ldId: string): string {
    const ld = completedLabeledDatasets.find(ld => ld.id === ldId)
    return ld?.target_columns?.[0] ?? ''
  }

  async function loadFsPreview(fsId: string) {
    setFsPreview(null); setFsPreviewLoading(true)
    try {
      const res = await previewFeatureSet(fsId)
      if (mountedRef.current) setFsPreview(res.data)
    } catch (e) {
      if (mountedRef.current) toast.error(getApiErrorMessage(e, 'Preview failed'))
    } finally {
      if (mountedRef.current) setFsPreviewLoading(false)
    }
  }

  function openPanel() {
    const defaultLd = completedLabeledDatasets.some(ld => ld.id === activeLabeledDatasetId)
      ? (activeLabeledDatasetId ?? '')
      : (completedLabeledDatasets[0]?.id ?? '')
    setFormLabeledDatasetId(defaultLd)
    setFsName('')
    setAnalysisTab('funnel')
    setSelectedCols(new Set())
    setTargetColumn(defaultLd ? defaultTargetForLabeledDataset(defaultLd) : '')
    setPanelOpen(true)
  }

  useEffect(() => {
    if (!formLabeledDatasetId) return
    if (targetColumn && targetCols.includes(targetColumn)) return
    const nextTarget = defaultTargetForLabeledDataset(formLabeledDatasetId)
    if (nextTarget !== targetColumn) setTargetColumn(nextTarget)
  }, [formLabeledDatasetId, targetColumn, targetCols, completedLabeledDatasets])

  const createMut = useMutation({
    mutationFn: () => createFeatureSet({
      labeled_dataset_id: formLabeledDatasetId,
      name: fsName || `Feature Set — ${activeLabeledDataset?.name ?? formLabeledDatasetId.slice(0, 8)}`,
      target_column: targetColumn,
      task: selectorTask,
      mi_top_k: Math.max(selectorTopK * 3, 50),
      tree_top_k: Math.max(1, selectorTopK),
      vif_threshold: vifThreshold,
      corr_threshold: 0.95,
    }),
    onSuccess: (res) => {
      const fs = res.data
      qc.invalidateQueries({ queryKey: ['featureSets'] })
      setActiveFeatureSet(fs.id)
      setDetailTab('preview')
      setPanelOpen(false)
      toast.success('Feature Selection started!')
      
      const taskId = fs.celery_task_id
      if (taskId) {
        setTaskProgress(taskId, 0, 'Task queued…', 'PENDING')
        connectTaskWS(taskId, (msg) => {
          setTaskProgress(msg.task_id, msg.progress, msg.message, msg.status)
          if (msg.status === 'SUCCESS' || msg.status === 'FAILURE') {
            qc.invalidateQueries({ queryKey: ['featureSets'] })
          }
        }, clearTask)
      }
    },
    onError: (e) => toast.error(getApiErrorMessage(e, 'Failed to start analysis')),
  })

  async function runAnalysis() {
    if (!formLabeledDatasetId || !targetColumn) { toast.error('Select a Labeled Dataset and target column first'); return }
    if (!targetCols.includes(targetColumn)) { toast.error('Selected target is not in this labeled dataset'); return }
    createMut.mutate()
  }

  function handleLabeledDatasetChange(ldId: string) {
    setFormLabeledDatasetId(ldId); setSelectedCols(new Set())
    setTargetColumn(ldId ? defaultTargetForLabeledDataset(ldId) : '')
  }

  function toggleCol(col: string) {
    setSelectedCols(prev => { const n = new Set(prev); if (n.has(col)) n.delete(col); else n.add(col); return n })
  }

  const deleteMut = useMutation({
    mutationFn: (id: string) => deleteFeatureSet(id),
    onSuccess: (_, id) => {
      qc.invalidateQueries({ queryKey: ['featureSets'] })
      if (activeFeatureSetId === id) setActiveFeatureSet(null)
      setFsPreview(null); setConfirmDeleteId(null); toast.success('Deleted')
    },
    onError: (e) => toast.error(getApiErrorMessage(e, 'Delete failed')),
  })

  const categories        = selected ? categorizeColumns(selected.selected_columns) : []
  const selectedAnalysis  = (selected?.analysis_snapshot as AnalysisData | null | undefined) ?? null
  const selectedAnalysisConfig = (selected?.analysis_config as AnalysisConfig | null | undefined) ?? null

  const currentTabMeta = ANALYSIS_TABS.find(t => t.key === analysisTab)
  const detailAnalysisData = selectedAnalysis
  const detailVifThreshold = detailTab === 'analysis'
    ? (selectedAnalysisConfig?.vif_threshold ?? vifThreshold)
    : vifThreshold
  const detailChartFeatureCount = detailAnalysisData ? Math.min(50, Object.keys(detailAnalysisData.spearman_with_target).length) : 0
  const detailBarHeight = Math.max(400, detailChartFeatureCount * 18 + 80)
  const detailChartOption = useMemo(() => {
    if (!detailAnalysisData) return null
    switch (analysisTab) {
      case 'funnel':     return null
      case 'corr':
        return corrBarOption(detailAnalysisData.spearman_with_target, detailAnalysisData.final_selected, detailAnalysisData.dropped_corr)
      case 'mi':
        return miBarOption(detailAnalysisData.mutual_information, detailAnalysisData.final_selected)
      case 'importance':
        return importanceBarOption(detailAnalysisData.feature_importance)
      case 'vif':
        return vifBarOption(detailAnalysisData.vif_scores, detailAnalysisData.dropped_vif, detailVifThreshold)
      case 'heatmap':
        return heatmapOption(detailAnalysisData.inter_feature_corr)
    }
  }, [analysisTab, detailAnalysisData, detailVifThreshold])

  return (
    <>
      <LabPage
        title="Feature Selection"
        subtitle="Phân tích đa chiều để hiểu tại sao cột được chọn — Target Corr, Mutual Info, VIF, LightGBM importance"
        action={
          <button onClick={openPanel} className="btn-primary text-sm px-4 py-2">+ Analyze & Create</button>
        }
        list={
          <div className="flex flex-col h-full">
            <div className="p-3 border-b border-white/[0.06] shrink-0">
              <input className="input text-xs w-full" placeholder="Search feature sets…" value={search} onChange={e => setSearch(e.target.value)} />
            </div>
            <div className="flex-1 overflow-y-auto p-2 space-y-1">
              {isLoading && <div className="text-xs text-zinc-600 px-2 py-3">Loading…</div>}
              {!isLoading && filteredSets.length === 0 && (
                <div className="text-xs text-zinc-600 px-2 py-3">
                  {featureSets.length === 0 ? 'No feature sets yet. Click "+ Analyze & Create".' : 'No matches.'}
                </div>
              )}
              {filteredSets.map(fs => {
                const active = fs.id === selected?.id
                const ld   = labeledDatasets.find(l => l.id === fs.labeled_dataset_id)
                return (
                  <button key={fs.id}
                    onClick={() => { setActiveFeatureSet(fs.id); setConfirmDeleteId(null); setDetailTab('preview') }}
                    className={`w-full text-left px-3 py-3 transition-all duration-150 border-l-2 rounded-r-lg ${active ? 'border-l-brand-400 bg-white/[0.03]' : 'border-l-transparent hover:bg-white/[0.02]'}`}
                  >
                    <div className="text-sm font-medium text-zinc-100 truncate tracking-tight">{fs.name}</div>
                    <div className="text-[10px] text-zinc-500 mt-0.5 flex gap-2 flex-wrap">
                      {ld && <span className="text-brand-400 font-mono">{ld.name ?? ld.id.slice(0, 8)}</span>}
                      <span>{fs.selected_columns.length} features</span><span>·</span>
                      <span className="font-mono text-emerald-400">{fs.target_column}</span>
                    </div>
                    <div className="text-[10px] text-zinc-700 mt-0.5">{new Date(fs.created_at).toLocaleDateString()}</div>
                  </button>
                )
              })}
            </div>
          </div>
        }
        detail={
          <div className="space-y-5">
            {selected && (
              <>
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <h2 className="text-2xl font-semibold text-zinc-50 tracking-tight">{selected.name}</h2>
                    <div className="flex gap-3 mt-1 text-xs text-zinc-500 items-center flex-wrap">
                      {selected.labeled_dataset_id && <span className="font-mono bg-surface px-2 py-0.5 rounded text-brand-400">{labeledDatasets.find(l => l.id === selected.labeled_dataset_id)?.name ?? selected.labeled_dataset_id.slice(0, 8)}</span>}
                      <span><span className="text-zinc-300">{selected.selected_columns.length}</span> features</span>
                      <span>target: <span className="font-mono text-emerald-400">{selected.target_column}</span></span>
                      <span>{new Date(selected.created_at).toLocaleString()}</span>
                    </div>
                  </div>
                  <div className="flex gap-2 shrink-0">
                    {confirmDeleteId === selected.id ? (
                      <div className="flex gap-2 items-center">
                        <span className="text-xs text-zinc-400">Delete?</span>
                        <button onClick={() => deleteMut.mutate(selected.id)} disabled={deleteMut.isPending} className="btn-danger text-xs px-3 py-1.5">{deleteMut.isPending ? '…' : 'Confirm'}</button>
                        <button onClick={() => setConfirmDeleteId(null)} className="btn-secondary text-xs px-3 py-1.5">Cancel</button>
                      </div>
                    ) : (
                      <button onClick={() => setConfirmDeleteId(selected.id)} className="btn-danger text-xs px-3 py-1.5">Delete</button>
                    )}
                  </div>
                </div>
                {selected.status === 'pending' || selected.status === 'running' ? (
                  <div className="mb-4 bg-brand-500/10 border border-brand-500/20 rounded-xl p-4">
                    <div className="flex justify-between items-end mb-2">
                      <div>
                        <div className="text-sm font-semibold text-brand-400 flex items-center gap-2">
                          <span className="w-2 h-2 rounded-full bg-brand-500 animate-pulse" />
                          Feature Selection in Progress...
                        </div>
                        <div className="text-xs text-zinc-400 mt-1">{taskMessage || 'Running background task...'}</div>
                      </div>
                      <div className="text-brand-500 font-mono text-sm">{taskProgress || 0}%</div>
                    </div>
                    <div className="h-2 bg-black/50 rounded-full overflow-hidden border border-white/5">
                      <div className="h-full bg-gradient-to-r from-brand-600 to-brand-400 transition-all duration-300" style={{ width: `${taskProgress || 0}%` }} />
                    </div>
                  </div>
                ) : selected.status === 'failed' ? (
                  <div className="mb-4 bg-red-500/10 border border-red-500/20 rounded-xl p-4">
                    <div className="text-sm font-semibold text-red-400">Analysis Failed</div>
                    <div className="text-xs text-zinc-400 mt-1">{selected.error_message || 'An unknown error occurred during feature selection.'}</div>
                  </div>
                ) : null}

                <div className="flex gap-0 border-b border-white/[0.06]">
                  {(['preview', 'columns', 'analysis'] as DetailTab[]).map(tab => (
                    <button key={tab} onClick={() => setDetailTab(tab)}
                      className={`px-4 py-2.5 text-sm transition-colors border-b-2 -mb-px ${detailTab === tab ? 'border-brand-400 text-zinc-100 font-medium' : 'border-transparent text-zinc-500 hover:text-zinc-300 hover:border-white/[0.10]'}`}
                    >{tab.charAt(0).toUpperCase() + tab.slice(1)}</button>
                  ))}
                </div>

                {detailTab === 'preview' && (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex gap-4 text-xs text-zinc-500">
                        {fsPreview && (<><span><span className="text-zinc-300">{fsPreview.row_count.toLocaleString()}</span> rows</span><span><span className="text-zinc-300">{fsPreview.column_count}</span> cols</span></>)}
                      </div>
                      <button onClick={() => loadFsPreview(selected.id)} className="text-xs text-zinc-500 hover:text-zinc-300">↺ Refresh</button>
                    </div>
                    {fsPreviewLoading && <div className="text-xs text-zinc-600">Loading preview…</div>}
                    {fsPreview && <PreviewTable columns={fsPreview.columns} rows={fsPreview.rows} />}
                  </div>
                )}

                {detailTab === 'columns' && (
                  <div className="space-y-5">
                    <div>
                      <div className="section-label mb-2">Target Column</div>
                      <span className="text-sm font-mono px-3 py-1 rounded-lg border border-emerald-500/40 text-emerald-300 bg-emerald-500/10">{selected.target_column}</span>
                    </div>
                    <div>
                      <div className="section-label mb-3">Feature Columns <span className="text-zinc-700 font-normal normal-case">({selected.selected_columns.length})</span></div>
                      <div className="space-y-4">
                        {categories.map(cat => (
                          <div key={cat.label}>
                            <div className="text-xs text-zinc-500 mb-2">{cat.label} <span className="text-zinc-700">({cat.cols.length})</span></div>
                            <div className="flex flex-wrap gap-1.5">
                              {cat.cols.map(col => <span key={col} className={`text-[11px] font-mono px-2 py-0.5 rounded border ${cat.chipClass}`}>{col}</span>)}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}

                {detailTab === 'analysis' && (
                  <div className="space-y-4">
                    {!selectedAnalysis && (
                      <div className="text-sm text-zinc-500 border border-white/[0.06] rounded-xl p-4 bg-white/[0.02]">
                        This feature set does not have a saved analysis snapshot. Create a new feature set from the analysis panel to keep the charts and scores for later review.
                      </div>
                    )}

                    {selectedAnalysis && (
                      <>
                        <div className="flex items-center justify-between gap-3 flex-wrap">
                          <div className="flex gap-3 text-xs text-zinc-500 flex-wrap">
                            <span>task: <span className="text-zinc-300">{selectedAnalysisConfig?.task ?? 'regression'}</span></span>
                            <span>VIF: <span className="text-zinc-300">{selectedAnalysisConfig?.vif_threshold ?? vifThreshold}</span></span>
                            <span>MI top-k: <span className="text-zinc-300">{selectedAnalysisConfig?.mi_top_k ?? 50}</span></span>
                            <span>Tree top-k: <span className="text-zinc-300">{selectedAnalysisConfig?.tree_top_k ?? 20}</span></span>
                          </div>
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => {
                                const payload = {
                                  exported_at: new Date().toISOString(),
                                  analysis_config: selectedAnalysisConfig,
                                  analysis_data: selectedAnalysis,
                                }
                                downloadTextFile(
                                  `feature-analysis-${selected?.id ?? 'snapshot'}.json`,
                                  JSON.stringify(payload, null, 2),
                                  'application/json;charset=utf-8',
                                )
                              }}
                              className="btn-secondary text-xs px-3 py-1.5 flex items-center gap-1"
                            >
                              <Download className="w-3.5 h-3.5" /> JSON
                            </button>
                            <button
                              onClick={() => {
                                const inputFallback = 0
                                const csv = toAnalysisCsv(selectedAnalysis, selectedAnalysisConfig ?? null, inputFallback)
                                downloadTextFile(
                                  `feature-analysis-${selected?.id ?? 'snapshot'}.csv`,
                                  csv,
                                  'text/csv;charset=utf-8',
                                )
                              }}
                              className="btn-secondary text-xs px-3 py-1.5 flex items-center gap-1"
                            >
                              <Download className="w-3.5 h-3.5" /> CSV
                            </button>
                          </div>
                        </div>

                        <div className="flex items-center gap-1.5 text-[11px] text-zinc-500 flex-wrap">
                          <span className="text-zinc-300 font-medium">{getAnalysisInputCount(selectedAnalysis, 0)}</span><span>features</span>
                          <span className="text-zinc-700 mx-0.5">→</span>
                          <span className="text-amber-400 font-medium">-{selectedAnalysis.dropped_corr.length}</span><span className="text-zinc-600">corr dup</span>
                          <span className="text-zinc-700 mx-0.5">→</span>
                          <span className="text-amber-400 font-medium">-{selectedAnalysis.dropped_vif.length}</span><span className="text-zinc-600">VIF</span>
                          <span className="text-zinc-700 mx-0.5">→</span>
                          <span className="text-indigo-300 font-medium">top {Object.keys(selectedAnalysis.mutual_information).length}</span><span className="text-zinc-600">MI</span>
                          <span className="text-zinc-700 mx-0.5">→</span>
                          <span className="text-brand-300 font-semibold">{selectedAnalysis.final_selected.length} final</span>
                        </div>

                        <div className="flex gap-0 border-b border-white/[0.06] overflow-x-auto">
                          {ANALYSIS_TABS.map(t => (
                            <button key={t.key} onClick={() => setAnalysisTab(t.key)}
                              className={`px-3 py-2 text-xs transition-colors border-b-2 -mb-px whitespace-nowrap shrink-0 ${analysisTab === t.key ? 'border-brand-400 text-zinc-100 font-medium' : 'border-transparent text-zinc-500 hover:text-zinc-300'}`}
                            >{t.label}</button>
                          ))}
                        </div>

                        {currentTabMeta && (
                          <div className="px-4 py-2 border border-white/[0.06] rounded-xl flex items-start gap-2 bg-white/[0.015]">
                            <Info className="w-3.5 h-3.5 text-zinc-500 mt-0.5 shrink-0" />
                            <p className="text-[11px] text-zinc-500 leading-relaxed">{currentTabMeta.desc}</p>
                          </div>
                        )}

                        {analysisTab !== 'funnel' && (
                          <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3 space-y-1.5">
                            <div className="text-[11px] uppercase tracking-wide text-zinc-500">How to Read This Chart</div>
                            {getChartInsights(analysisTab, selectedAnalysis).map((line, idx) => (
                              <p key={idx} className="text-[11px] text-zinc-400 leading-relaxed">{line}</p>
                            ))}
                          </div>
                        )}

                        {analysisTab === 'funnel' ? (
                          <FunnelBreakdown data={selectedAnalysis} inputCols={[]} vifThreshold={selectedAnalysisConfig?.vif_threshold ?? vifThreshold} />
                        ) : detailChartOption ? (
                          <ReactECharts
                            option={detailChartOption}
                            style={{ width: '100%', height: analysisTab === 'heatmap' ? Math.max(400, Object.keys(selectedAnalysis.inter_feature_corr).length * 17 + 140) : detailBarHeight }}
                            theme="dark"
                            opts={{ renderer: 'canvas' }}
                            notMerge
                          />
                        ) : null}
                      </>
                    )}
                  </div>
                )}
              </>
            )}
            {!selected && <EmptyState message="Click &quot;+ Analyze &amp; Create&quot; để tạo feature set từ pipeline" />}
          </div>
        }
      />

      {/* ── Analysis Panel ───────────────────────────────────────────────── */}
      {panelOpen && (
        <>
          <div className="fixed inset-0 z-40 bg-black/60" onClick={() => setPanelOpen(false)} />
          <div className="fixed right-0 top-0 bottom-0 z-50 w-[780px] bg-surface-card border-l border-white/[0.06] flex flex-col shadow-2xl">

            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-white/[0.06] shrink-0">
              <h2 className="font-semibold text-zinc-100">Feature Analysis & Selection</h2>
              <button onClick={() => setPanelOpen(false)} className="text-zinc-500 hover:text-zinc-300 p-1.5 hover:bg-white/[0.06] rounded-lg"><X className="w-4 h-4" /></button>
            </div>

            {/* Config */}
            <div className="px-6 py-4 border-b border-white/[0.06] shrink-0 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label text-xs">Source Labeled Dataset</label>
                  <select className="input text-sm" value={formLabeledDatasetId} onChange={e => handleLabeledDatasetChange(e.target.value)}>
                    <option value="">-- select labeled dataset --</option>
                    {completedLabeledDatasets.map(ld => <option key={ld.id} value={ld.id}>{ld.name ?? ld.id.slice(0, 8)} ({ld.feature_columns?.length ?? 0} features, {ld.target_columns?.length ?? 0} targets)</option>)}
                  </select>
                </div>
                <div>
                  <label className="label text-xs">Target Column</label>
                  <select className="input text-sm" value={targetColumn} onChange={e => setTargetColumn(e.target.value)}>
                    <option value="">-- select target --</option>
                    {targetCols.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
              </div>
              <div className="flex items-end gap-3">
                <div>
                  <label className="label text-xs">Task</label>
                  <select className="input text-sm" value={selectorTask} onChange={e => setSelectorTask(e.target.value as 'regression' | 'classification')}>
                    <option value="regression">regression</option>
                    <option value="classification">classification</option>
                  </select>
                </div>
                <div>
                  <label className="label text-xs">Top-K final</label>
                  <input type="number" min={1} max={200} value={selectorTopK} onChange={e => setSelectorTopK(Number(e.target.value) || 20)} className="input text-sm w-24" />
                </div>
              </div>
              {formLabeledDatasetId && (
                <div className="text-[11px] text-zinc-600">
                  Labeled Dataset <span className="text-zinc-400">{activeLabeledDataset?.name}</span> · {inputCols.length} features · {targetCols.length} targets
                  {' — '}Quá trình phân tích sẽ chạy ngầm và tốn khoảng 1-3 phút tuỳ lượng data.
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="px-6 py-4 border-t border-white/[0.06] shrink-0 space-y-3">
              <div>
                <label className="label text-xs">Feature Set Name <span className="text-zinc-600">(optional)</span></label>
                <input className="input text-sm" value={fsName} onChange={e => setFsName(e.target.value)} placeholder="Auto-generated if blank" />
              </div>
              <div className="flex items-center gap-3">
                <button onClick={() => createMut.mutate()} disabled={createMut.isPending || !targetColumn || !formLabeledDatasetId} className="btn-primary flex-1 text-sm disabled:opacity-50">
                  {createMut.isPending ? 'Starting…' : `Start Background Analysis`}
                </button>
                <button onClick={() => setPanelOpen(false)} className="btn-secondary text-sm px-4">Cancel</button>
              </div>
            </div>

          </div>
        </>
      )}
    </>
  )
}

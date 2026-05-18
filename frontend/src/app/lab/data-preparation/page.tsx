'use client'

import { useEffect, useRef, useMemo, useState } from 'react'
import dynamic from 'next/dynamic'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { listPipelines, listDataPreps, prepareData, previewPreparedData, deleteDataPrep, downloadPreparedData, connectTaskWS, TaskProgress } from '@/lib/api'
import { useAppStore, Pipeline, DataPreparation } from '@/store/appStore'
import { LabPage, StatusBadge, PreviewTable, TaskBar } from '@/components/ui/LabPage'
import { toast } from 'sonner'
import { getApiErrorMessage } from '@/lib/api-error'
import { X, Download, Trash2 } from 'lucide-react'

const ReactECharts = dynamic(() => import('echarts-for-react'), { ssr: false })

interface QualityMetrics {
  row_count?: number; column_count?: number; null_cells?: number; duplicate_candles?: number; gap_segments?: number; corrupted_rows?: number; spikes?: number; expected_interval_sec?: number
}

interface PreparationState {
  beforeMetrics?: QualityMetrics; afterMetrics?: QualityMetrics; rows?: Record<string, any>[]; columns?: { name: string; type: string }[]
}

export default function DataPreparationPage() {
  const qc = useQueryClient()
  const { setTaskProgress, taskProgress, taskMessage, taskStatus, activeTaskId } = useAppStore()
  const wsRef = useRef<WebSocket | null>(null)
  const mountedRef = useRef(true)

  const { data: pipelines = [] } = useQuery<Pipeline[]>({ queryKey: ['pipelines'], queryFn: () => listPipelines().then(r => r.data) })
  const { data: dataPreps = [], isLoading } = useQuery<DataPreparation[]>({
    queryKey: ['dataPreps'],
    queryFn: () => listDataPreps().then(r => r.data),
    refetchInterval: (q) => {
      const data = q.state.data as DataPreparation[] | undefined
      return data?.some(p => p.status === 'pending' || p.status === 'running') ? 2000 : false
    },
  })
  const completedIndicatorPipelines = useMemo(
    () => pipelines.filter(p => p.status === 'completed' && Boolean(p.s3_processed_path)),
    [pipelines],
  )

  const [drawerOpen, setDrawerOpen] = useState(false)
  const [formPipelineId, setFormPipelineId] = useState('')
  const [prepName, setPrepName] = useState('')
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  const [selectedPrepId, setSelectedPrepId] = useState<string | null>(null)
  const [previewData, setPreviewData] = useState<PreparationState | null>(null)
  const [activeTab, setActiveTab] = useState<'overview' | 'data' | 'features'>('overview')

  useEffect(() => () => { mountedRef.current = false }, [])

  const selectedPrep = selectedPrepId ? dataPreps.find(p => p.id === selectedPrepId) : null

  const qualitySummary = useMemo(() => {
    if (!previewData?.beforeMetrics || !previewData?.afterMetrics) return null
    const beforeRows = Number(previewData.beforeMetrics.row_count ?? 0)
    const afterRows = Number(previewData.afterMetrics.row_count ?? 0)
    const removedRows = Math.max(0, beforeRows - afterRows)
    const beforeNulls = Number(previewData.beforeMetrics.null_cells ?? 0)
    const afterNulls = Number(previewData.afterMetrics.null_cells ?? 0)
    const beforeCorrupted = Number(previewData.beforeMetrics.corrupted_rows ?? 0)
    const afterCorrupted = Number(previewData.afterMetrics.corrupted_rows ?? 0)
    const beforeSpikes = Number(previewData.beforeMetrics.spikes ?? 0)
    const afterSpikes = Number(previewData.afterMetrics.spikes ?? 0)
    return {
      removedRows,
      removedPct: beforeRows > 0 ? Number(((removedRows / beforeRows) * 100).toFixed(2)) : 0,
      nullDelta: afterNulls - beforeNulls,
      corruptedDelta: afterCorrupted - beforeCorrupted,
      spikesDelta: afterSpikes - beforeSpikes,
    }
  }, [previewData])

  const chartLegend = {
    data: ['Before', 'After'],
    textStyle: { color: '#e5e7eb' },
  }

  async function loadPreview(prepId: string) {
    try {
      const res = await previewPreparedData(prepId, 200)
      setPreviewData({ beforeMetrics: res.data.quality_before, afterMetrics: res.data.quality_after, rows: res.data.rows, columns: res.data.columns })
    } catch (err) {
      toast.error(`Preview failed: ${getApiErrorMessage(err)}`)
    }
  }

  async function handlePrepare() {
    if (!formPipelineId) { toast.error('Select an indicators pipeline'); return }
    setCreating(true); setCreateError(null)
    try {
      const res = await prepareData({
        pipeline_id: formPipelineId,
        name: prepName || `prep_${Date.now()}`,
        alignment_config: { enabled: true },
        cleaning_config: { enabled: true },
        missing_value_config: { enabled: true },
        normalization_config: { enabled: true, enable_scaling: true },
      })
      const taskId = res.data.celery_task_id as string
      const prepId = res.data.id as string
      setTaskProgress(taskId, 5, 'Preparing data...', 'PROGRESS')
      setDrawerOpen(false)
      setCreating(false)
      setSelectedPrepId(prepId)
      setActiveTab('overview')
      wsRef.current?.close()
      wsRef.current = connectTaskWS(taskId, (data: TaskProgress) => {
        if (!mountedRef.current) return
        setTaskProgress(data.task_id, data.progress, data.message, data.status, data.step, data.sub as Record<string, unknown>)
      }, () => {
        if (mountedRef.current) {
          setTaskProgress(taskId, 100, 'Data preparation completed', 'SUCCESS')
          qc.invalidateQueries({ queryKey: ['dataPreps'] })
          setTimeout(() => loadPreview(prepId), 1000)
        }
      })
    } catch (err) {
      setCreateError(getApiErrorMessage(err))
      setCreating(false)
      toast.error(getApiErrorMessage(err))
    }
  }

  async function handleDelete(prepId: string) {
    if (confirm('Delete this preparation job?')) {
      try {
        await deleteDataPrep(prepId)
        qc.invalidateQueries({ queryKey: ['dataPreps'] })
        setSelectedPrepId(null)
        setPreviewData(null)
        toast.success('Deleted')
      } catch (err) {
        toast.error(getApiErrorMessage(err))
      }
    }
  }

  async function handleDownload(prepId: string) {
    try {
      const res = await downloadPreparedData(prepId)
      const url = window.URL.createObjectURL(new Blob([res.data]))
      const link = document.createElement('a')
      link.href = url
      link.setAttribute('download', `prepared_${prepId}.parquet`)
      document.body.appendChild(link)
      link.click()
      link.parentNode?.removeChild(link)
    } catch (err) {
      toast.error(getApiErrorMessage(err))
    }
  }

  const chartOption = useMemo(() => {
    if (!previewData?.beforeMetrics || !previewData?.afterMetrics) return null
    const metrics = ['row_count', 'null_cells', 'corrupted_rows', 'spikes']
    const before = metrics.map(m => previewData.beforeMetrics?.[m as keyof QualityMetrics] ?? 0)
    const after = metrics.map(m => previewData.afterMetrics?.[m as keyof QualityMetrics] ?? 0)
    return {
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
      legend: chartLegend,
      xAxis: { type: 'category', data: metrics.map(m => m.replace(/_/g, ' ')) },
      yAxis: { type: 'value' },
      series: [
        { name: 'Before', data: before, type: 'bar', itemStyle: { color: '#ef4444' } },
        { name: 'After', data: after, type: 'bar', itemStyle: { color: '#22c55e' } },
      ],
    }
  }, [previewData])

  const step3Option = useMemo(() => {
    if (!previewData?.beforeMetrics || !previewData?.afterMetrics) return null
    return {
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
      legend: chartLegend,
      xAxis: { type: 'category', data: ['Duplicate Candles', 'Gap Segments'] },
      yAxis: { type: 'value' },
      series: [
        { name: 'Before', type: 'bar', data: [previewData.beforeMetrics.duplicate_candles ?? 0, previewData.beforeMetrics.gap_segments ?? 0], itemStyle: { color: '#ef4444' } },
        { name: 'After', type: 'bar', data: [previewData.afterMetrics.duplicate_candles ?? 0, previewData.afterMetrics.gap_segments ?? 0], itemStyle: { color: '#22c55e' } },
      ],
    }
  }, [previewData])

  const step4Option = useMemo(() => {
    if (!previewData?.beforeMetrics || !previewData?.afterMetrics) return null
    return {
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
      legend: chartLegend,
      xAxis: { type: 'category', data: ['Corrupted Rows', 'Spikes'] },
      yAxis: { type: 'value' },
      series: [
        { name: 'Before', type: 'bar', data: [previewData.beforeMetrics.corrupted_rows ?? 0, previewData.beforeMetrics.spikes ?? 0], itemStyle: { color: '#f97316' } },
        { name: 'After', type: 'bar', data: [previewData.afterMetrics.corrupted_rows ?? 0, previewData.afterMetrics.spikes ?? 0], itemStyle: { color: '#10b981' } },
      ],
    }
  }, [previewData])

  const step5Option = useMemo(() => {
    if (!previewData?.beforeMetrics || !previewData?.afterMetrics) return null
    return {
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
      legend: chartLegend,
      xAxis: { type: 'category', data: ['Null Cells'] },
      yAxis: { type: 'value' },
      series: [
        { name: 'Before', type: 'bar', data: [previewData.beforeMetrics.null_cells ?? 0], itemStyle: { color: '#ef4444' } },
        { name: 'After', type: 'bar', data: [previewData.afterMetrics.null_cells ?? 0], itemStyle: { color: '#22c55e' } },
      ],
    }
  }, [previewData])

  const step6Option = useMemo(() => {
    const enabled = Boolean((selectedPrep?.normalization_config as Record<string, unknown> | undefined)?.enabled)
    return {
      tooltip: { trigger: 'item' },
      series: [
        {
          type: 'pie',
          radius: ['58%', '78%'],
          label: { show: true, formatter: '{b}: {d}%' },
          data: enabled
            ? [
                { value: 100, name: 'Normalized', itemStyle: { color: '#22c55e' } },
                { value: 0, name: 'Remaining', itemStyle: { color: '#334155' } },
              ]
            : [
                { value: 0, name: 'Normalized', itemStyle: { color: '#22c55e' } },
                { value: 100, name: 'Remaining', itemStyle: { color: '#334155' } },
              ],
        },
      ],
    }
  }, [selectedPrep])

  const taskBar = activeTaskId ? <TaskBar progress={taskProgress} message={taskMessage} status={taskStatus || "processing"} /> : null

  const listPanel = (
    <div className="flex flex-col gap-2 p-4">
      <button onClick={() => { setDrawerOpen(true); setSelectedPrepId(null) }} className="mb-4 px-4 py-2 bg-violet-600 text-white text-sm rounded-lg hover:bg-violet-700 transition-colors">
        + New Preparation
      </button>
      {dataPreps.length === 0 ? (
        <div className="text-xs text-zinc-500 p-4">No preparations yet</div>
      ) : (
        dataPreps.map(prep => (
          <button key={prep.id} onClick={() => { setSelectedPrepId(prep.id); setActiveTab('overview'); setTimeout(() => loadPreview(prep.id), 100) }} className={`text-left p-3 rounded-lg text-sm transition-colors ${selectedPrepId === prep.id ? 'bg-white/[0.10] border border-white/[0.20]' : 'hover:bg-white/[0.05] border border-transparent'}`}>
            <div className="font-semibold truncate text-xs">{prep.name}</div>
            <div className="text-xs text-zinc-500 mt-1"><StatusBadge status={prep.status} /></div>
          </button>
        ))
      )}
    </div>
  )

  const detailPanel = (
    <div>
      {drawerOpen && (
        <>
          <div className="fixed inset-0 bg-black/50 z-40" onClick={() => setDrawerOpen(false)} />
          <div className="fixed right-0 top-0 bottom-0 w-[500px] bg-zinc-900 border-l border-white/[0.06] z-50 p-6 overflow-y-auto">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-2xl font-bold">New Preparation</h2>
              <button onClick={() => setDrawerOpen(false)}><X size={24} /></button>
            </div>
            <div className="mb-6">
              <label className="block text-sm font-semibold mb-2">Feature Factory Source</label>
              <select value={formPipelineId} onChange={(e) => setFormPipelineId(e.target.value)} className="w-full px-3 py-2 bg-zinc-800 border border-white/[0.10] rounded-lg text-white">
                <option value="">-- select completed feature pipeline --</option>
                {completedIndicatorPipelines.map(p => (<option key={p.id} value={p.id}>{p.name ?? p.id} ({(p.feature_columns ?? []).length} generated)</option>))}
              </select>
              <div className="text-xs text-zinc-400 mt-2">Data Preparation now uses completed output from Feature Factory pipelines.</div>
            </div>
            <div className="mb-6">
              <label className="block text-sm font-semibold mb-2">Job Name (optional)</label>
              <input type="text" value={prepName} onChange={(e) => setPrepName(e.target.value)} placeholder="Auto-generated if blank" className="w-full px-3 py-2 bg-zinc-800 border border-white/[0.10] rounded-lg text-white placeholder:text-zinc-600" />
            </div>
            <div className="mb-6 p-3 rounded border border-white/[0.08] bg-zinc-800/40 text-sm text-zinc-200">
              <div className="font-semibold mb-1">Automatic Production Pipeline</div>
              <div>Timestamp Alignment → Data Cleaning → Missing Value Handling → Normalization</div>
              <div className="text-xs text-zinc-400 mt-2">All 4 steps run automatically when you click Start Preparation.</div>
            </div>
            {createError && (<div className="mb-4 p-3 bg-red-900/30 border border-red-700 rounded text-sm text-red-200">{createError}</div>)}
            <button onClick={handlePrepare} disabled={!formPipelineId || creating} className="w-full px-4 py-2 bg-violet-600 text-white rounded-lg hover:bg-violet-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
              {creating ? 'Preparing...' : 'Start Preparation'}
            </button>
          </div>
        </>
      )}
      {!selectedPrep ? (
        <div className="text-zinc-500 text-sm p-8">Select or create a data preparation job</div>
      ) : (
        <div>
          {taskBar}
          <div className="flex items-center gap-3 mb-6">
            <button onClick={() => { setSelectedPrepId(null); setPreviewData(null) }} className="px-3 py-1 text-sm bg-zinc-800 hover:bg-zinc-700 rounded">← Back</button>
            <h2 className="text-xl font-bold">{selectedPrep.name}</h2>
            <StatusBadge status={selectedPrep.status} />
            <div className="flex-1" />
            <button onClick={() => handleDownload(selectedPrep.id)} className="p-2 hover:bg-white/[0.05] rounded" title="Download"><Download size={20} /></button>
            <button onClick={() => handleDelete(selectedPrep.id)} className="p-2 hover:bg-red-900/20 rounded" title="Delete"><Trash2 size={20} className="text-red-400" /></button>
          </div>
          {previewData && (
            <>
              <div className="mb-4 inline-flex rounded-lg border border-white/[0.10] bg-zinc-900/70 p-1">
                <button
                  onClick={() => setActiveTab('overview')}
                  className={`px-3 py-1.5 text-sm rounded-md transition-colors ${activeTab === 'overview' ? 'bg-white/[0.14] text-white' : 'text-zinc-400 hover:text-zinc-200'}`}
                >
                  Overview
                </button>
                <button
                  onClick={() => setActiveTab('data')}
                  className={`px-3 py-1.5 text-sm rounded-md transition-colors ${activeTab === 'data' ? 'bg-white/[0.14] text-white' : 'text-zinc-400 hover:text-zinc-200'}`}
                >
                  Prepared Data ({previewData.rows?.length ?? 0} rows, {previewData.columns?.length ?? 0} columns)
                </button>
                <button
                  onClick={() => setActiveTab('features')}
                  className={`px-3 py-1.5 text-sm rounded-md transition-colors ${activeTab === 'features' ? 'bg-white/[0.14] text-white' : 'text-zinc-400 hover:text-zinc-200'}`}
                >
                  Features
                </button>
              </div>

              {activeTab === 'overview' && (
                <>
              <div className="grid grid-cols-2 gap-4 mb-6">
                <div className="bg-zinc-900 border border-white/[0.06] rounded-lg p-4">
                  <h3 className="text-sm font-semibold mb-2">Quality Before</h3>
                  <div className="space-y-1 text-sm">
                    <p>Rows: <span className="text-orange-300">{previewData.beforeMetrics?.row_count}</span></p>
                    <p>Corrupted: <span className="text-red-400">{previewData.beforeMetrics?.corrupted_rows ?? 0}</span></p>
                    <p>Spikes: <span className="text-red-400">{previewData.beforeMetrics?.spikes ?? 0}</span></p>
                  </div>
                </div>
                <div className="bg-zinc-900 border border-white/[0.06] rounded-lg p-4">
                  <h3 className="text-sm font-semibold mb-2">Quality After</h3>
                  <div className="space-y-1 text-sm">
                    <p>Rows: <span className="text-green-300">{previewData.afterMetrics?.row_count}</span></p>
                    <p>Corrupted: <span className="text-green-400">{previewData.afterMetrics?.corrupted_rows ?? 0}</span></p>
                    <p>Spikes: <span className="text-green-400">{previewData.afterMetrics?.spikes ?? 0}</span></p>
                  </div>
                </div>
              </div>
              {qualitySummary && (
                <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-6">
                  <div className="bg-zinc-900 border border-white/[0.06] rounded-lg p-3">
                    <div className="text-xs text-zinc-400">Rows Removed</div>
                    <div className="text-lg font-semibold text-zinc-100">{qualitySummary.removedRows}</div>
                    <div className="text-xs text-zinc-400 mt-1">{qualitySummary.removedPct}% of source rows</div>
                  </div>
                  <div className="bg-zinc-900 border border-white/[0.06] rounded-lg p-3">
                    <div className="text-xs text-zinc-400">Null Cells Delta</div>
                    <div className={`text-lg font-semibold ${qualitySummary.nullDelta <= 0 ? 'text-emerald-300' : 'text-red-300'}`}>
                      {qualitySummary.nullDelta > 0 ? '+' : ''}{qualitySummary.nullDelta}
                    </div>
                  </div>
                  <div className="bg-zinc-900 border border-white/[0.06] rounded-lg p-3">
                    <div className="text-xs text-zinc-400">Corrupted Rows Delta</div>
                    <div className={`text-lg font-semibold ${qualitySummary.corruptedDelta <= 0 ? 'text-emerald-300' : 'text-red-300'}`}>
                      {qualitySummary.corruptedDelta > 0 ? '+' : ''}{qualitySummary.corruptedDelta}
                    </div>
                  </div>
                  <div className="bg-zinc-900 border border-white/[0.06] rounded-lg p-3">
                    <div className="text-xs text-zinc-400">Spikes Delta</div>
                    <div className={`text-lg font-semibold ${qualitySummary.spikesDelta <= 0 ? 'text-emerald-300' : 'text-red-300'}`}>
                      {qualitySummary.spikesDelta > 0 ? '+' : ''}{qualitySummary.spikesDelta}
                    </div>
                  </div>
                </div>
              )}
              <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 mb-6">
                {step3Option && (
                  <div className="bg-zinc-900 border border-white/[0.06] rounded-lg p-4 h-80">
                    <div className="flex flex-col mb-3">
                      <h3 className="text-sm font-semibold">Timestamp Alignment</h3>
                      <p className="text-xs text-zinc-400 mt-1">Remove duplicate timestamps and close gaps</p>
                    </div>
                    <ReactECharts option={step3Option} style={{ height: 'calc(100% - 40px)' }} />
                  </div>
                )}
                {step4Option && (
                  <div className="bg-zinc-900 border border-white/[0.06] rounded-lg p-4 h-80">
                    <div className="flex flex-col mb-3">
                      <h3 className="text-sm font-semibold">Data Cleaning</h3>
                      <p className="text-xs text-zinc-400 mt-1">Remove corrupted OHLCV data and extreme price spikes</p>
                    </div>
                    <ReactECharts option={step4Option} style={{ height: 'calc(100% - 40px)' }} />
                  </div>
                )}
                {step5Option && (
                  <div className="bg-zinc-900 border border-white/[0.06] rounded-lg p-4 h-80">
                    <div className="flex flex-col mb-3">
                      <h3 className="text-sm font-semibold">Missing Value Handling</h3>
                      <p className="text-xs text-zinc-400 mt-1">Fill NaN values in critical columns and drop incomplete records</p>
                    </div>
                    <ReactECharts option={step5Option} style={{ height: 'calc(100% - 40px)' }} />
                  </div>
                )}
                {step6Option && (
                  <div className="bg-zinc-900 border border-white/[0.06] rounded-lg p-4 h-80">
                    <div className="flex flex-col mb-3">
                      <h3 className="text-sm font-semibold">Normalization</h3>
                      <p className="text-xs text-zinc-400 mt-1">Scale numeric features to standard distribution for model input</p>
                    </div>
                    <ReactECharts option={step6Option} style={{ height: 'calc(100% - 40px)' }} />
                  </div>
                )}
              </div>
              {chartOption && (
                <div className="bg-zinc-900 border border-white/[0.06] rounded-lg p-4 mb-6 h-96">
                  <h3 className="text-sm font-semibold mb-4">Quality Metrics</h3>
                  <ReactECharts option={chartOption} style={{ height: '100%' }} />
                </div>
              )}
                </>
              )}

              {activeTab === 'data' && previewData?.rows && previewData?.columns && (
                <div className="bg-zinc-900 border border-white/[0.06] rounded-lg p-4">
                  <h3 className="text-sm font-semibold mb-4">Prepared Data ({previewData.rows.length} rows, {previewData.columns.length} columns)</h3>
                  <PreviewTable rows={previewData.rows} columns={previewData.columns} />
                </div>
              )}

              {activeTab === 'features' && previewData?.columns && (
                <div className="bg-zinc-900 border border-white/[0.06] rounded-lg p-4">
                  <h3 className="text-sm font-semibold mb-4">Features Scaling Status</h3>
                  {(() => {
                    const columns = previewData.columns ?? []
                    return (
                  <table className="min-w-full text-xs">
                    <thead>
                      <tr>
                        <th className="text-left py-2 px-2">Column</th>
                        <th className="text-left py-2 px-2">Type</th>
                        <th className="text-left py-2 px-2">Scaled Column</th>
                        <th className="text-left py-2 px-2">Reason</th>
                      </tr>
                    </thead>
                    <tbody>
                      {columns.map(col => {
                        if (col.name.endsWith('_scaled')) return null

                        const scaledColumn = columns.find(c => c.name === `${col.name}_scaled`)
                        const typeLower = col.type.toLowerCase()
                        const isNumeric = ['float', 'int', 'double', 'decimal', 'long'].some(kind => typeLower.includes(kind))
                        const reason = scaledColumn ? '' : (isNumeric ? '' : `Non-numeric: ${col.type}`)

                        return (
                          <tr key={col.name}>
                            <td className="py-2 px-2 font-mono text-zinc-300">{col.name}</td>
                            <td className="py-2 px-2 text-zinc-400">{col.type}</td>
                            <td className={`py-2 px-2 font-mono ${scaledColumn ? 'text-green-400' : 'text-zinc-500'}`}>
                              {scaledColumn ? scaledColumn.name : ''}
                            </td>
                            <td className={`py-2 px-2 ${reason ? 'text-amber-400' : 'text-zinc-500'}`}>
                              {reason}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                    )
                  })()}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )

  return <LabPage title="Data Preparation" subtitle="Alignment, Cleaning, Missing Value Handling, and Normalization" list={listPanel} detail={detailPanel} />
}

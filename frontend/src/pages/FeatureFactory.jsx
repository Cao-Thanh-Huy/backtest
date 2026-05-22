import React, { useState, useEffect, useMemo } from 'react'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import * as api from '../api/client'
import {
  Zap, Database, Play, Trash2, Clock, CheckCircle, AlertCircle, ChevronRight, ArrowRight,
  Download, Eye, RefreshCw, Layers, Sliders, Info, Sparkles, HelpCircle, X, ExternalLink,
  ChevronUp, ChevronDown, CheckCircle2, Shield, Calendar, LayoutGrid, BarChart3, Search, Activity, Plus
} from 'lucide-react'

const S = {
  page: {
    padding: '32px',
    height: '100vh',
    overflowY: 'auto',
    background: 'var(--bg-primary)',
    color: 'var(--text-primary)',
  },
  header: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    marginBottom: 24,
  },
  title: { fontSize: 22, fontWeight: 700, color: '#e2e8f0', display: 'flex', alignItems: 'center', gap: 10 },
  btn: (variant = 'primary', disabled = false) => ({
    display: 'flex', alignItems: 'center', gap: 6,
    padding: '8px 16px', borderRadius: 8, fontWeight: 600, fontSize: 13,
    cursor: disabled ? 'not-allowed' : 'pointer', transition: 'all 0.15s', border: 'none',
    opacity: disabled ? 0.5 : 1,
    ...(variant === 'primary'
      ? { background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', color: '#fff', boxShadow: disabled ? 'none' : '0 4px 12px rgba(99,102,241,0.3)' }
      : variant === 'danger'
        ? { background: '#ef444420', color: '#f87171', border: '1px solid #ef444440' }
        : variant === 'ghost'
          ? { background: 'transparent', color: '#94a3b8', border: '1px solid #334155' }
          : { background: '#1e293b', color: '#94a3b8', border: '1px solid #334155' }
    ),
  }),
  card: {
    background: '#0f172a', border: '1px solid #1e293b',
    borderRadius: 12, overflow: 'hidden',
  },
  table: { width: '100%', borderCollapse: 'collapse', minWidth: 1100 },
  th: {
    padding: '16px 20px', textAlign: 'left',
    fontSize: 11, fontWeight: 700, color: '#64748b',
    textTransform: 'uppercase', letterSpacing: 1,
    borderBottom: '1px solid #1e293b', background: '#0a0f1e',
  },
  td: {
    padding: '16px 20px', borderBottom: '1px solid #1e293b',
    fontSize: 13, color: '#cbd5e1', verticalAlign: 'middle',
  },
  badge: (color) => ({
    display: 'inline-flex', alignItems: 'center', gap: 6,
    padding: '4px 12px', borderRadius: 20, fontSize: 11, fontWeight: 700,
    background: `${color}15`, color: color, border: `1px solid ${color}30`,
    textTransform: 'uppercase', letterSpacing: '0.05em', whiteSpace: 'nowrap'
  }),
  overlay: {
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)',
    zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center',
    backdropFilter: 'blur(4px)',
  },
  drawer: {
    background: '#0f172a', border: '1px solid #1e293b',
    borderRadius: 16, width: '100%', maxWidth: 520,
    maxHeight: '92vh', display: 'flex', flexDirection: 'column',
    overflow: 'hidden', boxShadow: '0 25px 80px #000a',
  },
  drawerHeader: {
    padding: '20px 24px', borderBottom: '1px solid #1e293b',
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    background: '#0a0f1e',
  },
  drawerBody: { padding: '24px', overflowY: 'auto', flex: 1 },
  drawerFooter: {
    padding: '16px 24px', borderTop: '1px solid #1e293b',
    display: 'flex', justifyContent: 'space-between', background: '#0a0f1e',
  },
  label: { fontSize: 12, fontWeight: 600, color: '#94a3b8', marginBottom: 6, display: 'block' },
  input: {
    width: '100%', padding: '10px 12px', borderRadius: 8, fontSize: 13,
    background: '#1e293b', border: '1px solid #334155', color: '#e2e8f0',
    outline: 'none', boxSizing: 'border-box',
  },
  select: {
    width: '100%', padding: '10px 12px', borderRadius: 8, fontSize: 13,
    background: '#1e293b', border: '1px solid #334155', color: '#e2e8f0',
    outline: 'none', cursor: 'pointer',
  },
  formGroup: { marginBottom: 16 },
  row: { display: 'flex', gap: 12 },
  breadcrumb: {
    display: 'flex', alignItems: 'center', gap: 8,
    fontSize: 12, color: '#64748b', marginBottom: 20,
  },
}

const getTimelineSteps = (pipeline) => {
  const status = pipeline.status?.toLowerCase() || 'pending'
  const progress = pipeline.progress || 0
  const message = pipeline.progress_message || ''

  // Step 1: Init
  let step1 = { status: 'pending', desc: 'Waiting to start...', time: null }
  // Step 2: Math Sweep
  let step2 = { status: 'pending', desc: 'Waiting to start math engine...', time: null }
  // Step 3: Lags
  let step3 = { status: 'pending', desc: 'Waiting for feature completion...', time: null }
  // Step 4: Storage
  let step4 = { status: 'pending', desc: 'Waiting for Parquet serialization...', time: null }

  if (status === 'completed') {
    step1 = { status: 'completed', desc: 'Successfully loaded source market data from database.' }
    step2 = { status: 'completed', desc: 'Successfully generated 99 RSI indicator variants (2 to 100).' }
    step3 = { status: 'completed', desc: `Successfully calculated ${pipeline.lags?.length || 0} lag transformations.` }
    step4 = { status: 'completed', desc: `Parquet dataset written successfully to MinIO processed bucket.` }
  } else if (status === 'failed') {
    step1 = { status: 'completed', desc: 'Successfully loaded source market data.' }
    if (progress > 30) {
      step2 = { status: 'completed', desc: 'Math engine finished calculation.' }
      if (progress > 80) {
        step3 = { status: 'completed', desc: 'Lag transformations generated.' }
        step4 = { status: 'failed', desc: 'Failed to write Parquet dataset to MinIO bucket (Storage Error).' }
      } else {
        step3 = { status: 'failed', desc: 'Pipeline interrupted during lag step generation.' }
        step4 = { status: 'pending', desc: 'Storage commit aborted.' }
      }
    } else {
      step2 = { status: 'failed', desc: 'Calculation aborted due to system memory limit or timeout.' }
      step3 = { status: 'pending', desc: 'Lag calculations aborted.' }
      step4 = { status: 'pending', desc: 'Storage commit aborted.' }
    }
  } else if (status === 'running') {
    if (progress <= 25) {
      step1 = { status: 'running', desc: message || 'Querying database for source dataset...' }
    } else {
      step1 = { status: 'completed', desc: 'Successfully loaded source market data.' }
      if (progress <= 80) {
        step2 = { status: 'running', desc: message || `Generating RSI sweeps (${progress}% completed)...` }
      } else {
        step2 = { status: 'completed', desc: 'Successfully generated 99 RSI indicator variants (2 to 100).' }
        if (progress <= 94) {
          step3 = { status: 'running', desc: message || 'Generating lag transformation columns...' }
        } else {
          step3 = { status: 'completed', desc: 'Calculated lag transformations.' }
          step4 = { status: 'running', desc: message || 'Writing Parquet to MinIO storage...' }
        }
      }
    }
  } else if (status === 'pending') {
    step1 = { status: 'running', desc: 'Celery worker is reserving task from queue...' }
  }

  return [
    { title: 'Pipeline Initialization & Data Loading', ...step1, stepNum: 'STEP 1' },
    { title: 'Advanced Math Indicator Sweeps (RSI 2 to 100)', ...step2, stepNum: 'STEP 2' },
    { title: 'Temporal Lag Transformations', ...step3, stepNum: 'STEP 3' },
    { title: 'Parquet Serialization & Data Lake Storage', ...step4, stepNum: 'STEP 4' },
  ]
}

function StatusBadge({ status, progress, progressMessage, isTable, errorMessage }) {
  const map = {
    completed: { color: '#10b981', label: 'Completed', icon: <CheckCircle size={11} /> },
    failed: { color: '#ef4444', label: 'Failed', icon: <AlertCircle size={11} /> },
    running: { color: '#3b82f6', label: 'Running', icon: <RefreshCw size={11} className="spin" /> },
    pending: { color: '#fbbf24', label: 'Pending', icon: <Clock size={11} /> },
    canceled: { color: '#f59e0b', label: 'Canceled', icon: <X size={11} /> }
  }
  let statusLower = status?.toLowerCase()
  if (statusLower === 'failed' && (errorMessage === 'Canceled by user' || progressMessage === 'Canceled by user')) {
    statusLower = 'canceled'
  }
  const { color, label, icon } = map[statusLower] || { color: '#94a3b8', label: status || 'Unknown', icon: <Clock size={11} /> }
  const showProgress = statusLower === 'running' && typeof progress === 'number'

  if (isTable) {
    return (
      <span style={S.badge(color)}>
        {icon} {label} {showProgress ? `(${progress}%)` : ''}
      </span>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, justifyContent: 'center' }}>
      <span style={S.badge(color)}>
        {icon} {label} {showProgress ? `(${progress}%)` : ''}
      </span>
      {showProgress && (
        <div style={{ width: 120, height: 6, background: '#1e293b', borderRadius: 3, overflow: 'hidden', position: 'relative', marginTop: 4 }}>
          <div 
            style={{ 
              width: `${progress}%`, 
              height: '100%', 
              background: '#3b82f6', 
              borderRadius: 3,
              transition: 'width 0.4s ease-out',
              boxShadow: '0 0 8px rgba(59,130,246,0.6)'
            }} 
          />
        </div>
      )}
      {statusLower === 'running' && progressMessage && (
        <div 
          style={{ fontSize: 11, color: '#94a3b8', marginTop: 4 }}
          title={progressMessage}
        >
          {progressMessage}
        </div>
      )}
    </div>
  )
}

function SummaryCard({ icon: Icon, label, value, colorClass, sub, highlight }) {
  const colors = {
    purple: { bg: 'rgba(99,102,241,0.08)', iconBtn: 'rgba(99,102,241,0.15)', text: '#818cf8', glow: 'rgba(99,102,241,0.4)', border: 'rgba(99,102,241,0.3)' },
    green: { bg: 'rgba(16,185,129,0.08)', iconBtn: 'rgba(16,185,129,0.15)', text: '#34d399', glow: 'rgba(16,185,129,0.4)', border: 'rgba(16,185,129,0.3)' },
    red: { bg: 'rgba(239,68,68,0.08)', iconBtn: 'rgba(239,68,68,0.15)', text: '#f87171', glow: 'rgba(239,68,68,0.5)', border: 'rgba(239,68,68,0.4)' },
    cyan: { bg: 'rgba(6,182,212,0.08)', iconBtn: 'rgba(6,182,212,0.15)', text: '#22d3ee', glow: 'rgba(6,182,212,0.4)', border: 'rgba(6,182,212,0.3)' },
    amber: { bg: 'rgba(251,191,36,0.08)', iconBtn: 'rgba(251,191,36,0.15)', text: '#fbbf24', glow: 'rgba(251,191,36,0.4)', border: 'rgba(251,191,36,0.3)' },
  }
  const c = colors[colorClass] || colors.purple

  return (
    <div
      style={{
        background: highlight ? c.bg : 'rgba(15, 23, 42, 0.6)',
        border: `1px solid ${highlight ? c.border : 'var(--border-color)'}`,
        borderRadius: '16px', padding: '24px', position: 'relative', overflow: 'hidden',
        boxShadow: highlight ? `0 0 24px ${c.iconBtn}` : 'var(--shadow-sm)',
        transition: 'all 0.3s ease', display: 'flex', flexDirection: 'column'
      }}
      onMouseEnter={(e) => { e.currentTarget.style.transform = 'translateY(-4px)'; e.currentTarget.style.boxShadow = `0 12px 30px ${c.iconBtn}` }}
      onMouseLeave={(e) => { e.currentTarget.style.transform = 'none'; e.currentTarget.style.boxShadow = highlight ? `0 0 24px ${c.iconBtn}` : 'var(--shadow-sm)' }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
        <div style={{ width: 48, height: 48, borderRadius: '12px', background: c.iconBtn, color: c.text, display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: `0 0 16px ${c.glow}` }}>
          <Icon size={24} strokeWidth={2.5} />
        </div>
      </div>
      <div>
        <div style={{ fontSize: 32, fontWeight: 800, color: highlight ? c.text : 'var(--text-primary)', lineHeight: 1.2, textShadow: highlight ? `0 0 12px ${c.glow}` : 'none' }}>{value}</div>
        <div style={{ fontSize: 13, color: 'var(--text-muted)', fontWeight: 500, letterSpacing: '0.02em', textTransform: 'uppercase', marginTop: 4 }}>{label}</div>
        {sub && <div style={{ fontSize: 12, color: c.text, marginTop: 8, fontWeight: 500, display: 'flex', alignItems: 'center', gap: 6 }}>{highlight && <Activity size={14} />} {sub}</div>}
      </div>
    </div>
  )
}

export default function FeatureFactory() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const detailTab = searchParams.get('tab') || 'metadata'
  const setDetailTab = (tab) => setSearchParams({ tab })

  const [datasets, setDatasets] = useState([])
  const [pipelines, setPipelines] = useState([])
  const [isLoading, setIsLoading] = useState(false)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [deletingId, setDeletingId] = useState(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState(null)
  const [cancelingId, setCancelingId] = useState(null)
  const [confirmCancelId, setConfirmCancelId] = useState(null)
  
  // Search & Filter (List view)
  const [searchQuery, setSearchQuery] = useState('')
  
  // Form States (Inside drawer)
  const [selectedDatasetId, setSelectedDatasetId] = useState('')
  const [pipelineName, setPipelineName] = useState('')
  const [lagsInput, setLagsInput] = useState('1')
  const [rsiMin, setRsiMin] = useState(2)
  const [rsiMax, setRsiMax] = useState(100)
  const [rsiStep, setRsiStep] = useState(1)
  const [includeThreshold, setIncludeThreshold] = useState(true)
  const [includeTrend, setIncludeTrend] = useState(true)
  const [includeRawExtras, setIncludeRawExtras] = useState(true)
  const [includeMultiZone, setIncludeMultiZone] = useState(true)
  const [includeMomentumSlope, setIncludeMomentumSlope] = useState(true)
  const [includeDivergence, setIncludeDivergence] = useState(true)
  const [includeTrendStructure, setIncludeTrendStructure] = useState(true)
  const [includeStatistical, setIncludeStatistical] = useState(true)
  const [includePersistence, setIncludePersistence] = useState(true)
  const [includeCrossovers, setIncludeCrossovers] = useState(true)
  const [selectedIndicator, setSelectedIndicator] = useState('RSI')

  // Details States (Profile view)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [previewData, setPreviewData] = useState(null)
  const [featuresSearchQuery, setFeaturesSearchQuery] = useState('')
  const [ramHistories, setRamHistories] = useState({})

  // Toast notifications
  const [toast, setToast] = useState(null)
  const showToast = (message, type = 'success') => {
    setToast({ message, type })
    setTimeout(() => setToast(null), 3000)
  }

  // Load datasets and pipelines
  const loadAll = async () => {
    setIsLoading(true)
    try {
      const [ds, pipes] = await Promise.all([
        api.listDatasets(),
        api.listPipelines()
      ])
      setDatasets(ds || [])
      setPipelines(pipes || [])
    } catch (e) {
      showToast(e.message || 'Failed to sync data', 'error')
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    loadAll()
  }, [])

  // Auto-polling for running pipelines
  useEffect(() => {
    const hasRunning = pipelines.some(p => p.status === 'pending' || p.status === 'running')
    if (!hasRunning) return

    const timer = setInterval(async () => {
      try {
        const pipeList = await api.listPipelines()
        setPipelines(pipeList || [])
      } catch (err) {
        console.error('Failed to poll pipelines status', err)
      }
    }, 3000)

    return () => clearInterval(timer)
  }, [pipelines])

  // Track dynamic real-time RAM streaming
  useEffect(() => {
    const runningPipelines = pipelines.filter(p => p.status === 'running')
    if (runningPipelines.length > 0) {
      setRamHistories(prev => {
        const next = { ...prev }
        let updated = false
        runningPipelines.forEach(p => {
          if (p.celery_ram_mb !== null && p.celery_ram_mb !== undefined) {
            const currentHistory = next[p.id] || []
            const nowStr = new Date().toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })
            const lastPoint = currentHistory[currentHistory.length - 1]
            if (!lastPoint || lastPoint.time !== nowStr) {
              next[p.id] = [...currentHistory, { time: nowStr, ram: p.celery_ram_mb }]
              updated = true
            }
          }
        })
        return updated ? next : prev
      })
    }
  }, [pipelines])

  // Get active selected pipeline
  const selectedPipeline = useMemo(() => {
    return pipelines.find(p => String(p.id) === String(id))
  }, [pipelines, id])

  // Get active dataset object (in drawer)
  const activeDataset = useMemo(() => {
    return datasets.find(d => String(d.id) === String(selectedDatasetId))
  }, [datasets, selectedDatasetId])

  // Auto pipeline name recommendation
  useEffect(() => {
    if (activeDataset) {
      const cleanSymbol = activeDataset.symbol.replace(/[^a-zA-Z0-9]/g, '')
      const ind = selectedIndicator ? selectedIndicator.toLowerCase() : 'features'
      setPipelineName(`${cleanSymbol}_${activeDataset.timeframe}_${ind}_pipeline`)
    } else {
      setPipelineName('')
    }
  }, [activeDataset, selectedIndicator])

  // Load preview data when entering Profile View and preview tab is active
  useEffect(() => {
    if (!selectedPipeline || selectedPipeline.status !== 'completed') return

    const fetchPreview = async () => {
      setPreviewLoading(true)
      setPreviewData(null)
      try {
        const p = await api.getFeaturePipelinePreview(selectedPipeline.id, 15)
        setPreviewData(p)
      } catch (e) {
        console.error(e)
        showToast('Failed to preview Parquet data', 'error')
      } finally {
        setPreviewLoading(false)
      }
    }

    if (detailTab === 'preview') {
      fetchPreview()
    }
  }, [selectedPipeline, detailTab])

  // Live column estimation calculation
  const estimation = useMemo(() => {
    if (selectedIndicator !== 'RSI') {
      return {
        rsiCycles: 0,
        width: 0,
        lagsCount: 0,
        totalColumns: 0,
        overLimit: false
      }
    }
    const min = parseInt(rsiMin) || 2
    const max = parseInt(rsiMax) || 100
    const step = parseInt(rsiStep) || 1
    
    // Number of RSI periods
    const rsiCycles = Math.max(1, Math.floor((max - min) / step) + 1)
    
    // Width (columns per cycle)
    let width = 1
    if (includeThreshold) width += 2
    if (includeTrend) width += 1
    if (includeRawExtras) width += 5
    if (includeMultiZone) width += 3
    if (includeMomentumSlope) width += 6
    if (includeDivergence) width += 4
    if (includeTrendStructure) width += 5
    if (includeStatistical) width += 4
    if (includePersistence) width += 4
    if (includeCrossovers) width += 3
    
    // Lags count
    const lagList = lagsInput
      .split(',')
      .map(x => x.trim())
      .filter(x => x && !isNaN(x))
      .map(Number)
    const lagsCount = lagList.length
    
    const baseColumns = rsiCycles * width
    const totalColumns = baseColumns * (1 + lagsCount)

    return {
      rsiCycles,
      width,
      lagsCount,
      totalColumns,
      overLimit: totalColumns > 10000
    }
  }, [rsiMin, rsiMax, rsiStep, includeThreshold, includeTrend, includeRawExtras, includeMultiZone, includeMomentumSlope, includeDivergence, includeTrendStructure, includeStatistical, includePersistence, includeCrossovers, lagsInput, selectedIndicator])

  // Create Pipeline action
  const handleCreatePipeline = async (e) => {
    e.preventDefault()
    if (!selectedDatasetId) {
      showToast('Please select a source dataset!', 'error')
      return
    }
    if (estimation.overLimit) {
      showToast('Total columns exceeds the 10,000 limit!', 'error')
      return
    }

    setGenerating(true)
    try {
      const lagList = lagsInput
        .split(',')
        .map(x => x.trim())
        .filter(x => x && !isNaN(x))
        .map(Number)

      const payload = {
        dataset_id: selectedDatasetId,
        name: pipelineName || `${activeDataset.symbol}_${activeDataset.timeframe}_pipeline`,
        indicators: [
          {
            name: 'rsi',
            params: {
              include_threshold: includeThreshold,
              include_trend: includeTrend,
              include_raw_extras: includeRawExtras,
              include_multi_zone: includeMultiZone,
              include_momentum_slope: includeMomentumSlope,
              include_divergence: includeDivergence,
              include_trend_structure: includeTrendStructure,
              include_statistical: includeStatistical,
              include_persistence: includePersistence,
              include_crossovers: includeCrossovers
            },
            params_sweep: {
              length: {
                min: parseInt(rsiMin),
                max: parseInt(rsiMax),
                step: parseInt(rsiStep)
              }
            }
          }
        ],
        lags: lagList
      }

      await api.generateFeaturePipeline(payload)
      showToast('Feature generation process initiated!', 'success')
      setDrawerOpen(false)
      loadAll()

      // Reset form
      setSelectedDatasetId('')
      setLagsInput('1')
      setRsiMin(2)
      setRsiMax(100)
      setRsiStep(1)
      setIncludeThreshold(true)
      setIncludeTrend(true)
      setIncludeRawExtras(true)
      setIncludeMultiZone(true)
      setIncludeMomentumSlope(true)
      setIncludeDivergence(true)
      setIncludeTrendStructure(true)
      setIncludeStatistical(true)
      setIncludePersistence(true)
      setIncludeCrossovers(true)
    } catch (err) {
      showToast(err.message || 'Failed to create feature pipeline', 'error')
    } finally {
      setGenerating(false)
    }
  }

  // Generate sample feature dataset (identical to user's setup)
  const handleGenerateSample = async () => {
    if (datasets.length === 0) {
      showToast('Không tìm thấy nguồn dữ liệu. Vui lòng tạo hoặc nạp thử nghiệm dữ liệu thị trường (Market Intake) trước!', 'error')
      return
    }

    setGenerating(true)
    try {
      // Find BTCUSDT 1m dataset as standard sample if possible, otherwise any first dataset
      const sampleDs = datasets.find(d => d.symbol === 'BTCUSDT' && d.timeframe === '1m') || datasets[0]
      
      const payload = {
        dataset_id: sampleDs.id,
        name: `${sampleDs.symbol}_${sampleDs.timeframe}_rsi_pipeline_sample`,
        indicators: [
          {
            name: 'rsi',
            params: {
              include_threshold: true,
              include_trend: true,
              include_raw_extras: true,
              include_multi_zone: true,
              include_momentum_slope: true,
              include_divergence: true,
              include_trend_structure: true,
              include_statistical: true,
              include_persistence: true,
              include_crossovers: true
            },
            params_sweep: {
              length: {
                min: 2,
                max: 100,
                step: 1
              }
            }
          }
        ],
        lags: [1]
      }

      await api.generateFeaturePipeline(payload)
      showToast('Kích hoạt tiến trình tạo feature mẫu thành công!', 'success')
      loadAll()
    } catch (err) {
      showToast(err.message || 'Failed to generate sample feature pipeline', 'error')
    } finally {
      setGenerating(false)
    }
  }

  // Delete Pipeline action
  const handleDeletePipeline = (pipeId, e) => {
    if (e) e.stopPropagation()
    setConfirmDeleteId(pipeId)
  }

  const executeDelete = async () => {
    const pipeId = confirmDeleteId
    setConfirmDeleteId(null)
    if (!pipeId || deletingId) return
    setDeletingId(pipeId)
    try {
      await api.deletePipeline(pipeId)
      showToast('Feature dataset deleted successfully!', 'success')
      if (selectedPipeline?.id === pipeId) navigate('/feature-factory')
      loadAll()
    } catch (err) {
      showToast(err.message || 'Deletion failed', 'error')
    } finally {
      setDeletingId(null)
    }
  }

  // Cancel Pipeline actions
  const handleCancelPipeline = (pipeId, e) => {
    if (e) e.stopPropagation()
    setConfirmCancelId(pipeId)
  }

  const executeCancel = async () => {
    const pipeId = confirmCancelId
    setConfirmCancelId(null)
    if (!pipeId || cancelingId) return
    setCancelingId(pipeId)
    try {
      await api.cancelPipeline(pipeId)
      showToast('Đã hủy tiến trình thành công!', 'success')
      if (selectedPipeline?.id === pipeId) {
        // Reload detail state if open
        const updated = await api.getPipeline(pipeId)
        setPipelines(prev => prev.map(p => p.id === pipeId ? updated : p))
      }
      loadAll()
    } catch (err) {
      showToast(err.message || 'Hủy tiến trình thất bại', 'error')
    } finally {
      setCancelingId(null)
    }
  }

  // Direct parquet download
  const handleDownloadParquet = async (pipeline, e) => {
    if (e) e.stopPropagation()
    try {
      const res = await api.getFeaturePipelineDownload(pipeline.id)
      if (res && res.url) {
        window.open(res.url, '_blank')
        showToast('Initiating Parquet file download...', 'success')
      } else {
        throw new Error('No download url')
      }
    } catch (err) {
      showToast(err.message || 'Failed to retrieve download link', 'error')
    }
  }

  // Statistics calculation for history list
  const filteredPipelines = useMemo(() => {
    let list = pipelines
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim()
      list = list.filter(p => p.name.toLowerCase().includes(q))
    }
    return list
  }, [pipelines, searchQuery])

  // Feature columns search
  const filteredFeaturesList = useMemo(() => {
    if (!selectedPipeline || !selectedPipeline.feature_columns) return []
    let list = selectedPipeline.feature_columns
    if (featuresSearchQuery.trim()) {
      const q = featuresSearchQuery.toLowerCase().trim()
      list = list.filter(f => f.toLowerCase().includes(q))
    }
    return list
  }, [selectedPipeline, featuresSearchQuery])

  // Counters
  const counters = useMemo(() => {
    const total = pipelines.length
    const running = pipelines.filter(p => p.status === 'pending' || p.status === 'running').length
    const completed = pipelines.filter(p => p.status === 'completed').length
    const totalFeatures = pipelines.reduce((sum, p) => sum + (p.feature_columns?.length || 0), 0)
    return { total, running, completed, totalFeatures }
  }, [pipelines])

  // PROFILE VIEW (when selectedPipeline is active)
  if (id) {
    if (isLoading && !selectedPipeline) {
      return (
        <div style={{ ...S.page, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '80vh', color: '#64748b' }}>
          <RefreshCw size={24} className="spin" style={{ marginBottom: 15 }} />
          <span>Loading Feature Dataset information...</span>
        </div>
      )
    }

    if (!selectedPipeline) {
      return (
        <div style={{ ...S.page, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '80vh', color: '#64748b', gap: 16 }}>
          <AlertCircle size={40} color="#ef4444" />
          <h2 style={{ color: '#e2e8f0', margin: 0 }}>Dataset Not Found</h2>
          <p style={{ color: '#64748b', margin: 0 }}>Feature pipeline with ID {id} does not exist or has been deleted.</p>
          <button style={{ ...S.btn('primary'), height: 44, borderRadius: 12 }} onClick={() => navigate('/feature-factory')}>
            Back to List
          </button>
        </div>
      )
    }

    const rsiConfig = selectedPipeline.indicators_config?.find(ind => ind.name === 'rsi')
    const min = rsiConfig?.params_sweep?.length?.min || '2'
    const max = rsiConfig?.params_sweep?.length?.max || '100'
    const step = rsiConfig?.params_sweep?.length?.step || '1'
    const sourceDs = datasets.find(d => d.id === selectedPipeline.dataset_id)

    return (
      <div style={S.page}>
        {toast && (
          <div style={{
            position: 'fixed', top: 24, right: 24, zIndex: 1100,
            background: toast.type === 'error' ? '#ef4444' : '#10b981',
            color: '#fff', padding: '12px 24px', borderRadius: 8,
            fontWeight: 600, fontSize: 13, boxShadow: '0 10px 30px rgba(0,0,0,0.3)',
            display: 'flex', alignItems: 'center', gap: 8,
          }}>
            {toast.type === 'error' ? <AlertCircle size={16} /> : <CheckCircle size={16} />}
            {toast.message}
          </div>
        )}

        {/* Breadcrumb */}
        <div style={S.breadcrumb}>
          <span style={{ cursor: 'pointer' }} onClick={() => navigate('/feature-factory')}>Feature Factory</span>
          <ChevronRight size={10} />
          <span style={{ color: '#e2e8f0', fontWeight: 500 }}>{selectedPipeline.name} Profile</span>
        </div>

        {/* Header */}
        <div style={{ ...S.header, marginBottom: 32 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <button
              onClick={() => navigate('/feature-factory')}
              style={{ ...S.btn('ghost'), width: 44, height: 44, padding: 0, justifyContent: 'center', borderRadius: 12, border: '1px solid rgba(255,255,255,0.06)', background: 'rgba(255,255,255,0.02)' }}
              title="Back to list"
            >
              <ArrowRight size={16} style={{ transform: 'rotate(180deg)' }} />
            </button>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ background: 'rgba(99,102,241,0.1)', padding: 12, borderRadius: 16, display: 'flex', boxShadow: '0 0 20px rgba(99,102,241,0.15)' }}>
                <Zap size={28} color="#8b5cf6" style={{ filter: 'drop-shadow(0 0 8px rgba(99,102,241,0.5))' }} />
              </div>
              <div>
                <h1 style={{ ...S.title, fontSize: 24, margin: 0, display: 'flex', alignItems: 'center', gap: 10 }}>
                  {selectedPipeline.name}
                  <span style={{ fontSize: 10, color: '#475569', fontWeight: 500, letterSpacing: 1 }}>FEATURE FACTORY PROFILE</span>
                </h1>
                <p style={{ fontSize: '13px', color: '#64748b', marginTop: 4, margin: 0 }}>
                  Source: <span style={{ color: '#818cf8', fontWeight: 600 }}>{sourceDs ? `${sourceDs.symbol} (${sourceDs.timeframe})` : 'Original Dataset'}</span> • Period: <span style={{ color: '#10b981', fontWeight: 600 }}>RSI {min}-{max} ({step})</span>
                </p>
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            {(selectedPipeline.status === 'running' || selectedPipeline.status === 'pending') && (
              <button
                onClick={(e) => handleCancelPipeline(selectedPipeline.id, e)}
                style={{ ...S.btn('secondary'), height: 44, padding: '0 20px', borderRadius: 12, background: 'rgba(251,191,36,0.1)', color: '#fbbf24', border: '1px solid rgba(251,191,36,0.3)', marginRight: 0 }}
              >
                <X size={16} /> Cancel Running
              </button>
            )}
            <button 
              onClick={() => handleDeletePipeline(selectedPipeline.id)}
              style={{ ...S.btn('danger'), height: 44, padding: '0 20px', borderRadius: 12 }}
              disabled={deletingId === selectedPipeline.id}
            >
              <Trash2 size={16} /> Delete Dataset
            </button>
          </div>
        </div>

        {/* Tab Selection card */}
        <div style={S.card}>
          <div style={{ display: 'flex', borderBottom: '1px solid #1e293b', background: '#0a0f1e', padding: '0 16px', borderTopLeftRadius: 12, borderTopRightRadius: 12 }}>
            <button
              style={{
                padding: '16px 20px', background: 'none', border: 'none', fontSize: 13, fontWeight: 600, cursor: 'pointer',
                color: detailTab === 'metadata' ? '#10b981' : '#64748b',
                borderBottom: `2px solid ${detailTab === 'metadata' ? '#10b981' : 'transparent'}`,
                transition: 'all 0.15s'
              }}
              onClick={() => setDetailTab('metadata')}
            >
              <Info size={14} style={{ display: 'inline', marginRight: 8, verticalAlign: 'middle' }} />
              Metadata Configuration
            </button>
            <button
              style={{
                padding: '16px 20px', background: 'none', border: 'none', fontSize: 13, fontWeight: 600, cursor: 'pointer',
                color: detailTab === 'timeline' ? '#10b981' : '#64748b',
                borderBottom: `2px solid ${detailTab === 'timeline' ? '#10b981' : 'transparent'}`,
                transition: 'all 0.15s'
              }}
              onClick={() => setDetailTab('timeline')}
            >
              <Clock size={14} style={{ display: 'inline', marginRight: 8, verticalAlign: 'middle' }} />
              Live Run Timeline
            </button>
            <button
              style={{
                padding: '16px 20px', background: 'none', border: 'none', fontSize: 13, fontWeight: 600, cursor: 'pointer',
                color: detailTab === 'monitor' ? '#10b981' : '#64748b',
                borderBottom: `2px solid ${detailTab === 'monitor' ? '#10b981' : 'transparent'}`,
                transition: 'all 0.15s'
              }}
              onClick={() => setDetailTab('monitor')}
            >
              <Activity size={14} style={{ display: 'inline', marginRight: 8, verticalAlign: 'middle' }} />
              Celery Memory Monitor
            </button>
            <button
              style={{
                padding: '16px 20px', background: 'none', border: 'none', fontSize: 13, fontWeight: 600, cursor: 'pointer',
                color: detailTab === 'features' ? '#10b981' : '#64748b',
                borderBottom: `2px solid ${detailTab === 'features' ? '#10b981' : 'transparent'}`,
                transition: 'all 0.15s'
              }}
              onClick={() => setDetailTab('features')}
            >
              <Layers size={14} style={{ display: 'inline', marginRight: 8, verticalAlign: 'middle' }} />
              Features List ({selectedPipeline.feature_columns?.length || 0})
            </button>
            <button
              style={{
                padding: '16px 20px', background: 'none', border: 'none', fontSize: 13, fontWeight: 600, cursor: 'pointer',
                color: detailTab === 'preview' ? '#10b981' : '#64748b',
                borderBottom: `2px solid ${detailTab === 'preview' ? '#10b981' : 'transparent'}`,
                transition: 'all 0.15s'
              }}
              onClick={() => setDetailTab('preview')}
            >
              <LayoutGrid size={14} style={{ display: 'inline', marginRight: 8, verticalAlign: 'middle' }} />
              Preview
            </button>
          </div>

          <div style={{ padding: '24px' }}>
            {/* Tab content: PREVIEW */}
            {detailTab === 'preview' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {selectedPipeline.status !== 'completed' ? (
                  <div style={{ textAlign: 'center', padding: '60px 0', color: '#64748b', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
                    <Clock size={40} className="spin" color="#fbbf24" />
                    <span>The feature dataset is currently being calculated on the backend. Please check back when completed.</span>
                  </div>
                ) : previewLoading ? (
                  <div style={{ textAlign: 'center', padding: '60px 0', color: '#64748b' }}>
                    <RefreshCw size={24} className="spin" style={{ margin: '0 auto 15px auto' }} />
                    Loading Parquet dataset from MinIO...
                  </div>
                ) : !previewData || !previewData.columns ? (
                  <div style={{ textAlign: 'center', padding: '60px 0', color: '#64748b' }}>
                    No preview data available.
                  </div>
                ) : (
                  <div style={{ overflowX: 'auto', border: '1px solid #1e293b', borderRadius: 8, background: '#070a14' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, textAlign: 'left' }}>
                      <thead style={{ background: '#0a0f1e', borderBottom: '1px solid #1e293b' }}>
                        <tr>
                          {previewData.columns.map(c => (
                            <th key={c.name} style={{ padding: '12px 16px', fontWeight: 600, color: '#e2e8f0', borderBottom: '1px solid #1e293b', whiteSpace: 'nowrap' }}>
                              <div>{c.name}</div>
                              <div style={{ fontSize: 9, color: '#64748b', fontFamily: 'monospace', textTransform: 'uppercase', marginTop: 4 }}>{c.type}</div>
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {previewData.rows.map((row, ri) => (
                          <tr key={ri} style={{ borderBottom: '1px solid #1e293b', background: ri % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.01)' }}>
                            {previewData.columns.map(c => (
                              <td key={c.name} style={{ padding: '12px 16px', color: '#cbd5e1', fontFamily: 'monospace' }}>
                                {row[c.name] !== undefined && row[c.name] !== null ? String(row[c.name]) : '—'}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            {/* Tab content: FEATURES LIST */}
            {detailTab === 'features' && (
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, background: '#1e293b', borderRadius: 8, padding: '10px 16px', marginBottom: 20 }}>
                  <Search size={16} color="#64748b" />
                  <input
                    type="text"
                    style={{ background: 'transparent', border: 'none', color: '#e2e8f0', fontSize: 13, outline: 'none', width: '100%' }}
                    placeholder="Search features (e.g. rsi_14_lag1)..."
                    value={featuresSearchQuery}
                    onChange={e => setFeaturesSearchQuery(e.target.value)}
                  />
                  {featuresSearchQuery && <button onClick={() => setFeaturesSearchQuery('')} style={{ background: 'none', border: 'none', color: '#64748b', cursor: 'pointer' }}><X size={14} /></button>}
                </div>

                {!selectedPipeline.feature_columns || selectedPipeline.feature_columns.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: '40px 0', color: '#64748b' }}>No feature columns generated yet.</div>
                ) : filteredFeaturesList.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: '40px 0', color: '#64748b' }}>No columns matched your search query.</div>
                ) : (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 12 }}>
                    {filteredFeaturesList.map((col, idx) => (
                      <div key={idx} style={{ background: '#0a0f1e', border: '1px solid #1e293b', borderRadius: 8, padding: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
                        <Sparkles size={12} color="#8b5cf6" />
                        <span style={{ fontSize: 12, color: '#e2e8f0', fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={col}>
                          {col}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Tab content: METADATA */}
            {detailTab === 'metadata' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
                  {/* Indicators settings */}
                  <div style={{ background: '#0a0f1e', border: '1px solid #1e293b', borderRadius: 12, padding: 20 }}>
                    <div style={{ fontSize: 14, fontWeight: 700, color: '#e2e8f0', borderBottom: '1px solid #1e293b', paddingBottom: 10, marginBottom: 15, display: 'flex', alignItems: 'center', gap: 8 }}>
                      <Sliders size={16} color="#6366f1" /> Indicator & Lags Configuration
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, fontSize: 13 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span style={{ color: '#94a3b8' }}>RSI Sweep Range:</span>
                        <span style={{ color: '#cbd5e1', fontWeight: 600 }}>{min} to {max} (step {step})</span>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span style={{ color: '#94a3b8' }}>Lag Steps (Lags):</span>
                        <span style={{ color: '#818cf8', fontWeight: 600 }}>{selectedPipeline.lags?.join(', ') || 'None'}</span>
                      </div>

                      <div style={{ borderTop: '1px solid #1e293b', paddingTop: 12, marginTop: 4, display: 'flex', flexDirection: 'column', gap: 10 }}>
                        <div style={{ fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.5 }}>Advanced Parameters Status</div>
                        
                        {[
                          { label: 'Threshold Crossover (>50 & <50)', key: 'include_threshold' },
                          { label: 'Trend Direction Analysis', key: 'include_trend' },
                          { label: 'Raw Extras & Normalized Distances', key: 'include_raw_extras' },
                          { label: 'Multi-zone Market Regimes', key: 'include_multi_zone' },
                          { label: 'Momentum & Regression Slope', key: 'include_momentum_slope' },
                          { label: 'Classic & Hidden Divergences', key: 'include_divergence' },
                          { label: 'Trend Structure & Range Shifts', key: 'include_trend_structure' },
                          { label: 'Statistical Rolling Metrics', key: 'include_statistical' },
                          { label: 'Temporal Persistence (JIT)', key: 'include_persistence' },
                          { label: 'Crossovers & Fast/Slow Spread', key: 'include_crossovers' },
                        ].map((opt, i) => {
                          const isActive = !!rsiConfig?.params?.[opt.key]
                          return (
                            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12 }}>
                              <span style={{ color: '#94a3b8' }}>{opt.label}:</span>
                              <span style={{
                                padding: '2px 8px', borderRadius: 6, fontSize: 10, fontWeight: 700,
                                background: isActive ? 'rgba(16,185,129,0.1)' : 'rgba(239,68,68,0.1)',
                                color: isActive ? '#10b981' : '#ef4444',
                                border: `1px solid ${isActive ? 'rgba(16,185,129,0.2)' : 'rgba(239,68,68,0.2)'}`
                              }}>
                                {isActive ? 'ACTIVE' : 'INACTIVE'}
                              </span>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  </div>

                  {/* System execution metrics */}
                  <div style={{ background: '#0a0f1e', border: '1px solid #1e293b', borderRadius: 12, padding: 20 }}>
                    <div style={{ fontSize: 14, fontWeight: 700, color: '#e2e8f0', borderBottom: '1px solid #1e293b', paddingBottom: 10, marginBottom: 15, display: 'flex', alignItems: 'center', gap: 8 }}>
                      <Database size={16} color="#10b981" /> System Execution & Storage
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, fontSize: 13 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span style={{ color: '#94a3b8' }}>Total Feature Columns:</span>
                        <span style={{ color: '#10b981', fontWeight: 700 }}>{(selectedPipeline.feature_columns?.length || 0).toLocaleString()} columns</span>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span style={{ color: '#94a3b8' }}>Data Lake Path (MinIO):</span>
                        <span style={{ color: '#cbd5e1', fontFamily: 'monospace', fontSize: 11 }}>processed-data/pipelines/{selectedPipeline.id}.parquet</span>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span style={{ color: '#94a3b8' }}>Created At:</span>
                        <span style={{ color: '#cbd5e1' }}>{new Date(selectedPipeline.created_at).toLocaleString('en-US')}</span>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ color: '#94a3b8' }}>Pipeline Status:</span>
                        <StatusBadge status={selectedPipeline.status} progress={selectedPipeline.progress} progressMessage={selectedPipeline.progress_message} errorMessage={selectedPipeline.error_message} />
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Tab content: LIVE RUN TIMELINE */}
            {detailTab === 'timeline' && (
              <div>
                {/* Live Execution Timeline & Run History */}
                <div style={{ background: '#0a0f1e', border: '1px solid #1e293b', borderRadius: 12, padding: 24 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: '#e2e8f0', borderBottom: '1px solid #1e293b', paddingBottom: 12, marginBottom: 20, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <Activity size={16} color="#3b82f6" />
                      Live Execution Timeline & Run History
                    </div>
                    {selectedPipeline.status?.toLowerCase() === 'running' && (
                      <span style={{ fontSize: 11, background: 'rgba(59,130,246,0.1)', border: '1px solid rgba(59,130,246,0.3)', padding: '4px 12px', borderRadius: 20, color: '#3b82f6', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
                        <RefreshCw size={11} className="spin" />
                        ACTIVE RUN: {selectedPipeline.progress || 0}%
                      </span>
                    )}
                  </div>

                  <div style={{ position: 'relative', paddingLeft: 36, display: 'flex', flexDirection: 'column', gap: 24 }}>
                    {/* Connecting line */}
                    <div style={{ position: 'absolute', left: 11, top: 12, bottom: 12, width: 2, background: 'linear-gradient(180deg, #10b981 0%, #3b82f6 50%, #1e293b 100%)', zIndex: 0 }} />

                    {getTimelineSteps(selectedPipeline).map((step, idx) => {
                      let iconColor = '#64748b'
                      let iconBg = '#070a14'
                      let stepIcon = <Clock size={12} color="#64748b" />
                      let borderStyle = '1px solid #1e293b'

                      if (step.status === 'completed') {
                        iconColor = '#10b981'
                        iconBg = 'rgba(16,185,129,0.1)'
                        stepIcon = <CheckCircle2 size={12} color="#10b981" />
                        borderStyle = '1px solid rgba(16,185,129,0.2)'
                      } else if (step.status === 'running') {
                        iconColor = '#3b82f6'
                        iconBg = 'rgba(59,130,246,0.1)'
                        stepIcon = <RefreshCw size={12} color="#3b82f6" className="spin" />
                        borderStyle = '1px solid rgba(59,130,246,0.3)'
                      } else if (step.status === 'failed') {
                        iconColor = '#ef4444'
                        iconBg = 'rgba(239,68,68,0.1)'
                        stepIcon = <AlertCircle size={12} color="#ef4444" />
                        borderStyle = '1px solid rgba(239,68,68,0.2)'
                      }

                      return (
                        <div key={idx} style={{ position: 'relative', display: 'flex', gap: 16, zIndex: 1 }}>
                          {/* Timeline node */}
                          <div style={{
                            position: 'absolute', left: -36, top: 2, width: 24, height: 24, borderRadius: '50%',
                            background: iconBg, border: `2px solid ${iconColor}`, display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2
                          }}>
                            {stepIcon}
                          </div>

                          {/* Step card */}
                          <div style={{ flex: 1, background: '#070a14', border: borderStyle, borderRadius: 8, padding: 16, display: 'flex', flexDirection: 'column', gap: 6 }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                              <span style={{ fontSize: 10, fontWeight: 700, color: iconColor, letterSpacing: '0.05em' }}>{step.stepNum}</span>
                              <span style={{ fontSize: 10, color: iconColor, textTransform: 'uppercase', fontWeight: 700 }}>{step.status}</span>
                            </div>
                            <div style={{ fontSize: 13, fontWeight: 600, color: '#cbd5e1' }}>{step.title}</div>
                            <div style={{ fontSize: 12, color: '#94a3b8' }}>{step.desc}</div>

                            {/* Inner progress bar for active running step */}
                            {step.status === 'running' && selectedPipeline.progress && (
                              <div style={{ width: '100%', height: 4, background: '#1e293b', borderRadius: 2, overflow: 'hidden', marginTop: 8 }}>
                                <div 
                                  style={{ 
                                    width: `${selectedPipeline.progress}%`, 
                                    height: '100%', 
                                    background: '#3b82f6', 
                                    borderRadius: 2,
                                    transition: 'width 0.4s ease-out',
                                    boxShadow: '0 0 8px rgba(59,130,246,0.6)'
                                  }} 
                                />
                              </div>
                            )}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              </div>
            )}

            {/* Tab content: CELERY MEMORY MONITOR */}
            {detailTab === 'monitor' && (
              <div>
                {/* Dynamic Memory Streaming Area Chart */}
                  {(() => {
                    const history = ramHistories[selectedPipeline.id] || []
                    const svgWidth = 500
                    const svgHeight = 130
                    const paddingLeft = 35
                    const paddingRight = 10
                    const paddingTop = 15
                    const paddingBottom = 20

                    const usableWidth = svgWidth - paddingLeft - paddingRight
                    const usableHeight = svgHeight - paddingTop - paddingBottom

                    const rams = history.map(d => d.ram)
                    const maxRam = Math.max(...rams, 250)
                    const minRam = Math.max(0, Math.min(...rams) - 20)

                    const points = history.map((pt, index) => {
                      const x = paddingLeft + (index / (history.length - 1 || 1)) * usableWidth
                      const y = paddingTop + usableHeight - ((pt.ram - minRam) / (maxRam - minRam || 1)) * usableHeight
                      return { x, y, ...pt }
                    })

                    const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ')
                    const areaPath = points.length > 0 
                      ? `${linePath} L ${points[points.length - 1].x} ${paddingTop + usableHeight} L ${points[0].x} ${paddingTop + usableHeight} Z`
                      : ''

                    return (
                      <div style={{
                        background: 'rgba(10,15,30,0.4)',
                        border: '1px solid #1e293b',
                        borderRadius: 12,
                        padding: 16,
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 12,
                        marginTop: 20,
                      }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <Activity size={14} color="#a78bfa" />
                            <span style={{ fontSize: 13, fontWeight: 700, color: '#f8fafc' }}>
                              Celery Memory Monitor
                            </span>
                          </div>
                          {selectedPipeline.status?.toLowerCase() === 'running' ? (
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: '#10b981', fontWeight: 600 }}>
                              <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#10b981', display: 'inline-block' }} className="blink"></span>
                              LIVE STREAMING
                            </div>
                          ) : (
                            <span style={{ fontSize: 11, color: '#64748b', fontWeight: 600 }}>
                              RUN COMPLETE (IDLE)
                            </span>
                          )}
                        </div>

                        {history.length === 0 ? (
                          <div style={{
                            height: 110, display: 'flex', flexDirection: 'column', alignItems: 'center',
                            justifyContent: 'center', gap: 8, color: '#475569', fontSize: 12,
                            background: 'rgba(0,0,0,0.15)', borderRadius: 8, border: '1px dashed #334155'
                          }}>
                            <Clock size={18} className={selectedPipeline.status?.toLowerCase() === 'running' ? "spin" : ""} style={{ opacity: 0.5 }} />
                            <span>
                              {selectedPipeline.status?.toLowerCase() === 'running'
                                ? 'Initializing memory stream monitoring...'
                                : 'No memory logs available for this run.'}
                            </span>
                          </div>
                        ) : (
                          <div style={{ position: 'relative' }}>
                            <svg viewBox={`0 0 ${svgWidth} ${svgHeight}`} style={{ width: '100%', height: 'auto', display: 'block' }}>
                              <defs>
                                <linearGradient id="ramAreaGrad" x1="0" y1="0" x2="0" y2="1">
                                  <stop offset="0%" stopColor="#8b5cf6" stopOpacity="0.35" />
                                  <stop offset="100%" stopColor="#8b5cf6" stopOpacity="0.0" />
                                </linearGradient>
                              </defs>

                              {/* Horizontal Grid lines */}
                              {[0, 0.5, 1].map((ratio, i) => {
                                const y = paddingTop + ratio * usableHeight
                                const val = Math.round(maxRam - ratio * (maxRam - minRam))
                                return (
                                  <g key={i}>
                                    <line x1={paddingLeft} y1={y} x2={svgWidth - paddingRight} y2={y} stroke="#1e293b" strokeDasharray="3,3" />
                                    <text x={paddingLeft - 8} y={y + 4} fill="#64748b" fontSize="9" textAnchor="end" fontFamily="monospace">
                                      {val}M
                                    </text>
                                  </g>
                                )
                              })}

                              {/* Filled Area */}
                              <path d={areaPath} fill="url(#ramAreaGrad)" />

                              {/* Stroke line */}
                              <path d={linePath} fill="none" stroke="#a78bfa" strokeWidth="2" strokeLinecap="round" />

                              {/* Breathing Cursor on the latest point */}
                              {points.length > 0 && (
                                <g>
                                  <circle cx={points[points.length - 1].x} cy={points[points.length - 1].y} r="6" fill="#8b5cf6" opacity="0.4">
                                    <animate attributeName="r" values="4;10;4" dur="2s" repeatCount="indefinite" />
                                    <animate attributeName="opacity" values="0.6;0.1;0.6" dur="2s" repeatCount="indefinite" />
                                  </circle>
                                  <circle cx={points[points.length - 1].x} cy={points[points.length - 1].y} r="3.5" fill="#f8fafc" />
                                </g>
                              )}

                              {/* X-axis Labels */}
                              {points.length >= 2 && (
                                <g>
                                  <text x={points[0].x} y={svgHeight - 4} fill="#64748b" fontSize="9" textAnchor="start">
                                    {points[0].time}
                                  </text>
                                  <text x={points[points.length - 1].x} y={svgHeight - 4} fill="#64748b" fontSize="9" textAnchor="end">
                                    {points[points.length - 1].time}
                                  </text>
                                </g>
                              )}
                            </svg>

                            {/* Float badge for current RAM value */}
                            <div style={{
                              position: 'absolute', top: 6, right: 6,
                              background: 'rgba(15,23,42,0.75)', border: '1px solid #334155',
                              borderRadius: 6, padding: '4px 8px', fontSize: 11, fontFamily: 'monospace',
                              color: '#cbd5e1', fontWeight: 600
                            }}>
                              RAM Usage: <span style={{ color: '#a78bfa', fontWeight: 700 }}>{history[history.length - 1].ram} MB</span>
                            </div>
                          </div>
                        )}
                      </div>
                    )
                  })()}
              </div>
            )}
          </div>
        </div>
      </div>
    )
  }

  // LIST VIEW (main page showing created datasets)
  return (
    <div style={S.page}>
      {toast && (
        <div style={{
          position: 'fixed', top: 24, right: 24, zIndex: 1100,
          background: toast.type === 'error' ? '#ef4444' : '#10b981',
          color: '#fff', padding: '12px 24px', borderRadius: 8,
          fontWeight: 600, fontSize: 13, boxShadow: '0 10px 30px rgba(0,0,0,0.3)',
          display: 'flex', alignItems: 'center', gap: 8,
        }}>
          {toast.type === 'error' ? <AlertCircle size={16} /> : <CheckCircle size={16} />}
          {toast.message}
        </div>
      )}
      {confirmDeleteId && (
        <div style={S.overlay}>
          <div style={{
            background: '#0f172a', border: '1px solid #334155', borderRadius: 16,
            padding: 24, width: '100%', maxWidth: 420, textAlign: 'center',
            boxShadow: '0 20px 50px rgba(0,0,0,0.5)',
            display: 'flex', flexDirection: 'column', gap: 20,
          }}>
            <div style={{
              width: 56, height: 56, borderRadius: '50%', background: 'rgba(239,68,68,0.1)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto'
            }}>
              <AlertCircle size={28} color="#ef4444" />
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <h3 style={{ fontSize: 16, fontWeight: 700, color: '#f8fafc', margin: 0 }}>Delete Feature Dataset</h3>
              <p style={{ fontSize: 13, color: '#94a3b8', margin: 0, lineHeight: '20px' }}>
                Are you sure you want to delete this feature dataset? This action cannot be undone.
              </p>
            </div>

            <div style={{ display: 'flex', gap: 12, marginTop: 4 }}>
              <button
                onClick={() => setConfirmDeleteId(null)}
                style={{
                  flex: 1, padding: '12px 16px', background: '#1e293b', border: '1px solid #334155',
                  borderRadius: 10, color: '#cbd5e1', fontWeight: 600, fontSize: 13, cursor: 'pointer',
                  transition: 'background 0.2s', outline: 'none'
                }}
              >
                Cancel
              </button>
              <button
                onClick={executeDelete}
                style={{
                  flex: 1, padding: '12px 16px', background: '#ef4444', border: 'none',
                  borderRadius: 10, color: '#fff', fontWeight: 600, fontSize: 13, cursor: 'pointer',
                  transition: 'background 0.2s', outline: 'none'
                }}
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
      {confirmCancelId && (
        <div style={S.overlay}>
          <div style={{
            background: '#0f172a', border: '1px solid #334155', borderRadius: 16,
            padding: 24, width: '100%', maxWidth: 420, textAlign: 'center',
            boxShadow: '0 20px 50px rgba(0,0,0,0.5)',
            display: 'flex', flexDirection: 'column', gap: 20,
          }}>
            <div style={{
              width: 56, height: 56, borderRadius: '50%', background: 'rgba(251,191,36,0.1)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto'
            }}>
              <AlertCircle size={28} color="#fbbf24" />
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <h3 style={{ fontSize: 16, fontWeight: 700, color: '#f8fafc', margin: 0 }}>Hủy Tiến Trình Feature</h3>
              <p style={{ fontSize: 13, color: '#94a3b8', margin: 0, lineHeight: '20px' }}>
                Bạn có chắc chắn muốn hủy tiến trình sinh feature này không? Hành động này sẽ dừng ngay việc tính toán của Celery worker.
              </p>
            </div>

            <div style={{ display: 'flex', gap: 12, marginTop: 4 }}>
              <button
                onClick={() => setConfirmCancelId(null)}
                style={{
                  flex: 1, padding: '12px 16px', background: '#1e293b', border: '1px solid #334155',
                  borderRadius: 10, color: '#cbd5e1', fontWeight: 600, fontSize: 13, cursor: 'pointer',
                  transition: 'background 0.2s', outline: 'none'
                }}
              >
                Quay lại
              </button>
              <button
                onClick={executeCancel}
                style={{
                  flex: 1, padding: '12px 16px', background: '#fbbf24', border: 'none',
                  borderRadius: 10, color: '#0f172a', fontWeight: 700, fontSize: 13, cursor: 'pointer',
                  transition: 'background 0.2s', outline: 'none'
                }}
              >
                Xác nhận Hủy
              </button>
            </div>
          </div>
        </div>
      )}


      {/* Header */}
      <div style={S.header}>
        <div style={{ ...S.title, fontSize: 26 }}>
          <div style={{ background: 'rgba(99,102,241,0.15)', padding: 12, borderRadius: 16, display: 'flex', boxShadow: '0 0 20px rgba(99,102,241,0.2)' }}>
            <Zap size={28} color="#818cf8" />
          </div>
          Feature Factory
          <span style={{ fontSize: 10, color: '#475569', marginLeft: 12, fontWeight: 500, letterSpacing: 1 }}>v1.1.2-STABLE</span>
        </div>

        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <div style={{ position: 'relative' }}>
            <Search size={15} color="#64748b" style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)' }} />
            <input
              placeholder="Search Feature Dataset..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              style={{ ...S.input, paddingLeft: 40, width: 220, background: 'rgba(0,0,0,0.3)', height: 44, borderRadius: 12 }}
            />
          </div>

          <button
            style={{ ...S.btn('ghost'), width: 44, height: 44, padding: 0, justifyContent: 'center' }}
            onClick={loadAll}
            disabled={isLoading}
            title="Refresh"
          >
            <RefreshCw size={18} className={isLoading ? "spin" : ""} />
          </button>
          
          <button
            style={{ ...S.btn('secondary'), height: 44, padding: '0 24px', borderRadius: 12, background: 'rgba(99,102,241,0.1)', color: '#818cf8', border: '1px solid rgba(99,102,241,0.3)', marginRight: 0 }}
            onClick={handleGenerateSample}
            disabled={isLoading || generating}
          >
            <Zap size={18} /> Generate Samples
          </button>
          
          <button
            style={{ ...S.btn('primary'), height: 44, padding: '0 24px', borderRadius: 12 }}
            onClick={() => setDrawerOpen(true)}
          >
            <Plus size={18} /> Create Feature Dataset
          </button>
        </div>
      </div>

      {/* Summary Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 20, marginBottom: 32 }}>
        <SummaryCard icon={Layers} label="Total Pipelines" value={counters.total} colorClass="purple" highlight={counters.total > 0} sub={`${counters.total} pipelines active`} />
        <SummaryCard icon={RefreshCw} label="Generating Features" value={counters.running} colorClass="cyan" highlight={counters.running > 0} sub={counters.running > 0 ? `${counters.running} pipelines processing` : "No active processes"} />
        <SummaryCard icon={CheckCircle} label="Completed" value={counters.completed} colorClass="green" highlight={counters.completed > 0} sub={`${counters.completed} datasets ready`} />
        <SummaryCard icon={Sparkles} label="Total Features Generated" value={counters.totalFeatures.toLocaleString()} colorClass="amber" highlight={counters.totalFeatures > 0} sub="Calculated columns" />
      </div>

      {/* Main Table Card */}
      <div style={S.card}>


        {/* Real Table */}
        <div style={{ overflowX: 'auto' }}>
          {pipelines.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '80px 0', color: '#64748b', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
              <Database size={48} strokeWidth={1.2} color="#334155" />
              <div>
                <h3 style={{ color: '#e2e8f0', margin: '0 0 6px 0', fontSize: 15 }}>No Feature Dataset Yet</h3>
                <p style={{ color: '#64748b', margin: 0, fontSize: 13 }}>Please click the button above to initialize a new RSI sweep feature dataset.</p>
              </div>
            </div>
          ) : filteredPipelines.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '60px 0', color: '#64748b' }}>
              No Feature Datasets found matching your search query.
            </div>
          ) : (
            <table style={S.table}>
              <thead>
                <tr>
                  <th style={S.th}>Pipeline Name</th>
                  <th style={S.th}>Source Dataset</th>
                  <th style={S.th}>RSI Settings (Sweep)</th>
                  <th style={S.th}>Lags</th>
                  <th style={{ ...S.th, textAlign: 'center' }}>Status</th>
                  <th style={{ ...S.th, textAlign: 'center' }}>Features Created</th>
                  <th style={S.th}>Created At</th>
                  <th style={{ ...S.th, textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredPipelines.map(p => {
                  const rsiConfig = p.indicators_config?.find(ind => ind.name === 'rsi')
                  const min = rsiConfig?.params_sweep?.length?.min || '?'
                  const max = rsiConfig?.params_sweep?.length?.max || '?'
                  const step = rsiConfig?.params_sweep?.length?.step || '?'
                  const hasThresh = rsiConfig?.params?.include_threshold ? 'Threshold' : ''
                  const hasTrend = rsiConfig?.params?.include_trend ? 'Trend' : ''
                  const source = datasets.find(d => d.id === p.dataset_id)

                  return (
                    <tr
                      key={p.id}
                      onClick={() => navigate(`/feature-factory/${p.id}`)}
                      style={{ borderBottom: '1px solid #1e293b', cursor: 'pointer', transition: 'background 0.15s' }}
                      onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.01)'}
                      onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                    >
                      <td style={{ ...S.td, fontWeight: 700, color: '#e2e8f0' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#8b5cf6', boxShadow: '0 0 6px #8b5cf6' }}></div>
                          {p.name}
                        </div>
                        <div style={{ fontSize: 10, color: '#475569', paddingLeft: 16 }}>ID: {p.id.slice(0, 8)}</div>
                      </td>
                      <td style={S.td}>
                        <div style={{ fontWeight: 600, color: '#818cf8' }}>{source ? source.symbol : 'Original Dataset'}</div>
                        <div style={{ fontSize: 11, color: '#64748b' }}>{source ? source.timeframe : 'Timeframe'}</div>
                      </td>
                      <td style={S.td}>
                        <div style={{ fontSize: 13, color: '#e2e8f0' }}>RSI: {min} to {max} ({step})</div>
                        <div style={{ fontSize: 10, color: '#8b5cf6', marginTop: 2 }}>
                          {[hasThresh, hasTrend].filter(Boolean).join(', ') || 'RSI Core Only'}
                        </div>
                      </td>
                      <td style={S.td}>
                        <span style={{ fontSize: 12, color: '#cbd5e1', fontFamily: 'monospace' }}>
                          {p.lags?.join(', ') || 'none'}
                        </span>
                      </td>
                      <td style={{ ...S.td, textAlign: 'center' }}>
                        <StatusBadge status={p.status} progress={p.progress} progressMessage={p.progress_message} isTable={true} errorMessage={p.error_message} />
                      </td>
                      <td style={{ ...S.td, textAlign: 'center', fontFamily: 'monospace', color: '#10b981', fontWeight: 700, fontSize: 14 }}>
                        {p.status === 'completed' ? (p.feature_columns?.length || 0).toLocaleString() : '—'}
                      </td>
                      <td style={{ ...S.td, color: '#94a3b8' }}>
                        {new Date(p.created_at).toLocaleDateString('en-US')}
                      </td>
                      <td style={{ ...S.td, textAlign: 'right' }}>
                        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                          {(p.status === 'running' || p.status === 'pending') && (
                            <button
                              onClick={(e) => handleCancelPipeline(p.id, e)}
                              style={{ ...S.btn('ghost'), padding: 8, borderRadius: 8 }}
                              title="Cancel Pipeline Run"
                            >
                              <X size={14} color="#fbbf24" />
                            </button>
                          )}
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              navigate(`/feature-factory/${p.id}`)
                            }}
                            style={{ ...S.btn('ghost'), padding: 8, borderRadius: 8 }}
                            title="View Configuration Properties"
                          >
                            <Sliders size={14} color="#818cf8" />
                          </button>
                          <button
                            onClick={(e) => handleDeletePipeline(p.id, e)}
                            style={{ ...S.btn('ghost'), padding: 8, borderRadius: 8 }}
                            disabled={deletingId === p.id}
                            title="Delete Dataset"
                          >
                            <Trash2 size={14} color="#f87171" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* RIGHT-SIDE DRAWER: Create Feature Dataset Form */}
      {drawerOpen && (
        <div style={S.overlay} onClick={() => setDrawerOpen(false)}>
          <div style={S.drawer} onClick={e => e.stopPropagation()}>
            <div style={S.drawerHeader}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <Zap size={18} color="#8b5cf6" />
                <h3 style={{ fontSize: 16, fontWeight: 700, color: '#e2e8f0', margin: 0 }}>Initialize Feature Dataset</h3>
              </div>
              <button
                onClick={() => setDrawerOpen(false)}
                style={{ background: 'transparent', border: 'none', color: '#64748b', cursor: 'pointer', display: 'flex' }}
              >
                <X size={20} />
              </button>
            </div>

            <div style={S.drawerBody}>
              <form onSubmit={handleCreatePipeline}>
                {/* Select Input Dataset */}
                <div style={S.formGroup}>
                  <label style={S.label}>1. Source Dataset</label>
                  <select
                    style={S.select}
                    value={selectedDatasetId}
                    onChange={e => setSelectedDatasetId(e.target.value)}
                    required
                  >
                    <option value="">-- Select Dataset --</option>
                    {datasets.map(d => (
                      <option key={d.id} value={d.id}>
                        {d.symbol} ({d.timeframe}) • {Number(d.row_count || 0).toLocaleString()} rows
                      </option>
                    ))}
                  </select>
                </div>

                {/* Selected Dataset Metadata */}
                {activeDataset && (
                  <div style={{ background: '#0a0f1e', border: '1px solid #1e293b', borderRadius: 8, padding: 14, marginBottom: 16, fontSize: 12, color: '#94a3b8' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                      <span>Symbol:</span>
                      <strong style={{ color: '#fff' }}>{activeDataset.symbol}</strong>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                      <span>Timeframe:</span>
                      <strong style={{ color: '#818cf8' }}>{activeDataset.timeframe}</strong>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span>Total Rows:</span>
                      <strong style={{ color: '#10b981' }}>{Number(activeDataset.row_count || 0).toLocaleString()} rows</strong>
                    </div>
                  </div>
                )}

                {/* Pipeline Name */}
                <div style={S.formGroup}>
                  <label style={S.label}>2. Feature Dataset Name</label>
                  <input
                    type="text"
                    style={S.input}
                    placeholder="e.g., BTC_1h_rsi_pipeline"
                    value={pipelineName}
                    onChange={e => setPipelineName(e.target.value)}
                    required
                  />
                </div>

                {/* Technical Indicator Selection */}
                <div style={S.formGroup}>
                  <label style={S.label}>3. Technical Indicator</label>
                  <select
                    style={S.select}
                    value={selectedIndicator}
                    onChange={e => setSelectedIndicator(e.target.value)}
                    required
                  >
                    <option value="RSI">RSI (Relative Strength Index)</option>
                    <option value="MACD">MACD (Moving Average Convergence Divergence) - Coming Soon</option>
                    <option value="BB">Bollinger Bands (BB) - Coming Soon</option>
                    <option value="EMA">Exponential Moving Average (EMA) - Coming Soon</option>
                  </select>
                </div>

                {selectedIndicator === 'RSI' ? (
                  <>
                    {/* RSI Configuration sweep ranges */}
                    <div style={{ fontSize: 13, fontWeight: 700, color: '#f1f5f9', marginTop: 24, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
                      <Zap size={14} color="#6366f1" /> RSI Parameter Sweep Configuration
                    </div>

                    <div style={{ ...S.row, marginBottom: 16 }}>
                      <div style={{ flex: 1 }}>
                        <label style={S.label}>Min Period</label>
                        <input
                          type="number"
                          min="2"
                          max={rsiMax}
                          style={S.input}
                          value={rsiMin}
                          onChange={e => setRsiMin(Math.max(2, parseInt(e.target.value) || 2))}
                        />
                      </div>
                      <div style={{ flex: 1 }}>
                        <label style={S.label}>Max Period</label>
                        <input
                          type="number"
                          min={rsiMin}
                          max="500"
                          style={S.input}
                          value={rsiMax}
                          onChange={e => setRsiMax(Math.max(rsiMin, parseInt(e.target.value) || rsiMin))}
                        />
                      </div>
                      <div style={{ flex: 1 }}>
                        <label style={S.label}>Step</label>
                        <input
                          type="number"
                          min="1"
                          max="50"
                          style={S.input}
                          value={rsiStep}
                          onChange={e => setRsiStep(Math.max(1, parseInt(e.target.value) || 1))}
                        />
                      </div>
                    </div>

                    {/* Advanced RSI Config */}
                    <div style={{ ...S.formGroup, background: 'rgba(255,255,255,0.01)', border: '1px dashed #1e293b', borderRadius: 8, padding: 14 }}>
                      <label style={{ ...S.label, marginBottom: 12, color: '#f1f5f9' }}>Advanced Analysis Options:</label>
                      
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                        {/* 1. Threshold Crossover */}
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                          <div>
                            <div style={{ fontSize: 12, fontWeight: 600, color: '#cbd5e1' }}>Threshold Crossover (&gt;50 &amp; &lt;50)</div>
                            <div style={{ fontSize: 10, color: '#64748b' }}>Generate gt_50 and lt_50 columns [+2 cols]</div>
                          </div>
                          <div
                            onClick={() => setIncludeThreshold(!includeThreshold)}
                            style={{
                              width: 36, height: 20, borderRadius: 20,
                              background: includeThreshold ? '#6366f1' : '#334155',
                              position: 'relative', cursor: 'pointer',
                              transition: 'background 0.3s'
                            }}
                          >
                            <div style={{
                              width: 14, height: 14, borderRadius: '50%', background: '#fff',
                              position: 'absolute', top: 3, left: includeThreshold ? 19 : 3,
                              transition: 'left 0.2s ease'
                            }} />
                          </div>
                        </div>

                        {/* 2. Trend Direction */}
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                          <div>
                            <div style={{ fontSize: 12, fontWeight: 600, color: '#cbd5e1' }}>Trend Direction Analysis</div>
                            <div style={{ fontSize: 10, color: '#64748b' }}>Direction relative to previous candle [+1 col]</div>
                          </div>
                          <div
                            onClick={() => setIncludeTrend(!includeTrend)}
                            style={{
                              width: 36, height: 20, borderRadius: 20,
                              background: includeTrend ? '#6366f1' : '#334155',
                              position: 'relative', cursor: 'pointer',
                              transition: 'background 0.3s'
                            }}
                          >
                            <div style={{
                              width: 14, height: 14, borderRadius: '50%', background: '#fff',
                              position: 'absolute', top: 3, left: includeTrend ? 19 : 3,
                              transition: 'left 0.2s ease'
                            }} />
                          </div>
                        </div>

                        {/* 3. Raw Extras */}
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                          <div>
                            <div style={{ fontSize: 12, fontWeight: 600, color: '#cbd5e1' }}>Raw Extras &amp; Normalized Distances</div>
                            <div style={{ fontSize: 10, color: '#64748b' }}>Normalized RSI, centered, and distances to 30/50/70 [+5 cols]</div>
                          </div>
                          <div
                            onClick={() => setIncludeRawExtras(!includeRawExtras)}
                            style={{
                              width: 36, height: 20, borderRadius: 20,
                              background: includeRawExtras ? '#6366f1' : '#334155',
                              position: 'relative', cursor: 'pointer',
                              transition: 'background 0.3s'
                            }}
                          >
                            <div style={{
                              width: 14, height: 14, borderRadius: '50%', background: '#fff',
                              position: 'absolute', top: 3, left: includeRawExtras ? 19 : 3,
                              transition: 'left 0.2s ease'
                            }} />
                          </div>
                        </div>

                        {/* 4. Multi-zone Market Regimes */}
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                          <div>
                            <div style={{ fontSize: 12, fontWeight: 600, color: '#cbd5e1' }}>Multi-zone Market Regimes</div>
                            <div style={{ fontSize: 10, color: '#64748b' }}>7-zone regime index, overbought/oversold binary signals [+3 cols]</div>
                          </div>
                          <div
                            onClick={() => setIncludeMultiZone(!includeMultiZone)}
                            style={{
                              width: 36, height: 20, borderRadius: 20,
                              background: includeMultiZone ? '#6366f1' : '#334155',
                              position: 'relative', cursor: 'pointer',
                              transition: 'background 0.3s'
                            }}
                          >
                            <div style={{
                              width: 14, height: 14, borderRadius: '50%', background: '#fff',
                              position: 'absolute', top: 3, left: includeMultiZone ? 19 : 3,
                              transition: 'left 0.2s ease'
                            }} />
                          </div>
                        </div>

                        {/* 5. Momentum & Slope Analysis */}
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                          <div>
                            <div style={{ fontSize: 12, fontWeight: 600, color: '#cbd5e1' }}>Momentum &amp; Regression Slope</div>
                            <div style={{ fontSize: 10, color: '#64748b' }}>Velocity, acceleration, and 5 &amp; 10 period linear slope [+6 cols]</div>
                          </div>
                          <div
                            onClick={() => setIncludeMomentumSlope(!includeMomentumSlope)}
                            style={{
                              width: 36, height: 20, borderRadius: 20,
                              background: includeMomentumSlope ? '#6366f1' : '#334155',
                              position: 'relative', cursor: 'pointer',
                              transition: 'background 0.3s'
                            }}
                          >
                            <div style={{
                              width: 14, height: 14, borderRadius: '50%', background: '#fff',
                              position: 'absolute', top: 3, left: includeMomentumSlope ? 19 : 3,
                              transition: 'left 0.2s ease'
                            }} />
                          </div>
                        </div>

                        {/* 6. Divergence Analysis */}
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                          <div>
                            <div style={{ fontSize: 12, fontWeight: 600, color: '#cbd5e1' }}>Classic &amp; Hidden Divergences</div>
                            <div style={{ fontSize: 10, color: '#64748b' }}>Price vs RSI divergences (bull, bear, hidden bull/bear) [+4 cols]</div>
                          </div>
                          <div
                            onClick={() => setIncludeDivergence(!includeDivergence)}
                            style={{
                              width: 36, height: 20, borderRadius: 20,
                              background: includeDivergence ? '#6366f1' : '#334155',
                              position: 'relative', cursor: 'pointer',
                              transition: 'background 0.3s'
                            }}
                          >
                            <div style={{
                              width: 14, height: 14, borderRadius: '50%', background: '#fff',
                              position: 'absolute', top: 3, left: includeDivergence ? 19 : 3,
                              transition: 'left 0.2s ease'
                            }} />
                          </div>
                        </div>

                        {/* 7. RSI Trend Structure */}
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                          <div>
                            <div style={{ fontSize: 12, fontWeight: 600, color: '#cbd5e1' }}>Trend Structure &amp; Range Shifts</div>
                            <div style={{ fontSize: 10, color: '#64748b' }}>HH/LL, Swing Failure Pattern, Constance Brown range shift [+5 cols]</div>
                          </div>
                          <div
                            onClick={() => setIncludeTrendStructure(!includeTrendStructure)}
                            style={{
                              width: 36, height: 20, borderRadius: 20,
                              background: includeTrendStructure ? '#6366f1' : '#334155',
                              position: 'relative', cursor: 'pointer',
                              transition: 'background 0.3s'
                            }}
                          >
                            <div style={{
                              width: 14, height: 14, borderRadius: '50%', background: '#fff',
                              position: 'absolute', top: 3, left: includeTrendStructure ? 19 : 3,
                              transition: 'left 0.2s ease'
                            }} />
                          </div>
                        </div>

                        {/* 8. Statistical Features */}
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                          <div>
                            <div style={{ fontSize: 12, fontWeight: 600, color: '#cbd5e1' }}>Statistical Rolling Metrics</div>
                            <div style={{ fontSize: 10, color: '#64748b' }}>Rolling mean, std, z-score, and 50-period percentile rank [+4 cols]</div>
                          </div>
                          <div
                            onClick={() => setIncludeStatistical(!includeStatistical)}
                            style={{
                              width: 36, height: 20, borderRadius: 20,
                              background: includeStatistical ? '#6366f1' : '#334155',
                              position: 'relative', cursor: 'pointer',
                              transition: 'background 0.3s'
                            }}
                          >
                            <div style={{
                              width: 14, height: 14, borderRadius: '50%', background: '#fff',
                              position: 'absolute', top: 3, left: includeStatistical ? 19 : 3,
                              transition: 'left 0.2s ease'
                            }} />
                          </div>
                        </div>

                        {/* 9. Time Persistence */}
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                          <div>
                            <div style={{ fontSize: 12, fontWeight: 600, color: '#cbd5e1' }}>Temporal Persistence (JIT)</div>
                            <div style={{ fontSize: 10, color: '#64748b' }}>Consecutive OB/OS bars, bars since cross-up/down 50 [+4 cols]</div>
                          </div>
                          <div
                            onClick={() => setIncludePersistence(!includePersistence)}
                            style={{
                              width: 36, height: 20, borderRadius: 20,
                              background: includePersistence ? '#6366f1' : '#334155',
                              position: 'relative', cursor: 'pointer',
                              transition: 'background 0.3s'
                            }}
                          >
                            <div style={{
                              width: 14, height: 14, borderRadius: '50%', background: '#fff',
                              position: 'absolute', top: 3, left: includePersistence ? 19 : 3,
                              transition: 'left 0.2s ease'
                            }} />
                          </div>
                        </div>

                        {/* 10. Crossovers & Spreads */}
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                          <div>
                            <div style={{ fontSize: 12, fontWeight: 600, color: '#cbd5e1' }}>Crossovers &amp; Fast/Slow Spread</div>
                            <div style={{ fontSize: 10, color: '#64748b' }}>RSI vs SMA(9) crossover, Fast vs Slow RSI(2L) spread [+3 cols]</div>
                          </div>
                          <div
                            onClick={() => setIncludeCrossovers(!includeCrossovers)}
                            style={{
                              width: 36, height: 20, borderRadius: 20,
                              background: includeCrossovers ? '#6366f1' : '#334155',
                              position: 'relative', cursor: 'pointer',
                              transition: 'background 0.3s'
                            }}
                          >
                            <div style={{
                              width: 14, height: 14, borderRadius: '50%', background: '#fff',
                              position: 'absolute', top: 3, left: includeCrossovers ? 19 : 3,
                              transition: 'left 0.2s ease'
                            }} />
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Lags */}
                    <div style={S.formGroup}>
                      <label style={S.label}>4. Lag Steps (Lags)</label>
                      <input
                        type="text"
                        style={S.input}
                        placeholder="e.g., 1, 2, 3"
                        value={lagsInput}
                        onChange={e => setLagsInput(e.target.value)}
                      />
                      <span style={{ fontSize: 10, color: '#64748b', marginTop: 4, display: 'block' }}>
                        Separate lag steps using commas.
                      </span>
                    </div>

                    {/* Live Estimator Panel */}
                    <div style={{
                      background: estimation.overLimit ? 'rgba(239,68,68,0.06)' : 'rgba(16,185,129,0.06)',
                      border: `1px solid ${estimation.overLimit ? 'rgba(239,68,68,0.2)' : 'rgba(16,185,129,0.2)'}`,
                      borderRadius: 10, padding: 16, marginBottom: 24, fontSize: 13
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 700, color: estimation.overLimit ? '#f87171' : '#34d399', marginBottom: 10 }}>
                        <Info size={14} /> Estimated Columns Output:
                      </div>
                      <div style={{ color: '#94a3b8', display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12 }}>
                        <div>• RSI Periods Sweep: <strong style={{ color: '#fff' }}>{estimation.rsiCycles}</strong> steps</div>
                        <div>• Base columns per period: <strong style={{ color: '#fff' }}>{estimation.width}</strong> columns</div>
                        <div>• Lag duplicates: <strong style={{ color: '#fff' }}>{estimation.lagsCount}</strong> lags</div>
                        <div style={{ borderTop: '1px dashed #1e293b', marginTop: 6, paddingTop: 6, fontSize: 13 }}>
                          • Total projected columns: {' '}
                          <strong style={{ color: estimation.overLimit ? '#f87171' : '#34d399', fontSize: 15 }}>
                            {estimation.totalColumns.toLocaleString()}
                          </strong> / 10,000
                        </div>
                      </div>
                      {estimation.overLimit && (
                        <div style={{ color: '#f87171', fontSize: 11, marginTop: 8, display: 'flex', alignItems: 'center', gap: 4 }}>
                          <AlertCircle size={12} /> Warning: Exceeds 10,000 columns hard limit! Please narrow the RSI sweep range or reduce lag steps.
                        </div>
                      )}
                    </div>
                  </>
                ) : (
                  <div style={{
                    background: 'rgba(99,102,241,0.03)',
                    border: '1px dashed rgba(99,102,241,0.2)',
                    borderRadius: 10, padding: '24px 16px', marginBottom: 24, textAlign: 'center', color: '#94a3b8'
                  }}>
                    <Sparkles size={24} color="#818cf8" style={{ marginBottom: 8, filter: 'drop-shadow(0 0 8px rgba(99,102,241,0.3))' }} />
                    <div style={{ fontSize: 14, fontWeight: 700, color: '#e2e8f0', marginBottom: 4 }}>Indicator Coming Soon</div>
                    <p style={{ fontSize: 12, margin: 0, color: '#64748b', lineHeight: 1.4 }}>
                      We are actively developing advanced parameter sweep and automatic feature generation modules for this indicator. Please use RSI for now.
                    </p>
                  </div>
                )}

                {/* Submit button */}
                <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end', marginTop: 24 }}>
                  <button
                    type="button"
                    style={S.btn('ghost')}
                    onClick={() => setDrawerOpen(false)}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    style={S.btn('primary', !selectedDatasetId || estimation.overLimit || generating)}
                    disabled={!selectedDatasetId || estimation.overLimit || generating}
                  >
                    {generating ? <RefreshCw size={14} className="spin" /> : <Play size={14} />}
                    {generating ? 'Submitting...' : 'Generate Features'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

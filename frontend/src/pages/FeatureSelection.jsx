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
    </div>
  )
}

export default function FeatureSelection() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()

  const [featureSets, setFeatureSets] = useState([])
  const [labeledDatasets, setLabeledDatasets] = useState([])
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [toast, setToast] = useState(null)

  // Drawer Create State
  const [showDrawer, setShowDrawer] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  
  // Selection Form Config
  const [selectedLdId, setSelectedLdId] = useState('')
  const [runName, setRunName] = useState('')
  const [targetCol, setTargetCol] = useState('')
  const [taskType, setTaskType] = useState('classification')
  const [vifThreshold, setVifThreshold] = useState(10.0)
  const [corrThreshold, setCorrThreshold] = useState(0.95)
  const [miTopK, setMiTopK] = useState(50)
  const [treeTopK, setTreeTopK] = useState(20)

  // Detail snapshot states
  const [activeTab, setActiveTab] = useState('summary')
  const [previewData, setPreviewData] = useState(null)
  const [loadingPreview, setLoadingPreview] = useState(false)

  // Toast Helper
  const showToast = (msg, type = 'success') => {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 4000)
  }

  // Load datasets and feature sets
  const loadAll = async () => {
    try {
      const [setsRes, labeledRes] = await Promise.all([
        api.listFeatureSets(),
        api.listLabeledDatasets()
      ])
      setFeatureSets(setsRes || [])
      
      // Filter only successfully completed labeled datasets
      const completedLd = (labeledRes || []).filter(d => d.status === 'completed')
      setLabeledDatasets(completedLd)
    } catch (err) {
      showToast('Không thể kết nối API: ' + err.message, 'error')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadAll()
  }, [])

  // Auto-poll if any pipeline is running/pending
  useEffect(() => {
    const hasRunning = featureSets.some(f => f.status === 'pending' || f.status === 'running')
    if (!hasRunning) return

    const timer = setInterval(() => {
      loadAll()
    }, 4000)
    return () => clearInterval(timer)
  }, [featureSets])

  // Get active detail feature set if ID in URL
  const activeSet = useMemo(() => {
    if (!id) return null
    return featureSets.find(f => f.id === id) || null
  }, [id, featureSets])

  // Load preview data when preview tab is active
  useEffect(() => {
    if (activeSet && activeTab === 'preview' && !previewData && activeSet.status === 'completed') {
      loadPreview()
    }
  }, [activeSet, activeTab])

  const loadPreview = async () => {
    setLoadingPreview(true)
    try {
      const res = await api.previewFeatureSet(activeSet.id, 200)
      setPreviewData(res)
    } catch (err) {
      showToast('Không thể tải bản xem trước dữ liệu: ' + err.message, 'error')
    } finally {
      setLoadingPreview(false)
    }
  }

  // Auto pre-fill target column when source labeled dataset is selected
  useEffect(() => {
    if (!selectedLdId) return
    const ds = labeledDatasets.find(d => d.id === selectedLdId)
    if (ds) {
      // Find the first target column name from configuration
      try {
        const config = typeof ds.targets_config === 'string' ? JSON.parse(ds.targets_config) : ds.targets_config
        if (config && config.length > 0) {
          setTargetCol(config[0].name)
          setTaskType(config[0].params?.type || 'classification')
        }
      } catch (e) {
        setTargetCol('')
      }
      if (!runName) {
        setRunName(`Filter for ${ds.name.replace(/ \(Target:.*\)/, '')}`)
      }
    }
  }, [selectedLdId, labeledDatasets])

  const handleCreateSelection = async (e) => {
    e.preventDefault()
    if (!selectedLdId) {
      showToast('Vui lòng chọn nguồn dữ liệu gán nhãn!', 'error')
      return
    }
    if (!targetCol) {
      showToast('Vui lòng điền cột mục tiêu cần lọc!', 'error')
      return
    }

    setSubmitting(true)
    try {
      const payload = {
        labeled_dataset_id: selectedLdId,
        name: runName || undefined,
        target_column: targetCol,
        task: taskType,
        vif_threshold: parseFloat(vifThreshold),
        corr_threshold: parseFloat(corrThreshold),
        mi_top_k: parseInt(miTopK),
        tree_top_k: parseInt(treeTopK)
      }
      const newSet = await api.createFeatureSet(payload)
      showToast('Bắt đầu chạy bộ lọc chọn lọc đặc trưng ngầm!', 'success')
      setShowDrawer(false)
      // Reset form
      setSelectedLdId('')
      setRunName('')
      setTargetCol('')
      
      // Reload & redirect
      await loadAll()
      navigate(`/feature-selection/${newSet.id}`)
    } catch (err) {
      showToast(err.message || 'Chạy tuyển chọn đặc trưng thất bại', 'error')
    } finally {
      setSubmitting(false)
    }
  }

  const handleDelete = async (setId, e) => {
    e.stopPropagation()
    if (!window.confirm('Bạn có chắc chắn muốn xóa lượt chạy lọc đặc trưng này?')) return
    try {
      await api.deleteFeatureSet(setId)
      showToast('Đã xóa lượt chạy lọc đặc trưng thành công', 'success')
      if (id === setId) {
        navigate('/feature-selection')
      }
      loadAll()
    } catch (err) {
      showToast(err.message || 'Xóa thất bại', 'error')
    }
  }

  // Filtered list
  const filteredSets = useMemo(() => {
    return featureSets.filter(f => {
      const nameMatch = f.name?.toLowerCase().includes(searchQuery.toLowerCase())
      const sourceMatch = f.labeled_dataset_id?.toLowerCase().includes(searchQuery.toLowerCase())
      return nameMatch || sourceMatch
    })
  }, [featureSets, searchQuery])

  // Get source info of a selection set
  const getSourceInfo = (ldId) => {
    const ds = labeledDatasets.find(d => d.id === ldId)
    return ds ? ds.name : `Source Labeled Dataset (${ldId.substring(0, 8)})`
  }

  return (
    <div style={S.page}>
      {/* Toast Alert */}
      {toast && (
        <div style={{
          position: 'fixed', top: 24, right: 24, zIndex: 10000,
          background: toast.type === 'error' ? '#ef4444' : '#10b981',
          color: '#fff', padding: '12px 24px', borderRadius: 8,
          boxShadow: '0 10px 30px rgba(0,0,0,0.3)', fontWeight: 600, fontSize: 13,
          display: 'flex', alignItems: 'center', gap: 8
        }}>
          {toast.type === 'error' ? <AlertCircle size={16} /> : <CheckCircle size={16} />}
          {toast.msg}
        </div>
      )}

      {/* Breadcrumbs */}
      <div style={S.breadcrumb}>
        <span>Backtest Suite</span>
        <ChevronRight size={12} />
        <span style={{ cursor: 'pointer' }} onClick={() => navigate('/feature-factory')}>Feature Factory</span>
        <ChevronRight size={12} />
        <span style={{ color: '#f1f5f9', fontWeight: 600 }}>Feature Selection</span>
      </div>

      {!activeSet ? (
        // ── LIST VIEW ──
        <>
          <div style={S.header}>
            <div>
              <h1 style={S.title}>
                <Sliders size={24} color="#6366f1" /> Feature Selection Engine
              </h1>
              <p style={{ fontSize: 13, color: '#64748b', marginTop: 4 }}>
                Chạy các thuật toán lọc đặc trưng nâng cao (Spearman Correlation, VIF, Mutual Information, LightGBM Tree Importance) để tinh lọc ra các feature tốt nhất.
              </p>
            </div>
            <button style={S.btn('primary')} onClick={() => setShowDrawer(true)}>
              <Plus size={16} /> Run Feature Selection
            </button>
          </div>

          {/* Quick Statistics Cards */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 20, marginBottom: 28 }}>
            <div style={{ ...S.card, padding: 20, display: 'flex', alignItems: 'center', gap: 16, background: 'rgba(30,41,59,0.25)' }}>
              <div style={{ width: 48, height: 48, borderRadius: 12, background: 'rgba(99,102,241,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Activity size={24} color="#818cf8" />
              </div>
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.5 }}>Tổng lượt lọc</div>
                <div style={{ fontSize: 24, fontWeight: 700, color: '#f1f5f9', marginTop: 2 }}>{featureSets.length}</div>
              </div>
            </div>

            <div style={{ ...S.card, padding: 20, display: 'flex', alignItems: 'center', gap: 16, background: 'rgba(30,41,59,0.25)' }}>
              <div style={{ width: 48, height: 48, borderRadius: 12, background: 'rgba(16,185,129,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <CheckCircle2 size={24} color="#34d399" />
              </div>
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.5 }}>Bộ lọc hoàn thành</div>
                <div style={{ fontSize: 24, fontWeight: 700, color: '#34d399', marginTop: 2 }}>
                  {featureSets.filter(s => s.status === 'completed').length}
                </div>
              </div>
            </div>

            <div style={{ ...S.card, padding: 20, display: 'flex', alignItems: 'center', gap: 16, background: 'rgba(30,41,59,0.25)' }}>
              <div style={{ width: 48, height: 48, borderRadius: 12, background: 'rgba(251,191,36,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Sparkles size={24} color="#fbbf24" />
              </div>
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.5 }}>Bộ lọc tốt nhất</div>
                <div style={{ fontSize: 14, color: '#fbbf24', fontWeight: 600, marginTop: 4 }}>
                  {(() => {
                    const completed = featureSets.filter(f => f.status === 'completed' && f.selected_columns?.length > 0)
                    if (completed.length === 0) return 'Chưa có'
                    const minSet = [...completed].sort((a,b) => a.selected_columns.length - b.selected_columns.length)[0]
                    return `${minSet.name} (${minSet.selected_columns.length} features)`
                  })()}
                </div>
              </div>
            </div>
          </div>

          {/* Search bar & Table */}
          <div style={{ ...S.card }}>
            <div style={{ padding: '16px 20px', borderBottom: '1px solid #1e293b', background: '#0a0f1e', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ position: 'relative', width: 320 }}>
                <Search size={16} color="#64748b" style={{ position: 'absolute', left: 12, top: 12 }} />
                <input
                  type="text"
                  placeholder="Tìm kiếm bộ lọc..."
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  style={{ ...S.input, paddingLeft: 36 }}
                />
              </div>
              <button style={S.btn('ghost')} onClick={loadAll}>
                <RefreshCw size={14} /> Tải lại danh sách
              </button>
            </div>

            <div style={{ overflowX: 'auto' }}>
              <table style={S.table}>
                <thead>
                  <tr>
                    <th style={S.th}>Bộ lọc Đặc Trưng</th>
                    <th style={S.th}>Nguồn Nhãn Labeled Dataset</th>
                    <th style={S.th}>Cột Target</th>
                    <th style={S.th}>Cấu hình (Corr | VIF | LGBM)</th>
                    <th style={S.th}>Số lượng Feature</th>
                    <th style={S.th}>Trạng thái</th>
                    <th style={{ ...S.th, textAlign: 'right' }}>Thao tác</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr>
                      <td colSpan={7} style={{ ...S.td, textAlign: 'center', padding: 40, color: '#64748b' }}>
                        <RefreshCw size={24} className="spin" style={{ marginBottom: 12 }} />
                        <div>Đang truy vấn danh sách Feature Selection...</div>
                      </td>
                    </tr>
                  ) : filteredSets.length === 0 ? (
                    <tr>
                      <td colSpan={7} style={{ ...S.td, textAlign: 'center', padding: 40, color: '#64748b' }}>
                        <Info size={24} style={{ marginBottom: 12 }} />
                        <div>Không có bộ lọc nào được tìm thấy. Nhấp nút phía trên để tạo!</div>
                      </td>
                    </tr>
                  ) : (
                    filteredSets.map((f) => (
                      <tr
                        key={f.id}
                        onClick={() => navigate(`/feature-selection/${f.id}`)}
                        style={{ cursor: 'pointer', transition: 'background 0.15s' }}
                        onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.015)'}
                        onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                      >
                        <td style={{ ...S.td, fontWeight: 700, color: '#f1f5f9' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <Sliders size={14} color="#818cf8" /> {f.name}
                          </div>
                          <div style={{ fontSize: 10, color: '#64748b', marginTop: 4, fontWeight: 400 }}>
                            ID: {f.id.substring(0, 8)}… | Ngày tạo: {new Date(f.created_at).toLocaleString('vi-VN')}
                          </div>
                        </td>
                        <td style={S.td}>
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
                            <Database size={13} color="#94a3b8" /> {getSourceInfo(f.labeled_dataset_id)}
                          </span>
                        </td>
                        <td style={S.td}>
                          <code style={{ background: '#1e293b', padding: '2px 6px', borderRadius: 4, color: '#38bdf8', fontSize: 11 }}>
                            {f.target_column}
                          </code>
                        </td>
                        <td style={S.td}>
                          <div style={{ display: 'flex', gap: 8, fontSize: 11 }}>
                            <span style={{ color: '#a78bfa' }}>Corr: {f.analysis_config?.corr_threshold || '0.95'}</span>
                            <span style={{ color: '#34d399' }}>VIF: {f.analysis_config?.vif_threshold || '10'}</span>
                            <span style={{ color: '#fb7185' }}>Top: {f.analysis_config?.tree_top_k || '20'}</span>
                          </div>
                        </td>
                        <td style={S.td}>
                          {f.status === 'completed' ? (
                            <strong style={{ color: '#34d399', fontSize: 14 }}>
                              {f.selected_columns?.length || 0} <span style={{ fontSize: 11, fontWeight: 400, color: '#64748b' }}>features</span>
                            </strong>
                          ) : (
                            <span style={{ color: '#64748b' }}>—</span>
                          )}
                        </td>
                        <td style={S.td}>
                          <StatusBadge status={f.status} progress={f.progress} progressMessage={f.progress_message} errorMessage={f.error_message} isTable={true} />
                        </td>
                        <td style={{ ...S.td, textAlign: 'right' }}>
                          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                            <button
                              style={{ ...S.btn('ghost'), padding: 6 }}
                              onClick={(e) => {
                                e.stopPropagation()
                                navigate(`/feature-selection/${f.id}`)
                              }}
                              title="Chi tiết phân tích đặc trưng"
                            >
                              <Eye size={14} />
                            </button>
                            <button
                              style={{ ...S.btn('danger'), padding: 6 }}
                              onClick={(e) => handleDelete(f.id, e)}
                              title="Xóa bộ lọc này"
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      ) : (
        // ── DETAIL VIEW (ANALYTICAL SNAKESHOP FUNNEL) ──
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          {/* Detail Header */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid #1e293b', paddingBottom: 16 }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <button style={S.btn('ghost')} onClick={() => navigate('/feature-selection')}>
                  <ChevronRight size={14} style={{ transform: 'rotate(180deg)' }} /> Back to list
                </button>
                <h2 style={{ fontSize: 18, fontWeight: 700, color: '#f1f5f9' }}>{activeSet.name}</h2>
                <StatusBadge status={activeSet.status} progress={activeSet.progress} progressMessage={activeSet.progress_message} errorMessage={activeSet.error_message} isTable={true} />
              </div>
              <div style={{ display: 'flex', gap: 16, fontSize: 11, color: '#64748b', marginTop: 6, paddingLeft: 104 }}>
                <span>ID: {activeSet.id}</span>
                <span>•</span>
                <span>Nguồn nhãn: {getSourceInfo(activeSet.labeled_dataset_id)}</span>
                <span>•</span>
                <span>Cột Target: <code>{activeSet.target_column}</code></span>
              </div>
            </div>

            <div style={{ display: 'flex', gap: 8 }}>
              {activeSet.status === 'completed' && (
                <button
                  style={{ ...S.btn('primary') }}
                  onClick={() => {
                    // Export features simple list to clipboard
                    navigator.clipboard.writeText(JSON.stringify(activeSet.selected_columns, null, 2))
                    showToast('Đã copy danh sách features vào bộ nhớ tạm!', 'success')
                  }}
                >
                  <Plus size={14} /> Copy Features JSON
                </button>
              )}
              <button style={S.btn('danger')} onClick={(e) => handleDelete(activeSet.id, e)}>
                <Trash2 size={14} /> Delete Run
              </button>
            </div>
          </div>

          {activeSet.status === 'running' || activeSet.status === 'pending' ? (
            // Process view when selection is calculating
            <div style={{ ...S.card, padding: 40, textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
              <RefreshCw size={40} className="spin" color="#6366f1" />
              <h3 style={{ fontSize: 16, fontWeight: 700, color: '#e2e8f0' }}>Đang tính toán tuyển chọn đặc trưng...</h3>
              <p style={{ fontSize: 13, color: '#64748b', maxWidth: 500 }}>
                Hệ thống đang chạy quy trình lọc toán học: Loại bỏ tương quan Spearman trùng lặp, triệt tiêu đa cộng tuyến VIF, đo lường Mutual Information và xếp hạng cây LightGBM.
              </p>
              <div style={{ width: '100%', maxWidth: 400, background: '#1e293b', height: 8, borderRadius: 4, overflow: 'hidden', marginTop: 12 }}>
                <div style={{ width: `${activeSet.progress || 10}%`, height: '100%', background: 'linear-gradient(90deg, #6366f1, #8b5cf6)', transition: 'width 0.3s' }} />
              </div>
              <span style={{ fontSize: 11, color: '#818cf8', fontWeight: 600 }}>{activeSet.progress_message || 'Đang lập lịch tác vụ...'}</span>
            </div>
          ) : activeSet.status === 'failed' ? (
            // Failed process view
            <div style={{ ...S.card, padding: 40, textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16, borderColor: '#ef444450' }}>
              <AlertCircle size={40} color="#ef4444" />
              <h3 style={{ fontSize: 16, fontWeight: 700, color: '#f87171' }}>Tiến trình tuyển chọn feature bị lỗi</h3>
              <code style={{ background: 'rgba(239,68,68,0.1)', color: '#f87171', padding: '12px 24px', borderRadius: 8, border: '1px solid rgba(239,68,68,0.15)', maxWidth: 600, fontSize: 12 }}>
                {activeSet.error_message || 'Lỗi hệ thống không xác định trong quá trình xử lý đặc trưng.'}
              </code>
            </div>
          ) : (
            // ── SUCCESS: COMPLETED ANALYTICS SUITE ──
            <>
              {/* Funnel Stage Visualization Card */}
              {activeSet.analysis_snapshot?.stage_counts && (
                <div style={{ ...S.card, padding: 24, background: 'rgba(30,41,59,0.1)' }}>
                  <h3 style={{ fontSize: 13, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 20 }}>
                    Phễu Tuyển Chọn Đặc Trưng (Selection Funnel)
                  </h3>
                  
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 16 }}>
                    <div style={{ textAlign: 'center', flex: 1, minWidth: 100 }}>
                      <div style={{ fontSize: 24, fontWeight: 800, color: '#f1f5f9' }}>{activeSet.analysis_snapshot.stage_counts.input}</div>
                      <div style={{ fontSize: 11, color: '#64748b', fontWeight: 600, marginTop: 4 }}>Tổng đầu vào</div>
                    </div>

                    <ChevronRight size={20} color="#334155" />

                    <div style={{ textAlign: 'center', flex: 1, minWidth: 100 }}>
                      <div style={{ fontSize: 24, fontWeight: 800, color: '#a78bfa' }}>{activeSet.analysis_snapshot.stage_counts.after_corr}</div>
                      <div style={{ fontSize: 11, color: '#a78bfa', fontWeight: 600, marginTop: 4 }}>Sau Spearman Drop</div>
                      <div style={{ fontSize: 9, color: '#64748b', marginTop: 2 }}>
                        Bỏ {activeSet.analysis_snapshot.stage_counts.input - activeSet.analysis_snapshot.stage_counts.after_corr} trùng lặp
                      </div>
                    </div>

                    <ChevronRight size={20} color="#334155" />

                    <div style={{ textAlign: 'center', flex: 1, minWidth: 100 }}>
                      <div style={{ fontSize: 24, fontWeight: 800, color: '#34d399' }}>{activeSet.analysis_snapshot.stage_counts.after_vif}</div>
                      <div style={{ fontSize: 11, color: '#34d399', fontWeight: 600, marginTop: 4 }}>Sau VIF drop</div>
                      <div style={{ fontSize: 9, color: '#64748b', marginTop: 2 }}>
                        Bỏ {activeSet.analysis_snapshot.stage_counts.after_corr - activeSet.analysis_snapshot.stage_counts.after_vif} đa cộng tuyến
                      </div>
                    </div>

                    <ChevronRight size={20} color="#334155" />

                    <div style={{ textAlign: 'center', flex: 1, minWidth: 100 }}>
                      <div style={{ fontSize: 24, fontWeight: 800, color: '#fb7185' }}>{activeSet.analysis_snapshot.stage_counts.after_mi}</div>
                      <div style={{ fontSize: 11, color: '#fb7185', fontWeight: 600, marginTop: 4 }}>Mutual Info Top-K</div>
                      <div style={{ fontSize: 9, color: '#64748b', marginTop: 2 }}>Giữ top {activeSet.analysis_config?.mi_top_k}</div>
                    </div>

                    <ChevronRight size={20} color="#334155" />

                    <div style={{ textAlign: 'center', flex: 1, minWidth: 100, padding: '12px 16px', borderRadius: 8, background: 'rgba(99,102,241,0.1)', border: '1px solid rgba(99,102,241,0.2)' }}>
                      <div style={{ fontSize: 28, fontWeight: 800, color: '#818cf8' }}>{activeSet.selected_columns?.length || 0}</div>
                      <div style={{ fontSize: 11, color: '#818cf8', fontWeight: 700, marginTop: 4 }}>LightGBM Top Chosen</div>
                      <div style={{ fontSize: 9, color: '#94a3b8', marginTop: 2 }}>Bộ đặc trưng tối ưu</div>
                    </div>
                  </div>
                </div>
              )}

              {/* Tabs for details */}
              <div style={{ display: 'flex', borderBottom: '1px solid #1e293b', gap: 24 }}>
                <button
                  onClick={() => setActiveTab('summary')}
                  style={{
                    padding: '12px 4px', background: 'none', border: 'none', cursor: 'pointer',
                    fontSize: 13, fontWeight: 600, color: activeTab === 'summary' ? '#818cf8' : '#64748b',
                    borderBottom: activeTab === 'summary' ? '2px solid #818cf8' : '2px solid transparent',
                    transition: 'all 0.15s'
                  }}
                >
                  <Sparkles size={14} style={{ display: 'inline', marginRight: 6, verticalAlign: 'middle' }} />
                  Optimal Features ({activeSet.selected_columns?.length || 0})
                </button>
                <button
                  onClick={() => setActiveTab('correlation')}
                  style={{
                    padding: '12px 4px', background: 'none', border: 'none', cursor: 'pointer',
                    fontSize: 13, fontWeight: 600, color: activeTab === 'correlation' ? '#818cf8' : '#64748b',
                    borderBottom: activeTab === 'correlation' ? '2px solid #818cf8' : '2px solid transparent',
                    transition: 'all 0.15s'
                  }}
                >
                  <Layers size={14} style={{ display: 'inline', marginRight: 6, verticalAlign: 'middle' }} />
                  Spearman Drop Reasons
                </button>
                <button
                  onClick={() => setActiveTab('vif')}
                  style={{
                    padding: '12px 4px', background: 'none', border: 'none', cursor: 'pointer',
                    fontSize: 13, fontWeight: 600, color: activeTab === 'vif' ? '#818cf8' : '#64748b',
                    borderBottom: activeTab === 'vif' ? '2px solid #818cf8' : '2px solid transparent',
                    transition: 'all 0.15s'
                  }}
                >
                  <Shield size={14} style={{ display: 'inline', marginRight: 6, verticalAlign: 'middle' }} />
                  VIF Multicollinearity
                </button>
                <button
                  onClick={() => setActiveTab('preview')}
                  style={{
                    padding: '12px 4px', background: 'none', border: 'none', cursor: 'pointer',
                    fontSize: 13, fontWeight: 600, color: activeTab === 'preview' ? '#818cf8' : '#64748b',
                    borderBottom: activeTab === 'preview' ? '2px solid #818cf8' : '2px solid transparent',
                    transition: 'all 0.15s'
                  }}
                >
                  <Eye size={14} style={{ display: 'inline', marginRight: 6, verticalAlign: 'middle' }} />
                  Dataset Preview
                </button>
              </div>

              {/* Tab Contents */}
              <div style={{ marginTop: 8 }}>
                {activeTab === 'summary' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
                    <div style={{ ...S.card, padding: 20 }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
                        <h4 style={{ fontSize: 14, fontWeight: 700, color: '#f1f5f9' }}>Optimal Selected Feature Importance Ranking (LightGBM)</h4>
                        <span style={{ fontSize: 11, color: '#64748b' }}>Sắp xếp theo thứ tự độ đóng góp giảm dần</span>
                      </div>
                      
                      {activeSet.analysis_snapshot?.feature_importance ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                          {Object.entries(activeSet.analysis_snapshot.feature_importance)
                            .sort((a,b) => b[1] - a[1])
                            .map(([feat, score], index) => (
                              <div key={feat} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                                <div style={{ width: 28, fontSize: 11, color: '#64748b', fontWeight: 700 }}>#{index+1}</div>
                                <div style={{ width: 300, fontSize: 13, color: '#cbd5e1', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                  <code>{feat}</code>
                                </div>
                                <div style={{ flex: 1, background: '#1e293b', height: 16, borderRadius: 8, overflow: 'hidden', position: 'relative' }}>
                                  <div style={{
                                    height: '100%',
                                    width: `${Math.min(100, (score / Math.max(...Object.values(activeSet.analysis_snapshot.feature_importance))) * 100)}%`,
                                    background: 'linear-gradient(90deg, #6366f1, #818cf8)',
                                    borderRadius: 8
                                  }} />
                                </div>
                                <div style={{ width: 80, textAlign: 'right', fontSize: 12, fontWeight: 700, color: '#818cf8' }}>
                                  {score}
                                </div>
                              </div>
                            ))
                          }
                        </div>
                      ) : (
                        <div style={{ color: '#64748b', textAlign: 'center', padding: 20 }}>Không có thông tin xếp hạng importance.</div>
                      )}
                    </div>
                  </div>
                )}

                {activeTab === 'correlation' && (
                  <div style={{ ...S.card }}>
                    <div style={{ padding: '16px 20px', borderBottom: '1px solid #1e293b', background: '#0a0f1e' }}>
                      <h4 style={{ fontSize: 14, fontWeight: 700, color: '#f1f5f9' }}>Lý do loại bỏ vì tương quan quá cao (Spearman &gt; {activeSet.analysis_config?.corr_threshold || '0.95'})</h4>
                      <p style={{ fontSize: 11, color: '#64748b', marginTop: 4 }}>
                        Những features này bị bỏ đi vì cung cấp thông tin trùng lặp tuyệt đối với một feature khác đã chọn trước đó, hạn chế nhiễu đa cộng tuyến.
                      </p>
                    </div>

                    <div style={{ overflowX: 'auto' }}>
                      <table style={S.table}>
                        <thead>
                          <tr>
                            <th style={S.th}>Feature Bị Drop</th>
                            <th style={S.th}>Trùng lặp quá cao với Feature</th>
                            <th style={S.th}>Hệ số tương quan Spearman</th>
                            <th style={S.th}>Hành động</th>
                          </tr>
                        </thead>
                        <tbody>
                          {!activeSet.analysis_snapshot?.dropped_corr_reasons || Object.keys(activeSet.analysis_snapshot.dropped_corr_reasons).length === 0 ? (
                            <tr>
                              <td colSpan={4} style={{ ...S.td, textAlign: 'center', padding: 30, color: '#64748b' }}>
                                Không có feature nào bị loại bỏ ở bước Correlation.
                              </td>
                            </tr>
                          ) : (
                            Object.entries(activeSet.analysis_snapshot.dropped_corr_reasons).map(([droppedCol, reason]) => (
                              <tr key={droppedCol}>
                                <td style={{ ...S.td, color: '#f87171', fontWeight: 600 }}>
                                  <code>{droppedCol}</code>
                                </td>
                                <td style={S.td}>
                                  <code style={{ color: '#34d399' }}>{reason.with}</code>
                                </td>
                                <td style={S.td}>
                                  <strong style={{ color: '#fb7185' }}>{(reason.corr * 100).toFixed(2)}%</strong>
                                </td>
                                <td style={S.td}>
                                  <span style={S.badge('#ef4444')}>Dropped</span>
                                </td>
                              </tr>
                            ))
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {activeTab === 'vif' && (
                  <div style={{ ...S.card }}>
                    <div style={{ padding: '16px 20px', borderBottom: '1px solid #1e293b', background: '#0a0f1e' }}>
                      <h4 style={{ fontSize: 14, fontWeight: 700, color: '#f1f5f9' }}>Variance Inflation Factor (VIF) Analysis</h4>
                      <p style={{ fontSize: 11, color: '#64748b', marginTop: 4 }}>
                        Hệ số phình đại lượng sai số. Các feature có VIF &gt; {activeSet.analysis_config?.vif_threshold || '10'} thể hiện sự bất ổn định đa cộng tuyến cực đại và bắt buộc phải bị loại bỏ.
                      </p>
                    </div>

                    <div style={{ overflowX: 'auto' }}>
                      <table style={S.table}>
                        <thead>
                          <tr>
                            <th style={S.th}>Tên Feature</th>
                            <th style={S.th}>Điểm số VIF</th>
                            <th style={S.th}>Trạng thái tuyển chọn</th>
                          </tr>
                        </thead>
                        <tbody>
                          {!activeSet.analysis_snapshot?.vif_scores ? (
                            <tr>
                              <td colSpan={3} style={{ ...S.td, textAlign: 'center', padding: 30, color: '#64748b' }}>
                                Không có thông tin phân tích VIF trong snapshot.
                              </td>
                            </tr>
                          ) : (
                            Object.entries(activeSet.analysis_snapshot.vif_scores)
                              .sort((a,b) => b[1] - a[1])
                              .map(([col, vif]) => {
                                const isDropped = activeSet.analysis_snapshot.dropped_vif?.includes(col) || vif > (activeSet.analysis_config?.vif_threshold || 10)
                                return (
                                  <tr key={col}>
                                    <td style={S.td}><code>{col}</code></td>
                                    <td style={{ ...S.td, fontWeight: 700, color: isDropped ? '#f87171' : '#34d399' }}>
                                      {vif.toFixed(2)}
                                    </td>
                                    <td style={S.td}>
                                      {isDropped ? (
                                        <span style={S.badge('#ef4444')}>Dropped (High VIF)</span>
                                      ) : (
                                        <span style={S.badge('#10b981')}>Passed VIF</span>
                                      )}
                                    </td>
                                  </tr>
                                )
                              })
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {activeTab === 'preview' && (
                  <div style={{ ...S.card, overflow: 'hidden' }}>
                    <div style={{ padding: '16px 20px', borderBottom: '1px solid #1e293b', background: '#0a0f1e', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <div>
                        <h4 style={{ fontSize: 14, fontWeight: 700, color: '#f1f5f9' }}>Bản Xem Trước Dữ Liệu Sau Khi Tinh Lọc</h4>
                        <p style={{ fontSize: 11, color: '#64748b', marginTop: 4 }}>
                          Hiển thị tối đa 200 dòng đầu tiên đã được loại bỏ hoàn toàn các cột thừa cùng 15 dòng rỗng NaN ở cuối.
                        </p>
                      </div>
                      <button style={S.btn('ghost')} onClick={loadPreview} disabled={loadingPreview}>
                        <RefreshCw size={12} className={loadingPreview ? 'spin' : ''} /> Tải lại preview
                      </button>
                    </div>

                    {loadingPreview ? (
                      <div style={{ padding: 40, textAlign: 'center', color: '#64748b' }}>
                        <RefreshCw size={24} className="spin" style={{ marginBottom: 12 }} />
                        <div>Đang tải bản xem trước tệp Parquet từ MinIO...</div>
                      </div>
                    ) : !previewData || !previewData.rows || previewData.rows.length === 0 ? (
                      <div style={{ padding: 40, color: '#64748b', textAlign: 'center' }}>
                        Không có dữ liệu bản xem trước để hiển thị.
                      </div>
                    ) : (
                      <div style={{ overflowX: 'auto', maxHeight: 500 }}>
                        <table style={S.table}>
                          <thead>
                            <tr>
                              <th style={{ ...S.th, position: 'sticky', top: 0, zIndex: 10 }}>timestamp</th>
                              {previewData.columns.filter(c => c.name !== 'timestamp').map(col => {
                                const isTarget = col.name === activeSet.target_column
                                return (
                                  <th 
                                    key={col.name} 
                                    style={{ 
                                      ...S.th, 
                                      position: 'sticky', top: 0, zIndex: 10,
                                      ...(isTarget ? { background: '#070f2e', color: '#38bdf8', borderBottom: '2px solid #38bdf8' } : {})
                                    }}
                                  >
                                    {isTarget ? `🎯 ${col.name} (Target)` : col.name}
                                  </th>
                                )
                              })}
                            </tr>
                          </thead>
                          <tbody>
                            {previewData.rows.map((row, idx) => (
                              <tr key={idx}>
                                <td style={{ ...S.td, background: 'rgba(0,0,0,0.15)', color: '#94a3b8', borderRight: '1px solid #1e293b' }}>
                                  {row.timestamp ? (
                                    // If numeric timestamp (millisecond epoch from Arrow), parse correctly
                                    isNaN(row.timestamp) 
                                      ? String(row.timestamp)
                                      : new Date(Number(row.timestamp)).toLocaleString('vi-VN')
                                  ) : '—'}
                                </td>
                                {previewData.columns.filter(c => c.name !== 'timestamp').map(col => {
                                  const isTarget = col.name === activeSet.target_column
                                  return (
                                    <td 
                                      key={col.name} 
                                      style={{ 
                                        ...S.td,
                                        ...(isTarget ? { background: 'rgba(56,189,248,0.12)', color: '#38bdf8', fontWeight: 700 } : {})
                                      }}
                                    >
                                      {row[col.name] !== undefined && row[col.name] !== null ? (
                                        typeof row[col.name] === 'number' ? row[col.name].toFixed(6) : String(row[col.name])
                                      ) : (
                                        <span style={{ color: '#ef4444' }}>NaN</span>
                                      )}
                                    </td>
                                  )
                                })}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {/* ── CREATE DRAWER OVERLAY ── */}
      {showDrawer && (
        <div style={S.overlay} onClick={() => setShowDrawer(false)}>
          <div style={S.drawer} onClick={e => e.stopPropagation()}>
            <div style={S.drawerHeader}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <Zap size={20} color="#fbbf24" />
                <h3 style={{ fontSize: 16, fontWeight: 700, color: '#fff' }}>Run Feature Selection</h3>
              </div>
              <button
                onClick={() => setShowDrawer(false)}
                style={{ background: 'none', border: 'none', color: '#64748b', cursor: 'pointer' }}
              >
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleCreateSelection} style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
              <div style={S.drawerBody}>
                {/* Labeled Dataset source select */}
                <div style={S.formGroup}>
                  <label style={S.label}>1. Select Target-Labeled Dataset Source</label>
                  <select
                    style={S.select}
                    value={selectedLdId}
                    onChange={e => setSelectedLdId(e.target.value)}
                    required
                  >
                    <option value="">-- Choose Labeled Dataset Source --</option>
                    {labeledDatasets.map(d => (
                      <option key={d.id} value={d.id}>{d.name}</option>
                    ))}
                  </select>
                  <span style={{ fontSize: 10, color: '#64748b', marginTop: 4, display: 'block' }}>
                    Chỉ hiển thị các Labeled Dataset đã hoàn thành gán cột mục tiêu ở bước trước.
                  </span>
                </div>

                {/* Selection Run Name */}
                <div style={S.formGroup}>
                  <label style={S.label}>2. Filter Run Name</label>
                  <input
                    type="text"
                    style={S.input}
                    placeholder="e.g., Optimal BTC 15m RSI Set"
                    value={runName}
                    onChange={e => setRunName(e.target.value)}
                  />
                </div>

                {/* Target & Task Auto display */}
                <div style={S.row}>
                  <div style={{ ...S.formGroup, flex: 1 }}>
                    <label style={S.label}>Target Column</label>
                    <input
                      type="text"
                      style={{ ...S.input, background: 'rgba(255,255,255,0.03)', color: '#38bdf8', fontWeight: 600 }}
                      value={targetCol}
                      onChange={e => setTargetCol(e.target.value)}
                      required
                    />
                  </div>
                  <div style={{ ...S.formGroup, flex: 1 }}>
                    <label style={S.label}>Task Type</label>
                    <input
                      type="text"
                      disabled
                      style={{ ...S.input, background: 'rgba(255,255,255,0.03)', color: '#94a3b8' }}
                      value={taskType === 'classification' ? 'Up/Down Binary' : 'Regression'}
                    />
                  </div>
                </div>

                {/* Mathematical thresholds config */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12, borderTop: '1px solid #1e293b', paddingTop: 16, marginTop: 8 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: '#818cf8', marginBottom: 4 }}>3. Mathematical Selection Thresholds</div>
                  
                  <div style={S.row}>
                    <div style={{ flex: 1 }}>
                      <label style={S.label}>Spearman Corr Limit</label>
                      <input
                        type="number"
                        step="0.01"
                        min="0.5"
                        max="1.0"
                        style={S.input}
                        value={corrThreshold}
                        onChange={e => setCorrThreshold(Math.max(0.5, parseFloat(e.target.value) || 0.95))}
                      />
                      <span style={{ fontSize: 9, color: '#64748b', marginTop: 2, display: 'block' }}>Drop |corr| &gt; threshold.</span>
                    </div>

                    <div style={{ flex: 1 }}>
                      <label style={S.label}>VIF Multi-col Limit</label>
                      <input
                        type="number"
                        step="0.1"
                        min="2.0"
                        max="100.0"
                        style={S.input}
                        value={vifThreshold}
                        onChange={e => setVifThreshold(Math.max(2.0, parseFloat(e.target.value) || 10.0))}
                      />
                      <span style={{ fontSize: 9, color: '#64748b', marginTop: 2, display: 'block' }}>Drop VIF &gt; threshold.</span>
                    </div>
                  </div>

                  <div style={S.row}>
                    <div style={{ flex: 1 }}>
                      <label style={S.label}>Mutual Info Top K</label>
                      <input
                        type="number"
                        min="5"
                        max="200"
                        style={S.input}
                        value={miTopK}
                        onChange={e => setMiTopK(Math.max(5, parseInt(e.target.value) || 50))}
                      />
                    </div>

                    <div style={{ flex: 1 }}>
                      <label style={S.label}>LightGBM Top K</label>
                      <input
                        type="number"
                        min="2"
                        max="100"
                        style={S.input}
                        value={treeTopK}
                        onChange={e => setTreeTopK(Math.max(2, parseInt(e.target.value) || 20))}
                      />
                    </div>
                  </div>
                </div>
              </div>

              <div style={S.drawerFooter}>
                <button
                  type="button"
                  style={S.btn('ghost')}
                  onClick={() => setShowDrawer(false)}
                >
                  Huỷ bỏ
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  style={S.btn('primary')}
                >
                  {submitting ? <RefreshCw size={14} className="spin" /> : <Play size={14} />} Start Filtering
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}

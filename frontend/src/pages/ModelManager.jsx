import React, { useState, useEffect, useCallback, useRef } from 'react'
import {
  Database, Table, Plus, Trash2, RefreshCw, ChevronRight,
  BarChart2, Eye, Code, Camera, Settings2, Check, X,
  Pencil, Copy, CheckCheck, AlertTriangle, Layers,
  FileText, HardDrive, Hash, Clock, Zap, Search, Upload,
  ChevronDown, ArrowRight, CheckCircle2, XCircle, Info, BookOpen
} from 'lucide-react'
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels'
import { useDocStore } from '../store/docStore'
import DocGuideDrawer from '../components/DocGuideDrawer'
import ProgressiveAssistToast from '../components/ProgressiveAssistToast'
import * as api from '../api/client'

// ── Constants ────────────────────────────────────────────────
const COL_TYPES = [
  'VARCHAR', 'BIGINT', 'INTEGER', 'SMALLINT', 'TINYINT',
  'DOUBLE', 'REAL', 'DECIMAL(18,6)', 'BOOLEAN',
  'DATE', 'TIMESTAMP', 'TIMESTAMP WITH TIME ZONE',
  'VARBINARY', 'JSON', 'ARRAY(VARCHAR)', 'MAP(VARCHAR,VARCHAR)',
]

const FILE_FORMATS = ['PARQUET', 'ORC', 'AVRO']

function fmtBytes(b) {
  if (!b) return '0 B'
  if (b < 1_024) return `${b} B`
  if (b < 1_048_576) return `${(b / 1_024).toFixed(1)} KB`
  if (b < 1_073_741_824) return `${(b / 1_048_576).toFixed(1)} MB`
  return `${(b / 1_073_741_824).toFixed(2)} GB`
}

function fmtNum(n) {
  if (n === null || n === undefined) return '—'
  return n.toLocaleString()
}

function fmtDate(d) {
  if (!d) return '—'
  return new Date(d).toLocaleString('vi-VN')
}

function schemaColor(s) {
  if (s === 'bronze') return 'bronze'
  if (s === 'silver') return 'silver'
  if (s === 'gold')   return 'gold'
  return 'other'
}

// ── Loading Dots ──────────────────────────────────────────────
function LoadingDots() {
  return (
    <div className="loading-dots">
      <span /><span /><span />
    </div>
  )
}

// ── Toast ─────────────────────────────────────────────────────
function Toast({ toasts, remove }) {
  return (
    <div style={{ position: 'fixed', bottom: 24, right: 24, zIndex: 9999, display: 'flex', flexDirection: 'column', gap: 8 }}>
      {toasts.map(t => (
        <div key={t.id} onClick={() => remove(t.id)} style={{
          background: t.type === 'error' ? 'rgba(239,68,68,0.95)' : 'rgba(16,185,129,0.95)',
          color: '#fff', padding: '10px 16px', borderRadius: 8, fontSize: 13,
          boxShadow: '0 4px 20px rgba(0,0,0,0.4)', cursor: 'pointer',
          animation: 'slideUp 0.3s ease', display: 'flex', gap: 8, alignItems: 'center',
          maxWidth: 320,
        }}>
          {t.type === 'error' ? <AlertTriangle size={14} /> : <Check size={14} />}
          {t.msg}
        </div>
      ))}
    </div>
  )
}

// ── Main ─────────────────────────────────────────────────────

function ConfirmModal({ title, message, confirmText = 'Confirm', onConfirm, onCancel }) {
  return (
    <div className="modal-overlay" style={{ background: 'rgba(0,0,0,0.6)', zIndex: 9999 }}>
      <div className="modal-content" style={{ maxWidth: 400 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, color: 'var(--warning)' }}>
           <AlertTriangle size={20} /> <h3 style={{ margin: 0, color: 'var(--text)' }}>{title}</h3>
        </div>
        <p style={{ color: 'var(--text-muted)', fontSize: 13, lineHeight: 1.5 }}>{message}</p>
        <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end', marginTop: 24 }}>
          <button className="btn btn-secondary" onClick={onCancel}>Cancel action</button>
          <button className="btn btn-primary" style={{ background: 'var(--warning)', borderColor: 'var(--warning)' }} onClick={onConfirm}>{confirmText}</button>
        </div>
      </div>
    </div>
  )
}


function TabMaintenance({ branch, schema, table, toast, confirm }) {
  const [retention, setRetention] = useState("7d")
  const [loadingOpt, setLoadingOpt] = useState(false)
  const [loadingVac, setLoadingVac] = useState(false)

  async function handleOptimize() {
    confirm({
      title: "Run Compaction",
      message: "Are you sure you want to run Compaction? This command will combine small data files into more efficient blocks.",
      onConfirm: async () => {
        setLoadingOpt(true)
        try {
          const res = await api.optimizeTable(schema, table, branch)
          toast(res.message || "File layout successfully optimized!", "success")
        } catch (err) {
          toast("Optimize Error: " + err.message, "error")
        }
        setLoadingOpt(false)
        confirm(null)
      },
      onCancel: () => confirm(null)
    })
  }

  async function handleVacuum() {
    confirm({
      title: "Cleanup Time-Travel History",
      message: `Are you sure you want to permanently delete snapshots older than [${retention}] (excluding current snapshot)? This will prevent you from rolling back to a point before that time!`,
      onConfirm: async () => {
        setLoadingVac(true)
        try {
          const res = await api.vacuumTable(schema, table, retention, 1, branch)
          toast(res.message || "Cleaned up old snapshots!", "success")
        } catch (err) {
          toast("Vacuum Error: " + err.message, "error")
        }
        setLoadingVac(false)
        confirm(null)
      },
      onCancel: () => confirm(null)
    })
  }

  return (
    <div style={{ padding: '20px 0' }}>

      {/* Card 1: Compaction */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-header">
          <h2 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span>🚀</span> Data Compaction
            <span className="badge badge-info" style={{ fontWeight: 400, fontSize: 11 }}>EXECUTE OPTIMIZE</span>
          </h2>
        </div>
        <div className="card-body">
          <p style={{ color: 'var(--text-secondary)', fontSize: 13, lineHeight: 1.7, marginBottom: 16 }}>
            Streaming/Micro-batch pipelines often generate thousands of small files (small files problem).
            The <code style={{ background: 'var(--bg-glass)', padding: '1px 6px', borderRadius: 4, fontFamily: 'monospace' }}>OPTIMIZE</code> command will
            group them into standard large Parquet files (~512MB), significantly speeding up queries.
          </p>
          <button className="btn btn-primary" onClick={handleOptimize} disabled={loadingOpt}>
            {loadingOpt ? <RefreshCw size={14} className="spin" /> : <RefreshCw size={14} />}
            {loadingOpt ? 'Running...' : 'Run File Compaction'}
          </button>
        </div>
      </div>

      {/* Card 2: Vacuum */}
      <div className="card">
        <div className="card-header">
          <h2 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span>🧹</span> Vacuum — Expire Snapshots
            <span className="badge badge-warning" style={{ fontWeight: 400, fontSize: 11 }}>Cannot be undone</span>
          </h2>
        </div>
        <div className="card-body">
          <p style={{ color: 'var(--text-secondary)', fontSize: 13, lineHeight: 1.7, marginBottom: 16 }}>
            Iceberg accumulates Snapshots over time for Time-Travel & Rollback. The <strong>Vacuum</strong> feature will
            permanently delete Snapshots older than your configured threshold (keeps at least 1 recent snapshot).
            After running, Time-Travel to points before this threshold will no longer be available.
          </p>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 12 }}>
            <div className="form-group" style={{ marginBottom: 0, width: 200 }}>
              <label className="form-label">Retention Period</label>
              <input
                type="text"
                value={retention}
                onChange={e => setRetention(e.target.value)}
                className="form-input"
                placeholder="VD: 7d, 24h, 30d"
                title="Syntax: Nd = N days, Nh = N hours"
              />
            </div>
            <button
              className="btn btn-danger"
              onClick={handleVacuum}
              disabled={loadingVac}
              style={{ marginBottom: 0, flexShrink: 0 }}
            >
              {loadingVac ? <RefreshCw size={14} className="spin" /> : <AlertTriangle size={14} />}
              {loadingVac ? 'Vacuuming...' : 'Run Vacuum'}
            </button>
          </div>
          <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 8 }}>
            💡 Recommendation: <strong>7d</strong> for Production. Use <strong>30d</strong> if more Time-Travel history is needed.
          </p>
        </div>
      </div>

    </div>
  )
}

export default function ModelManager() {

  const [schemas, setSchemas]           = useState([])
  const [openSchemas, setOpenSchemas]   = useState({})
  const [schemaTables, setSchemaTables] = useState({}) // {schemaName: [tableName,...]}
  const [selected, setSelected]         = useState(null) // {schema, table}
  const [activeTab, setActiveTab]       = useState('overview')
  const [previewSnapshotId, setPreviewSnapshotId] = useState(null)
  const [confirmDialog, setConfirmDialog] = useState(null)
  const [toasts, setToasts]             = useState([])
  const [showCreateSchema, setShowCreateSchema] = useState(false)
  const [showCreateTable, setShowCreateTable]   = useState(false)
  const [showCloneTable, setShowCloneTable]     = useState(false)
  const [branches, setBranches]         = useState([])
  const [activeBranch, setActiveBranch] = useState('main')
  const [refreshKey, setRefreshKey]     = useState(0)

  // Zustand store — Guide Drawer + Progressive Assist
  const { isDrawerOpen, toggleDrawer, reportError, resetErrorStreak, errorStreakCount } = useDocStore()

  // Toast helpers
  const toast = (msg, type = 'success') => {
    const id = Date.now()
    setToasts(p => [...p, { id, msg, type }])
    setTimeout(() => setToasts(p => p.filter(t => t.id !== id)), 3500)
  }
  const removeToast = (id) => setToasts(p => p.filter(t => t.id !== id))

  useEffect(() => { api.listBranches().then(d => setBranches(d.branches || [])).catch(()=>{}) }, [])
  useEffect(() => { loadSchemas(activeBranch) }, [activeBranch])

  // Parse URL to jump to specific table
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const qs = params.get('schema')
    const qt = params.get('table')
    if (qs && qt) {
      setOpenSchemas(p => ({ ...p, [qs]: true }))
      api.getTables(qs, activeBranch).then(data => {
        setSchemaTables(p => ({ ...p, [qs]: data.tables || [] }))
        setSelected({ schema: qs, table: qt })
        setActiveTab('preview')
        window.history.replaceState({}, '', '/models')
      }).catch(()=>{})
    }
  }, [])

  async function loadSchemas(branch) {
    try {
      const data = await api.getSchemas(branch)
      let list = data.schemas || []
      const orderMap = { bronze: 1, silver: 2, gold: 3 }
      list.sort((a, b) => {
        const orderA = orderMap[a] || 99
        const orderB = orderMap[b] || 99
        if (orderA !== orderB) return orderA - orderB
        return a.localeCompare(b)
      })
      setSchemas(list)
      // Don't auto-expand any schema — user clicks to open
      setOpenSchemas(prev => prev)
    } catch (e) { toast('Failed to load schemas', 'error') }
  }

  async function loadTablesForSchema(schema, branch = activeBranch) {
    try {
      const data = await api.getTables(schema, branch)
      setSchemaTables(prev => ({ ...prev, [schema]: data.tables || [] }))
    } catch { setSchemaTables(prev => ({ ...prev, [schema]: [] })) }
  }

  function toggleSchema(schema) {
    const next = !openSchemas[schema]
    setOpenSchemas(prev => ({ ...prev, [schema]: next }))
    if (next && !schemaTables[schema]) loadTablesForSchema(schema, activeBranch)
  }

  function selectTable(schema, table) {
    setSelected({ schema, table })
    setActiveTab('preview')  // default to Preview tab when selecting a table
    setPreviewSnapshotId(null)
  }

  function handleDropSchema(schema) {
    setConfirmDialog({
      title: "Delete Schema",
      message: `Delete schema "${schema}"? Schema must be EMPTY.`,
      confirmText: "Delete",
      onConfirm: async () => {
        setConfirmDialog(null)
        try {
          await api.dropSchema(schema, activeBranch)
          toast(`Deleted schema "${schema}"`)
          resetErrorStreak()
          setSchemas(p => p.filter(s => s !== schema))
          setSchemaTables(p => { const n = {...p}; delete n[schema]; return n })
          if (selected?.schema === schema) setSelected(null)
        } catch (e) {
          toast(e.message, 'error')
          reportError(e.message)
        }
      },
      onCancel: () => setConfirmDialog(null)
    })
  }

  function handleDropTable(schema, table) {
    setConfirmDialog({
      title: "Delete Table",
      message: <>Delete table "{schema}.{table}"?<br/>This action CANNOT be undone.</>,
      confirmText: "Delete",
      onConfirm: async () => {
        setConfirmDialog(null)
        try {
          await api.dropTable(schema, table, activeBranch)
          toast(`Deleted table "${table}"`)
          resetErrorStreak()
          setSchemaTables(prev => ({ ...prev, [schema]: (prev[schema] || []).filter(t => t !== table) }))
          if (selected?.schema === schema && selected?.table === table) setSelected(null)
        } catch (e) {
          toast(e.message, 'error')
          reportError(e.message)
        }
      },
      onCancel: () => setConfirmDialog(null)
    })
  }

  function handleTruncateTable(schema, table) {
    setConfirmDialog({
      title: "Drop All Rows (Clear Data)",
      message: <>Are you sure you want to delete all rows from "{schema}.{table}"?<br/>The table structure will be kept, but data CANNOT be recovered.</>,
      confirmText: "Delete Data",
      onConfirm: async () => {
        setConfirmDialog(null)
        try {
          await api.truncateTable(schema, table, activeBranch)
          toast(`Deleted all rows from "${table}"`)
          refreshCurrentSchema()
        } catch (e) {
          toast(e.message, 'error')
          reportError(e.message)
        }
      },
      onCancel: () => setConfirmDialog(null)
    })
  }

  function refreshCurrentSchema() {
    if (selected) loadTablesForSchema(selected.schema, activeBranch)
    setRefreshKey(k => k + 1)
  }

  function handleCloneTable(schema, table) {
    setShowCloneTable(true)
  }

  const tabs = [
    { id: 'overview',    label: 'Overview',    icon: <BarChart2 size={13} /> },
    { id: 'schema',      label: 'Schema',      icon: <Table size={13} /> },
    { id: 'preview',     label: 'Preview',     icon: <Eye size={13} /> },
    { id: 'snapshots',   label: 'Snapshots',   icon: <Camera size={13} /> },
    { id: 'ddl',         label: 'DDL',         icon: <Code size={13} /> },
    { id: 'maintenance', label: 'Optimize',    icon: <Settings2 size={13} /> },
    { id: 'import',      label: 'Import CSV',  icon: <Upload size={13} /> },
  ]

  return (
    <>
      {/* Top bar */}
      <div className="top-bar">
        <h1 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Database size={18} /> Data Models
        </h1>
        <div className="flex gap-2">
          <button className="btn btn-secondary btn-sm" onClick={() => loadSchemas(activeBranch)}>
            <RefreshCw size={13} /> Refresh
          </button>
          <button className="btn btn-secondary btn-sm" onClick={() => setShowCreateSchema(true)}>
            <Layers size={13} /> New Schema
          </button>
          <button className="btn btn-primary btn-sm" onClick={() => setShowCreateTable(true)}>
            <Plus size={13} /> New Table
          </button>
          {/* Nút mở/đóng Guide Drawer */}
          <button
            className={`btn btn-sm ${isDrawerOpen ? 'btn-primary' : 'btn-secondary'}`}
            onClick={toggleDrawer}
            title={isDrawerOpen ? 'Đóng Guide' : 'Mở Hướng Dẫn'}
            style={{
              position: 'relative',
              ...(isDrawerOpen ? {} : { borderColor: 'rgba(139,92,246,0.4)', color: '#a78bfa' }),
            }}
          >
            <BookOpen size={13} /> Guide
            {/* Badge đỏ khi có lỗi chưa xem */}
            {errorStreakCount > 0 && (
              <span style={{
                position: 'absolute', top: -4, right: -4,
                width: 8, height: 8, borderRadius: '50%',
                background: '#ef4444',
                border: '1.5px solid var(--bg-surface)',
                animation: 'errorPulse 1.2s ease-in-out infinite',
              }} />
            )}
          </button>
          <style>{`
            @keyframes errorPulse {
              0%, 100% { transform: scale(1); opacity: 1; }
              50% { transform: scale(1.4); opacity: 0.7; }
            }
          `}</style>
        </div>
      </div>

      {/* Main layout — Resizable 3-panel: Schema Tree | Detail | Guide Drawer */}
      <PanelGroup direction="horizontal" style={{ height: 'calc(100vh - 56px)' }}>

        {/* Panel 1: Schema Tree (sidebar cố định ~220px, min 150px) */}
        <Panel defaultSize={18} minSize={13} maxSize={28} style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div className="schema-panel" style={{ height: '100%', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        <div className="schema-panel">
          <div className="schema-panel-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h3>Catalog Explorer</h3>
            <select
              className="form-select"
              style={{ width: 100, fontSize: 12, padding: '2px 8px' }}
              value={activeBranch}
              onChange={e => {
                const b = e.target.value;
                setActiveBranch(b);
                setSchemas([]);
                setSchemaTables({});
                setSelected(null);
                setOpenSchemas({});
              }}
            >
              {branches.map(b => <option key={b.name} value={b.name}>{b.name}</option>)}
            </select>
          </div>
          <div className="schema-tree">
            {schemas.length === 0 ? (
              <div style={{ padding: '24px 16px', color: 'var(--text-muted)', fontSize: 12, textAlign: 'center' }}>
                No schemas found
              </div>
            ) : schemas.map(schema => (
              <div className="schema-node" key={schema}>
                {/* Schema row */}
                <div
                  className="schema-node-header"
                  onClick={() => toggleSchema(schema)}
                >
                  <div className={`schema-icon ${schemaColor(schema)}`}>
                    {schema[0].toUpperCase()}
                  </div>
                  <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {schema}
                  </span>
                  {schemaTables[schema] && (
                    <span style={{ fontSize: 10, color: 'var(--text-muted)', background: 'var(--bg-glass)', padding: '1px 5px', borderRadius: 8 }}>
                      {schemaTables[schema].length}
                    </span>
                  )}
                  <ChevronRight size={13} className={`schema-node-chevron${openSchemas[schema] ? ' open' : ''}`} />
                </div>

                {/* Tables list */}
                {openSchemas[schema] && (
                  <div className="table-nodes">
                    {!schemaTables[schema] ? (
                      <div style={{ padding: '8px 16px 8px 40px' }}><LoadingDots /></div>
                    ) : schemaTables[schema].length === 0 ? (
                      <div style={{ padding: '8px 16px 8px 40px', fontSize: 12, color: 'var(--text-muted)', fontStyle: 'italic' }}>
                        No tables yet
                      </div>
                    ) : schemaTables[schema].map(t => (
                      <div
                        key={t}
                        className={`table-node${selected?.schema === schema && selected?.table === t ? ' active' : ''}`}
                        onClick={() => selectTable(schema, t)}
                      >
                        <Table size={12} />
                        <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t}</span>
                        <button
                          className="btn btn-danger btn-sm"
                          style={{ padding: '2px 6px', opacity: 0, fontSize: 10 }}
                          onMouseEnter={e => e.currentTarget.style.opacity = 1}
                          onMouseLeave={e => e.currentTarget.style.opacity = 0}
                          onClick={ev => { ev.stopPropagation(); handleDropTable(schema, t) }}
                          title="Delete table"
                        >
                          <Trash2 size={10} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
        </div>
        </Panel>

        <PanelResizeHandle style={{ width: 4, background: 'var(--border)', cursor: 'col-resize', transition: 'background 0.2s' }}
          onDragging={d => { if(d) document.querySelector('.panel-resize-handle-schema')?.classList.add('dragging') }}
        />

        {/* Panel 2: Detail Panel (chiếm phần còn lại) */}
        <Panel style={{ overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        <div className="detail-panel" style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
          {!selected ? (
            <div className="detail-empty">
              <Database size={56} />
              <h3>Select a table to view details</h3>
              <p>Expand a schema on the left and click any table name</p>
              <button className="btn btn-primary btn-sm" style={{ marginTop: 8 }} onClick={() => setShowCreateTable(true)}>
                <Plus size={13} /> Create first table
              </button>
            </div>
          ) : (
            <>
              {/* Detail Header */}
              <div className="detail-header">
                <div className="breadcrumb">
                  <span className="breadcrumb-schema">{selected.schema}</span>
                  <span className="breadcrumb-sep">/</span>
                  <span className="breadcrumb-table">{selected.table}</span>
                </div>
                <div className="detail-actions">
                  <RenameTableInline
                    branch={activeBranch}
                    schema={selected.schema}
                    table={selected.table}
                    onSuccess={(newName) => {
                      toast(`Renamed to → ${newName}`)
                      setSchemaTables(prev => ({
                        ...prev,
                        [selected.schema]: (prev[selected.schema] || []).map(t => t === selected.table ? newName : t)
                      }))
                      setSelected({ schema: selected.schema, table: newName })
                    }}
                    onError={e => toast(e, 'error')}
                  />
                  <button
                    className="btn btn-secondary btn-sm"
                    onClick={() => handleCloneTable(selected.schema, selected.table)}
                    title="Clone table"
                    style={{ borderColor: 'rgba(139,92,246,0.5)', color: '#a78bfa' }}
                  >
                    <Copy size={13} /> Clone
                  </button>
                  <button className="btn btn-secondary btn-sm" onClick={refreshCurrentSchema}>
                    <RefreshCw size={13} />
                  </button>
                  <button className="btn btn-warning btn-sm" onClick={() => handleTruncateTable(selected.schema, selected.table)} style={{ background: 'var(--warning)', borderColor: 'var(--warning)', color: '#fff' }}>
                    <Trash2 size={13} /> Drop All Rows
                  </button>
                  <button className="btn btn-danger btn-sm" onClick={() => handleDropTable(selected.schema, selected.table)}>
                    <Trash2 size={13} /> Drop Table
                  </button>
                </div>
              </div>

              {/* Tab bar */}
              <div className="tab-bar">
                {tabs.map(tab => (
                  <button
                    key={tab.id}
                    className={`tab-btn${activeTab === tab.id ? ' active' : ''}`}
                    onClick={() => setActiveTab(tab.id)}
                  >
                    {tab.icon} {tab.label}
                  </button>
                ))}
              </div>

              {/* Tab content */}
              <div className="tab-content" style={{ flex: 1, overflow: 'auto' }} key={refreshKey}>
                {activeTab === 'overview' && (
                  <TabOverview branch={activeBranch} schema={selected.schema} table={selected.table} toast={toast} />
                )}
                {activeTab === 'schema' && (
                  <TabSchema
                    branch={activeBranch}
                    schema={selected.schema}
                    table={selected.table}
                    toast={toast}
                  />
                )}
                {activeTab === 'preview' && (
                  <TabPreview branch={activeBranch} schema={selected.schema} table={selected.table} toast={toast} initialSnapshotId={previewSnapshotId} />
                )}
                {activeTab === 'snapshots' && (
                  <TabSnapshots branch={activeBranch} schema={selected.schema} table={selected.table} onTimeTravelPreview={(snapId) => { setPreviewSnapshotId(String(snapId)); setActiveTab('preview') }} toast={toast} confirm={setConfirmDialog} />
                )}
                {/* ── Tab DDL (readonly) ────────────────────────────── */}
                {activeTab === 'ddl' && (
                  <TabDDL branch={activeBranch} schema={selected.schema} table={selected.table} toast={toast} />
                )}
                {activeTab === 'maintenance' && (
                  <TabMaintenance branch={activeBranch} schema={selected.schema} table={selected.table} toast={toast} confirm={setConfirmDialog} />
                )}
                {activeTab === 'import' && (
                  <TabImportCSV branch={activeBranch} schema={selected.schema} table={selected.table} toast={toast} onImportSuccess={() => setActiveTab('preview')} />
                )}
              </div>
            </>
          )}
        </div>
        </Panel>

        {/* Panel 3: Guide Drawer (chỉ hiện khi isDrawerOpen) */}
        {isDrawerOpen && (
          <>
            <PanelResizeHandle style={{ width: 4, background: 'var(--border)', cursor: 'col-resize' }} />
            <Panel defaultSize={28} minSize={20} maxSize={45}>
              <DocGuideDrawer
                schema={selected?.schema}
                table={selected?.table}
              />
            </Panel>
          </>
        )}

      </PanelGroup>

      {/* Modals */}
      {confirmDialog && <ConfirmModal {...confirmDialog} />}
      {showCreateSchema && (
        <CreateSchemaModal
          branch={activeBranch}
          onClose={() => setShowCreateSchema(false)}
          onSuccess={(name) => {
            toast(`Created schema "${name}"`)
            resetErrorStreak()
            setSchemas(p => [...p, name])
            setShowCreateSchema(false)
          }}
          onError={e => { toast(e, 'error'); reportError(e) }}
        />
      )}
      {showCreateTable && (
        <CreateTableWizard
          branch={activeBranch}
          schemas={schemas}
          defaultSchema={selected?.schema || schemas[0] || 'bronze'}
          onClose={() => setShowCreateTable(false)}
          onSuccess={(schema, table) => {
            toast(`Created table "${schema}.${table}"`)
            resetErrorStreak()
            loadTablesForSchema(schema)
            setSelected({ schema, table })
            setShowCreateTable(false)
          }}
          onError={e => { toast(e, 'error'); reportError(e) }}
        />
      )}

      
      {showCloneTable && selected && (
        <CloneTableModal
          branch={activeBranch}
          schemas={schemas}
          srcSchema={selected.schema}
          srcTable={selected.table}
          onClose={() => setShowCloneTable(false)}
          onSuccess={(targetSchema, targetTable) => {
            toast(`Cloned → ${targetSchema}.${targetTable} ✓`)
            loadTablesForSchema(targetSchema)
            setSelected({ schema: targetSchema, table: targetTable })
            setShowCloneTable(false)
          }}
          onError={e => toast(e, 'error')}
        />
      )}

      <Toast toasts={toasts} remove={removeToast} />
      {/* Progressive Assist Toast — fixed góc dưới phải, tự pop-up khi gặp lỗi liên tiếp */}
      <ProgressiveAssistToast />
    </>
  )
}

// ── Rename inline button ──────────────────────────────────────
function RenameTableInline({ branch, schema, table, onSuccess, onError }) {
  const [editing, setEditing] = useState(false)
  const [val, setVal]         = useState(table)
  const [loading, setLoading] = useState(false)

  async function submit() {
    if (!val.trim() || val === table) { setEditing(false); return }
    setLoading(true)
    try {
      await api.renameTable(schema, table, { new_name: val.trim() }, branch)
      onSuccess(val.trim())
      setEditing(false)
    } catch (e) { onError(e.message) }
    setLoading(false)
  }

  if (!editing) return (
    <button className="btn btn-secondary btn-sm" onClick={() => { setVal(table); setEditing(true) }}>
      <Pencil size={13} /> Rename
    </button>
  )

  return (
    <div className="inline-confirm">
      <input
        className="form-input"
        style={{ padding: '4px 8px', width: 160, fontSize: 13 }}
        value={val}
        onChange={e => setVal(e.target.value)}
        autoFocus
        onKeyDown={e => { if (e.key === 'Enter') submit(); if (e.key === 'Escape') setEditing(false) }}
      />
      <button className="btn btn-primary btn-sm" onClick={submit} disabled={loading}>
        {loading ? <LoadingDots /> : <Check size={13} />}
      </button>
      <button className="btn btn-secondary btn-sm" onClick={() => setEditing(false)}>
        <X size={13} />
      </button>
    </div>
  )
}

// ── Clone Table Modal ─────────────────────────────────────────
function CloneTableModal({ branch, schemas, srcSchema, srcTable, onClose, onSuccess, onError }) {
  const [targetSchema, setTargetSchema] = useState(srcSchema)
  const [targetTable, setTargetTable]   = useState(`${srcTable}_copy`)
  const [copyData, setCopyData]         = useState(false)
  const [loading, setLoading]           = useState(false)
  const [step, setStep]                 = useState('form') // 'form' | 'serving' | 'done'
  const [result, setResult]             = useState(null)
  const [srcColumns, setSrcColumns]     = useState([])

  // Load columns of source table for PK picker
  useEffect(() => {
    api.describeTable(srcSchema, srcTable, branch)
      .then(d => setSrcColumns(d.columns || []))
      .catch(() => setSrcColumns([]))
  }, [srcSchema, srcTable, branch])

  const isValid = targetTable.trim().length > 0 && targetSchema.trim().length > 0
  const isGold  = targetSchema === 'gold'

  const previewSql = copyData
    ? `CREATE TABLE IF NOT EXISTS iceberg.${targetSchema}.${targetTable} ...\nINSERT INTO iceberg.${targetSchema}.${targetTable} SELECT * FROM iceberg.${srcSchema}.${srcTable};`
    : `CREATE TABLE IF NOT EXISTS iceberg.${targetSchema}.${targetTable}\n  AS (schema of iceberg.${srcSchema}.${srcTable});`

  async function handleClone() {
    if (!isValid) return
    setLoading(true)
    try {
      const res = await api.cloneTable(srcSchema, srcTable, {
        target_schema: targetSchema.trim(),
        target_table: targetTable.trim(),
        copy_data: copyData,
      }, branch)
      setResult(res)
      // If cloned into gold, offer serving layer registration
      if (isGold) {
        setStep('serving')
      } else {
        setStep('done')
      }
    } catch (e) {
      onError(e.message)
    }
    setLoading(false)
  }

  return (
    <div className="modal-overlay" style={{ background: 'rgba(0,0,0,0.65)', zIndex: 9999 }}>
      <div className="modal-content" style={{ maxWidth: 520, width: '94vw' }}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
          <div style={{
            width: 36, height: 36, borderRadius: 10,
            background: 'linear-gradient(135deg, rgba(139,92,246,0.25), rgba(99,102,241,0.15))',
            border: '1px solid rgba(139,92,246,0.35)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <Copy size={16} style={{ color: '#a78bfa' }} />
          </div>
          <div>
            <h3 style={{ margin: 0, fontSize: 16, color: 'var(--text)' }}>Clone Table</h3>
            <p style={{ margin: 0, fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
              Tạo bảng mới với cùng cấu trúc từ{' '}
              <code style={{ background: 'var(--bg-glass)', padding: '1px 5px', borderRadius: 4 }}>
                {srcSchema}.{srcTable}
              </code>
            </p>
          </div>
          <button
            className="btn btn-secondary btn-sm"
            style={{ marginLeft: 'auto', padding: '4px 8px' }}
            onClick={onClose}
          ><X size={14} /></button>
        </div>

        {step === 'form' ? (
          <>
            {/* Source info */}
            <div style={{
              background: 'var(--bg-glass)', border: '1px solid var(--border)',
              borderRadius: 8, padding: '10px 14px', marginBottom: 16,
              display: 'flex', gap: 8, alignItems: 'center',
            }}>
              <ArrowRight size={14} style={{ color: '#a78bfa', flexShrink: 0 }} />
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Source:</span>
              <code style={{ fontSize: 13, color: 'var(--text)' }}>{srcSchema}.<strong>{srcTable}</strong></code>
            </div>

            {/* Target schema + table */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.6fr', gap: 12, marginBottom: 14 }}>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">Target Schema</label>
                <select
                  className="form-select"
                  value={targetSchema}
                  onChange={e => setTargetSchema(e.target.value)}
                >
                  {schemas.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">New Table Name</label>
                <input
                  className="form-input"
                  value={targetTable}
                  onChange={e => setTargetTable(e.target.value.replace(/\s/g, '_').toLowerCase())}
                  placeholder={`${srcTable}_copy`}
                  autoFocus
                  onKeyDown={e => { if (e.key === 'Enter' && isValid) handleClone() }}
                />
              </div>
            </div>

            {/* Copy data toggle */}
            <div
              onClick={() => setCopyData(p => !p)}
              style={{
                display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer',
                padding: '12px 14px', borderRadius: 8, marginBottom: 14,
                background: copyData ? 'rgba(139,92,246,0.08)' : 'rgba(255,255,255,0.03)',
                border: `1px solid ${copyData ? 'rgba(139,92,246,0.4)' : 'rgba(255,255,255,0.08)'}`,
                transition: 'all 0.2s',
                userSelect: 'none',
              }}
            >
              {/* iOS-style toggle */}
              <div style={{
                width: 36, height: 20, borderRadius: 10, flexShrink: 0, position: 'relative',
                background: copyData ? '#8b5cf6' : 'rgba(255,255,255,0.15)',
                transition: 'background 0.2s',
              }}>
                <div style={{
                  position: 'absolute', top: 3, left: copyData ? 18 : 3,
                  width: 14, height: 14, borderRadius: '50%',
                  background: '#fff',
                  transition: 'left 0.2s',
                  boxShadow: '0 1px 3px rgba(0,0,0,0.4)',
                }} />
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>Copy Data</span>
                  <span style={{
                    fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 4,
                    background: copyData ? 'rgba(139,92,246,0.2)' : 'rgba(255,255,255,0.06)',
                    color: copyData ? '#a78bfa' : 'var(--text-muted)',
                    letterSpacing: '0.05em',
                  }}>{copyData ? 'ON' : 'OFF'}</span>
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5 }}>
                  {copyData
                    ? <span>Sao chép toàn bộ dữ liệu sang bảng mới <span style={{ color: 'var(--warning)', fontSize: 11 }}>(có thể mất thời gian nếu bảng lớn)</span></span>
                    : <span>Chỉ clone cấu trúc (schema rỗng, không có data)</span>
                  }
                </div>
              </div>
            </div>


            {/* SQL Preview */}
            <div style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                SQL Preview
              </div>
              <pre style={{
                background: 'var(--bg-glass)', border: '1px solid var(--border)',
                borderRadius: 6, padding: '10px 12px', fontSize: 11,
                color: 'var(--text-secondary)', whiteSpace: 'pre-wrap',
                fontFamily: 'monospace', margin: 0, lineHeight: 1.6,
              }}>
                {previewSql}
              </pre>
            </div>

            {/* Actions */}
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button className="btn btn-secondary" onClick={onClose} disabled={loading}>
                Cancel
              </button>
              <button
                className="btn btn-primary"
                onClick={handleClone}
                disabled={!isValid || loading}
                style={{
                  background: 'linear-gradient(135deg, #8b5cf6, #6366f1)',
                  borderColor: 'transparent',
                  minWidth: 120,
                }}
              >
                {loading ? (
                  <><RefreshCw size={13} className="spin" /> Cloning...</>
                ) : (
                  <><Copy size={13} /> Clone Table</>
                )}
              </button>
            </div>
          </>
        ) : step === 'serving' ? (
          /* Serving Layer Registration Step (only for gold tables) */
          <ServingRegisterStep
            result={result}
            srcColumns={srcColumns}
            onSkip={() => onSuccess(result.target_schema, result.target_table)}
            onDone={() => onSuccess(result.target_schema, result.target_table)}
            onError={onError}
          />
        ) : (
          /* Done state (non-gold clone) */
          <div style={{ textAlign: 'center', padding: '16px 0 8px' }}>
            <div style={{
              width: 56, height: 56, borderRadius: '50%', margin: '0 auto 16px',
              background: 'rgba(16,185,129,0.15)', border: '2px solid rgba(16,185,129,0.4)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <CheckCheck size={24} style={{ color: '#10b981' }} />
            </div>
            <h3 style={{ margin: '0 0 8px', color: 'var(--text)' }}>Clone thành công!</h3>
            <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: '0 0 20px', lineHeight: 1.6 }}>
              {result?.message}
            </p>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
              <button className="btn btn-secondary" onClick={onClose}>Đóng</button>
              <button
                className="btn btn-primary"
                onClick={() => onSuccess(result.target_schema, result.target_table)}
                style={{ background: 'linear-gradient(135deg, #8b5cf6, #6366f1)', borderColor: 'transparent' }}
              >
                <ArrowRight size={13} /> Đến bảng mới
              </button>
            </div>
          </div>
        )}

      </div>
    </div>
  )
}

// ── Serving Register Step (sub-component dùng trong CloneTableModal) ──────────
function ServingRegisterStep({ result, srcColumns, onSkip, onDone, onError }) {
  const [pkColumn, setPkColumn]     = useState('__none__')
  const [loading, setLoading]       = useState(false)
  const [registered, setRegistered] = useState(false)

  const goldTable = result.target_table

  async function handleRegister() {
    setLoading(true)
    try {
      const columns = srcColumns.map(c => ({
        name: c.name,
        trino_type: c.type,
      }))
      await api.createServingTable({
        gold_table: goldTable,
        columns,
        pk_column: pkColumn === '__none__' ? null : pkColumn,
        auto_discovered: false,
      })
      setRegistered(true)
    } catch (e) {
      onError('Serving registration failed: ' + e.message)
    }
    setLoading(false)
  }

  if (registered) {
    return (
      <div style={{ textAlign: 'center', padding: '8px 0' }}>
        <div style={{
          width: 56, height: 56, borderRadius: '50%', margin: '0 auto 16px',
          background: 'rgba(16,185,129,0.15)', border: '2px solid rgba(16,185,129,0.4)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <CheckCheck size={24} style={{ color: '#10b981' }} />
        </div>
        <h3 style={{ margin: '0 0 6px', color: 'var(--text)' }}>Hoàn tất!</h3>
        <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: '0 0 8px' }}>
          Clone + đăng ký Serving Layer thành công.
        </p>
        <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '0 0 20px' }}>
          Strategy: <strong>{pkColumn === '__none__' ? 'truncate_insert (no PK)' : `merge (PK: ${pkColumn})`}</strong>
        </p>
        <button className="btn btn-primary" onClick={onDone}
          style={{ background: 'linear-gradient(135deg, #8b5cf6, #6366f1)', borderColor: 'transparent' }}>
          <ArrowRight size={13} /> Đến bảng mới
        </button>
      </div>
    )
  }

  return (
    <div>
      {/* Clone success banner */}
      <div style={{
        display: 'flex', gap: 8, alignItems: 'center', padding: '10px 14px',
        background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.25)',
        borderRadius: 8, marginBottom: 18,
      }}>
        <CheckCircle2 size={14} style={{ color: '#10b981', flexShrink: 0 }} />
        <span style={{ fontSize: 13, color: 'var(--text)' }}>
          Clone thành công: <code style={{ fontSize: 12 }}>{goldTable}</code>
        </span>
      </div>

      {/* Serving registration prompt */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--text)', marginBottom: 4 }}>
          🎯 Đăng ký vào Serving Layer?
        </div>
        <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: 0, lineHeight: 1.6 }}>
          Bảng <code>{goldTable}</code> thuộc gold schema — bạn có thể đăng ký
          ngay để Dagster tự động sync sang PostgreSQL cho Power BI.
        </p>
      </div>

      {/* PK selector */}
      <div className="form-group" style={{ marginBottom: 18 }}>
        <label className="form-label">Primary Key Column (cho MERGE strategy)</label>
        <select
          className="form-select"
          value={pkColumn}
          onChange={e => setPkColumn(e.target.value)}
        >
          <option value="__none__">— Không có PK (dùng truncate_insert) —</option>
          {srcColumns.map(c => (
            <option key={c.name} value={c.name}>{c.name} ({c.type})</option>
          ))}
        </select>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6 }}>
          {pkColumn === '__none__'
            ? '⚡ truncate_insert: xóa sạch rồi insert lại toàn bộ — phù hợp fact/log table'
            : `🔀 merge: upsert theo ${pkColumn} — phù hợp dimension table có unique key`}
        </div>
      </div>

      {/* Actions */}
      <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
        <button className="btn btn-secondary" onClick={onSkip} disabled={loading}>
          Bỏ qua, đến bảng mới
        </button>
        <button
          className="btn btn-primary"
          onClick={handleRegister}
          disabled={loading}
          style={{ background: 'linear-gradient(135deg, #10b981, #059669)', borderColor: 'transparent', minWidth: 140 }}
        >
          {loading
            ? <><RefreshCw size={13} className="spin" /> Đang đăng ký...</>
            : <><Zap size={13} /> Đăng ký Serving</>}
        </button>
      </div>
    </div>
  )
}


// ── Tab: Overview ─────────────────────────────────────────────
function TabOverview({ branch, schema, table, toast }) {
  const [stats, setStats]   = useState(null)
  const [props, setProps]   = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    setStats(null); setProps(null)
    Promise.all([
      api.getTableStats(schema, table, branch).catch(() => null),
      api.getTableProps(schema, table, branch).catch(() => null),
    ]).then(([s, p]) => { setStats(s); setProps(p); setLoading(false) })
  }, [schema, table, branch])

  if (loading) return (
    <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 60 }}><LoadingDots /></div>
  )

  const location = props?.properties?.['write.target-file-size-bytes']
    ? `s3a://warehouse/${schema}/${table}`
    : `s3a://warehouse/${schema}/${table}/`

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Stats row */}
      <div className="stats-mini-grid">
        <div className="stat-mini-card">
          <div className="stat-mini-label"><Hash size={12} /> Rows</div>
          <div className="stat-mini-value">{fmtNum(stats?.row_count)}</div>
          <div className="stat-mini-sub">total records</div>
        </div>
        <div className="stat-mini-card">
          <div className="stat-mini-label"><FileText size={12} /> Files</div>
          <div className="stat-mini-value">{fmtNum(stats?.file_count)}</div>
          <div className="stat-mini-sub">parquet files</div>
        </div>
        <div className="stat-mini-card">
          <div className="stat-mini-label"><HardDrive size={12} /> Size</div>
          <div className="stat-mini-value">{fmtBytes(stats?.total_size_bytes)}</div>
          <div className="stat-mini-sub">on disk</div>
        </div>
        <div className="stat-mini-card">
          <div className="stat-mini-label"><Camera size={12} /> Snapshots</div>
          <div className="stat-mini-value">{fmtNum(stats?.snapshot_count)}</div>
          <div className="stat-mini-sub">versions</div>
        </div>
      </div>

      {/* Properties */}
      <div className="card">
        <div className="card-header"><h2>Table Properties</h2></div>
        <div className="card-body" style={{ padding: '0 0' }}>
          <table className="prop-table">
            <tbody>
              <tr><td>Full name</td><td><span className="font-mono" style={{ fontSize: 13 }}>iceberg.{schema}.{table}</span></td></tr>
              <tr><td>Storage</td><td><span className="font-mono" style={{ fontSize: 12 }}>{location}</span></td></tr>
              <tr><td>Format</td><td><span className="badge badge-info">PARQUET</span></td></tr>
              {props?.properties && Object.entries(props.properties).slice(0, 8).map(([k, v]) => (
                <tr key={k}>
                  <td>{k}</td>
                  <td><span className="font-mono" style={{ fontSize: 12 }}>{v}</span></td>
                </tr>
              ))}
              {props?.file_stats && (
                <tr>
                  <td>File count</td>
                  <td>{props.file_stats.file_count} files / {fmtBytes(props.file_stats.total_size_bytes)}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

// ── Tab: Schema ───────────────────────────────────────────────
function TabSchema({ branch, schema, table, toast }) {
  const [columns, setColumns]     = useState([])
  const [loading, setLoading]     = useState(true)
  const [renaming, setRenaming]   = useState(null) // col name being renamed
  const [renameVal, setRenameVal] = useState('')
  const [dropping, setDropping]   = useState(null)
  const [addForm, setAddForm]     = useState(null)  // null | {name, type, comment}
  const [busy, setBusy]           = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await api.describeTable(schema, table, branch)
      setColumns(data.columns || [])
    } catch (e) { toast(e.message, 'error') }
    setLoading(false)
  }, [schema, table, branch])

  useEffect(() => { load() }, [load])

  async function handleRename(oldName) {
    if (!renameVal.trim() || renameVal === oldName) { setRenaming(null); return }
    setBusy(true)
    try {
      await api.alterTable(schema, table, { rename_column: { from: oldName, to: renameVal.trim() } }, branch)
      toast(`Renamed column "${oldName}" → "${renameVal}"`)
      load()
    } catch (e) { toast(e.message, 'error') }
    setBusy(false); setRenaming(null)
  }

  async function handleDrop(colName) {
    setBusy(true)
    try {
      await api.alterTable(schema, table, { drop_columns: [colName] }, branch)
      toast(`Deleted column "${colName}"`)
      load()
    } catch (e) { toast(e.message, 'error') }
    setBusy(false); setDropping(null)
  }

  async function handleAdd() {
    if (!addForm?.name.trim()) return
    setBusy(true)
    try {
      await api.alterTable(schema, table, {
        add_columns: [{ name: addForm.name.trim(), type: addForm.type, comment: addForm.comment }]
      }, branch)
      toast(`Added column "${addForm.name}"`)
      setAddForm(null)
      load()
    } catch (e) { toast(e.message, 'error') }
    setBusy(false)
  }

  if (loading) return <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 60 }}><LoadingDots /></div>

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
        <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>{columns.length} columns</span>
        <button className="btn btn-primary btn-sm" onClick={() => setAddForm({ name: '', type: 'VARCHAR', comment: '' })}>
          <Plus size={13} /> Add Column
        </button>
      </div>

      <div className="col-list">
        {/* Header */}
        <div className="col-row-header">
          <span>Column Name</span>
          <span>Type</span>
          <span>Comment</span>
          <span style={{ width: 64 }}></span>
        </div>

        {/* Columns */}
        {columns.map((col) => (
          <div className="col-row" key={col.name}>
            {/* Name cell */}
            <div className="col-name-cell">
              {renaming === col.name ? (
                <input
                  className="col-name-input"
                  value={renameVal}
                  onChange={e => setRenameVal(e.target.value)}
                  autoFocus
                  onKeyDown={e => {
                    if (e.key === 'Enter') handleRename(col.name)
                    if (e.key === 'Escape') setRenaming(null)
                  }}
                />
              ) : (
                <span>{col.name}</span>
              )}
            </div>

            {/* Type */}
            <div>
              <span className="badge badge-info" style={{ fontSize: 11 }}>{col.type}</span>
            </div>

            {/* Comment */}
            <div style={{ fontSize: 12, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {col.comment || <span style={{ opacity: 0.4 }}>—</span>}
            </div>

            {/* Actions */}
            <div className="col-actions">
              {dropping === col.name ? (
                <div className="inline-confirm">
                  <span style={{ fontSize: 11, color: 'var(--danger)' }}>Delete?</span>
                  <button className="btn btn-danger btn-sm" style={{ padding: '2px 6px' }} onClick={() => handleDrop(col.name)} disabled={busy}>
                    <Check size={11} />
                  </button>
                  <button className="btn btn-secondary btn-sm" style={{ padding: '2px 6px' }} onClick={() => setDropping(null)}>
                    <X size={11} />
                  </button>
                </div>
              ) : renaming === col.name ? (
                <div className="inline-confirm">
                  <button className="btn btn-primary btn-sm" style={{ padding: '2px 6px' }} onClick={() => handleRename(col.name)} disabled={busy}>
                    <Check size={11} />
                  </button>
                  <button className="btn btn-secondary btn-sm" style={{ padding: '2px 6px' }} onClick={() => setRenaming(null)}>
                    <X size={11} />
                  </button>
                </div>
              ) : (
                <>
                  <button className="btn btn-secondary btn-sm" style={{ padding: '3px 7px' }}
                    title="Rename column"
                    onClick={() => { setRenaming(col.name); setRenameVal(col.name) }}>
                    <Pencil size={11} />
                  </button>
                  <button className="btn btn-danger btn-sm" style={{ padding: '3px 7px' }}
                    title="Delete column"
                    onClick={() => setDropping(col.name)}>
                    <Trash2 size={11} />
                  </button>
                </>
              )}
            </div>
          </div>
        ))}

        {/* Add column form */}
        {addForm && (
          <div className="add-col-row">
            <input
              className="form-input"
              placeholder="column_name"
              value={addForm.name}
              onChange={e => setAddForm({ ...addForm, name: e.target.value })}
              style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 13 }}
              autoFocus
            />
            <select
              className="form-select"
              value={addForm.type}
              onChange={e => setAddForm({ ...addForm, type: e.target.value })}
              style={{ fontSize: 12 }}
            >
              {COL_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
            <input
              className="form-input"
              placeholder="comment (optional)"
              value={addForm.comment}
              onChange={e => setAddForm({ ...addForm, comment: e.target.value })}
              style={{ fontSize: 12 }}
              onKeyDown={e => { if (e.key === 'Enter') handleAdd(); if (e.key === 'Escape') setAddForm(null) }}
            />
            <div style={{ display: 'flex', gap: 4 }}>
              <button className="btn btn-primary btn-sm" onClick={handleAdd} disabled={busy || !addForm.name.trim()}>
                {busy ? <LoadingDots /> : <Check size={13} />}
              </button>
              <button className="btn btn-secondary btn-sm" onClick={() => setAddForm(null)}>
                <X size={13} />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Tab: Preview ──────────────────────────────────────────────
function TabPreview({ branch, schema, table, toast, initialSnapshotId }) {
  const [data, setData]       = useState(null)
  const [loading, setLoading] = useState(true)
  const [limit, setLimit]     = useState(50)
  const [snapshotId, setSnapshotId] = useState(initialSnapshotId || '')
  const [search, setSearch]   = useState('')
  
  const [newRows, setNewRows] = useState([])
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => { 
    setSnapshotId(initialSnapshotId || '')
    load(limit, initialSnapshotId || null, search) 
  }, [schema, table, branch, initialSnapshotId])

  async function load(lim = limit, snap = null, q = search) {
    setLoading(true)
    setNewRows([])
    try {
      const res = await api.previewTable(schema, table, lim, snap || undefined, q || undefined, branch)
      setData(res)
    } catch { setData(null) }
    setLoading(false)
  }

  function handleAddRow() {
    if (!data?.columns) return
    const row = {}
    data.columns.forEach(c => row[c] = '')
    setNewRows([row, ...newRows])
  }

  function handleUpdateNewRow(index, col, val) {
    const list = [...newRows]
    list[index][col] = val
    setNewRows(list)
  }

  function handleRemoveNewRow(index) {
    const list = [...newRows]
    list.splice(index, 1)
    setNewRows(list)
  }

  async function handleExecuteInsert() {
    if (newRows.length === 0) return
    setSubmitting(true)
    try {
      const payload = newRows.map(row => {
        const parsed = {}
        for (let k in row) {
          let val = row[k]
          if (val === '') {
            parsed[k] = null
            continue
          }
          
          const typeInfo = data.column_details?.find(d => d.name === k)?.type || ''
          
          if (typeInfo.includes('TIMESTAMP')) {
              // Strict format validation: YYYY-MM-DD HH:mm:ss[.ms]
              if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d+)?$/.test(val)) {
                  throw new Error(`Timestamp column '${k}' requires format YYYY-MM-DD HH:mm:ss (e.g., 2024-03-04 12:00:00)`)
              }
          }
          
          if (typeInfo.includes('INT') || typeInfo.includes('DOUBLE') || typeInfo.includes('DECIMAL')) {
            const num = Number(val)
            parsed[k] = isNaN(num) ? val : num
          } else if (typeInfo.includes('BOOLEAN')) {
            parsed[k] = val === 'true' || val === '1'
          } else {
            parsed[k] = val
          }
        }
        return parsed
      })
      await api.insertTableData(schema, table, { rows: payload }, branch)
      setNewRows([])
      load(limit)
      toast && toast(`Inserted ${newRows.length} rows successfully`, 'success')
    } catch (e) {
      let msg = e.message;
      if (msg.includes('Cannot cast') || msg.includes('TYPE_MISMATCH')) {
        msg = "Invalid data type format entered.";
      } else if (msg.includes('not allow nulls')) {
        msg = "This column is required (Not Null).";
      } else if (msg.includes('date/time') || msg.includes('timestamp')) {
         msg = "Invalid time format, please check.";
      } else if (msg.includes('value is not acceptable')) {
         msg = "Invalid value for column.";
      }
      toast && toast("Error: " + msg, 'error')
    }
    setSubmitting(false)
  }

  const filtered = data?.rows

  function getPlaceholder(type) {
    if (!type) return '...'
    if (type.includes('TIMESTAMP(6)')) return 'YYYY-MM-DD HH:mm:ss.SSSSSS'
    if (type.includes('TIMESTAMP')) return 'YYYY-MM-DD HH:mm:ss'
    if (type.includes('DATE')) return 'YYYY-MM-DD'
    if (type.includes('DECIMAL') || type.includes('DOUBLE')) return '0.00'
    if (type.includes('INT')) return '123'
    if (type.includes('BOOLEAN')) return 'true/false'
    return type
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, height: '100%' }}>
      {/* Controls */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <button className="btn btn-primary btn-sm" onClick={handleAddRow} disabled={!data?.columns}>
          <Plus size={13} /> + Add Row
        </button>
        {newRows.length > 0 && (
          <button className="btn btn-primary btn-sm" style={{ background: 'var(--success)', borderColor: 'var(--success)' }} onClick={handleExecuteInsert} disabled={submitting}>
            {submitting ? <LoadingDots /> : <><CheckCheck size={13} /> Save {newRows.length} rows</>}
          </button>
        )}
        {newRows.length > 0 && (
          <button className="btn btn-secondary btn-sm" onClick={() => setNewRows([])}>
            Cancel
          </button>
        )}
      
        <div style={{ position: 'relative', flex: '0 0 200px', marginLeft: 16 }}>
          <Search size={13} style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
          <input
            className="form-input"
            placeholder="Filter rows..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') load(limit, snapshotId || null, e.target.value) }}
            style={{ paddingLeft: 28, fontSize: 12 }}
          />
        </div>
        <select
          className="form-select"
          value={limit}
          onChange={e => { setLimit(+e.target.value); load(+e.target.value) }}
          style={{ width: 100, fontSize: 12 }}
        >
          {[20, 50, 100, 200].map(n => <option key={n} value={n}>{n} rows</option>)}
        </select>
        <input
          className="form-input"
          placeholder="Snapshot ID (time travel)..."
          value={snapshotId}
          onChange={e => setSnapshotId(e.target.value)}
          style={{ width: 220, fontSize: 12 }}
        />
        <button className="btn btn-secondary btn-sm" onClick={() => load(limit, snapshotId || null, search)}>
          <RefreshCw size={13} /> Query
        </button>
        {data && (
          <span style={{ fontSize: 12, color: 'var(--text-muted)', marginLeft: 'auto' }}>
            {filtered?.length ?? data.count} / {data.count} rows
          </span>
        )}
      </div>

      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 40 }}><LoadingDots /></div>
      ) : !data ? (
        <div className="detail-empty">
          <Eye size={40} />
          <h3>No data</h3>
          <p>Table is empty or query failed</p>
        </div>
      ) : (
        <div className="data-grid-wrap" style={{ flex: 1 }}>
          <table className="data-grid">
            <thead>
              <tr>
                <th style={{ width: 48, color: 'var(--text-muted)', textAlign: 'center' }}>
                  <Zap size={13} style={{ color: 'var(--text-muted)' }} />
                </th>
                {data.columns.map(c => {
                  const typeInfo = data.column_details?.find(d => d.name === c)?.type;
                  return (
                    <th key={c}>
                      <div style={{ display: 'flex', flexDirection: 'column' }}>
                        <span>{c}</span>
                        {typeInfo && <span style={{ fontSize: 10, color: 'var(--primary)', fontWeight: 'normal', marginTop: 2 }}>{typeInfo}</span>}
                      </div>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {/* Render New Rows for Editing at the TOP */}
              {newRows.map((row, i) => (
                <tr key={`new-${i}`} style={{ background: 'var(--bg-card)', boxShadow: 'inset 0 0 0 1px rgba(99, 102, 241, 0.2)' }}>
                  <td style={{ textAlign: 'center' }}>
                    <button className="btn btn-secondary btn-sm" style={{ padding: '4px', background: 'transparent', border: 'none', color: 'var(--text-muted)' }} onClick={() => handleRemoveNewRow(i)} title="Cancel this row">
                      <Trash2 size={13} />
                    </button>
                  </td>
                  {data.columns.map(c => {
                    const typeInfo = data.column_details?.find(d => d.name === c)?.type || '';
                    return (
                      <td key={`new-${i}-${c}`} style={{ padding: 4 }}>
                        {(() => {
                          let inputType = 'text';
                          let stepStr = undefined;
                          if (typeInfo.includes('DATE') && !typeInfo.includes('TIMESTAMP')) {
                             inputType = 'date';
                          } else if (typeInfo.includes('INT') || typeInfo.includes('DECIMAL') || typeInfo.includes('DOUBLE')) {
                             inputType = 'number';
                             if (typeInfo.includes('DECIMAL') || typeInfo.includes('DOUBLE')) stepStr = "any";
                          }
                          return (
                            <input
                              className="form-input"
                              type={inputType}
                              step={stepStr}
                              style={{ width: '100%', height: '28px', fontSize: 12, borderRadius: 4, background: 'var(--bg-body)' }}
                              value={row[c] || ''}
                              placeholder={getPlaceholder(typeInfo)}
                              title={`Type: ${typeInfo}`}
                              autoComplete="off"
                              onChange={e => {
                                let val = e.target.value;
                                if (typeInfo.includes('TIMESTAMP')) {
                                  let v = val.replace(/\D/g, '');
                                  let masked = '';
                                  if (v.length > 0) masked += v.slice(0, 4);
                                  if (v.length >= 5) masked += '-' + v.slice(4, 6);
                                  if (v.length >= 7) masked += '-' + v.slice(6, 8);
                                  if (v.length >= 9) masked += ' ' + v.slice(8, 10);
                                  if (v.length >= 11) masked += ':' + v.slice(10, 12);
                                  if (v.length >= 13) masked += ':' + v.slice(12, 14);
                                  if (v.length >= 15) masked += '.' + v.slice(14, 20);
                                  val = masked;
                                }
                                handleUpdateNewRow(i, c, val);
                              }}
                            />
                          )
                        })()}
                      </td>
                    );
                  })}
                </tr>
              ))}
              
              {/* Existing Data */}
              {(filtered || data.rows).map((row, i) => (
                <tr key={`old-${i}`}>
                  <td style={{ color: 'var(--text-muted)', fontSize: 11, textAlign: 'center' }}>{i + 1}</td>
                  {data.columns.map(c => (
                    <td key={c}>
                      {row[c] === null || row[c] === undefined
                        ? <span className="data-grid-null">null</span>
                        : String(row[c])
                      }
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ── Tab: Snapshots ────────────────────────────────────────────
function TabSnapshots({ branch, schema, table, onTimeTravelPreview, toast, confirm }) {
  const [snaps, setSnaps]     = useState([])
  const [currId, setCurrId]   = useState('')
  const [loading, setLoading] = useState(true)

  async function loadData() {
    setLoading(true)
    try {
      const d = await api.getSnapshots(schema, table, branch)
      setSnaps(d.snapshots || [])
      setCurrId(d.current_snapshot_id || '')
    } catch {
      setSnaps([])
    }
    setLoading(false)
  }

  async function handleRollback(snapId) {
    confirm({
       title: "Restore Snapshot",
       message: `You are about to restore this table data to the point in time of Snapshot ID #${String(snapId).slice(-8)}. Data generated after this point will be hidden. Data returns to the selected state.`,
       confirmText: "Confirm restore",
       onConfirm: async () => {
         confirm(null);
         try {
           toast && toast(`Performing Time Travel...`, 'success');
           await api.rollbackToSnapshot(schema, table, snapId, branch);
           toast && toast(`[Success] Restored to snapshot ${snapId}`, 'success');
           setLoading(true);
           loadData();
         } catch (e) {
           toast && toast(`Restore error (Trino): ${e.message}`, 'error');
         }
       },
       onCancel: () => confirm(null)
    })
  }

  useEffect(() => {
    loadData()
  }, [schema, table, branch])

  if (loading) return <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 60 }}><LoadingDots /></div>

  if (snaps.length === 0) return (
    <div className="detail-empty">
      <Camera size={40} />
      <h3>No snapshots yet</h3>
      <p>Snapshots appear after data is INSERTED/DELETED in the table</p>
    </div>
  )

  const opColor = (op) => {
    if (!op) return 'other'
    const o = op.toLowerCase()
    if (o === 'append') return 'append'
    if (o === 'overwrite' || o === 'replace') return 'overwrite'
    if (o === 'delete') return 'delete'
    return 'replace'
  }

  const opBadge = (op) => {
    const cls = { append: 'badge-success', overwrite: 'badge-warning', delete: 'badge-danger', replace: 'badge-info' }
    return cls[opColor(op)] || 'badge-purple'
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 8 }}>
        {snaps.length} snapshots — newest first
      </div>
      <div className="snapshot-list">
        {snaps.map((s, i) => {
          const summary = s.summary || {}
          return (
            <div className="snapshot-item" key={s.snapshot_id}>
              <div className={`snapshot-dot ${opColor(s.operation)}`} />
              <div className="snapshot-content">
                <div className="snapshot-header">
                  {s.snapshot_id === currId && (
                    <span className="badge badge-primary" style={{ fontSize: 10, background: 'var(--primary)', color: '#fff' }}>
                      CURRENT
                    </span>
                  )}
                  {s.operation && (
                    <span className={`badge ${opBadge(s.operation)}`} style={{ fontSize: 10 }}>
                      {s.operation}
                    </span>
                  )}
                  <span className="snapshot-id">#{String(s.snapshot_id).slice(-8)}</span>
                  <span className="snapshot-time">{fmtDate(s.committed_at)}</span>
                  <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
                    <button
                      className="btn btn-secondary btn-sm"
                      style={{ padding: '2px 8px', fontSize: 11 }}
                      onClick={() => {
                        navigator.clipboard.writeText(String(s.snapshot_id))
                        toast && toast(`Copied ID: ${s.snapshot_id}`, 'success')
                      }}
                      title="Copy snapshot ID"
                    >
                      <Copy size={11} /> ID
                    </button>
                    {s.snapshot_id !== currId && (
                      <button
                        className="btn btn-secondary btn-sm"
                        style={{ padding: '2px 8px', fontSize: 11, background: 'var(--bg-card)', color: 'var(--warning)', borderColor: 'var(--warning)' }}
                        onClick={() => handleRollback(s.snapshot_id)}
                        title="Restore table to this snapshot"
                      >
                        <RefreshCw size={11} /> Restore
                      </button>
                    )}
                    <button
                        className="btn btn-secondary btn-sm"
                        style={{ padding: '2px 8px', fontSize: 11, background: 'var(--bg-card)', color: 'var(--primary)', borderColor: 'var(--primary)' }}
                        onClick={() => onTimeTravelPreview(s.snapshot_id)}
                        title="View data at this timestamp"
                      >
                        <Eye size={11} /> View
                      </button>
                  </div>
                </div>
                {Object.keys(summary).length > 0 && (
                  <div className="snapshot-summary">
                    {Object.entries(summary).slice(0, 6).map(([k, v]) => (
                      <span className="snapshot-kv" key={k}>
                        <span style={{ opacity: 0.6 }}>{k}:</span> {v}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Tab: DDL ──────────────────────────────────────────────────
function TabDDL({ branch, schema, table, toast }) {
  const [ddl, setDdl]         = useState('')
  const [loading, setLoading] = useState(true)
  const [copied, setCopied]   = useState(false)

  useEffect(() => {
    setLoading(true)
    api.getTableProps(schema, table, branch)
      .then(d => setDdl(d.ddl || ''))
      .catch(() => setDdl('-- Cannot fetch DDL'))
      .finally(() => setLoading(false))
  }, [schema, table, branch])

  function copyDDL() {
    navigator.clipboard.writeText(ddl)
    setCopied(true)
    toast('Copied DDL to clipboard')
    setTimeout(() => setCopied(false), 2000)
  }

  if (loading) return <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 60 }}><LoadingDots /></div>

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>
          Generated CREATE TABLE statement
        </span>
        <button className="btn btn-secondary btn-sm" onClick={copyDDL}>
          {copied ? <><CheckCheck size={13} /> Copied!</> : <><Copy size={13} /> Copy DDL</>}
        </button>
      </div>
      <div className="ddl-block">
        {ddl || '-- Table has no DDL (empty table or metadata not ready)'}
      </div>
    </div>
  )
}

// ── Modal: Create Schema ──────────────────────────────────────
function CreateSchemaModal({ branch, onClose, onSuccess, onError }) {
  const [name, setName]     = useState('')
  const [loc, setLoc]       = useState('')
  const [loading, setLoading] = useState(false)

  async function submit() {
    if (!name.trim()) return
    setLoading(true)
    try {
      await api.createSchema({ schema_name: name.trim(), location: loc.trim() || undefined })
      onSuccess(name.trim())
    } catch (e) { onError(e.message) }
    setLoading(false)
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 440 }} onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2 style={{ display: 'flex', alignItems: 'center', gap: 8 }}><Layers size={16} /> Create New Schema</h2>
          <button className="btn btn-secondary btn-sm" onClick={onClose}><X size={14} /></button>
        </div>
        <div className="modal-body">
          <div className="form-group">
            <label className="form-label">Schema Name *</label>
            <input className="form-input" placeholder="vd: staging" value={name}
              onChange={e => setName(e.target.value.toLowerCase().replace(/\s/g, '_'))}
              onKeyDown={e => e.key === 'Enter' && submit()}
              autoFocus
            />
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
              Default Location: s3a://warehouse/{name || 'schema_name'}/
            </div>
          </div>
          <div className="form-group">
            <label className="form-label">Custom Location (optional)</label>
            <input className="form-input" placeholder="s3a://your-bucket/path/" value={loc}
              onChange={e => setLoc(e.target.value)} />
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={submit} disabled={loading || !name.trim()}>
            {loading ? <LoadingDots /> : <><Check size={14} /> Create Schema</>}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Wizard: Create Table (3 steps) ───────────────────────────
function CreateTableWizard({ branch, schemas, defaultSchema, onClose, onSuccess, onError }) {
  const [step, setStep] = useState(1)
  const [loading, setLoading] = useState(false)

  // Step 1
  const [info, setInfo] = useState({
    schema_name: defaultSchema,
    table_name: '',
    comment: '',
  })

  // Step 2
  const [cols, setCols] = useState([
    { name: 'id', type: 'BIGINT', comment: 'Primary key' },
    { name: 'created_at', type: 'TIMESTAMP', comment: '' },
  ])

  // Step 3
  const [adv, setAdv] = useState({
    file_format: 'PARQUET',
    partition_by: '',
    sort_by: '',
    pk_column: '',
  })

  // ── Tier 1: Client-side Validators ───────────────────────────────
  function validateTableName(name) {
    if (!name) return null
    if (/^[0-9]/.test(name))
      return '❌ Table name cannot start with a number. e.g. correct → orders_111, wrong → 111_orders'
    if (!/^[a-z_][a-z0-9_]*$/.test(name))
      return '❌ Only lowercase letters, numbers, and underscores (_) are allowed. No spaces or special characters.'
    if (name.length > 64)
      return '❌ Table name is too long (max 64 characters).'
    return null
  }

  function validateColName(name) {
    if (!name) return null
    if (/^[0-9]/.test(name)) return 'Starts with a number'
    if (!/^[a-z_][a-z0-9_]*$/.test(name)) return 'Only a-z, 0-9, _ allowed'
    return null
  }

  function validatePartition(str) {
    if (!str.trim()) return null
    const validFunctions = ['year', 'month', 'day', 'hour', 'bucket', 'truncate', 'void']
    const parts = str.split(',').map(p => p.trim())
    for (const part of parts) {
      const fnMatch = part.match(/^(\w+)\((.+)\)$/)
      if (fnMatch) {
        const fnName = fnMatch[1].toLowerCase()
        if (!validFunctions.includes(fnName))
          return `❌ Function "${fnName}" is not valid. Use: month(col), day(col), bucket(N, col), year(col)...`
      } else if (!/^[a-z_][a-z0-9_]*$/.test(part)) {
        return `❌ "${part}" has invalid syntax. e.g. month(created_at), bucket(16, id)`
      }
    }
    return null
  }

  const tableNameError   = validateTableName(info.table_name)
  const partitionError   = validatePartition(adv.partition_by)
  const colErrors        = cols.map(c => validateColName(c.name.trim()))
  const hasColErrors     = colErrors.some(Boolean)

  function addCol() {
    setCols(p => [...p, { name: '', type: 'VARCHAR', comment: '' }])
  }
  function removeCol(i) {
    setCols(p => p.filter((_, idx) => idx !== i))
  }
  function updateCol(i, field, val) {
    setCols(p => p.map((c, idx) => idx === i ? { ...c, [field]: val } : c))
  }

  function generateSQL() {
    const colsSql = cols.filter(c => c.name.trim()).map(c => {
      let s = `  ${c.name} ${c.type}`
      if (c.comment) s += ` COMMENT '${c.comment}'`
      return s
    }).join(',\n')
    let sql = `CREATE TABLE IF NOT EXISTS iceberg.${info.schema_name}.${info.table_name || '<table>'} (\n${colsSql}\n)`
    if (info.comment) sql += `\nCOMMENT '${info.comment}'`
    const withParts = [`format = '${adv.file_format}'`]
    if (adv.partition_by.trim()) {
      const parts = adv.partition_by.split(',').map(p => `'${p.trim()}'`).join(', ')
      withParts.push(`partitioning = ARRAY[${parts}]`)
    }
    sql += `\nWITH (\n  ${withParts.join(',\n  ')}\n)`
    return sql
  }

  async function submit() {
    setLoading(true)
    try {
      const payload = {
        schema_name: info.schema_name,
        table_name: info.table_name.trim(),
        comment: info.comment || undefined,
        columns: cols.filter(c => c.name.trim()).map(c => ({
          name: c.name.trim(), type: c.type, comment: c.comment || undefined
        })),
        file_format: adv.file_format,
        partition_by: adv.partition_by.trim()
          ? adv.partition_by.split(',').map(p => p.trim()).filter(Boolean)
          : undefined,
        sort_by: adv.sort_by.trim()
          ? adv.sort_by.split(',').map(s => s.trim()).filter(Boolean)
          : undefined,
      }
      await api.createTable(payload, branch)
      if (info.schema_name === 'gold') {
        try {
          await api.createServingTable({
            gold_table: info.table_name.trim(),
            pk_column: adv.pk_column || null,
            columns: cols.filter(c => c.name.trim()).map(c => ({
              name: c.name.trim(), trino_type: c.type
            }))
          })
        } catch(err) {
          console.warn("Failed to register serving table:", err)
        }
      }
      onSuccess(info.schema_name, info.table_name.trim())
    } catch (e) { onError(e.message) }
    setLoading(false)
  }

  const stepDefs = [
    { num: 1, label: 'Details' },
    { num: 2, label: 'Columns' },
    { num: 3, label: 'Advanced' },
  ]

  const canNext1 = info.schema_name && info.table_name.trim() && !tableNameError
  const canNext2 = cols.filter(c => c.name.trim()).length > 0 && !hasColErrors
  // PK is optional — if not selected, serving layer will use truncate_insert or prompt user later
  const canSubmit = canNext1 && canNext2 && !partitionError

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-wide" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="modal-header">
          <h2 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Database size={16} /> Create Iceberg Table
          </h2>
          <button className="btn btn-secondary btn-sm" onClick={onClose}><X size={14} /></button>
        </div>

        {/* Step indicator */}
        <div className="wizard-steps">
          {stepDefs.map((s, i) => (
            <React.Fragment key={s.num}>
              <div className={`wizard-step${step === s.num ? ' active' : ''}${step > s.num ? ' done' : ''}`}>
                <div className="wizard-step-num">
                  {step > s.num ? <Check size={10} /> : s.num}
                </div>
                {s.label}
              </div>
              {i < stepDefs.length - 1 && <div className="wizard-step-sep" />}
            </React.Fragment>
          ))}
        </div>

        {/* Step content */}
        <div className="modal-body">
          {/* Step 1: Info */}
          {step === 1 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">Schema *</label>
                <select className="form-select" value={info.schema_name}
                  onChange={e => setInfo({ ...info, schema_name: e.target.value })}>
                  {schemas.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">Table Name *</label>
                <input
                  className="form-input"
                  placeholder="vd: raw_orders"
                  value={info.table_name}
                  onChange={e => setInfo({ ...info, table_name: e.target.value.toLowerCase().replace(/\s/g, '_') })}
                  style={{
                    fontFamily: 'JetBrains Mono, monospace',
                    borderColor: tableNameError ? '#ef4444' : undefined,
                    boxShadow: tableNameError ? '0 0 0 2px rgba(239,68,68,0.15)' : undefined,
                  }}
                  autoFocus
                />
                {/* Inline validation error */}
                {tableNameError ? (
                  <div style={{
                    marginTop: 5, padding: '7px 10px', borderRadius: 6,
                    background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)',
                    fontSize: 11, color: '#fca5a5', lineHeight: 1.6,
                  }}>
                    {tableNameError}
                    <div style={{ marginTop: 3, color: 'rgba(252,165,165,0.7)' }}>
                      ✅ Suggestion: <code style={{ color: '#86efac' }}>{info.table_name.replace(/^[^a-z_]/, 'table_')}</code>
                    </div>
                  </div>
                ) : (
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                    Full name: iceberg.{info.schema_name}.{info.table_name || '<table>'}
                  </div>
                )}
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">Description (optional)</label>
                <textarea className="form-textarea" style={{ minHeight: 70 }}
                  placeholder="Short description of the table..."
                  value={info.comment}
                  onChange={e => setInfo({ ...info, comment: e.target.value })}
                />
              </div>
            </div>
          )}

          {/* Step 2: Columns */}
          {step === 2 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>{cols.filter(c=>c.name).length} columns</span>
                <button className="btn btn-secondary btn-sm" onClick={addCol}>
                  <Plus size={13} /> Add Row
                </button>
              </div>
              {/* Col list header */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 130px 1fr auto', gap: 6, padding: '4px 10px',
                fontSize: 10, color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.7px' }}>
                <span>Name *</span><span>Type *</span><span>Comment</span><span></span>
              </div>
              <div className="wizard-col-list">
                {cols.map((col, i) => {
                  return (
                  <div className="wizard-col-item" key={i}
                    style={{
                      ...(colErrors[i] ? { border: '1px solid rgba(239,68,68,0.3)', borderRadius: 7, padding: '4px', background: 'rgba(239,68,68,0.04)' } : {}),
                    }}
                  >
                    <div style={{ display: 'contents' }}>
                    <input
                      className="form-input"
                      placeholder="col_name"
                      value={col.name}
                      onChange={e => updateCol(i, 'name', e.target.value.toLowerCase().replace(/\s/g, '_'))}
                      style={{
                        padding: '6px 8px', fontSize: 12, fontFamily: 'JetBrains Mono, monospace',
                        borderColor: colErrors[i] ? '#ef4444' : undefined,
                      }}
                    />
                    <select
                      className="form-select"
                      value={col.type}
                      onChange={e => updateCol(i, 'type', e.target.value)}
                      style={{ padding: '6px 8px', fontSize: 12 }}
                    >
                      {COL_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                    </select>
                    <input
                      className="form-input"
                      placeholder="comment..."
                      value={col.comment}
                      onChange={e => updateCol(i, 'comment', e.target.value)}
                      style={{ padding: '6px 8px', fontSize: 12 }}
                    />
                    <button
                      className="btn btn-danger btn-sm"
                      style={{ padding: '4px 8px' }}
                      onClick={() => removeCol(i)}
                    >
                      <X size={12} />
                    </button>
                    </div>
                    {colErrors[i] && (
                      <div style={{ gridColumn: '1/-1', fontSize: 10, color: '#fca5a5', padding: '2px 2px 0' }}>
                        ⚠️ {colErrors[i]}
                      </div>
                    )}
                  </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Step 3: Advanced */}
          {step === 3 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">File Format</label>
                <div style={{ display: 'flex', gap: 8 }}>
                  {FILE_FORMATS.map(f => (
                    <button key={f}
                      className={`btn ${adv.file_format === f ? 'btn-primary' : 'btn-secondary'} btn-sm`}
                      onClick={() => setAdv({ ...adv, file_format: f })}
                    >{f}</button>
                  ))}
                </div>
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">Partition By (optional)</label>
                <input className="form-input"
                  placeholder="vd: month(order_date), region"
                  value={adv.partition_by}
                  onChange={e => setAdv({ ...adv, partition_by: e.target.value })}
                  style={{ borderColor: partitionError ? '#ef4444' : undefined }}
                />
                {partitionError ? (
                  <div style={{
                    marginTop: 5, padding: '7px 10px', borderRadius: 6,
                    background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)',
                    fontSize: 11, color: '#fca5a5', lineHeight: 1.6,
                  }}>
                    {partitionError}
                    <div style={{ marginTop: 4, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      {['month(created_at)', 'year(event_date)', 'bucket(16, id)', 'region'].map(ex => (
                        <code key={ex}
                          onClick={() => setAdv({ ...adv, partition_by: ex })}
                          style={{
                            fontSize: 10, padding: '2px 6px', borderRadius: 4,
                            background: 'rgba(16,185,129,0.1)', color: '#6ee7b7',
                            border: '1px solid rgba(16,185,129,0.2)', cursor: 'pointer',
                          }}
                        >
                          {ex}
                        </code>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                    Multiple columns separated by commas. Supports: year(), month(), day(), hour(), bucket(N,...), truncate(N,...)
                  </div>
                )}
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">Sort By (optional)</label>
                <input className="form-input"
                  placeholder="vd: id, created_at DESC"
                  value={adv.sort_by}
                  onChange={e => setAdv({ ...adv, sort_by: e.target.value })}
                />
              </div>
              {info.schema_name === 'gold' && (
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label">
                    Primary Key
                    <span style={{ fontWeight: 400, color: 'var(--text-muted)', marginLeft: 6, fontSize: 11 }}>(optional — for Serving Layer MERGE sync)</span>
                  </label>
                  <select
                    className="form-select"
                    value={adv.pk_column}
                    onChange={e => setAdv({ ...adv, pk_column: e.target.value })}
                  >
                    <option value="">-- None (Truncate &amp; Insert) --</option>
                    {cols.filter(c => c.name.trim()).map(c => (
                      <option key={c.name} value={c.name}>{c.name} ({c.type})</option>
                    ))}
                  </select>
                  {!adv.pk_column && (
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                      ⚡ No PK selected — Serving Layer will use <strong>Truncate &amp; Insert</strong> strategy on each sync.
                    </div>
                  )}
                </div>
              )}
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">SQL Preview</label>
                <div className="sql-preview">{generateSQL()}</div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          {step > 1 && (
            <button className="btn btn-secondary" onClick={() => setStep(s => s - 1)}>← Go back</button>
          )}
          {step < 3 ? (
            <button
              className="btn btn-primary"
              onClick={() => setStep(s => s + 1)}
              disabled={(step === 1 && !canNext1) || (step === 2 && !canNext2)}
            >
              Next →
            </button>
          ) : (
            <button className="btn btn-primary" onClick={submit} disabled={loading || !canSubmit}>
              {loading ? <LoadingDots /> : <><Zap size={14} /> Create table</>}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}


// ── Tab: Import CSV ───────────────────────────────────────────────────────────
function TabImportCSV({ branch, schema, table, toast, onImportSuccess }) {
  const STEPS = ['upload', 'validate', 'ingest']
  const [step, setStep]               = useState('upload')   // 'upload' | 'validate' | 'ingest'

  // Step 1 state
  const [file, setFile]               = useState(null)
  const [dragOver, setDragOver]       = useState(false)
  const [csvHeaders, setCsvHeaders]   = useState([])         // headers parsed client-side
  const [csvColTypes, setCsvColTypes] = useState({})         // {col: 'integer'|'double'|'string'|'boolean'|'date'}
  const [mapping, setMapping]         = useState({})         // {csv_col: target_col}
  const [writeMode, setWriteMode]     = useState('insert')
  const [pkCols, setPkCols]           = useState([])
  const [tableColumns, setTableColumns] = useState([])       // [{name, type}]
  const [loadingCols, setLoadingCols] = useState(true)

  // Step 2 state
  const [stagingKey, setStagingKey]   = useState(null)
  const [uploadPct, setUploadPct]     = useState(0)
  const [uploading, setUploading]     = useState(false)
  const [validating, setValidating]   = useState(false)
  const [validResult, setValidResult] = useState(null)       // result from /validate

  // Step 3 state
  const [ingesting, setIngesting]     = useState(false)
  const [ingestResult, setIngestResult] = useState(null)

  const fileInputRef = useRef(null)

  // Load table columns once
  useEffect(() => {
    setLoadingCols(true)
    api.describeTable(schema, table, branch)
      .then(d => {
        setTableColumns(d.columns || [])
        setLoadingCols(false)
      })
      .catch(() => setLoadingCols(false))
  }, [schema, table, branch])

  // ── Client-side CSV type inference ──────────────────────────────────────────
  function inferCsvType(values) {
    const nonEmpty = values.filter(v => v !== null && v !== undefined && String(v).trim() !== '')
    if (nonEmpty.length === 0) return 'string'
    if (nonEmpty.every(v => /^-?\d+$/.test(String(v).trim()))) return 'integer'
    if (nonEmpty.every(v => /^-?\d+\.\d+$/.test(String(v).trim()))) return 'double'
    if (nonEmpty.every(v => /^\d{4}-\d{2}-\d{2}[T\s]\d{2}:\d{2}:\d{2}/.test(String(v).trim()))) return 'datetime'
    if (nonEmpty.every(v => /^\d{4}-\d{2}-\d{2}/.test(String(v).trim()))) return 'date'
    if (nonEmpty.every(v => /^(true|false|yes|no|1|0)$/i.test(String(v).trim()))) return 'boolean'
    return 'string'
  }

  // Compatibility check (client-side, mirrors backend logic)
  function clientCompat(csvType, targetType) {
    const base = (targetType || '').toLowerCase().split('(')[0].split(/\s/)[0].trim()
    if (['varchar', 'json', 'char', 'text'].includes(base)) return 'ok'
    if (csvType === 'integer' && ['integer', 'bigint', 'smallint', 'tinyint', 'double', 'real', 'decimal'].includes(base)) return 'ok'
    if (csvType === 'double'  && ['double', 'real', 'decimal'].includes(base)) return 'ok'
    if ((csvType === 'date' || csvType === 'datetime') && ['date', 'timestamp'].includes(base)) return 'ok'
    if (csvType === 'boolean' && base === 'boolean') return 'ok'
    if (csvType === 'string') return 'warning'   // needs TRY_CAST, may produce NULLs
    return 'warning'
  }

  // Parse CSV headers client-side when file is selected
  function handleFileSelect(f) {
    if (!f) return
    setFile(f)
    setStep('upload')
    setValidResult(null)
    setIngestResult(null)
    setStagingKey(null)
    setUploadPct(0)
    // Read first ~32KB to get header + up to 5 data rows for type inference
    const reader = new FileReader()
    reader.onload = (e) => {
      const lines = (e.target.result || '').split(/\r?\n/).filter(l => l.trim())
      const firstLine = lines[0] || ''
      const headers = firstLine.split(',').map(h => h.trim().replace(/^"|"$/g, ''))
      setCsvHeaders(headers)

      // Parse up to 5 data rows and infer dtype per column
      const dataLines = lines.slice(1, 6)
      const colValues = {}  // { headerName: [val, val, ...] }
      headers.forEach(h => { colValues[h] = [] })
      dataLines.forEach(line => {
        const cells = line.split(',').map(c => c.trim().replace(/^"|"$/g, ''))
        headers.forEach((h, i) => { if (cells[i] !== undefined) colValues[h].push(cells[i]) })
      })
      const types = {}
      headers.forEach(h => { types[h] = inferCsvType(colValues[h]) })
      setCsvColTypes(types)

      // Auto-map: if csv header exactly matches a table column name → pre-select it
      const autoMap = {}
      headers.forEach(h => {
        const match = tableColumns.find(c => c.name.toLowerCase() === h.toLowerCase())
        if (match) autoMap[h] = match.name
        else autoMap[h] = ''
      })
      setMapping(autoMap)
    }
    reader.readAsText(f.slice(0, 32768)) // 32KB — enough for header + 5 rows
  }

  function onDrop(e) {
    e.preventDefault()
    setDragOver(false)
    const f = e.dataTransfer.files[0]
    if (f && f.name.endsWith('.csv')) handleFileSelect(f)
    else toast('Please select a .csv file', 'error')
  }

  function setMapCol(csvCol, targetCol) {
    setMapping(prev => ({ ...prev, [csvCol]: targetCol }))
  }

  function togglePk(col) {
    setPkCols(prev => prev.includes(col) ? prev.filter(c => c !== col) : [...prev, col])
  }

  // Active (non-empty) mappings only
  const activeMappings = Object.fromEntries(
    Object.entries(mapping).filter(([, v]) => v !== '')
  )

  async function handleUploadAndValidate() {
    if (!file) return
    if (Object.keys(activeMappings).length === 0) {
      toast('Please map at least 1 column', 'error'); return
    }
    setUploading(true)
    setUploadPct(0)
    try {
      // 1. Get presigned URL
      const { upload_url, staging_key } = await api.csvPresign(schema, table, { filename: file.name })
      setStagingKey(staging_key)

      // 2. Upload directly to MinIO
      await api.uploadToPresignedUrl(upload_url, file, pct => setUploadPct(pct))
      setUploading(false)
      setUploadPct(100)

      // 3. Validate
      setValidating(true)
      const result = await api.csvValidate(schema, table, {
        staging_key,
        column_mapping: activeMappings,
        branch,
      })
      setValidResult(result)
      setValidating(false)
      setStep('validate')
    } catch (err) {
      setUploading(false)
      setValidating(false)
      toast('Upload/validate error: ' + err.message, 'error')
    }
  }

  async function handleIngest() {
    if (!stagingKey) return
    setIngesting(true)
    setStep('ingest')
    setIngestResult(null)
    try {
      const result = await api.csvIngest(schema, table, {
        staging_key: stagingKey,
        column_mapping: activeMappings,
        csv_headers: csvHeaders,
        write_mode: writeMode,
        pk_columns: writeMode === 'upsert' ? pkCols : [],
        branch,
      })
      setIngestResult(result)
      toast(`Import successful: ${result.rows_affected ?? '?'} rows`, 'success')
    } catch (err) {
      setIngestResult({ error: err.message })
      toast('Ingest error: ' + err.message, 'error')
    }
    setIngesting(false)
  }

  function resetWizard() {
    setFile(null); setCsvHeaders([]); setCsvColTypes({}); setMapping({}); setWriteMode('insert')
    setPkCols([]); setStagingKey(null); setUploadPct(0)
    setValidResult(null); setIngestResult(null); setStep('upload')
  }

  // ── Step indicator ─────────────────────────────────────────
  const stepLabels = [
    { id: 'upload',   label: '1. Upload & Map' },
    { id: 'validate', label: '2. Validate' },
    { id: 'ingest',   label: '3. Import' },
  ]

  const colStyle = { flex: 1, minWidth: 0 }
  const tableColNames = tableColumns.map(c => c.name)

  if (loadingCols) return (
    <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 60 }}><LoadingDots /></div>
  )

  return (
    <div style={{ padding: '20px 0', display: 'flex', flexDirection: 'column', gap: 20 }}>

      {/* Step indicator */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 0, marginBottom: 4 }}>
        {stepLabels.map((s, i) => {
          const done  = STEPS.indexOf(step) > i
          const active = step === s.id
          return (
            <React.Fragment key={s.id}>
              <div style={{
                display: 'flex', alignItems: 'center', gap: 6, padding: '5px 14px',
                borderRadius: 20, fontSize: 12, fontWeight: active ? 600 : 400,
                background: active ? 'var(--accent)' : done ? 'rgba(16,185,129,0.15)' : 'var(--bg-glass)',
                color: active ? '#fff' : done ? 'var(--success)' : 'var(--text-muted)',
                border: `1px solid ${active ? 'var(--accent)' : done ? 'var(--success)' : 'var(--border)'}`,
              }}>
                {done ? <CheckCircle2 size={12} /> : null}
                {s.label}
              </div>
              {i < stepLabels.length - 1 && (
                <div style={{ width: 24, height: 1, background: 'var(--border)', flexShrink: 0 }} />
              )}
            </React.Fragment>
          )
        })}
      </div>

      {/* ── STEP 1: Upload & Map ─────────────────────────────── */}
      {step === 'upload' && (
        <>
          {/* Drop zone */}
          <div
            className="card"
            onDragOver={e => { e.preventDefault(); setDragOver(true) }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onDrop}
            onClick={() => !file && fileInputRef.current?.click()}
            style={{
              border: `2px dashed ${dragOver ? 'var(--accent)' : file ? 'var(--success)' : 'var(--border)'}`,
              background: dragOver ? 'rgba(99,102,241,0.06)' : 'var(--bg-glass)',
              cursor: file ? 'default' : 'pointer',
              transition: 'all 0.2s',
            }}
          >
            <div className="card-body" style={{ textAlign: 'center', padding: '32px 20px' }}>
              {file ? (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12 }}>
                  <FileText size={28} style={{ color: 'var(--success)' }} />
                  <div style={{ textAlign: 'left' }}>
                    <div style={{ fontWeight: 600, fontSize: 14 }}>{file.name}</div>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                      {(file.size / 1048576).toFixed(2)} MB
                    </div>
                  </div>
                  <button className="btn btn-secondary btn-sm" style={{ marginLeft: 8 }}
                    onClick={e => { e.stopPropagation(); resetWizard() }}>
                    <X size={12} /> Change file
                  </button>
                </div>
              ) : (
                <>
                  <Upload size={36} style={{ color: 'var(--text-muted)', marginBottom: 10 }} />
                  <div style={{ fontSize: 14, fontWeight: 500 }}>Drag and drop CSV file here</div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
                    or <span style={{ color: 'var(--accent)', cursor: 'pointer' }}>click to select file</span>
                  </div>
                </>
              )}
            </div>
          </div>
          <input ref={fileInputRef} type="file" accept=".csv" style={{ display: 'none' }}
            onChange={e => handleFileSelect(e.target.files[0])} />

          {/* Column Mapping */}
          {file && csvHeaders.length > 0 && (
            <div className="card">
              <div className="card-header">
                <h2 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <ArrowRight size={16} /> Column Mapping
                  <span className="badge badge-info" style={{ fontSize: 11, fontWeight: 400 }}>
                    {Object.values(mapping).filter(v => v).length}/{csvHeaders.length} mapped
                  </span>
                </h2>
              </div>
              <div className="card-body" style={{ padding: 0 }}>
                {/* Header */}
                <div style={{
                  display: 'grid', gridTemplateColumns: '1fr 24px 1fr 56px',
                  gap: 8, padding: '8px 16px',
                  borderBottom: '1px solid var(--border)',
                  fontSize: 11, color: 'var(--text-muted)', fontWeight: 600,
                }}>
                  <span>CSV COLUMN (your file)</span>
                  <span />
                  <span>TABLE COLUMN (target)</span>
                  <span style={{ textAlign: 'center' }}>TYPE</span>
                </div>
                {csvHeaders.map(csvCol => {
                  const csvType   = csvColTypes[csvCol] || 'string'
                  const targetCol = mapping[csvCol] || ''
                  const targetColObj = tableColumns.find(c => c.name === targetCol)
                  const compat    = targetCol ? clientCompat(csvType, targetColObj?.type || 'varchar') : null

                  const compatColor = compat === 'ok' ? 'var(--success)' : compat === 'warning' ? 'var(--warning)' : 'var(--text-muted)'
                  const csvTypeColor = csvType === 'integer' || csvType === 'double' ? '#60a5fa'
                    : csvType === 'date' ? '#a78bfa' : csvType === 'boolean' ? '#f59e0b' : 'var(--text-muted)'

                  return (
                  <div key={csvCol} style={{
                    display: 'grid', gridTemplateColumns: '1fr 24px 1fr 56px',
                    gap: 8, padding: '7px 16px', alignItems: 'center',
                    borderBottom: '1px solid var(--border)',
                    background: compat === 'warning' ? 'rgba(245,158,11,0.04)' : 'transparent',
                  }}>
                    {/* CSV column + detected type badge */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                      <div style={{
                        background: 'var(--bg-glass)', borderRadius: 6, padding: '4px 10px',
                        fontSize: 12, fontFamily: 'monospace', color: 'var(--text)',
                        border: '1px solid var(--border)', flexShrink: 0,
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      }}>{csvCol}</div>
                      <span style={{
                        fontSize: 10, padding: '2px 6px', borderRadius: 4,
                        background: 'rgba(255,255,255,0.06)',
                        color: csvTypeColor, fontWeight: 600, flexShrink: 0,
                      }}>{csvType}</span>
                    </div>

                    <ArrowRight size={13} style={{ color: compatColor, margin: 'auto', transition: 'color 0.2s' }} />

                    <select
                      className="form-select"
                      style={{ fontSize: 12, padding: '4px 8px' }}
                      value={mapping[csvCol] || ''}
                      onChange={e => setMapCol(csvCol, e.target.value)}
                    >
                      <option value="">— Skip —</option>
                      {tableColumns.map(c => {
                        const usedByOther = Object.entries(mapping).some(
                          ([otherCsvCol, targetCol]) => targetCol === c.name && otherCsvCol !== csvCol
                        )
                        return (
                          <option key={c.name} value={c.name} disabled={usedByOther}>
                            {c.name} ({c.type}){usedByOther ? ' ✓ used' : ''}
                          </option>
                        )
                      })}
                    </select>

                    {/* Inline compat status */}
                    <div style={{ textAlign: 'center', fontSize: 11, fontWeight: 600 }}>
                      {compat === 'ok'      && <span title="Type compatible" style={{ color: 'var(--success)' }}>✓ OK</span>}
                      {compat === 'warning' && <span title="Might become NULL" style={{ color: 'var(--warning)' }}>⚠ cast</span>}
                      {!compat              && <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>—</span>}
                    </div>
                  </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Write Mode */}
          {file && (
            <div className="card">
              <div className="card-header">
                <h2 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Settings2 size={16} /> Write Mode
                </h2>
              </div>
              <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {[
                  { value: 'insert', label: 'Insert (Append)', desc: 'Insert all new rows into the table. Existing data is not deleted.', badge: 'badge-info' },
                  { value: 'upsert', label: 'Upsert (MERGE)', desc: 'Update existing rows (by Primary Key), insert new rows.', badge: 'badge-warning' },
                  { value: 'overwrite', label: 'Overwrite', desc: 'Delete all existing data then insert from CSV.', badge: 'badge-error' },
                ].map(opt => (
                  <label key={opt.value} style={{
                    display: 'flex', alignItems: 'flex-start', gap: 10, cursor: 'pointer',
                    padding: '10px 12px', borderRadius: 8,
                    border: `1px solid ${writeMode === opt.value ? 'var(--accent)' : 'var(--border)'}`,
                    background: writeMode === opt.value ? 'rgba(99,102,241,0.06)' : 'transparent',
                    transition: 'all 0.15s',
                  }}>
                    <input type="radio" name="writeMode" value={opt.value}
                      checked={writeMode === opt.value}
                      onChange={() => setWriteMode(opt.value)}
                      style={{ marginTop: 2 }} />
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 600, fontSize: 13 }}>
                        {opt.label}
                        <span className={`badge ${opt.badge}`} style={{ fontSize: 10 }}>{opt.value.toUpperCase()}</span>
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>{opt.desc}</div>
                    </div>
                  </label>
                ))}

                {/* PK selector for UPSERT */}
                {writeMode === 'upsert' && (
                  <div style={{ marginTop: 4, padding: '10px 12px', background: 'var(--bg-glass)', borderRadius: 8, border: '1px solid var(--border)' }}>
                    <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8 }}>
                      Primary Key Columns <span style={{ color: 'var(--danger)' }}>*</span>
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                      {tableColumns.filter(c => Object.values(activeMappings).includes(c.name)).map(c => (
                        <label key={c.name} style={{
                          display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer',
                          padding: '3px 10px', borderRadius: 12, fontSize: 12,
                          border: `1px solid ${pkCols.includes(c.name) ? 'var(--accent)' : 'var(--border)'}`,
                          background: pkCols.includes(c.name) ? 'rgba(99,102,241,0.1)' : 'var(--bg-glass)',
                        }}>
                          <input type="checkbox" checked={pkCols.includes(c.name)}
                            onChange={() => togglePk(c.name)} style={{ margin: 0 }} />
                          {c.name}
                        </label>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Action button */}
          {file && (
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
              {(uploading || validating) && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--text-muted)' }}>
                  {uploading
                    ? <><RefreshCw size={13} className="spin" /> Uploading... {uploadPct}%</>
                    : <><RefreshCw size={13} className="spin" /> Validating...</>
                  }
                </div>
              )}
              {/* Upload progress bar */}
              {uploading && (
                <div style={{ flex: 1, height: 4, background: 'var(--border)', borderRadius: 2, alignSelf: 'center' }}>
                  <div style={{
                    height: '100%', width: `${uploadPct}%`,
                    background: 'var(--accent)', borderRadius: 2, transition: 'width 0.3s',
                  }} />
                </div>
              )}
              <button
                className="btn btn-primary"
                onClick={handleUploadAndValidate}
                disabled={uploading || validating || Object.keys(activeMappings).length === 0 || (writeMode === 'upsert' && pkCols.length === 0)}
              >
                {uploading || validating ? <LoadingDots /> : <><Upload size={13} /> Upload & Validate →</>}
              </button>
            </div>
          )}
        </>
      )}

      {/* ── STEP 2: Validate Result ───────────────────────────── */}
      {step === 'validate' && validResult && (
        <>
          <div className="card">
            <div className="card-header">
              <h2 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {validResult.ok
                  ? <><CheckCircle2 size={16} style={{ color: 'var(--success)' }} /> Validation OK</>
                  : <><XCircle size={16} style={{ color: 'var(--danger)' }} /> Validation Failed</>}
              </h2>
            </div>
            <div className="card-body" style={{ padding: 0 }}>
              {/* Column compatibility table */}
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ background: 'var(--bg-glass)', fontSize: 11, color: 'var(--text-muted)' }}>
                      <th style={{ padding: '6px 12px', textAlign: 'left' }}>CSV Column</th>
                      <th style={{ padding: '6px 12px', textAlign: 'left' }}>Detected Type</th>
                      <th style={{ padding: '6px 4px' }}>→</th>
                      <th style={{ padding: '6px 12px', textAlign: 'left' }}>Target Column</th>
                      <th style={{ padding: '6px 12px', textAlign: 'left' }}>Target Type</th>
                      <th style={{ padding: '6px 12px', textAlign: 'center' }}>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(validResult.column_preview || []).map(col => (
                      <tr key={col.csv_col}>
                        <td style={{ padding: '6px 12px', fontFamily: 'monospace', fontSize: 12 }}>{col.csv_col}</td>
                        <td style={{ padding: '6px 12px' }}>
                          <span className="badge badge-info" style={{ fontSize: 11 }}>{col.detected_dtype}</span>
                        </td>
                        <td style={{ padding: '6px 4px', color: 'var(--text-muted)', textAlign: 'center' }}>→</td>
                        <td style={{ padding: '6px 12px', fontFamily: 'monospace', fontSize: 12 }}>{col.target_col}</td>
                        <td style={{ padding: '6px 12px' }}>
                          <span className="badge badge-info" style={{ fontSize: 11 }}>{col.target_type}</span>
                        </td>
                        <td style={{ padding: '6px 12px', textAlign: 'center' }}>
                          {col.compatible
                            ? <CheckCircle2 size={14} style={{ color: 'var(--success)' }} />
                            : <AlertTriangle size={14} style={{ color: 'var(--warning)' }} />}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Errors / Warnings */}
              {(validResult.errors || []).length > 0 && (
                <div style={{ padding: '10px 16px', borderTop: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {validResult.errors.map((e, i) => (
                    <div key={i} style={{
                      display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 12,
                      color: e.type === 'type_warning' ? 'var(--warning)' : 'var(--danger)',
                    }}>
                      {e.type === 'type_warning' ? <AlertTriangle size={13} style={{ flexShrink: 0, marginTop: 1 }} /> : <XCircle size={13} style={{ flexShrink: 0, marginTop: 1 }} />}
                      {e.message}
                    </div>
                  ))}
                </div>
              )}

              {/* Preview rows */}
              {(validResult.first_rows || []).length > 0 && (
                <div style={{ padding: '10px 16px', borderTop: '1px solid var(--border)' }}>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 8, fontWeight: 600 }}>DATA PREVIEW (first 5 rows)</div>
                  <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                      <thead>
                        <tr>{Object.keys(validResult.first_rows[0] || {}).map(k => (
                          <th key={k} style={{ padding: '4px 10px', textAlign: 'left', color: 'var(--text-muted)' }}>{k}</th>
                        ))}</tr>
                      </thead>
                      <tbody>
                        {validResult.first_rows.map((row, i) => (
                          <tr key={i}>{Object.values(row).map((v, j) => (
                            <td key={j} style={{ padding: '4px 10px', fontFamily: 'monospace' }}>{String(v ?? '')}</td>
                          ))}</tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
            <button className="btn btn-secondary" onClick={() => {
              if (stagingKey) {
                api.csvCleanup(stagingKey).catch(() => {})
              }
              setStep('upload')
            }}>
              ← Go back
            </button>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              {/* Warning banner when there is type_warning */}
              {(validResult.errors || []).some(e => e.type === 'type_warning') && (
                <div style={{
                  fontSize: 12, color: 'var(--warning)',
                  background: 'rgba(245,158,11,0.1)',
                  border: '1px solid rgba(245,158,11,0.3)',
                  borderRadius: 8, padding: '6px 12px',
                  display: 'flex', alignItems: 'center', gap: 6,
                }}>
                  <AlertTriangle size={13} />
                  Type mismatch — values that cannot be cast will become <strong style={{marginLeft: 4}}>NULL</strong>
                </div>
              )}
              <button
                className="btn"
                style={{
                  background: ((validResult.errors || []).some(e => e.type === 'type_warning') || writeMode === 'overwrite')
                    ? 'var(--warning)' : 'var(--accent-primary)',
                  color: '#fff',
                  border: 'none',
                }}
                onClick={handleIngest}
                disabled={!validResult.ok && (validResult.errors || []).some(e => e.type !== 'type_warning')}
              >
                {writeMode === 'overwrite'
                  ? <><AlertTriangle size={13} /> Overwrite &amp; Import →</>
                  : (validResult.errors || []).some(e => e.type === 'type_warning')
                    ? <><AlertTriangle size={13} /> Import anyway (with NULLs) →</>
                    : <><Upload size={13} /> Proceed to Import →</>}
              </button>
            </div>
          </div>
        </>
      )}

      {/* ── STEP 3: Ingest Result ─────────────────────────────── */}
      {step === 'ingest' && (
        <div className="card">
          <div className="card-header">
            <h2 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {ingesting
                ? <><RefreshCw size={16} className="spin" /> Importing...</>
                : ingestResult?.error
                  ? <><XCircle size={16} style={{ color: 'var(--danger)' }} /> Import failed</>
                  : <><CheckCircle2 size={16} style={{ color: 'var(--success)' }} /> Import completed!</>}
            </h2>
          </div>
          <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {ingesting && (
              <div style={{ display: 'flex', justifyContent: 'center', padding: '24px 0' }}>
                <LoadingDots />
              </div>
            )}
            {!ingesting && ingestResult && (
              <>
                {ingestResult.error ? (
                  <div style={{ color: 'var(--danger)', fontSize: 13, background: 'rgba(239,68,68,0.08)', padding: '12px 16px', borderRadius: 8, border: '1px solid rgba(239,68,68,0.3)' }}>
                    <AlertTriangle size={14} style={{ marginRight: 6 }} />
                    {ingestResult.error}
                  </div>
                ) : (
                  <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                    <div className="stat-mini-card" style={{ flex: 1, minWidth: 120 }}>
                      <div className="stat-mini-label"><Hash size={12} /> Rows Imported</div>
                      <div className="stat-mini-value">{(ingestResult.rows_affected ?? 0).toLocaleString()}</div>
                      <div className="stat-mini-sub">records</div>
                    </div>
                    <div className="stat-mini-card" style={{ flex: 2, minWidth: 200 }}>
                      <div className="stat-mini-label"><Info size={12} /> Details</div>
                      <div style={{ fontSize: 12, marginTop: 4 }}>{ingestResult.message}</div>
                    </div>
                  </div>
                )}

                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, marginTop: 8 }}>
                  <button className="btn btn-secondary" onClick={resetWizard}>
                    <Upload size={13} /> Import another file
                  </button>
                  {!ingestResult.error && (
                    <button className="btn btn-primary" onClick={onImportSuccess}>
                      <Eye size={13} /> View Preview table →
                    </button>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      )}

    </div>
  )
}

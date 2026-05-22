import React, { useState, useEffect, useCallback } from 'react'
import { Database, RefreshCw, CheckCircle2, AlertTriangle, Play, Settings, Zap, Trash2, X, History, Loader2, Eye, Table, Info, AlertCircle, Server } from 'lucide-react'
import * as api from '../api/client'
import '../styles/serving.css'

const fmtDate = d => {
  if (!d) return '—'
  const dt = new Date(d), now = new Date(), diff = Math.floor((now - dt) / 60000)
  if (diff < 1) return 'just now'
  if (diff < 60) return `${diff}m ago`
  if (diff < 1440) return `${Math.floor(diff / 60)}h ago`
  return dt.toLocaleString('vi-VN')
}

const StatusDot = ({ status }) => <span className={`sm-dot ${status || 'default'}`} />

const StatusBadge = ({ status }) => {
  const map = { active: ['#10b981', 'Active'], syncing: ['#3b82f6', 'Syncing…'], error: ['#ef4444', 'Error'], pending_pk_config: ['#f59e0b', 'Setup Required'] }
  const [color, label] = map[status] || ['#64748b', status]
  return <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, fontWeight: 600, color, padding: '3px 9px', borderRadius: 20, background: color + '18', border: `1px solid ${color}30` }}>
    <StatusDot status={status} />{label}
  </span>
}

const showToastGlobal = { fn: null }

export default function ServingManager() {
  const [tables, setTables] = useState([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState(null)
  const [toast, setToast] = useState(null)
  const [pkModal, setPkModal] = useState(null)
  const [pkSel, setPkSel] = useState('')
  const [deleteModal, setDeleteModal] = useState(null)

  showToastGlobal.fn = (msg, type = 'success') => { setToast({ msg, type }); setTimeout(() => setToast(null), 4500) }
  const showToast = showToastGlobal.fn

  const loadTables = useCallback(async () => {
    setLoading(true)
    try {
      const data = await api.getServingTables()
      setTables(data || [])
      if (selected) {
        const upd = (data || []).find(t => t.gold_table === selected.gold_table)
        if (upd) setSelected(upd)
      }
    } catch (e) { showToast(e.message, 'error') }
    finally { setLoading(false) }
  }, [selected?.gold_table])

  useEffect(() => { loadTables() }, [])

  useEffect(() => {
    const id = setInterval(() => { if (tables.some(t => t.sync_status === 'syncing')) loadTables() }, 8000)
    return () => clearInterval(id)
  }, [tables])

  const handleSync = async (t) => {
    try {
      const res = await api.triggerServingSync(t.gold_table)
      if (!res.launched) { showToast(res.error || 'Failed to launch', 'error'); return }
      showToast(`Sync started for ${t.gold_table}`)
      const patch = p => p.map(x => x.gold_table === t.gold_table ? { ...x, sync_status: 'syncing' } : x)
      setTables(patch)
      if (selected?.gold_table === t.gold_table) setSelected(s => ({ ...s, sync_status: 'syncing' }))
      let tries = 0
      const poll = setInterval(async () => {
        if (++tries > 24) { clearInterval(poll); return }
        try {
          const upd = await api.getServingTable(t.gold_table)
          setTables(p => p.map(x => x.gold_table === t.gold_table ? upd : x))
          if (selected?.gold_table === t.gold_table) setSelected(upd)
          if (upd.sync_status !== 'syncing') {
            clearInterval(poll)
            if (upd.sync_status === 'active') showToast(`✓ ${t.gold_table} synced — ${(upd.last_row_count || 0).toLocaleString()} rows`)
            else if (upd.sync_status === 'error') showToast((upd.last_error || 'Sync failed').slice(0, 120), 'error')
          }
        } catch {}
      }, 5000)
    } catch (e) { showToast(e.message, 'error') }
  }

  const handleDeleteClick = (gold_table) => {
    setDeleteModal(gold_table)
  }

  const handleConfirmDelete = async () => {
    if (!deleteModal) return
    const gold_table = deleteModal
    try {
      await api.deleteServingTable(gold_table)
      setTables(p => p.filter(t => t.gold_table !== gold_table))
      if (selected?.gold_table === gold_table) setSelected(null)
      showToast(`Removed ${gold_table}`)
      setDeleteModal(null)
    } catch (e) { showToast(e.message, 'error') }
  }

  const handleConfirmPK = async () => {
    if (!pkSel) { showToast('Select a column', 'error'); return }
    try {
      await api.confirmServingTablePK(pkModal.gold_table, pkSel)
      showToast(`PK configured — ${pkModal.gold_table} will use MERGE strategy`)
      setPkModal(null); setPkSel('')
      loadTables()
    } catch (e) { showToast(e.message, 'error') }
  }

  const handleSkipPK = async () => {
    try {
      await api.skipServingTablePK(pkModal.gold_table)
      showToast(`${pkModal.gold_table} activated — using Truncate & Insert strategy`)
      setPkModal(null); setPkSel('')
      loadTables()
    } catch (e) { showToast(e.message, 'error') }
  }

  const counts = { active: 0, error: 0, syncing: 0, pending: 0 }
  tables.forEach(t => {
    if (t.sync_status === 'active') counts.active++
    else if (t.sync_status === 'error') counts.error++
    else if (t.sync_status === 'syncing') counts.syncing++
    else if (t.sync_status === 'pending_pk_config') counts.pending++
  })

  return (
    <div className="sm-layout">
      {/* Top Bar */}
      <div className="sm-topbar">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ background: 'linear-gradient(135deg,#a855f7,#6366f1)', padding: '7px 8px', borderRadius: 9, display: 'flex', boxShadow: '0 0 16px rgba(139,92,246,0.35)' }}>
            <Zap size={17} color="#fff" />
          </div>
          <div>
            <div style={{ fontWeight: 700, fontSize: 14, letterSpacing: '-0.2px' }}>Serving Layer</div>
            <div style={{ fontSize: 10, color: 'var(--text-muted)', letterSpacing: '0.2px' }}>Iceberg → Trino → PostgreSQL → PowerBI</div>
          </div>
          <div style={{ display: 'flex', gap: 6, marginLeft: 8 }}>
            {[['active', '#10b981', counts.active + ' active'], ['error', '#ef4444', counts.error + ' error'], ['pending', '#f59e0b', counts.pending + ' pending'], ['syncing', '#3b82f6', counts.syncing + ' syncing']].filter(([, , l]) => !l.startsWith('0')).map(([k, c, l]) => (
              <span key={k} style={{ fontSize: 11, color: c, background: c + '18', padding: '2px 8px', borderRadius: 20, fontWeight: 600 }}>{l}</span>
            ))}
          </div>
        </div>
        <button className="btn btn-secondary btn-sm" onClick={loadTables} style={{ gap: 6 }}>
          <RefreshCw size={12} /> Refresh
        </button>
      </div>

      {/* Split */}
      <div className="sm-split">
        {/* Left panel */}
        <div className="sm-left">
          <div className="sm-left-header">
            <div className="sm-left-label">Tables ({tables.length})</div>
          </div>
          <div className="sm-left-list">
            {loading ? (
              <div style={{ padding: 32, display: 'flex', justifyContent: 'center' }}><Loader2 size={18} className="spin" style={{ color: 'var(--text-muted)' }} /></div>
            ) : tables.length === 0 ? (
              <div style={{ padding: '40px 16px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 12 }}>
                <Database size={28} style={{ opacity: 0.2, display: 'block', margin: '0 auto 8px' }} />
                No serving tables yet
              </div>
            ) : tables.map(t => (
              <div key={t.gold_table} className={`sm-table-item${selected?.gold_table === t.gold_table ? ' selected' : ''}`} onClick={() => setSelected(t)}>
                <div className="sm-table-item-name">
                  <StatusDot status={t.sync_status} />
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.gold_table}</span>
                </div>
                <div className="sm-table-item-meta">
                  <span>{t.columns?.length || 0} cols</span>
                  {t.last_row_count != null && <span>{t.last_row_count.toLocaleString()} rows</span>}
                  {t.last_sync_at && <span>{fmtDate(t.last_sync_at)}</span>}
                  {!t.last_sync_at && <span style={{ color: '#f59e0b' }}>never synced</span>}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Right panel */}
        <div className="sm-right">
          {!selected ? (
            <div className="sm-right-empty">
              <div style={{ background: 'rgba(99,102,241,0.08)', border: '1px solid rgba(99,102,241,0.15)', padding: 28, borderRadius: '50%' }}>
                <Server size={40} style={{ opacity: 0.3 }} />
              </div>
              <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-secondary)' }}>Select a table</div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Click any table on the left to view details</div>
            </div>
          ) : (
            <DetailPanel key={selected.gold_table} table={selected} onSync={handleSync} onDelete={handleDeleteClick} onSetupPK={() => { setPkModal(selected); setPkSel('') }} showToast={showToast} />
          )}
        </div>
      </div>

      {/* PK / Strategy Modal */}
      {pkModal && (
        <div className="modal-overlay">
          <div className="modal" style={{ maxWidth: 480 }}>
            <div className="modal-header">
              <h2 style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 15 }}><Settings size={16} /> Configure Sync Strategy</h2>
              <button className="btn btn-icon btn-sm" onClick={() => setPkModal(null)}><X size={14} /></button>
            </div>
            <div className="modal-body" style={{ padding: '20px 24px' }}>

              {/* Option A — Set PK for MERGE */}
              <div style={{ background: 'rgba(99,102,241,0.07)', border: '1px solid rgba(99,102,241,0.2)', borderRadius: 10, padding: '14px 16px', marginBottom: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 8, fontWeight: 600, fontSize: 13, color: '#a5b4fc' }}>
                  <CheckCircle2 size={14} /> Option A — Set Primary Key (MERGE)
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 12, lineHeight: 1.6 }}>
                  Table has a unique column? Select it to enable incremental <strong>MERGE</strong> sync — only changed rows are updated. Best for large, frequently updated tables.
                </div>
                <div className="form-group" style={{ marginBottom: 10 }}>
                  <label className="form-label">Primary Key Column</label>
                  <select className="form-select" value={pkSel} onChange={e => setPkSel(e.target.value)}>
                    <option value="">— select column —</option>
                    {pkModal.columns?.map(c => <option key={c.name} value={c.name}>{c.name} ({c.trino_type})</option>)}
                  </select>
                </div>
                <button className="btn btn-primary btn-sm" onClick={handleConfirmPK} disabled={!pkSel} style={{ width: '100%', justifyContent: 'center' }}>
                  <CheckCircle2 size={13} /> Confirm PK & Start Sync
                </button>
              </div>

              {/* Option B — No PK, use Truncate Insert */}
              <div style={{ background: 'rgba(16,185,129,0.05)', border: '1px solid rgba(16,185,129,0.15)', borderRadius: 10, padding: '14px 16px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 8, fontWeight: 600, fontSize: 13, color: '#34d399' }}>
                  <Zap size={14} /> Option B — No PK (Truncate & Insert)
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 12, lineHeight: 1.6 }}>
                  No unique column? Use <strong>Truncate & Insert</strong> — table is fully replaced on each sync. Safe for any table, including fact/log tables with no natural key.
                </div>
                <button className="btn btn-secondary btn-sm" onClick={handleSkipPK} style={{ width: '100%', justifyContent: 'center', borderColor: 'rgba(16,185,129,0.3)', color: '#34d399' }}>
                  <Play size={13} /> Skip PK — Use Truncate & Insert
                </button>
              </div>

            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deleteModal && (
        <div className="modal-overlay">
          <div className="modal" style={{ maxWidth: 400 }}>
            <div className="modal-header">
              <h2 style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 15 }}><Trash2 size={16} /> Confirm Deletion</h2>
              <button className="btn btn-icon btn-sm" onClick={() => setDeleteModal(null)}><X size={14} /></button>
            </div>
            <div className="modal-body" style={{ padding: '20px 24px' }}>
              <div style={{ fontSize: 13, marginBottom: 16 }}>
                Are you sure you want to remove the serving config for <strong>{deleteModal}</strong>?
              </div>
              <div style={{ background: 'rgba(239,68,68,0.07)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 8, padding: '10px 14px', marginBottom: 20, fontSize: 12, color: '#fca5a5', display: 'flex', gap: 8, lineHeight: 1.5 }}>
                <AlertTriangle size={14} style={{ flexShrink: 0, marginTop: 1 }} />
                <span>The PostgreSQL serving table will be dropped. The original Iceberg Gold table will <strong>not</strong> be affected.</span>
              </div>
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button className="btn btn-secondary btn-sm" onClick={() => setDeleteModal(null)}>Cancel</button>
                <button className="btn btn-danger btn-sm" onClick={handleConfirmDelete}><Trash2 size={13} /> Remove</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div style={{ position: 'fixed', bottom: 24, right: 24, zIndex: 9999, minWidth: 280, maxWidth: 400, background: toast.type === 'error' ? '#450a0a' : '#052e16', border: `1px solid ${toast.type === 'error' ? 'rgba(239,68,68,0.35)' : 'rgba(16,185,129,0.3)'}`, color: '#fff', padding: '12px 16px', borderRadius: 10, fontSize: 13, boxShadow: '0 16px 40px rgba(0,0,0,0.5)', display: 'flex', gap: 10, alignItems: 'flex-start', animation: 'slideUp 0.25s ease' }}>
          {toast.type === 'error' ? <AlertTriangle size={15} style={{ flexShrink: 0, marginTop: 1, color: '#f87171' }} /> : <CheckCircle2 size={15} style={{ flexShrink: 0, marginTop: 1, color: '#34d399' }} />}
          <span style={{ lineHeight: 1.5, fontSize: 12.5 }}>{toast.msg}</span>
        </div>
      )}
    </div>
  )
}

/* ─── Detail Panel ─────────────────────────────────────────────── */
function DetailPanel({ table, onSync, onDelete, onSetupPK, showToast }) {
  const [tab, setTab] = useState('overview')
  const isPending = table.sync_status === 'pending_pk_config'
  const isSyncing = table.sync_status === 'syncing'

  const TABS = [
    ['overview', 'Overview', <Info size={12} />],
    ['preview', 'Data Preview', <Eye size={12} />],
    ['history', 'Sync History', <History size={12} />],
    ['sql', 'Compiled SQL', <Code2 size={12} />],
    ['schema', 'Schema', <Table size={12} />],
  ]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div className="sm-detail-header">
        <div className="sm-detail-top">
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
            <div style={{ background: 'rgba(99,102,241,0.12)', padding: 9, borderRadius: 10, display: 'flex', flexShrink: 0 }}>
              <Server size={18} color="#818cf8" />
            </div>
            <div style={{ minWidth: 0 }}>
              <div className="sm-detail-title">{table.gold_table}</div>
              <div className="sm-detail-subtitle">powerbi_serving.{table.gold_table}</div>
            </div>
            <StatusBadge status={table.sync_status} />
          </div>
          <div className="sm-actions">
            {isPending ? (
              <button className="btn btn-warning btn-sm" onClick={onSetupPK} style={{ gap: 6 }}><Settings size={13} /> Configure Strategy</button>
            ) : (
              <button className="btn btn-primary btn-sm" onClick={() => onSync(table)} disabled={isSyncing} style={{ minWidth: 110 }}>
                {isSyncing ? <><RefreshCw size={13} className="spin" />Syncing…</> : <><Play size={13} />Sync Now</>}
              </button>
            )}
            <button className="btn btn-danger btn-sm btn-icon" title="Delete config" onClick={() => onDelete(table.gold_table)}><Trash2 size={14} /></button>
          </div>
        </div>
        <div className="sm-tabs">
          {TABS.map(([id, label, icon]) => (
            <button key={id} className={`sm-tab${tab === id ? ' active' : ''}`} onClick={() => setTab(id)}>
              {icon} {label}
            </button>
          ))}
        </div>
      </div>

      <div className="sm-body">
        {tab === 'overview' && <OverviewTab table={table} />}
        {tab === 'preview' && <PreviewTab table={table} showToast={showToast} />}
        {tab === 'history' && <HistoryTab table={table} showToast={showToast} />}
        {tab === 'sql' && <CompiledSqlTab table={table} showToast={showToast} />}
        {tab === 'schema' && <SchemaTab table={table} />}
      </div>
    </div>
  )
}

/* ─── Overview Tab ─────────────────────────────────────────────── */
function OverviewTab({ table: t }) {
  const props = [
    ['Status', <StatusBadge status={t.sync_status} />],
    ['Strategy', <span className="sm-strategy">{t.strategy}</span>],
    ['Primary Key', t.pk_column ? <code className="sm-pk-code">{t.pk_column}</code> : <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>None — Truncate &amp; Insert</span>],
    ['Row Count', <span style={{ fontSize: 13, fontWeight: 700 }}>{t.last_row_count != null ? t.last_row_count.toLocaleString() : '—'}</span>],
    ['Columns', <span style={{ fontSize: 13, fontWeight: 700 }}>{t.columns?.length || 0}</span>],
    ['Last Sync', <span style={{ fontSize: 13 }}>{t.last_sync_at ? new Date(t.last_sync_at).toLocaleString('vi-VN') : 'Never'}</span>],
    ['Source Table', <span style={{ fontSize: 12, fontFamily: 'monospace', color: '#fcd34d' }}>iceberg.gold.{t.gold_table}</span>],
    ['Destination Table', <span style={{ fontSize: 12, fontFamily: 'monospace', color: '#34d399' }}>powerbi_serving.{t.gold_table}</span>],
    ['Discovery Mode', <span style={{ fontSize: 13 }}>{t.auto_discovered ? '🤖 Auto (sensor)' : '👤 Manual'}</span>],
    ['Created At', <span style={{ fontSize: 13 }}>{new Date(t.created_at).toLocaleString('vi-VN')}</span>],
    ['Max MERGE Rows', <span style={{ fontSize: 13 }}>{(t.max_rows_for_merge || 0).toLocaleString()}</span>],
    ['Iceberg Snapshot ID', <span style={{ fontSize: 12, fontFamily: 'monospace', color: 'var(--text-muted)' }}>{t.last_snapshot_id || '—'}</span>],
  ]

  return (
    <>
      <div className="sm-table-wrap">
        <table style={{ margin: 0 }}>
          <thead><tr><th style={{ width: 220 }}>Property</th><th>Value</th></tr></thead>
          <tbody>
            {props.map(([label, val]) => (
              <tr key={label}>
                <td style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 600 }}>{label}</td>
                <td>{val}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {t.last_error && (
        <div className="sm-error-box" style={{ marginTop: 16 }}>
          <div className="sm-error-label"><AlertCircle size={12} /> Last Error</div>
          <div className="sm-error-msg">{t.last_error}</div>
        </div>
      )}
    </>
  )
}

/* ─── Data Preview Tab ─────────────────────────────────────────── */
function PreviewTab({ table, showToast }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await api.executeQuery({ sql: `SELECT * FROM postgres.powerbi_serving."${table.gold_table}" LIMIT 100` })
      setData(res)
    } catch (e) { showToast(e.message, 'error') }
    finally { setLoading(false) }
  }, [table.gold_table])

  useEffect(() => { load() }, [load])

  if (loading) return <div style={{ display: 'flex', justifyContent: 'center', padding: 60, gap: 10, color: 'var(--text-muted)' }}><Loader2 size={20} className="spin" />Loading data…</div>

  return (
    <div>
      <div className="sm-preview-info">
        <span>
          {data ? <>Showing <strong style={{ color: 'var(--text-primary)' }}>{data.rows?.length || 0}</strong> rows in <code style={{ background: 'rgba(255,255,255,0.06)', padding: '1px 6px', borderRadius: 3, fontSize: 11 }}>powerbi_serving.{table.gold_table}</code></> : 'Click Load to fetch data'}
        </span>
        <button className="btn btn-secondary btn-sm" onClick={load}><RefreshCw size={11} /> Reload</button>
      </div>
      {!data?.rows?.length ? (
        <div style={{ textAlign: 'center', padding: 60, color: 'var(--text-muted)', fontSize: 13 }}>
          <Database size={36} style={{ opacity: 0.15, display: 'block', margin: '0 auto 12px' }} />
          Table is empty — run a sync to populate data
        </div>
      ) : (
        <div className="sm-table-wrap">
          <table>
            <thead><tr>{data.columns?.map(c => <th key={c}>{c}</th>)}</tr></thead>
            <tbody>
              {data.rows.map((row, i) => (
                <tr key={i}>{row.map((cell, j) => (
                  <td key={j} style={{ fontFamily: 'monospace', fontSize: 12 }}>
                    {cell == null ? <span style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>null</span> : String(cell)}
                  </td>
                ))}</tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

/* ─── Sync History Tab ─────────────────────────────────────────── */
import { Code2 } from 'lucide-react'

function HistoryTab({ table, showToast }) {
  const [data, setData] = useState([])
  const [loading, setLoading] = useState(true)
  const [sqlModal, setSqlModal] = useState(null)

  useEffect(() => {
    setLoading(true)
    api.getServingTableHistory(table.gold_table)
      .then(d => setData(d || []))
      .catch(e => showToast(e.message, 'error'))
      .finally(() => setLoading(false))
  }, [table.gold_table])

  if (loading) return <div style={{ display: 'flex', justifyContent: 'center', padding: 60, gap: 10, color: 'var(--text-muted)' }}><Loader2 size={20} className="spin" />Loading history…</div>

  if (!data.length) return (
    <div style={{ textAlign: 'center', padding: 60, color: 'var(--text-muted)' }}>
      <History size={36} style={{ opacity: 0.15, display: 'block', margin: '0 auto 12px' }} />
      <div style={{ fontSize: 13 }}>No sync history yet</div>
      <div style={{ fontSize: 11, marginTop: 4 }}>Run a sync to see logs here</div>
    </div>
  )

  return (
    <>
      <div className="sm-table-wrap">
        <table style={{ minWidth: 900 }}>
          <thead><tr>
            <th>Time</th><th>Status</th><th>Run ID</th><th>Snapshot ID</th><th>Strategy</th><th>Rows</th><th>Duration</th><th>Trigger</th><th>SQL</th>
          </tr></thead>
          <tbody>
            {data.map((row, i) => (
              <tr key={i}>
                <td style={{ fontSize: 12, whiteSpace: 'nowrap' }}>{new Date(row.synced_at).toLocaleString('vi-VN')}</td>
                <td>
                  {row.status === 'success'
                    ? <span className="sm-hist-ok"><CheckCircle2 size={12} />Success</span>
                    : <span className="sm-hist-fail" title={row.error_message}><AlertTriangle size={12} />Failed</span>}
                </td>
                <td><code style={{ fontSize: 11, color: 'var(--text-muted)' }}>{row.dagster_run_id?.slice(0, 8) || '—'}</code></td>
                <td><code style={{ fontSize: 11, color: 'var(--text-muted)' }}>{row.snapshot_id || '—'}</code></td>
                <td><span style={{ fontFamily: 'monospace', fontSize: 11, background: 'rgba(255,255,255,0.06)', padding: '1px 6px', borderRadius: 3 }}>{row.strategy_used || '—'}</span></td>
                <td style={{ fontWeight: 600, fontSize: 13 }}>{row.rows_affected != null ? row.rows_affected.toLocaleString() : '—'}</td>
                <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{row.duration_s != null ? `${row.duration_s}s` : '—'}</td>
                <td><span style={{ fontSize: 11, color: 'var(--text-secondary)', background: 'rgba(255,255,255,0.05)', padding: '1px 6px', borderRadius: 3 }}>{row.triggered_by}</span></td>
                <td>
                  <button className="btn btn-icon btn-sm" disabled={!row.compiled_sql} onClick={() => setSqlModal(row.compiled_sql)} title={row.compiled_sql ? "View Compiled SQL" : "No SQL recorded"}>
                    <Code2 size={14} style={{ opacity: row.compiled_sql ? 1 : 0.2 }} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {sqlModal && (
        <div className="modal-overlay">
          <div className="modal" style={{ maxWidth: 800 }}>
            <div className="modal-header">
              <h2 style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 15 }}><Code2 size={16} /> Compiled SQL</h2>
              <button className="btn btn-icon btn-sm" onClick={() => setSqlModal(null)}><X size={14} /></button>
            </div>
            <div className="modal-body" style={{ padding: '16px 20px', background: '#010409' }}>
              <SqlHighlighter sql={sqlModal} />
            </div>
          </div>
        </div>
      )}
    </>
  )
}

/* ─── SQL Syntax Highlighter ─────────────────────────────────────── */
function SqlHighlighter({ sql }) {
  if (!sql) return null
  
  const keywords = [
    'MERGE INTO', 'USING', 'SELECT', 'FROM', 'WHERE', 'ON', 'WHEN MATCHED THEN',
    'UPDATE SET', 'WHEN NOT MATCHED THEN', 'INSERT', 'VALUES', 'AS', 'OVER',
    'PARTITION BY', 'ORDER BY', 'AND', 'OR', 'IS', 'NOT', 'NULL'
  ]

  let html = sql
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')

  // Strings (single quotes)
  html = html.replace(/'([^']*)'/g, '<span style="color: #a5d6ff;">\'$1\'</span>')
  
  // Identifiers (double quotes)
  html = html.replace(/"([^"]*)"/g, '<span style="color: #7ee787;">"$1"</span>')

  // Keywords
  keywords.forEach(kw => {
    // using word boundary, handling spaces in keywords
    const regex = new RegExp(`\\b${kw}\\b`, 'gi')
    html = html.replace(regex, match => `<span style="color: #ff7b72; font-weight: 600;">${match}</span>`)
  })

  return (
    <pre 
      style={{ margin: 0, padding: 16, background: '#0d1117', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 6, color: '#c9d1d9', fontFamily: 'monospace', fontSize: 13, overflowX: 'auto', whiteSpace: 'pre-wrap', lineHeight: 1.5 }}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}

/* ─── Compiled SQL Tab ─────────────────────────────────────────── */
function CompiledSqlTab({ table, showToast }) {
  const [sql, setSql] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    api.getServingTableHistory(table.gold_table)
      .then(d => {
        const latestWithSql = (d || []).find(r => r.compiled_sql)
        setSql(latestWithSql?.compiled_sql || null)
      })
      .catch(e => showToast(e.message, 'error'))
      .finally(() => setLoading(false))
  }, [table.gold_table])

  if (loading) return <div style={{ display: 'flex', justifyContent: 'center', padding: 60, gap: 10, color: 'var(--text-muted)' }}><Loader2 size={20} className="spin" />Loading…</div>

  if (!sql) return (
    <div style={{ textAlign: 'center', padding: 60, color: 'var(--text-muted)' }}>
      <Code2 size={36} style={{ opacity: 0.15, display: 'block', margin: '0 auto 12px' }} />
      <div style={{ fontSize: 13 }}>No Compiled SQL found</div>
      <div style={{ fontSize: 11, marginTop: 4 }}>Run a successful sync to generate the query.</div>
    </div>
  )

  return (
    <div style={{ padding: 16 }}>
      <div style={{ marginBottom: 12, fontSize: 12, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 8 }}>
        <Code2 size={14} /> Latest Compiled SQL (Trino)
      </div>
      <SqlHighlighter sql={sql} />
    </div>
  )
}

/* ─── Schema Tab ───────────────────────────────────────────────── */
function SchemaTab({ table }) {
  return (
    <div>
      <div style={{ marginBottom: 14, fontSize: 12, color: 'var(--text-muted)' }}>
        {table.columns?.length || 0} columns — <span style={{ color: 'var(--text-secondary)' }}>iceberg.gold.{table.gold_table} → powerbi_serving.{table.gold_table}</span>
      </div>
      <div className="sm-table-wrap">
        <table>
          <thead><tr><th>#</th><th>Column Name</th><th>Trino Type</th><th>PostgreSQL Type</th><th>Role</th></tr></thead>
          <tbody>
            {table.columns?.map((c, i) => (
              <tr key={c.name}>
                <td style={{ color: 'var(--text-muted)', fontSize: 11, width: 40 }}>{i + 1}</td>
                <td><code style={{ fontFamily: 'monospace', fontSize: 13, fontWeight: 600 }}>{c.name}</code></td>
                <td><span style={{ fontFamily: 'monospace', fontSize: 12, color: '#93c5fd' }}>{c.trino_type}</span></td>
                <td><span style={{ fontFamily: 'monospace', fontSize: 12, color: '#6ee7b7' }}>{c.pg_type}</span></td>
                <td>
                  {c.name === table.pk_column && <span style={{ background: 'rgba(99,102,241,0.15)', color: '#a5b4fc', padding: '2px 7px', borderRadius: 4, fontSize: 11, fontWeight: 700, border: '1px solid rgba(99,102,241,0.25)' }}>PK</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

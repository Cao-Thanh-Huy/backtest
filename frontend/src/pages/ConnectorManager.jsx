/**
 * ConnectorManager — Trang quản lý REST API Connectors
 * Multi-step wizard: Basic → Auth → Pagination/Partition → Test → Save
 */
import React, { useState, useEffect, useCallback } from 'react'
import { Link } from 'react-router-dom'
import {
  Plug, Plus, RefreshCw, Trash2, Edit3, Play, CheckCircle, Pause, Power,
  AlertCircle, Clock, ChevronRight, ChevronLeft, X, Eye,
  EyeOff, Search, Activity, Database, Zap, Shield, Calendar, Save, GitBranch, Link2, ExternalLink, Unlink, ArrowRight, MoreVertical,
  History, GitMerge, Code2, FileCode, Globe, Unlock
} from 'lucide-react'
import {
  listConnectors, createConnector, updateConnector,
  deleteConnector, testConnector, triggerIngest, getRunHistory, updateSchedule, getSampleBaseUrl,
  forceUnlockConnector
} from '../api/connectors'
import {
  getDagsterRunErrorLog,
  listPipelines,
  listDownstreamTriggers, addDownstreamTrigger,
  updateDownstreamTrigger, removeDownstreamTrigger,
} from '../api/client'

// ── Styles ──────────────────────────────────────────────────────────────────
const S = {
  page: {
    padding: '24px',
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
  btn: (variant = 'primary') => ({
    display: 'flex', alignItems: 'center', gap: 6,
    padding: '8px 16px', borderRadius: 8, fontWeight: 600, fontSize: 13,
    cursor: 'pointer', transition: 'all 0.15s', border: 'none',
    ...(variant === 'primary'
      ? { background: 'linear-gradient(135deg,#10b981,#059669)', color: '#fff' }
      : variant === 'danger'
        ? { background: '#ef444420', color: '#f87171', border: '1px solid #ef444440' }
        : variant === 'ghost'
          ? { background: 'transparent', color: '#94a3b8', border: '1px solid #334155' }
          : { background: '#1e293b', color: '#94a3b8', border: '1px solid #334155' }
    ),
  }),
  card: {
    background: '#0f172a', border: '1px solid #1e293b',
    borderRadius: 12, overflow: 'visible',
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
    textTransform: 'uppercase', letterSpacing: '0.05em'
  }),
  overlay: {
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)',
    zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center',
    backdropFilter: 'blur(4px)',
  },
  drawer: {
    background: '#0f172a', border: '1px solid #1e293b',
    borderRadius: 16, width: '100%', maxWidth: 680,
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
  stepIndicator: { display: 'flex', gap: 0, marginBottom: 24 },
  step: (active, done) => ({
    flex: 1, textAlign: 'center', padding: '10px 4px',
    fontSize: 12, fontWeight: 600, cursor: 'default',
    borderBottom: `3px solid ${done ? '#10b981' : active ? '#3b82f6' : '#1e293b'}`,
    color: done ? '#10b981' : active ? '#60a5fa' : '#475569',
    transition: 'all 0.2s',
  }),
  wizardLayerCard: (selected, disabled) => ({
    padding: 20, borderRadius: 14,
    cursor: disabled ? 'not-allowed' : 'pointer',
    border: `2px solid ${selected ? '#6366f1' : '#1e293b'}`,
    background: selected ? 'rgba(99,102,241,0.08)' : '#0a0f1e',
    opacity: disabled ? 0.45 : 1,
    transition: 'all 0.2s',
  }),
  breadcrumb: {
    display: 'flex', alignItems: 'center', gap: 8,
    fontSize: 12, color: '#64748b', marginBottom: 20,
  },
}

// ── SummaryCard ───────────────────────────────────────────
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
    <div style={{
      background: highlight ? c.bg : 'var(--bg-glass)',
      border: `1px solid ${highlight ? c.border : 'var(--border-color)'}`,
      borderRadius: '16px',
      padding: '24px',
      position: 'relative',
      overflow: 'hidden',
      boxShadow: highlight ? `0 0 24px ${c.iconBtn}` : 'var(--shadow-sm)',
      transition: 'all 0.3s ease',
      display: 'flex', flexDirection: 'column'
    }}
      onMouseEnter={(e) => { e.currentTarget.style.transform = 'translateY(-4px)'; e.currentTarget.style.boxShadow = `0 12px 30px ${c.iconBtn}` }}
      onMouseLeave={(e) => { e.currentTarget.style.transform = 'none'; e.currentTarget.style.boxShadow = highlight ? `0 0 24px ${c.iconBtn}` : 'var(--shadow-sm)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
        <div style={{ width: 48, height: 48, borderRadius: '12px', background: c.iconBtn, color: c.text, display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: `0 0 16px ${c.glow}` }}>
          <Icon size={24} strokeWidth={2.5} />
        </div>
      </div>
      <div>
        <div style={{ fontSize: 32, fontWeight: 800, color: highlight ? c.text : 'var(--text-primary)', lineHeight: 1.2, fontFamily: 'var(--font-family)', textShadow: highlight ? `0 0 12px ${c.glow}` : 'none' }}>{value}</div>
        <div style={{ fontSize: 13, color: 'var(--text-muted)', fontWeight: 500, letterSpacing: '0.02em', textTransform: 'uppercase', marginTop: 4 }}>{label}</div>
        {sub && <div style={{ fontSize: 12, color: c.text, marginTop: 8, fontWeight: 500, display: 'flex', alignItems: 'center', gap: 6 }}>{highlight && <Activity size={14} />} {sub}</div>}
      </div>
    </div>
  )
}

// ── Status badge ────────────────────────────────────────────────────────────
function StatusBadge({ status }) {
  const map = {
    // Connector Status
    active: { color: '#10b981', label: 'Active', icon: <CheckCircle size={11} /> },
    inactive: { color: '#64748b', label: 'Inactive', icon: <Clock size={11} /> },
    error: { color: '#ef4444', label: 'Error', icon: <AlertCircle size={11} /> },

    // Run History Status
    success: { color: '#10b981', label: 'Success', icon: <CheckCircle size={11} /> },
    failed: { color: '#ef4444', label: 'Failed', icon: <AlertCircle size={11} /> },
    failure: { color: '#ef4444', label: 'Failed', icon: <AlertCircle size={11} /> },
    running: { color: '#3b82f6', label: 'Running', icon: <RefreshCw size={11} className="spin" /> },

    // Dagster Statuses
    queued: { color: '#f59e0b', label: 'Queued', icon: <Clock size={11} /> },
    starting: { color: '#8b5cf6', label: 'Starting', icon: <RefreshCw size={11} className="spin" /> },
    started: { color: '#3b82f6', label: 'Running', icon: <RefreshCw size={11} className="spin" /> },
  }
  const { color, label, icon } = map[status?.toLowerCase()] || { color: '#94a3b8', label: status || 'Unknown', icon: <Clock size={11} /> }
  return <span style={S.badge(color)}>{icon} {label}</span>
}

// ── iOS-style Toggle Switch ──────────────────────────────────────────────────
const Toggle = ({ active, onChange, disabled, activeColor = '#10b981' }) => (
  <div
    onClick={() => !disabled && onChange(!active)}
    style={{
      width: 36, height: 20, borderRadius: 20,
      background: active ? activeColor : '#334155',
      position: 'relative', cursor: disabled ? 'not-allowed' : 'pointer',
      transition: 'background 0.3s', opacity: disabled ? 0.5 : 1
    }}
  >
    <div style={{
      width: 14, height: 14, borderRadius: '50%', background: '#fff',
      position: 'absolute', top: 3, left: active ? 19 : 3,
      transition: 'left 0.3s, background 0.3s',
      boxShadow: '0 2px 4px rgba(0,0,0,0.2)'
    }} />
  </div>
)

// ── Auth type badge ─────────────────────────────────────────────────────────
function AuthBadge({ type }) {
  const map = {
    none: { color: '#64748b', label: 'None' },
    bearer: { color: '#3b82f6', label: 'Bearer' },
    api_key: { color: '#a855f7', label: 'API Key' },
    basic: { color: '#f97316', label: 'Basic' },
  }
  const { color, label } = map[type] || map.none
  return <span style={S.badge(color)}>{label}</span>
}

// ── Sample Connector Domains ─────────────────────────────────────────────────
const CONNECTOR_SAMPLE_DOMAINS = [
  {
    id: 'finance',
    label: 'Finance Report',
    desc: 'Cost Items, GL, P&L, Budget vs Actual, Receivables, Dimensions & Roles',
    connectors: [
      { name: 'balance_sheet', desc: 'Bảng cân đối kế toán' },
      { name: 'fes_bcgl', desc: 'Báo cáo tổng hợp GL' },
      { name: 'khoan_item_in', desc: 'Chi tiết khoản mục đầu vào' },
      { name: 'role_user_gsbh', desc: 'GSBH role assignments' },
      { name: 'dim_date', desc: 'Bảng lịch ngày' },
      { name: 'fes_bobj_ap_v', desc: 'Accounts Payable View' },
      { name: 'kqhdkd', desc: 'Kết quả hoạt động kinh doanh' },
      { name: 'role_user', desc: 'Danh sách người dùng theo role' },
      { name: 'dim_matinh', desc: 'Danh mục mã tỉnh' },
      { name: 'fes_bobj_dept_account', desc: 'Department Account mapping' },
      { name: 'erp_dim_khachhang', desc: 'Danh mục khách hàng' },
      { name: 'fes_fi_02_ar_debt', desc: 'AR Debt report' },
      { name: 'role_admin', desc: 'Admin roles' },
      { name: 'wms_tonkho', desc: 'Tồn kho WMS' },
      { name: 'erp_dim_sanpham', desc: 'Danh mục sản phẩm' },
      { name: 'fi_sub_641', desc: 'Chi tiết phân bổ chi phí 641' },
      { name: 'fi_sub_642', desc: 'Chi tiết phân bổ chi phí 642' },
      { name: 'role_kenh', desc: 'Kênh role assignments' },
      { name: 'etl_log_time', desc: 'ETL execution time logs' },
      { name: 'ke_hoach_thung', desc: 'Kế hoạch thùng' },
      { name: 'fact_donhang', desc: 'Đơn hàng bán' },
      { name: 'fes_baocao_gl', desc: 'GL Báo cáo chi tiết' },
      { name: 'khoan_in', desc: 'Khoản mục đầu vào' },
      { name: 'role_nhan', desc: 'Nhân viên role assignments' },
    ],
  },
]

// ── Wizard steps ────────────────────────────────────────────────────────────
const STEPS = ['Basic Setup & Test', 'Request Details']
const CRON_PRESETS = [
  { label: 'Manual (No Schedule)', value: '' },
  { label: 'Every Minute (* * * * *)', value: '* * * * *' },
  { label: 'Every 5 Minutes (*/5 * * * *)', value: '*/5 * * * *' },
  { label: 'Every 30 Minutes (*/30 * * * *)', value: '*/30 * * * *' },
  { label: 'Every Hour (0 * * * *)', value: '0 * * * *' },
  { label: 'Every Day at Midnight (0 0 * * *)', value: '0 0 * * *' },
  { label: 'Every Sunday (0 0 * * 0)', value: '0 0 * * 0' },
  { label: 'Custom Expression ...', value: 'custom' }
]

const formatCron = (val) => {
  if (!val) return 'No schedule';
  const preset = CRON_PRESETS.find(p => p.value === val);
  if (preset && preset.value !== 'custom') {
    // Extracts "Every 5 Minutes" from "Every 5 Minutes (*/5 * * * *)"
    return preset.label.split(' (')[0];
  }
  return val;
}

function CronInput({ value, onChange }) {
  const isCustom = !CRON_PRESETS.some(p => p.value === value) && value !== '' && value !== 'custom'
  const [mode, setMode] = useState(isCustom ? 'custom' : (value || ''))

  return (
    <div style={{ display: 'flex', gap: 12, flexDirection: 'column' }}>
      <select
        style={S.select}
        value={mode}
        onChange={e => {
          const val = e.target.value
          setMode(val)
          if (val !== 'custom') onChange(val)
        }}
      >
        {CRON_PRESETS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
      </select>

      {mode === 'custom' && (
        <input
          style={{ ...S.input, fontFamily: 'monospace' }}
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder="e.g. 0 12 * * 1-5"
          autoFocus
        />
      )}
    </div>
  )
}

function ConnectorWizard({ initial, onSave, onClose }) {
  const isEdit = !!initial?.id
  const [step, setStep] = useState(0)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState(null)
  const [showSecret, setShowSecret] = useState(false)
  const [error, setError] = useState(null)

  const [form, setForm] = useState({
    name: initial?.name || '',
    display_name: initial?.display_name || '',
    description: initial?.description || '',
    base_url: initial?.base_url || '',
    method: initial?.method || 'GET',
    headers_json: JSON.stringify(initial?.headers_json || {}, null, 2),
    params_json: JSON.stringify(initial?.params_json || {}, null, 2),
    body_json: initial?.body_json ? JSON.stringify(initial.body_json, null, 2) : '',
    data_path: initial?.data_path || '',
    auth_type: initial?.auth_type || 'none',
    auth_creds: initial?.auth_creds || { token: '', header_name: 'X-API-Key', api_key: '', username: '', password: '' },
    sync_schedule: initial?.sync_schedule || '',
  })

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))
  const setCred = (k, v) => setForm(f => ({ ...f, auth_creds: { ...f.auth_creds, [k]: v } }))

  const getParsedForm = () => {
    const payload = { ...form }

    if (!payload.name) {
      if (!payload.display_name?.trim()) throw new Error("Display Name (Tên hiển thị) is required!")
      const base = payload.display_name.trim().toLowerCase().replace(/[^a-z0-9]/g, '_').substring(0, 50)
      const suffix = Math.random().toString(36).substring(2, 6)
      payload.name = `${base}_${suffix}`
    }

    try {
      payload.headers_json = form.headers_json.trim() ? JSON.parse(form.headers_json) : {}
      payload.params_json = form.params_json.trim() ? JSON.parse(form.params_json) : {}
      payload.body_json = form.body_json.trim() ? JSON.parse(form.body_json) : null
    } catch (e) {
      throw new Error(`Invalid JSON syntax in configuration: ${e.message}`)
    }

    return payload
  }

  const handleTest = async () => {
    setTesting(true)
    setTestResult(null)
    setError(null)
    try {
      const payload = getParsedForm()
      const res = await testConnector(payload)
      setTestResult(res)
    } catch (e) {
      setError(e.message)
    } finally {
      setTesting(false)
    }
  }

  const handleSave = async () => {
    setSaving(true)
    setError(null)
    try {
      const payload = getParsedForm()
      if (isEdit) await updateConnector(initial.id, payload)
      else await createConnector(payload)
      onSave()
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  const renderStep0 = () => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24, paddingBottom: 20 }}>
      <div style={{ background: '#1e293b50', border: '1px solid #1e293b', borderRadius: 12, padding: 20 }}>
        <h4 style={{ margin: '0 0 16px 0', color: '#e2e8f0', fontSize: 14, display: 'flex', alignItems: 'center', gap: 8 }}>
          <Zap size={16} color="#3b82f6" /> Essential Identity & Endpoint
        </h4>
        <div style={{ ...S.formGroup }}>
          <label style={S.label}>Display Name *</label>
          <input style={S.input} value={form.display_name} onChange={e => set('display_name', e.target.value)} placeholder="e.g. Github Issues API" />
        </div>
        <div style={{ ...S.formGroup, marginBottom: 0 }}>
          <label style={S.label}>Base URL *</label>
          <input style={S.input} value={form.base_url} onChange={e => set('base_url', e.target.value)} placeholder="https://api.github.com/repos/org/repo/issues" />
        </div>
      </div>

      <div style={{ background: '#1e293b50', border: '1px solid #1e293b', borderRadius: 12, padding: 20 }}>
        <h4 style={{ margin: '0 0 16px 0', color: '#e2e8f0', fontSize: 14, display: 'flex', alignItems: 'center', gap: 8 }}>
          <Shield size={16} color="#10b981" /> Authentication
        </h4>
        <div style={{ ...S.formGroup, marginBottom: form.auth_type !== 'none' ? 16 : 0 }}>
          <label style={S.label}>Auth Type</label>
          <select style={S.select} value={form.auth_type} onChange={e => set('auth_type', e.target.value)}>
            <option value="none">None (Public API)</option>
            <option value="bearer">Bearer Token</option>
            <option value="api_key">API Key Header</option>
            <option value="basic">HTTP Basic Auth</option>
          </select>
        </div>

        {form.auth_type === 'bearer' && (
          <div style={{ ...S.formGroup, marginBottom: 0 }}>
            <label style={S.label}>Bearer Token {isEdit && '(leave empty to keep unchanged)'}</label>
            <div style={{ position: 'relative' }}>
              <input style={{ ...S.input, paddingRight: 40, fontFamily: 'monospace' }}
                type={showSecret ? 'text' : 'password'} value={form.auth_creds.token}
                onChange={e => setCred('token', e.target.value)} placeholder={isEdit ? '••••••••' : 'eyJhbGc...'} />
              <button title="Toggle visibility" onClick={() => setShowSecret(!showSecret)} style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: '#64748b', cursor: 'pointer' }}>
                {showSecret ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>
          </div>
        )}

        {form.auth_type === 'api_key' && (
          <div style={{ ...S.row, marginBottom: 0 }}>
            <div style={{ ...S.formGroup, flex: 1, marginBottom: 0 }}>
              <label style={S.label}>Header Name</label>
              <input style={S.input} value={form.auth_creds.header_name} onChange={e => setCred('header_name', e.target.value)} placeholder="X-API-Key" />
            </div>
            <div style={{ ...S.formGroup, flex: 2, marginBottom: 0 }}>
              <label style={S.label}>API Key {isEdit && '(leave empty to keep unchanged)'}</label>
              <div style={{ position: 'relative' }}>
                <input style={{ ...S.input, paddingRight: 40, fontFamily: 'monospace' }} type={showSecret ? 'text' : 'password'} value={form.auth_creds.api_key} onChange={e => setCred('api_key', e.target.value)} placeholder={isEdit ? '••••••••' : 'sk-live-xxxx'} />
                <button title="Toggle visibility" onClick={() => setShowSecret(!showSecret)} style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: '#64748b', cursor: 'pointer' }}>
                  {showSecret ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
            </div>
          </div>
        )}

        {form.auth_type === 'basic' && (
          <div style={{ ...S.row, marginBottom: 0 }}>
            <div style={{ ...S.formGroup, flex: 1, marginBottom: 0 }}>
              <label style={S.label}>Username</label>
              <input style={S.input} value={form.auth_creds.username} onChange={e => setCred('username', e.target.value)} />
            </div>
            <div style={{ ...S.formGroup, flex: 1, marginBottom: 0 }}>
              <label style={S.label}>Password {isEdit && '(leave empty to keep unchanged)'}</label>
              <input style={{ ...S.input, fontFamily: 'monospace' }} type={showSecret ? 'text' : 'password'} value={form.auth_creds.password} onChange={e => setCred('password', e.target.value)} placeholder={isEdit ? '••••••••' : ''} />
            </div>
          </div>
        )}
      </div>

      <div style={{ textAlign: 'center', paddingTop: 8 }}>
        <button onClick={handleTest} disabled={testing} style={{ ...S.btn('primary'), margin: '0 auto', padding: '10px 24px', fontSize: 13, background: 'rgba(59, 130, 246, 0.1)', color: '#3b82f6', border: '1px solid rgba(59, 130, 246, 0.3)' }}>
          {testing ? <RefreshCw size={14} className="spin" /> : <Play size={14} />}
          {testing ? 'Testing...' : 'Test Config Now'}
        </button>
      </div>

      {testResult && (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
            {testResult.success ? <CheckCircle size={16} color="#10b981" /> : <AlertCircle size={16} color="#ef4444" />}
            <span style={{ fontWeight: 600, fontSize: 13, color: testResult.success ? '#10b981' : '#ef4444' }}>
              {testResult.success ? 'Connection successful!' : 'Connection failed!'}
            </span>
          </div>
          {testResult.data && (
            <div style={{ background: '#0a0f1e', borderRadius: 8, padding: 12, border: '1px solid #1e293b', overflow: 'auto', maxHeight: 200 }}>
              <div style={{ fontSize: 11, color: '#64748b', marginBottom: 8, textTransform: 'uppercase' }}>Preview (3 records):</div>
              <pre style={{ fontSize: 11, color: '#e2e8f0', margin: 0 }}>{JSON.stringify(testResult.data.slice(0, 3), null, 2)}</pre>
            </div>
          )}
        </div>
      )}
    </div>
  )

  const renderStep1 = () => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24, paddingBottom: 20 }}>
      <div style={{ background: '#1e293b50', border: '1px solid #1e293b', borderRadius: 12, padding: 20 }}>
        <h4 style={{ margin: '0 0 16px 0', color: '#e2e8f0', fontSize: 14, display: 'flex', alignItems: 'center', gap: 8 }}>
          <Globe size={16} color="#f59e0b" /> Request Details (Optional)
        </h4>
        <div style={{ ...S.row, alignItems: 'flex-end', marginBottom: 16 }}>
          <div style={{ ...S.formGroup, flex: 1, marginBottom: 0 }}>
            <label style={S.label}>Method</label>
            <select style={S.select} value={form.method} onChange={e => set('method', e.target.value)}>
              <option>GET</option>
              <option>POST</option>
            </select>
          </div>
          <div style={{ ...S.formGroup, flex: 2, marginBottom: 0 }}>
            <label style={S.label}>Data Path (JSONPath to array)</label>
            <input style={S.input} value={form.data_path} onChange={e => set('data_path', e.target.value)} placeholder='e.g. "data" or "results.items" (leave blank if root is array)' />
          </div>
        </div>
        <div style={S.formGroup}>
          <label style={S.label}>Query Params (JSON)</label>
          <textarea style={{ ...S.input, height: 60, fontFamily: 'monospace', fontSize: 12 }} value={form.params_json} onChange={e => set('params_json', e.target.value)} placeholder="{}" />
        </div>
        <div style={S.formGroup}>
          <label style={S.label}>Static Headers (JSON)</label>
          <textarea style={{ ...S.input, height: 60, fontFamily: 'monospace', fontSize: 12 }} value={form.headers_json} onChange={e => set('headers_json', e.target.value)} placeholder="{}" />
        </div>
        {form.method === 'POST' && (
          <div style={S.formGroup}>
            <label style={S.label}>Request Body (JSON)</label>
            <textarea style={{ ...S.input, height: 60, fontFamily: 'monospace', fontSize: 12 }} value={form.body_json} onChange={e => set('body_json', e.target.value)} placeholder="{}" />
          </div>
        )}
      </div>
    </div>
  )

  const steps = [renderStep0, renderStep1]


  return (
    <div style={S.overlay} onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={S.drawer}>
        <div style={S.drawerHeader}>
          <div style={{ fontWeight: 700, fontSize: 16, color: '#e2e8f0', display: 'flex', alignItems: 'center', gap: 8 }}>
            <Zap size={18} color="#818cf8" />
            {isEdit ? 'Edit Connector' : 'Create New Connector'}
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#64748b', cursor: 'pointer' }}>
            <X size={18} />
          </button>
        </div>

        <div style={S.stepIndicator}>
          {STEPS.map((s, i) => (
            <div key={s} style={S.step(i === step, i < step)} onClick={() => i < step && setStep(i)}>
              {i < step ? '✓ ' : ''}{s}
            </div>
          ))}
        </div>

        <div style={S.drawerBody}>
          {steps[step]()}
          {error && (
            <div style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 8, padding: 12, marginTop: 12, color: '#f87171', fontSize: 13 }}>
              {error}
            </div>
          )}
        </div>

        <div style={S.drawerFooter}>
          <button
            style={S.btn('ghost')}
            onClick={() => step > 0 ? setStep(step - 1) : onClose()}
          >
            {step === 0 ? 'Cancel' : 'Back'}
          </button>
          <div style={{ display: 'flex', gap: 10 }}>
            {step === STEPS.length - 1 ? (
              <button style={S.btn('primary')} onClick={handleSave} disabled={saving || (!isEdit && !testResult?.success)}>
                {saving ? <RefreshCw size={14} className="spin" /> : <CheckCircle size={14} />}
                Save Connector
              </button>
            ) : (
              <button style={S.btn('primary')} onClick={() => setStep(step + 1)}>
                Next
                <ChevronRight size={14} />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

export default function ConnectorManager() {
  const [renderError, setRenderError] = useState(null)

  // Outer render wrapper to catch any exceptions
  try {
    return <ConnectorManagerContent onCrash={setRenderError} />
  } catch (e) {
    console.error("CRITICAL RENDER ERROR:", e)
    return (
      <div style={{ padding: 40, background: '#111', color: '#f87171', minHeight: '100vh', fontFamily: 'monospace' }}>
        <h1 style={{ fontSize: 24, marginBottom: 16 }}>⚠️ Critical Render Error (Diagnostic)</h1>
        <p style={{ color: '#94a3b8', marginBottom: 20 }}>Phiên bản build: 1.0.9-DEBUG (06:50)</p>
        <div style={{ background: '#000', padding: 20, borderRadius: 8, border: '1px solid #ef4444', overflow: 'auto' }}>
          {e.message}
          <br /><br />
          {e.stack}
        </div>
        <button onClick={() => window.location.reload()} style={{ marginTop: 20, padding: '10px 20px', background: '#334155', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer' }}>
          Tải lại trang
        </button>
      </div>
    )
  }
}

function ConnectorManagerContent({ onCrash }) {
  const [connectors, setConnectors] = useState([])
  const [loading, setLoading] = useState(false)
  const [search, setSearch] = useState('')
  const [showWizard, setShowWizard] = useState(false)
  const [editTarget, setEditTarget] = useState(null)
  const [deleteConfirm, setDeleteConfirm] = useState(null)
  const [historyTarget, setHistoryTarget] = useState(null)
  const [scheduleTarget, setScheduleTarget] = useState(null)
  const [syncingIds, setSyncingIds] = useState(new Set())
  // Map connectorId→active runId when a sync is genuinely in-progress from Dagster
  const [activeSyncIds, setActiveSyncIds] = useState({})
  const [triggerTarget, setTriggerTarget] = useState(null)  // connector for DownstreamTriggerDrawer
  const [sqlInspectTarget, setSqlInspectTarget] = useState(null)  // connector for Compiled SQL modal
  const [openMenuId, setOpenMenuId] = useState(null)

  // Sample Connector Wizard state
  const [showSampleWizard, setShowSampleWizard] = useState(false)
  const [wizardStep, setWizardStep] = useState(1)
  const [wizardDomain, setWizardDomain] = useState(null)
  const [selectedConnectors, setSelectedConnectors] = useState(new Set())
  const [generateLoading, setGenerateLoading] = useState(false)

  const [toast, setToast] = useState(null)

  const showToast = (type, message) => {
    setToast({ type, message })
    setTimeout(() => setToast(null), 4000)
  }

  function openSampleWizard() {
    setShowSampleWizard(true)
    setWizardStep(1)
    setWizardDomain(null)
    setSelectedConnectors(new Set())
    setGenerateLoading(false)
  }

  function closeConnectorWizard() {
    setShowSampleWizard(false)
    setWizardStep(1)
    setWizardDomain(null)
    setSelectedConnectors(new Set())
    setGenerateLoading(false)
  }

  function handleSelectDomain(domainId) {
    const domain = CONNECTOR_SAMPLE_DOMAINS.find(d => d.id === domainId)
    setWizardDomain(domainId)
    setSelectedConnectors(new Set())
    setWizardStep(2)
  }

  function toggleConnectorSelection(name) {
    setSelectedConnectors(prev => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }

  const executeSampleConnectorGeneration = async () => {
    const domainConfig = CONNECTOR_SAMPLE_DOMAINS.find(d => d.id === wizardDomain)
    const toCreate = (domainConfig?.connectors || []).filter(c => selectedConnectors.has(c.name))
    if (toCreate.length === 0) return

    setGenerateLoading(true)
    try {
      // Fetch dynamic base URL from env configuration via API
      let sampleBaseUrl = 'http://10.5.0.11:8001'
      try {
        const res = await getSampleBaseUrl()
        if (res?.base_url) {
          sampleBaseUrl = res.base_url
        }
      } catch (err) {
        console.warn('Failed to retrieve dynamic sample base URL, falling back to default:', err)
      }

      let successCount = 0
      for (const { name } of toCreate) {
        const apiName = `api_${name}`
        if (!connectors.find(c => c.name === apiName)) {
          await createConnector({
            name: apiName,
            display_name: `API ${name}`,
            description: `Auto-generated connector for ${name}`,
            base_url: `${sampleBaseUrl}/data/${name}`,
            method: 'GET',
            headers_json: {},
            params_json: {},
            body_json: null,
            data_path: 'data',
            auth_type: 'none',
            auth_creds: { token: '', header_name: '', api_key: '', username: '', password: '' },
            sync_schedule: '',
          })
          successCount++
        }
      }
      showToast('success', `Generated ${successCount} sample connector${successCount !== 1 ? 's' : ''}!`)
      closeConnectorWizard()
      load()
    } catch (e) {
      showToast('error', 'Error generating samples: ' + e.message)
      setGenerateLoading(false)
    }
  }

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await listConnectors()
      const list = data.connectors || []
      setConnectors(list)
      // Detect active syncs by checking recent run history for each connector
      const active = {}
      await Promise.allSettled(list.map(async (c) => {
        try {
          const { runs } = await getRunHistory(c.id)
          const running = (runs || []).find(r => ['running', 'queued', 'starting', 'started'].includes(r.status?.toLowerCase()))
          if (running) active[c.id] = running.id
        } catch (_) { }
      }))
      setActiveSyncIds(active)
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  // ── Auto-poll active syncs every 5s until all are done ─────────────────────
  useEffect(() => {
    if (Object.keys(activeSyncIds).length === 0) return
    const interval = setInterval(async () => {
      const updated = { ...activeSyncIds }
      let changed = false
      await Promise.allSettled(Object.entries(activeSyncIds).map(async ([connectorId]) => {
        try {
          const { runs } = await getRunHistory(connectorId, 3)
          const stillRunning = (runs || []).find(r => ['running', 'queued', 'starting', 'started'].includes(r.status?.toLowerCase()))
          if (!stillRunning) {
            delete updated[connectorId]
            changed = true
          }
        } catch (_) { }
      }))
      if (changed) setActiveSyncIds({ ...updated })
    }, 5000)
    return () => clearInterval(interval)
  }, [activeSyncIds])

  const handleToggleOuterList = async (connectorId, triggerId, newEnabledState) => {
    try {
      await updateDownstreamTrigger(connectorId, triggerId, { enabled: newEnabledState })
      setConnectors(prev => prev.map(c => {
        if (c.id === connectorId) {
          return {
            ...c,
            downstream_triggers: c.downstream_triggers.map(t =>
              t.id === triggerId ? { ...t, enabled: newEnabledState } : t
            )
          }
        }
        return c
      }))
      showToast('success', `Trigger was ${newEnabledState ? 'enabled' : 'disabled'} successfully`)
    } catch (e) {
      showToast('error', e.message || 'Failed to toggle trigger')
    }
  }

  // Click outside → close connector dropdown
  useEffect(() => {
    if (!openMenuId) return
    const close = () => setOpenMenuId(null)
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [openMenuId])

  // Auto-open history/trigger modal from URL params (e.g. from Pipeline Studio → Connector back-link)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const highlightId = params.get('highlight')
    const runId = params.get('run')
    const openTarget = params.get('open') // 'triggers' | 'history' | null
    if (!highlightId) return
    // Wait for connectors to load
    if (connectors.length === 0) return
    const match = connectors.find(c => c.id === highlightId || c.id.startsWith(highlightId))
    if (match) {
      if (openTarget === 'triggers') {
        setTriggerTarget(match)
      } else {
        setHistoryTarget({ ...match, _highlightRunId: runId || null })
      }
      // Clean URL
      window.history.replaceState({}, '', window.location.pathname)
    }
  }, [connectors])

  const handleIngest = async (id, name) => {
    if (activeSyncIds[id]) {
      showToast('error', `"${name}" đang sync. Đợi hoặc dừng trước khi chạy mới.`)
      return
    }
    setSyncingIds(prev => new Set(prev).add(id))
    try {
      const res = await triggerIngest(id)
      showToast('success', `Queued in Dagster for: ${name}`)
      // Mark as actively syncing with a placeholder ID (will be confirmed on next load)
      if (res?.dagster_run_id) setActiveSyncIds(prev => ({ ...prev, [id]: res.dagster_run_id }))
    } catch (e) {
      if (e.status === 409) {
        showToast('error', `"${name}" đang sync rồi!`)
        load()
      } else {
        showToast('error', 'Error: ' + e.message)
      }
    } finally {
      setSyncingIds(prev => { const n = new Set(prev); n.delete(id); return n })
    }
  }

  const handleToggleSchedule = async (c, active) => {
    // Update local state optimistic UI
    setConnectors(prev => prev.map(item => item.id === c.id ? { ...item, schedule_enabled: active } : item))
    try {
      await updateConnector(c.id, { schedule_enabled: active })
      showToast('success', `${active ? 'Enabled' : 'Disabled'} schedule for ${c.name}`)
    } catch (e) {
      showToast('error', 'Failed to update schedule status: ' + e.message)
      load() // Revert on failure
    }
  }

  const handleToggleMasterStatus = async (c) => {
    const newStatus = c.status === 'active' ? 'inactive' : 'active'
    setConnectors(prev => prev.map(item => item.id === c.id ? { ...item, status: newStatus } : item))
    try {
      await updateConnector(c.id, { status: newStatus })
      showToast('success', `Connector ${c.name} is now ${newStatus.toUpperCase()}`)
    } catch (e) {
      showToast('error', 'Failed to update master status: ' + e.message)
      load()
    }
  }

  const handleDelete = async (id) => {
    try {
      await deleteConnector(id)
      setDeleteConfirm(null)
      showToast('success', 'Connector deleted successfully')
      load()
    } catch (e) {
      showToast('error', 'Error: ' + e.message)
    }
  }

  const handleForceUnlock = async (c) => {
    const isConfirmed = window.confirm(
      `⚠️ CẢNH BÁO QUAN TRỌNG:\n\n` +
      `Hành động này sẽ giải phóng khóa chạy (concurrent lock) của REST Connector "${c.display_name || c.name}" ` +
      `bằng cách đánh dấu các lượt sync đang chạy là THẤT BẠI.\n\n` +
      `Chỉ thực hiện hành động này nếu tiến trình Dagster tương ứng đã thực sự bị crash hoặc treo cứng.\n` +
      `Nếu admin cố tình Force Unlock khi job Dagster vẫn đang chạy thực tế, điều này có thể dẫn tới việc ghi đè/nhiễu dữ liệu Bronze.\n\n` +
      `Bạn có chắc chắn muốn thực hiện Force Unlock không?`
    )
    if (!isConfirmed) return

    try {
      const res = await forceUnlockConnector(c.id)
      showToast('success', `Connector unlocked successfully! Released ${res.unlocked_runs} stuck runs.`)
      load()
    } catch (e) {
      showToast('error', 'Failed to unlock connector: ' + e.message)
    }
  }

  const visible = (connectors || [])
    .filter(c => {
      if (!c) return false;
      const n = (c.name || '').toLowerCase();
      const d = (c.display_name || '').toLowerCase();
      const s = (search || '').toLowerCase();
      return n.includes(s) || d.includes(s);
    })
    .sort((a, b) => new Date(b.updated_at || b.created_at || 0) - new Date(a.updated_at || a.created_at || 0))

  const stats = {
    total: (connectors || []).length,
    active: (connectors || []).filter(c => c?.status === 'active').length,
    scheduled: (connectors || []).filter(c => c?.schedule_enabled).length,
    triggered: (connectors || []).filter(c => (c?.downstream_trigger_count || 0) > 0).length,
    error: (connectors || []).filter(c => c?.status === 'error').length,
  }

  return (
    <div style={{ ...S.page, padding: '32px' }}>
      <div style={S.header}>
        <div style={{ ...S.title, fontSize: 26 }}>
          <div style={{ background: 'rgba(129,140,248,0.15)', padding: 12, borderRadius: 16, display: 'flex', boxShadow: '0 0 20px rgba(129,140,248,0.2)' }}><Plug size={28} color="#818cf8" /></div>
          Connector Manager
          <span style={{ fontSize: 10, color: '#475569', marginLeft: 12, fontWeight: 500, letterSpacing: 1 }}>v1.0.9-STABLE</span>
        </div>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <div style={{ position: 'relative' }}>
            <Search size={15} color="#64748b" style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)' }} />
            <input placeholder="Search connector..." value={search} onChange={e => setSearch(e.target.value)} style={{ ...S.input, paddingLeft: 40, width: 280, background: 'rgba(0,0,0,0.3)', height: 44, borderRadius: 12 }} />
          </div>
          <button style={{ ...S.btn('ghost'), width: 44, height: 44, padding: 0, justifyContent: 'center' }} onClick={load} disabled={loading} title="Refresh">
            <RefreshCw size={18} className={loading ? "spin" : ""} />
          </button>
          <button style={{ ...S.btn('secondary'), height: 44, padding: '0 24px', borderRadius: 12, background: 'rgba(99,102,241,0.1)', color: '#818cf8', border: '1px solid rgba(99,102,241,0.3)' }} onClick={openSampleWizard} disabled={loading}>
            <Zap size={18} /> Generate Samples
          </button>
          <button id="btn-create-connector" style={{ ...S.btn('primary'), height: 44, padding: '0 24px', borderRadius: 12 }} onClick={() => { setEditTarget(null); setShowWizard(true) }}>
            <Plus size={18} /> Create New Connector
          </button>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 20, marginBottom: 36 }}>
        <SummaryCard icon={Database} label="TOTAL CONNECTORS" value={stats.total} colorClass="purple" />
        <SummaryCard icon={CheckCircle} label="ACTIVE" value={stats.active} colorClass="green" sub="Stable connectors" />
        <SummaryCard icon={Calendar} label="SCHEDULED" value={stats.scheduled} colorClass="cyan" sub="Auto-sync enabled" />
        <SummaryCard icon={GitMerge} label="TRIGGERED" value={stats.triggered} colorClass="amber" sub="Has pipeline trigger" />
        <SummaryCard icon={AlertCircle} label="HAS ERRORS" value={stats.error} colorClass="red" highlight={stats.error > 0} sub={stats.error > 0 ? "Review needed" : "No errors"} />
      </div>

      <div style={S.card}>
        {visible.length === 0 && !loading ? (
          <div style={{ textAlign: 'center', padding: '60px 20px' }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>🔌</div>
            <h3 style={{ fontSize: 18, color: '#e2e8f0', marginBottom: 8 }}>No connectors yet</h3>
            <p style={{ color: '#64748b', fontSize: 14, marginBottom: 20 }}>Create your first connector to start extracting data from REST APIs.</p>
            <button style={{ ...S.btn('primary'), margin: '0 auto' }} onClick={() => setShowWizard(true)}>
              <Plus size={14} /> Create Connector
            </button>
          </div>
        ) : (
          <table style={S.table}>
            <thead>
              <tr style={{ background: 'rgba(0,0,0,0.3)' }}>
                {[
                  { h: '', width: 50, align: 'center' },
                  { h: 'Connector Name', width: '25%', align: 'left' },
                  { h: 'Endpoint', width: '18%', align: 'left' },
                  { h: 'Auth', width: '8%', align: 'center' },
                  { h: 'Schedule', width: '17%', align: 'left' },
                  { h: 'Status', width: '10%', align: 'center' },
                  { h: 'Triggers', width: '10%', align: 'center' },
                  { h: 'Last Updated', width: '12%', align: 'left' },
                  { h: 'Actions', align: 'right' }
                ].map(col => (
                  <th key={col.h} style={{ ...S.th, padding: col.h === '' ? '16px 12px' : '16px 20px', fontSize: 12, width: col.width, textAlign: col.align }}>{col.h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visible.map(c => (
                <tr key={c.id} style={{ transition: 'background 0.2s', position: openMenuId === c.id ? 'relative' : 'static', zIndex: openMenuId === c.id ? 99 : 1 }} onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.02)'} onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                  <td style={{ ...S.td, padding: '16px 12px', width: 40 }}>
                    <div style={{ display: 'flex', justifyContent: 'center' }} title={c.status === 'active' ? "Tắt Connector (Master Switch)" : "Bật Connector"}>
                      <Toggle active={c.status === 'active'} onChange={() => handleToggleMasterStatus(c)} activeColor="#6366f1" />
                    </div>
                  </td>
                  <td style={S.td}>
                    <div style={{ fontWeight: 700, color: '#f1f5f9', fontSize: 14 }}>{c.display_name || c.name}</div>
                    <div style={{ fontSize: 11, color: '#64748b', marginTop: 2, fontFamily: 'monospace' }}>{c.name}</div>
                  </td>
                  <td style={S.td}>
                    <div style={{ fontSize: 12, color: '#94a3b8', maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', background: 'rgba(0,0,0,0.2)', padding: '4px 8px', borderRadius: 6, display: 'inline-block' }}>
                      {(c.base_url || '').replace(/^https?:\/\//i, '')}
                    </div>
                  </td>
                  <td style={{ ...S.td, textAlign: 'center' }}>
                    <div style={{ display: 'flex', justifyContent: 'center' }}>
                      <AuthBadge type={c.auth_type} />
                    </div>
                  </td>
                  <td style={S.td}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-start', gap: 12 }}>
                      <div title={!c.sync_schedule ? "Chưa có cấu hình lịch chạy" : c.schedule_enabled ? "Tắt tự động" : "Bật tự động"}>
                        <Toggle
                          active={c.schedule_enabled && !!c.sync_schedule}
                          onChange={(val) => handleToggleSchedule(c, val)}
                          disabled={c.status === 'inactive' || !c.sync_schedule}
                        />
                      </div>
                      {c.sync_schedule ? (
                        <span style={{ fontSize: 13, color: c.status === 'inactive' ? '#64748b' : '#cbd5e1' }}>
                          {formatCron(c.sync_schedule)}
                        </span>
                      ) : (
                        <span style={{ fontSize: 13, color: '#64748b' }}>None</span>
                      )}
                    </div>
                  </td>
                  <td style={{ ...S.td, textAlign: 'center' }}>
                    <div style={{ display: 'flex', justifyContent: 'center' }}>
                      <StatusBadge status={c.status} />
                    </div>
                  </td>
                  <td style={{ ...S.td, textAlign: 'center' }}>
                    <div
                      onClick={() => setTriggerTarget(c)}
                      style={{ display: 'flex', justifyContent: 'center', gap: 6, alignItems: 'center', cursor: 'pointer', opacity: 0.9 }}
                      onMouseEnter={e => e.currentTarget.style.opacity = 1}
                      onMouseLeave={e => e.currentTarget.style.opacity = 0.9}
                      title={c.downstream_triggers && c.downstream_triggers.length > 0 ? c.downstream_triggers.map(t => t.pipeline_name).join('\n') : 'Manage Triggers'}
                    >
                      {c.downstream_trigger_count > 0 ? (
                        <span style={{ fontSize: 11, padding: '4px 12px', borderRadius: 20, background: 'rgba(251,191,36,0.1)', color: '#fbbf24', border: '1px solid rgba(251,191,36,0.3)', fontWeight: 700, transition: 'all 0.2s', boxShadow: '0 0 10px rgba(251,191,36,0.1)' }}>
                          {c.downstream_trigger_count === 1 ? '1 PIPELINE' : `${c.downstream_trigger_count} PIPELINES`}
                        </span>
                      ) : (
                        <span style={{ fontSize: 11, color: '#64748b' }}>None</span>
                      )}
                    </div>
                  </td>
                  <td style={{ ...S.td, textAlign: 'left' }}>
                    <div style={{ fontSize: 12, whiteSpace: 'nowrap' }}>{c.updated_at ? new Date(c.updated_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : <span style={{ color: '#64748b' }}>—</span>}</div>
                  </td>
                  <td style={{ ...S.td, textAlign: 'right' }}>
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center', justifyContent: 'flex-end', position: 'relative' }}>
                      {/* Sync / Syncing button */}
                      {activeSyncIds[c.id] || syncingIds.has(c.id) ? (
                        <button
                          style={{
                            ...S.btn('ghost'), padding: '6px 10px', height: 32,
                            color: '#f87171', borderColor: 'rgba(248,113,113,0.4)',
                            background: 'rgba(248,113,113,0.08)',
                          }}
                          onClick={() => {
                            showToast('info', `Connector "${c.display_name || c.name}" đang sync. Vào History để theo dõi.`)
                          }}
                          title="Đang sync — vào History để dừng nếu cần"
                        >
                          <RefreshCw size={12} className="spin" /> Syncing...
                        </button>
                      ) : (
                        <button
                          style={{ ...S.btn('ghost'), padding: '6px 10px', color: '#10b981', borderColor: 'rgba(16,185,129,0.3)', opacity: c.status === 'inactive' ? 0.5 : 1, height: 32 }}
                          onClick={() => c.status !== 'inactive' && handleIngest(c.id, c.display_name || c.name)}
                          disabled={c.status === 'inactive'}
                          title="Run sync now"
                        >
                          <RefreshCw size={12} /> Sync
                        </button>
                      )}

                      {/* History */}
                      <button
                        style={{ ...S.btn('ghost'), padding: '6px 10px', height: 32, color: '#60a5fa', borderColor: 'rgba(96,165,250,0.3)' }}
                        onClick={() => setHistoryTarget(c)}
                        title="View run history"
                      >
                        <History size={12} /> History
                      </button>

                      {/* ⋯ Menu */}
                      <div style={{ position: 'relative' }}>
                        <button
                          style={{ ...S.btn('ghost'), padding: '6px', height: 32, aspectRatio: '1/1', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                          onClick={e => { e.stopPropagation(); setOpenMenuId(openMenuId === c.id ? null : c.id) }}
                        >
                          <MoreVertical size={16} color="#94a3b8" />
                        </button>

                        {openMenuId === c.id && (() => {
                          const rowIndex = visible.findIndex(x => x.id === c.id)
                          const isNearBottom = rowIndex >= visible.length - 2
                          return (
                            <div
                              onMouseDown={e => e.stopPropagation()}
                              style={{
                                position: 'absolute', right: 0,
                                ...(isNearBottom ? { bottom: '100%', marginBottom: 8 } : { top: '100%', marginTop: 8 }),
                                background: '#1e293b', border: '1px solid #334155', borderRadius: 10,
                                padding: 6, minWidth: 180, zIndex: 1000,
                                boxShadow: '0 12px 30px rgba(0,0,0,0.6)',
                                display: 'flex', flexDirection: 'column', gap: 2,
                              }}
                            >
                              <button
                                style={{ ...S.btn('ghost'), width: '100%', justifyContent: 'flex-start', color: '#c084fc', border: 'none', opacity: c.status === 'inactive' ? 0.5 : 1, height: 34 }}
                                onClick={() => { if (c.status !== 'inactive') { setScheduleTarget(c); setOpenMenuId(null) } }}
                                disabled={c.status === 'inactive'}
                              >
                                <Calendar size={14} style={{ marginRight: 8 }} /> Schedule
                              </button>
                              <button
                                style={{ ...S.btn('ghost'), width: '100%', justifyContent: 'flex-start', color: '#22d3ee', border: 'none', height: 34 }}
                                onClick={() => { setTriggerTarget(c); setOpenMenuId(null) }}
                              >
                                <GitBranch size={14} style={{ marginRight: 8 }} /> Triggers
                              </button>
                              <button
                                style={{ ...S.btn('ghost'), width: '100%', justifyContent: 'flex-start', color: '#fb923c', border: 'none', height: 34 }}
                                onClick={() => { setSqlInspectTarget(c); setOpenMenuId(null) }}
                              >
                                <FileCode size={14} style={{ marginRight: 8 }} /> Compiled SQL
                              </button>
                              <button
                                style={{ ...S.btn('ghost'), width: '100%', justifyContent: 'flex-start', color: '#f1f5f9', border: 'none', height: 34 }}
                                onClick={() => { setEditTarget(c); setShowWizard(true); setOpenMenuId(null) }}
                              >
                                <Edit3 size={14} style={{ marginRight: 8 }} /> Edit
                              </button>
                              <button
                                style={{ ...S.btn('ghost'), width: '100%', justifyContent: 'flex-start', color: '#f43f5e', border: 'none', height: 34 }}
                                onClick={() => { handleForceUnlock(c); setOpenMenuId(null) }}
                                title="Force release connector lock and mark stuck runs as failed"
                              >
                                <Unlock size={14} style={{ marginRight: 8 }} /> Force Unlock
                              </button>
                              <div style={{ height: 1, background: '#334155', margin: '3px 4px' }} />
                              <button
                                style={{ ...S.btn('ghost'), width: '100%', justifyContent: 'flex-start', color: '#ef4444', border: 'none', height: 34 }}
                                onClick={() => { setDeleteConfirm(c); setOpenMenuId(null) }}
                              >
                                <Trash2 size={14} style={{ marginRight: 8 }} /> Delete
                              </button>
                            </div>
                          )
                        })()}
                      </div>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {showWizard && (
        <ConnectorWizard
          initial={editTarget}
          onSave={() => { setShowWizard(false); load() }}
          onClose={() => setShowWizard(false)}
        />
      )}

      {deleteConfirm && (
        <div style={S.overlay} onClick={() => setDeleteConfirm(null)}>
          <div style={{ ...S.card, padding: 24, maxWidth: 400, width: '90%' }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
              <div style={{ background: 'rgba(239,68,68,0.1)', padding: 12, borderRadius: 12 }}>
                <Trash2 size={24} color="#ef4444" />
              </div>
              <div>
                <h3 style={{ fontSize: 18, color: '#e2e8f0', margin: 0 }}>Confirm Deletion</h3>
                <p style={{ color: '#64748b', fontSize: 13, margin: '4px 0 0' }}>Delete connector <strong style={{ color: '#f87171' }}>{deleteConfirm.display_name || deleteConfirm.name}</strong>?</p>
              </div>
            </div>
            <p style={{ fontSize: 13, color: '#94a3b8', background: 'rgba(0,0,0,0.2)', padding: 12, borderRadius: 8, marginBottom: 24 }}>This action cannot be undone. Running syncs will be aborted.</p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12 }}>
              <button style={S.btn('ghost')} onClick={() => setDeleteConfirm(null)}>Cancel</button>
              <button style={S.btn('danger')} onClick={() => handleDelete(deleteConfirm.id)}>
                <Trash2 size={14} /> Confirm Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* History Modal */}
      {historyTarget && (
        <ConnectorHistoryModal
          connector={historyTarget}
          highlightRunId={historyTarget._highlightRunId}
          onClose={() => setHistoryTarget(null)}
        />
      )}

      {/* Downstream Trigger Drawer */}
      {triggerTarget && (
        <DownstreamTriggerDrawer
          connector={triggerTarget}
          onClose={() => setTriggerTarget(null)}
          onChange={load}
          showToast={showToast}
        />
      )}

      {/* Schedule Modal */}
      {scheduleTarget && (
        <ConnectorScheduleModal
          connector={scheduleTarget}
          onClose={() => setScheduleTarget(null)}
          onSave={() => { setScheduleTarget(null); load(); showToast('success', 'Schedule updated successfully') }}
          onError={(m) => showToast('error', m)}
        />
      )}

      {/* Compiled SQL Modal — Config Inspector + WAP Plan */}
      {sqlInspectTarget && (
        <ConnectorSQLModal
          connector={sqlInspectTarget}
          onClose={() => setSqlInspectTarget(null)}
        />
      )}

      {/* ── Sample Connector Wizard Modal ── */}
      {showSampleWizard && (() => {
        const selectedDomainConfig = CONNECTOR_SAMPLE_DOMAINS.find(d => d.id === wizardDomain) || null
        const availableConnectors = selectedDomainConfig?.connectors || []
        const allSelected = availableConnectors.length > 0 && selectedConnectors.size === availableConnectors.length
        return (
          <div style={S.overlay} onClick={e => e.target === e.currentTarget && closeConnectorWizard()}>
            <div style={{ ...S.drawer, maxWidth: 600 }}>
              <div style={S.drawerHeader}>
                <div style={{ fontWeight: 700, fontSize: 16, color: '#e2e8f0', display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Zap size={18} color="#facc15" /> Generate Sample Connectors
                </div>
                <button onClick={closeConnectorWizard} style={{ background: 'none', border: 'none', color: '#64748b', cursor: 'pointer' }}>✕</button>
              </div>
              <div style={S.drawerBody}>
                <div style={S.breadcrumb}>
                  <span style={wizardStep >= 1 ? { color: '#e2e8f0' } : {}}>Domain</span>
                  <ChevronRight size={12} />
                  <span style={wizardStep >= 2 ? { color: '#e2e8f0' } : { opacity: 0.4 }}>Confirm</span>
                </div>

                {wizardStep === 1 && (
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 12 }}>
                    {CONNECTOR_SAMPLE_DOMAINS.map((domain) => (
                      <div
                        key={domain.id}
                        onClick={() => handleSelectDomain(domain.id)}
                        style={S.wizardLayerCard(false, false)}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                          <div>
                            <div style={{ fontSize: 16, fontWeight: 700, color: '#e2e8f0' }}>{domain.icon && `${domain.icon} `}{domain.label}</div>
                            <div style={{ fontSize: 12, color: '#64748b', marginTop: 6 }}>{domain.desc}</div>
                            <div style={{ fontSize: 11, color: '#475569', marginTop: 4 }}>{domain.connectors.length} connectors</div>
                          </div>
                          <ChevronRight size={16} color="#94a3b8" />
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {wizardStep === 2 && selectedDomainConfig && (
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                      <div style={{ fontSize: 12, color: '#94a3b8' }}>{availableConnectors.length} connectors available</div>
                      <button
                        onClick={() => {
                          if (allSelected) setSelectedConnectors(new Set())
                          else setSelectedConnectors(new Set(availableConnectors.map(c => c.name)))
                        }}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#818cf8', fontSize: 12 }}
                      >
                        {allSelected ? 'Deselect All' : 'Select All'}
                      </button>
                    </div>
                    <div style={{ border: '1px solid #1e293b', borderRadius: 10, padding: '0 14px', maxHeight: 340, overflowY: 'auto' }}>
                      {availableConnectors.map(c => (
                        <div key={c.name} style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '12px 0', borderBottom: '1px solid #1e293b' }}>
                          <input
                            type="checkbox"
                            checked={selectedConnectors.has(c.name)}
                            onChange={() => toggleConnectorSelection(c.name)}
                            style={{ marginTop: 2, accentColor: '#6366f1', width: 15, height: 15, cursor: 'pointer' }}
                          />
                          <div>
                            <div style={{ fontSize: 13, fontWeight: 600, color: '#e2e8f0' }}>api_{c.name}</div>
                            <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>{c.desc}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              <div style={S.drawerFooter}>
                <div>
                  {wizardStep > 1 && (
                    <button
                      style={S.btn('ghost')}
                      onClick={() => { setWizardStep(1); setWizardDomain(null); setSelectedConnectors(new Set()) }}
                    >
                      ← Back
                    </button>
                  )}
                </div>
                <div style={{ display: 'flex', gap: 10 }}>
                  <button style={S.btn('ghost')} onClick={closeConnectorWizard}>Cancel</button>
                  {wizardStep === 2 && (
                    <button
                      style={S.btn('primary')}
                      onClick={executeSampleConnectorGeneration}
                      disabled={generateLoading || selectedConnectors.size === 0}
                    >
                      {generateLoading ? <RefreshCw size={13} className="spin" /> : <Zap size={13} />}
                      {`Generate ${selectedConnectors.size} Connector${selectedConnectors.size !== 1 ? 's' : ''}`}
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        )
      })()}


      {/* Toast Notification */}
      {toast && (
        <div style={{
          position: 'fixed', bottom: 32, right: 32, zIndex: 9999,
          background: toast.type === 'error' ? '#ef4444' : '#10b981',
          color: '#fff', padding: '12px 24px', borderRadius: 12,
          boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
          display: 'flex', alignItems: 'center', gap: 10,
          fontWeight: 600, fontSize: 14,
          animation: 'slideInRight 0.3s ease-out'
        }}>
          {toast.type === 'error' ? <AlertCircle size={18} /> : <CheckCircle size={18} />}
          {toast.message}
        </div>
      )}
      <style>{`
        @keyframes slideInRight {
          from { transform: translateX(100%); opacity: 0; }
          to { transform: translateX(0); opacity: 1; }
        }
      `}</style>
    </div>
  )
}

function ConnectorScheduleModal({ connector, onClose, onSave, onError }) {
  const [cron, setCron] = useState(connector.sync_schedule || '')
  const [saving, setSaving] = useState(false)

  const handleSave = async () => {
    setSaving(true)
    try {
      await updateSchedule(connector.id, cron || null)
      onSave()
    } catch (e) {
      onError('Failed to update schedule: ' + e.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={S.overlay} onClick={onClose}>
      <div style={{ ...S.card, padding: 24, maxWidth: 450, width: '90%' }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
          <div style={{ background: 'rgba(192,132,252,0.1)', padding: 12, borderRadius: 12 }}>
            <Calendar size={24} color="#c084fc" />
          </div>
          <div>
            <h3 style={{ fontSize: 18, color: '#e2e8f0', margin: 0 }}>Sync Schedule</h3>
            <p style={{ color: '#64748b', fontSize: 13, margin: '4px 0 0' }}>Connector: <strong style={{ color: '#c084fc' }}>{connector.display_name || connector.name}</strong></p>
          </div>
        </div>

        <div style={{ marginBottom: 24 }}>
          <label style={S.label}>Cron Expression</label>
          <CronInput value={cron} onChange={setCron} />
          <p style={{ fontSize: 12, color: '#64748b', marginTop: 12 }}>If "Manual" is selected, the connector will only run when explicitly triggered.</p>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12 }}>
          <button style={S.btn('ghost')} onClick={onClose} disabled={saving}>Cancel</button>
          <button style={S.btn('primary')} onClick={handleSave} disabled={saving}>
            {saving ? <RefreshCw size={14} className="spin" /> : <Save size={14} />} Save Schedule
          </button>
        </div>
      </div>
    </div>
  )
}

function ConnectorHistoryModal({ connector, highlightRunId, onClose }) {
  const [runs, setRuns] = useState([])
  const [loading, setLoading] = useState(false)
  const [autoReload, setAutoReload] = useState(false)

  // Inline component to fetch Dagster error detail
  const ErrorLogInline = ({ runId, fallback }) => {
    const [log, setLog] = useState(null)
    const [loadingLog, setLoadingLog] = useState(false)

    useEffect(() => {
      let cancelled = false
      async function fetchLog() {
        setLoadingLog(true)
        try {
          const data = await getDagsterRunErrorLog(runId)
          if (!cancelled) setLog(data.error_message || fallback)
        } catch {
          if (!cancelled) setLog('Could not fetch error log from Dagster.')
        }
        if (!cancelled) setLoadingLog(false)
      }
      fetchLog()
      return () => { cancelled = true }
    }, [runId, fallback])

    return (
      <div style={{
        background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)',
        padding: 8, borderRadius: 6, color: '#f87171', fontSize: 11, fontFamily: 'monospace',
        maxHeight: 120, overflowY: 'auto'
      }}>
        {loadingLog ? (
          <span style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#fca5a5' }}>
            <RefreshCw size={12} className="spin" /> Fetching run logs...
          </span>
        ) : (
          log || fallback
        )}
      </div>
    )
  }


  const loadData = async (showLoading = true) => {
    if (showLoading) setLoading(true)
    try {
      const data = await getRunHistory(connector.id, 20)
      const sorted = (data.runs || []).sort((a, b) => new Date(b.created_at || b.started_at || 0) - new Date(a.created_at || a.started_at || 0))
      setRuns(sorted)
    } catch (e) {
      console.error("Lỗi getRunHistory:", e)
    } finally {
      if (showLoading) setLoading(false)
    }
  }

  useEffect(() => {
    loadData(true)
  }, [connector.id])

  useEffect(() => {
    let interval;
    if (autoReload) {
      interval = setInterval(() => loadData(false), 5000)
    }
    return () => clearInterval(interval)
  }, [autoReload, connector.id])

  return (
    <div style={S.overlay} onClick={onClose}>
      <div style={{ ...S.card, padding: 24, maxWidth: 1100, width: '95%', maxHeight: '80vh', display: 'flex', flexDirection: 'column' }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <h2 style={{ fontSize: 20, margin: 0, color: '#f1f5f9', display: 'flex', gap: 10, alignItems: 'center' }}>
            <Activity size={24} color="#818cf8" /> Run History: {connector.name}
          </h2>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <button
              onClick={() => setAutoReload(!autoReload)}
              style={{ ...S.btn(autoReload ? 'primary' : 'ghost'), padding: '6px 12px', fontSize: 12 }}
            >
              <RefreshCw size={14} className={autoReload ? "spin" : ""} style={{ marginRight: 6 }} />
              Auto Reload
            </button>
            <button onClick={() => loadData(true)} style={{ background: 'transparent', border: 'none', color: '#818cf8', cursor: 'pointer', display: 'flex', alignItems: 'center' }} title="Manual Refresh">
              <RefreshCw size={20} className={loading && !autoReload ? 'spin' : ''} />
            </button>
            <div style={{ width: 1, height: 24, background: 'rgba(255,255,255,0.1)' }} />
            <button style={{ background: 'transparent', border: 'none', color: '#64748b', cursor: 'pointer', display: 'flex', alignItems: 'center' }} onClick={onClose}><X size={24} /></button>
          </div>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', background: 'rgba(0,0,0,0.2)', borderRadius: 12, border: '1px solid rgba(255,255,255,0.05)' }}>
          {loading ? (
            <div style={{ padding: 40, textAlign: 'center', color: '#94a3b8' }}><RefreshCw size={24} className="spin" /> Loading...</div>
          ) : runs.length === 0 ? (
            <div style={{ padding: 40, textAlign: 'center', color: '#64748b' }}>No runs recorded yet.</div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
              <thead>
                <tr style={{ background: 'rgba(0,0,0,0.3)', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
                  <th style={{ padding: '12px 16px', color: '#94a3b8', fontWeight: 600, fontSize: 12 }}>Started At</th>
                  <th style={{ padding: '12px 16px', color: '#94a3b8', fontWeight: 600, fontSize: 12 }}>Run ID</th>
                  <th style={{ padding: '12px 16px', color: '#94a3b8', fontWeight: 600, fontSize: 12 }}>Run Method</th>
                  <th style={{ padding: '12px 16px', color: '#94a3b8', fontWeight: 600, fontSize: 12 }}>Trigger</th>
                  <th style={{ padding: '12px 16px', color: '#94a3b8', fontWeight: 600, fontSize: 12 }}>Message / Log</th>
                  <th style={{ padding: '12px 16px', color: '#94a3b8', fontWeight: 600, fontSize: 12 }}>Duration (s)</th>
                  <th style={{ padding: '12px 16px', color: '#94a3b8', fontWeight: 600, fontSize: 12 }}>Status</th>
                </tr>
              </thead>
              <tbody>
                {runs.map(r => {
                  const isHighlighted = highlightRunId && (r.id === highlightRunId || r.id?.startsWith(highlightRunId))
                  const pipelineCount = r.downstream_pipeline_run_ids?.length || 0
                  const firstPipelineRun = pipelineCount > 0 ? r.downstream_pipeline_run_ids[0] : null

                  return (
                    <tr key={r.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.07)', background: isHighlighted ? 'rgba(251,191,36,0.08)' : 'transparent', boxShadow: isHighlighted ? 'inset 0 0 0 1px rgba(251,191,36,0.35)' : 'none', transition: 'all 0.2s' }}>
                      <td style={{ padding: '12px 16px', fontSize: 13, color: '#f1f5f9', whiteSpace: 'nowrap' }}>
                        {r.started_at ? new Date(r.started_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' }) : <span style={{ color: '#94a3b8' }}>Pending...</span>}
                      </td>
                      <td style={{ padding: '12px 16px', fontSize: 12 }}>
                        {r.id && (
                          <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: '#6366f1', background: 'rgba(99,102,241,0.1)', padding: '2px 8px', borderRadius: 5 }}>
                            {(r.id || '').slice(0, 8)}
                          </span>
                        )}
                      </td>

                      <td style={{ padding: '12px 16px', fontSize: 12 }}>
                        <span style={{
                          padding: '3px 9px', borderRadius: 4,
                          textTransform: 'uppercase', fontWeight: 600, fontSize: 12,
                          display: 'inline-flex', alignItems: 'center', gap: 4,
                          ...(r.triggered_by === 'schedule' || r.triggered_by === 'sensor'
                            ? { color: '#c084fc', background: 'rgba(192,132,252,0.1)', border: '1px solid rgba(192,132,252,0.25)' }
                            : { color: '#94a3b8', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)' }
                          )
                        }}>
                          {(r.triggered_by === 'schedule' || r.triggered_by === 'sensor') ? <><Clock size={11} /> Schedule</> : 'Manual'}
                        </span>
                      </td>
                      <td style={{ padding: '12px 16px', fontSize: 12 }}>
                        {pipelineCount > 0 ? (
                          <Link
                            to={`/pipelines/${firstPipelineRun.pipeline_id}?tab=history&highlight=${firstPipelineRun.pipeline_run_id}`}
                            title={r.downstream_pipeline_run_ids.map(pRun => pRun.pipeline_name).join('\n')}
                            style={{
                              color: '#34d399', fontSize: 11, display: 'inline-flex', alignItems: 'center', gap: 5,
                              textDecoration: 'none', background: 'rgba(52,211,153,0.1)',
                              padding: '4px 10px', borderRadius: 6, border: '1px solid rgba(52,211,153,0.3)',
                              fontWeight: 700, transition: 'all 0.15s', whiteSpace: 'nowrap'
                            }}
                            onMouseEnter={e => { e.currentTarget.style.background = 'rgba(52,211,153,0.2)'; e.currentTarget.style.boxShadow = '0 0 8px rgba(52,211,153,0.3)' }}
                            onMouseLeave={e => { e.currentTarget.style.background = 'rgba(52,211,153,0.1)'; e.currentTarget.style.boxShadow = 'none' }}
                          >
                            <GitBranch size={11} />
                            {pipelineCount === 1 ? 'PIPELINE' : `${pipelineCount} PIPELINE`}
                          </Link>
                        ) : (
                          <span style={{ fontSize: 11, color: '#475569', fontStyle: 'italic' }}>None</span>
                        )}
                      </td>
                      <td style={{ padding: '12px 16px', fontSize: 13, color: '#f1f5f9' }}>
                        {(r.status === 'failed' || r.status === 'failure') ? (
                          <ErrorLogInline runId={r.id} fallback={r.error_message || 'See Dagster UI for detailed error logs.'} />
                        ) : r.status === 'success' ? (
                          <span style={{ color: '#34d399' }}>Sync complete (Managed by Dagster)</span>
                        ) : (
                          <span style={{ color: '#94a3b8' }}>Sync in progress...</span>
                        )}
                      </td>
                      <td style={{ padding: '12px 16px', fontSize: 13, color: '#cbd5e1' }}>{r.duration_s != null ? `${r.duration_s.toFixed(1)}` : 'N/A'}</td>
                      <td style={{ padding: '12px 16px', fontSize: 13 }}><StatusBadge status={r.status} /></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  )
}

// ── DownstreamTriggerDrawer ────────────────────────────────────────────────────
// Full CRUD UI for connector → pipeline downstream trigger links
function DownstreamTriggerDrawer({ connector, onClose, onChange, showToast }) {
  const [triggers, setTriggers] = useState([])
  const [allPipelines, setAllPipelines] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [togglingId, setTogglingId] = useState(null)
  const [removingId, setRemovingId] = useState(null)

  // New trigger form state
  const [form, setForm] = useState({
    pipeline_id: '',
    enabled: true,
    only_if_new_rows: true,
    delay_seconds: 0,
  })

  const load = async () => {
    setLoading(true)
    try {
      const [tRes, pRes] = await Promise.all([
        listDownstreamTriggers(connector.id),
        listPipelines(),
      ])
      setTriggers(tRes.downstream || [])
      setAllPipelines((pRes.pipelines || []).filter(p => p.status !== 'archived'))
    } catch (e) {
      showToast('error', 'Failed to load triggers: ' + e.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [connector.id])

  const handleAdd = async () => {
    if (!form.pipeline_id) {
      showToast('error', 'Please select a pipeline')
      return
    }
    setSaving(true)
    try {
      await addDownstreamTrigger(connector.id, form)
      showToast('success', 'Downstream trigger added ✓')
      setForm({ pipeline_id: '', enabled: true, only_if_new_rows: true, delay_seconds: 0 })
      load()
      if (onChange) onChange()
    } catch (e) {
      showToast('error', e.message)
    } finally {
      setSaving(false)
    }
  }

  const handleToggle = async (t) => {
    setTogglingId(t.id)
    try {
      await updateDownstreamTrigger(connector.id, t.id, {
        pipeline_id: t.pipeline_id,
        enabled: !t.enabled,
        only_if_new_rows: t.only_if_new_rows,
        delay_seconds: t.delay_seconds,
      })
      load()
      if (onChange) onChange()
    } catch (e) {
      showToast('error', e.message)
    } finally {
      setTogglingId(null)
    }
  }

  const handleRemove = async (triggerId) => {
    setRemovingId(triggerId)
    try {
      await removeDownstreamTrigger(connector.id, triggerId)
      showToast('success', 'Trigger removed')
      load()
      if (onChange) onChange()
    } catch (e) {
      showToast('error', e.message)
    } finally {
      setRemovingId(null)
    }
  }

  // Pipelines not yet linked
  const linkedIds = new Set(triggers.map(t => t.pipeline_id))
  const availablePipelines = allPipelines.filter(p => !linkedIds.has(p.id))

  return (
    <div style={S.overlay} onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{
        background: '#0d1117',
        border: '1px solid rgba(34,211,238,0.2)',
        borderRadius: 20,
        width: '100%',
        maxWidth: 680,
        maxHeight: '90vh',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        boxShadow: '0 30px 90px rgba(0,0,0,0.7), 0 0 40px rgba(34,211,238,0.08)',
      }}>

        {/* ── Header ── */}
        <div style={{
          padding: '20px 24px',
          borderBottom: '1px solid rgba(255,255,255,0.07)',
          background: 'linear-gradient(135deg, #0a0f1e 0%, #0d1117 100%)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <div style={{
              width: 40, height: 40, borderRadius: 12,
              background: 'rgba(34,211,238,0.12)',
              border: '1px solid rgba(34,211,238,0.3)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: '0 0 20px rgba(34,211,238,0.2)',
            }}>
              <GitBranch size={20} color="#22d3ee" />
            </div>
            <div>
              <div style={{ fontSize: 16, fontWeight: 700, color: '#f1f5f9' }}>
                Trigger Pipelines
              </div>
              <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>
                Connector: <span style={{ color: '#22d3ee', fontFamily: 'monospace' }}>{connector.display_name || connector.name}</span>
              </div>
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: '#64748b', cursor: 'pointer', borderRadius: 8, padding: 6, display: 'flex' }}>
            <X size={18} />
          </button>
        </div>

        {/* ── Description banner ── */}
        <div style={{
          margin: '16px 24px 0',
          padding: '12px 16px',
          background: 'rgba(34,211,238,0.05)',
          border: '1px solid rgba(34,211,238,0.15)',
          borderRadius: 10,
          fontSize: 13, color: '#94a3b8', lineHeight: 1.6,
          display: 'flex', alignItems: 'flex-start', gap: 10,
        }}>
          <Zap size={16} color="#22d3ee" style={{ marginTop: 1, flexShrink: 0 }} />
          <span>
            After <strong style={{ color: '#22d3ee' }}>{connector.display_name || connector.name}</strong> finishes syncing,
            the pipelines below will automatically run. This creates an <strong style={{ color: '#a5b4fc' }}>event-driven</strong> data flow:
            Connector → Bronze Layer → Pipeline Transformation.
          </span>
        </div>

        {/* ── Body ── */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px' }}>

          {/* Existing triggers */}
          <div style={{ marginBottom: 24 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 12 }}>
              Active Triggers ({triggers.length})
            </div>

            {loading ? (
              <div style={{ padding: '24px', textAlign: 'center', color: '#64748b' }}>
                <RefreshCw size={20} className="spin" style={{ marginBottom: 8 }} /><br />Loading...
              </div>
            ) : triggers.length === 0 ? (
              <div style={{
                padding: '28px', textAlign: 'center',
                background: 'rgba(255,255,255,0.02)',
                border: '1px dashed rgba(255,255,255,0.08)',
                borderRadius: 12,
              }}>
                <GitBranch size={36} style={{ color: '#1e293b', marginBottom: 12 }} />
                <div style={{ fontSize: 14, color: '#475569', marginBottom: 6 }}>No trigger pipelines configured</div>
                <div style={{ fontSize: 12, color: '#334155' }}>Add a pipeline below to auto-trigger it after each sync</div>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {triggers.map(t => (
                  <div key={t.id} style={{
                    background: t.enabled ? 'rgba(34,211,238,0.04)' : 'rgba(255,255,255,0.02)',
                    border: `1px solid ${t.enabled ? 'rgba(34,211,238,0.2)' : 'rgba(255,255,255,0.06)'}`,
                    borderRadius: 12,
                    padding: '14px 18px',
                    transition: 'all 0.2s',
                  }}>
                    {/* Top row: flow diagram + actions */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                      {/* Mini flow: Connector → Pipeline */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1 }}>
                        {/* Connector box */}
                        <div style={{
                          display: 'flex', alignItems: 'center', gap: 6,
                          padding: '5px 10px', borderRadius: 7,
                          background: 'rgba(129,140,248,0.12)',
                          border: '1px solid rgba(129,140,248,0.25)',
                          fontSize: 12, color: '#818cf8', fontWeight: 600,
                        }}>
                          <Database size={12} />
                          {(connector.display_name || connector.name).slice(0, 20)}
                        </div>
                        {/* Arrow */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: 4, color: t.enabled ? '#22d3ee' : '#334155' }}>
                          <div style={{ height: 1, width: 24, background: 'currentColor', opacity: 0.6 }} />
                          <Zap size={13} style={{ opacity: t.enabled ? 1 : 0.3 }} />
                          <div style={{ height: 1, width: 24, background: 'currentColor', opacity: 0.6 }} />
                        </div>
                        {/* Pipeline box */}
                        <div style={{
                          display: 'flex', alignItems: 'center', gap: 6,
                          padding: '5px 10px', borderRadius: 7,
                          background: t.enabled ? 'rgba(34,211,238,0.1)' : 'rgba(255,255,255,0.04)',
                          border: `1px solid ${t.enabled ? 'rgba(34,211,238,0.3)' : 'rgba(255,255,255,0.08)'}`,
                          fontSize: 12, color: t.enabled ? '#22d3ee' : '#475569', fontWeight: 600,
                        }}>
                          <Zap size={12} />
                          {(t.pipeline_name || 'Pipeline').slice(0, 24)}
                        </div>
                      </div>

                      {/* Toggle enabled */}
                      <div title={t.enabled ? 'Disable trigger' : 'Enable trigger'}>
                        <Toggle
                          active={t.enabled}
                          onChange={() => togglingId !== t.id && handleToggle(t)}
                          disabled={togglingId === t.id}
                          activeColor="#22d3ee"
                        />
                      </div>

                      {/* Remove */}
                      <button
                        onClick={() => handleRemove(t.id)}
                        disabled={removingId === t.id}
                        style={{
                          background: 'rgba(239,68,68,0.08)',
                          border: '1px solid rgba(239,68,68,0.2)',
                          color: '#f87171', cursor: 'pointer',
                          borderRadius: 6, padding: '5px 8px',
                          display: 'flex', alignItems: 'center', gap: 4, fontSize: 11,
                          transition: 'all 0.15s',
                        }}
                        onMouseEnter={e => { e.currentTarget.style.background = 'rgba(239,68,68,0.2)' }}
                        onMouseLeave={e => { e.currentTarget.style.background = 'rgba(239,68,68,0.08)' }}
                      >
                        {removingId === t.id ? <RefreshCw size={11} className="spin" /> : <Unlink size={11} />}
                        Remove
                      </button>
                    </div>

                    {/* Config chips */}
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      <span style={{
                        fontSize: 11, padding: '2px 8px', borderRadius: 20,
                        background: t.only_if_new_rows ? 'rgba(34,197,94,0.1)' : 'rgba(245,158,11,0.1)',
                        border: `1px solid ${t.only_if_new_rows ? 'rgba(34,197,94,0.2)' : 'rgba(245,158,11,0.2)'}`,
                        color: t.only_if_new_rows ? '#22c55e' : '#f59e0b',
                        fontWeight: 600,
                      }}>
                        {t.only_if_new_rows ? '✓ Only if new rows' : '⚡ Always trigger'}
                      </span>
                      <span style={{
                        fontSize: 11, padding: '2px 8px', borderRadius: 20,
                        background: 'rgba(255,255,255,0.04)',
                        border: '1px solid rgba(255,255,255,0.08)',
                        color: '#64748b', fontWeight: 500,
                      }}>
                        Delay: {t.delay_seconds === 0 ? 'immediate' : `${t.delay_seconds}s`}
                      </span>
                      {t.last_triggered_at && (
                        <span style={{
                          fontSize: 11, padding: '2px 8px', borderRadius: 20,
                          background: 'rgba(99,102,241,0.08)',
                          border: '1px solid rgba(99,102,241,0.15)',
                          color: '#818cf8', fontWeight: 500,
                        }}>
                          Last: {new Date(t.last_triggered_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                        </span>
                      )}
                      <span style={{
                        fontSize: 11, padding: '2px 8px', borderRadius: 20,
                        background: t.enabled ? 'rgba(34,211,238,0.08)' : 'rgba(100,116,139,0.08)',
                        border: `1px solid ${t.enabled ? 'rgba(34,211,238,0.2)' : 'rgba(100,116,139,0.15)'}`,
                        color: t.enabled ? '#22d3ee' : '#64748b', fontWeight: 700,
                        textTransform: 'uppercase', letterSpacing: '0.04em',
                      }}>
                        {t.enabled ? '● ENABLED' : '○ DISABLED'}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* ── Add New Trigger Form ── */}
          <div style={{
            background: 'rgba(255,255,255,0.02)',
            border: '1px solid rgba(255,255,255,0.06)',
            borderRadius: 14, padding: '18px 20px',
          }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 14, display: 'flex', alignItems: 'center', gap: 6 }}>
              <Link2 size={13} /> Add New Trigger
            </div>

            <div style={{ marginBottom: 12 }}>
              <label style={S.label}>Select Pipeline *</label>
              <select
                style={S.select}
                value={form.pipeline_id}
                onChange={e => setForm(f => ({ ...f, pipeline_id: e.target.value }))}
              >
                <option value="">-- Choose a pipeline to trigger --</option>
                {availablePipelines.map(p => (
                  <option key={p.id} value={p.id}>
                    {p.name} {p.latest_version > 0 ? `(v${p.latest_version})` : '(draft)'}
                  </option>
                ))}
              </select>
              {availablePipelines.length === 0 && !loading && (
                <div style={{ fontSize: 11, color: '#f59e0b', marginTop: 6 }}>
                  All available published pipelines are already linked.
                </div>
              )}
            </div>

            <div style={{ display: 'flex', gap: 12, marginBottom: 12 }}>
              <div style={{ flex: 1 }}>
                <label style={S.label}>Condition</label>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', background: '#1e293b', border: '1px solid #334155', borderRadius: 8 }}>
                  <Toggle
                    active={form.only_if_new_rows}
                    onChange={v => setForm(f => ({ ...f, only_if_new_rows: v }))}
                    activeColor="#22c55e"
                  />
                  <span style={{ fontSize: 13, color: form.only_if_new_rows ? '#22c55e' : '#94a3b8' }}>
                    Only trigger if new rows ingested
                  </span>
                </div>
              </div>
              <div style={{ width: 160 }}>
                <label style={S.label}>Delay (seconds)</label>
                <input
                  type="number"
                  min={0} max={300} step={5}
                  style={S.input}
                  value={form.delay_seconds}
                  onChange={e => setForm(f => ({ ...f, delay_seconds: parseInt(e.target.value) || 0 }))}
                />
              </div>
            </div>

            {/* Preview mini flow */}
            {form.pipeline_id && (
              <div style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '10px 14px',
                background: 'rgba(34,211,238,0.05)',
                border: '1px solid rgba(34,211,238,0.15)',
                borderRadius: 8, marginBottom: 14, flexWrap: 'wrap',
              }}>
                <span style={{ fontSize: 11, color: '#64748b' }}>Preview:</span>
                <span style={{ fontSize: 12, color: '#818cf8', fontWeight: 600 }}>
                  <Database size={11} style={{ marginRight: 4 }} />
                  {connector.display_name || connector.name}
                </span>
                <ArrowRight size={14} color="#22d3ee" />
                <span style={{ fontSize: 12, color: '#22d3ee', fontWeight: 600 }}>
                  <Zap size={11} style={{ marginRight: 4 }} />
                  {allPipelines.find(p => p.id === form.pipeline_id)?.name || ''}
                </span>
                {form.only_if_new_rows && <span style={{ fontSize: 11, color: '#64748b' }}>(if new rows)</span>}
                {form.delay_seconds > 0 && <span style={{ fontSize: 11, color: '#64748b' }}>after {form.delay_seconds}s</span>}
              </div>
            )}

            <button
              onClick={handleAdd}
              disabled={saving || !form.pipeline_id}
              style={{
                ...S.btn('primary'),
                background: saving || !form.pipeline_id
                  ? 'rgba(34,211,238,0.1)'
                  : 'linear-gradient(135deg, #06b6d4, #0891b2)',
                color: saving || !form.pipeline_id ? '#334155' : '#fff',
                width: '100%', justifyContent: 'center', padding: '10px',
                boxShadow: !saving && form.pipeline_id ? '0 2px 12px rgba(6,182,212,0.3)' : 'none',
              }}
            >
              {saving ? <RefreshCw size={14} className="spin" /> : <Link2 size={14} />}
              {saving ? 'Linking...' : 'Add Trigger Pipeline'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── ConnectorSQLModal ────────────────────────────────────────────────────────
// Compiled SQL Inspector: Tab A = Config Inspector, Tab B = WAP Plan (downstream pipeline)
function ConnectorSQLModal({ connector, onClose }) {
  const [tab, setTab] = useState('config')  // 'config' | 'wap'
  const [wapLoading, setWapLoading] = useState(false)
  const [wapPlans, setWapPlans] = useState([])  // [{pipelineName, wapPlan}]
  const [wapError, setWapError] = useState(null)

  const configData = {
    id: connector.id,
    name: connector.name,
    display_name: connector.display_name,
    base_url: connector.base_url,
    method: connector.method,
    data_path: connector.data_path,
    auth_type: connector.auth_type,
    schedule: {
      cron: connector.sync_schedule || null,
      enabled: connector.schedule_enabled,
    },
    params: connector.params_json || null,
    headers: Object.keys(connector.headers_json || {}).length > 0
      ? '<redacted — contains auth headers>'
      : null,
    schema_hash: connector.schema_hash,
    status: connector.status,
    last_synced_at: connector.last_synced_at,
    rows_last_sync: connector.rows_last_sync,
    downstream_trigger_count: connector.downstream_trigger_count || 0,
  }

  const loadWapPlans = async () => {
    if (wapPlans.length > 0) return  // already loaded
    setWapLoading(true)
    setWapError(null)
    try {
      // Get downstream triggers for this connector
      const result = await listDownstreamTriggers(connector.id)
      const downstream = result.downstream || result || []
      if (!downstream || downstream.length === 0) {
        setWapError('No trigger pipelines linked to this connector.')
        setWapLoading(false)
        return
      }
      const plans = []
      for (const trig of downstream) {
        try {
          // Get latest pipeline run WAP plan
          const pipelineData = await fetch(`/api/pipelines/${trig.pipeline_id}/runs?limit=1`).then(r => r.json())
          const runs = pipelineData.runs || []
          if (runs.length > 0) {
            const run = runs[0]
            const { getWapPlan } = await import('../api/client')
            const plan = await getWapPlan(trig.pipeline_id, run.version || 1, run.dagster_run_id || run.id, new Date().toISOString())
            plans.push({ pipelineName: trig.pipeline_name || trig.pipeline_id, wapPlan: plan })
          } else {
            plans.push({ pipelineName: trig.pipeline_name || trig.pipeline_id, wapPlan: null })
          }
        } catch (e) {
          plans.push({ pipelineName: trig.pipeline_name || trig.pipeline_id, wapPlan: null, error: e.message })
        }
      }
      setWapPlans(plans)
    } catch (e) {
      setWapError('Failed to load trigger pipeline WAP plans: ' + e.message)
    } finally {
      setWapLoading(false)
    }
  }

  const handleTabChange = (t) => {
    setTab(t)
    if (t === 'wap') loadWapPlans()
  }

  const tabStyle = (active) => ({
    padding: '8px 20px', cursor: 'pointer', fontWeight: 600, fontSize: 13,
    borderBottom: `2px solid ${active ? '#fb923c' : 'transparent'}`,
    color: active ? '#fb923c' : '#64748b',
    background: 'transparent', border: 'none', transition: 'all 0.15s',
  })

  return (
    <div style={S.overlay} onClick={onClose}>
      <div
        style={{ ...S.card, padding: 0, maxWidth: 860, width: '95%', maxHeight: '85vh', display: 'flex', flexDirection: 'column' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ padding: '20px 24px', borderBottom: '1px solid #1e293b', background: '#0a0f1e', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ background: 'rgba(251,146,60,0.12)', border: '1px solid rgba(251,146,60,0.3)', padding: 10, borderRadius: 12, display: 'flex' }}>
              <FileCode size={22} color="#fb923c" />
            </div>
            <div>
              <div style={{ fontSize: 17, fontWeight: 700, color: '#f1f5f9' }}>Compiled SQL Inspector</div>
              <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>
                Connector: <span style={{ color: '#fb923c', fontFamily: 'monospace' }}>{connector.display_name || connector.name}</span>
              </div>
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: '#64748b', cursor: 'pointer', borderRadius: 8, padding: 6, display: 'flex' }}>
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '32px 24px', background: '#0a0f1e' }}>
          <div style={{ position: 'relative', maxWidth: 640, margin: '0 auto' }}>
            {/* Vertical Line */}
            <div style={{ position: 'absolute', top: 20, bottom: 40, left: 23, width: 2, background: 'rgba(34,211,238,0.1)' }} />

            {[
              {
                icon: <Link2 size={20} color="#3b82f6" />,
                title: 'REST API Extraction (Source)',
                code: `GET ${connector.base_url}`,
                desc: `Pulls data from the external source using the ${connector.method} method. Authentication is handled by Vault (${connector.auth_type}).`
              },
              {
                icon: <Zap size={20} color="#10b981" />,
                title: 'FastAPI Stream Loader',
                code: 'Streaming Response (Chunking)',
                desc: 'The backend buffers the incoming JSON payload into chunks. Instead of loading everything into memory (preventing OOM), chunks are continuously streamed out.'
              },
              {
                icon: <Database size={20} color="#f59e0b" />,
                title: 'MinIO (S3) Raw Storage',
                code: `s3a://warehouse/bronze/${connector.name}/raw_data.json`,
                desc: 'Data lands in our self-hosted S3-compatible storage. This forms the immutable base of the medallion architecture, ensuring zero data loss even if downstream parsing fails.'
              },
              {
                icon: <FileCode size={20} color="#8b5cf6" />,
                title: 'Hive Schema Mapping',
                code: `CREATE EXTERNAL TABLE IF NOT EXISTS hive.default.${connector.name}_raw (
  data VARCHAR
)
WITH (
  format = 'JSON',
  external_location = 's3a://bronze/connectors/${connector.name}/'
)`,
                desc: 'We map the raw JSON objects in MinIO to a Hive external table. This allows Trino to physically read the semi-structured JSON fragments using schema-on-read capabilities without moving data.'
              },
              {
                icon: <GitMerge size={20} color="#06b6d4" />,
                title: 'Iceberg Bronze Table (Trino)',
                code: `INSERT INTO iceberg.bronze.${connector.name}
SELECT *, CURRENT_TIMESTAMP AS ingested_at
FROM hive.default.stg_${connector.name}`,
                desc: `Trino executes a highly efficient distributed INSERT query to load the raw Hive staging data directly into the managed Apache Iceberg Bronze table. The Bronze layer acts as a strictly append-only, high-fidelity ledger of all raw source records.`
              }
            ].map((step, i) => (
              <div key={i} style={{ display: 'flex', gap: 24, marginBottom: 40, position: 'relative', zIndex: 1 }}>
                <div style={{ width: 48, height: 48, borderRadius: '50%', background: '#0f172a', border: `2px solid ${step.icon.props.color}`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, boxShadow: `0 0 15px ${step.icon.props.color}40` }}>
                  {step.icon}
                </div>
                <div style={{ paddingTop: 2 }}>
                  <div style={{ fontSize: 16, fontWeight: 700, color: '#f1f5f9', marginBottom: 6 }}>{step.title}</div>
                  <div style={{ fontSize: 13, color: step.icon.props.color, fontFamily: '"JetBrains Mono", Consolas, monospace', background: 'rgba(0,0,0,0.3)', padding: '12px 16px', borderRadius: 8, display: 'block', marginBottom: 12, border: '1px solid rgba(255,255,255,0.08)', whiteSpace: 'pre-wrap' }}>
                    {step.code}
                  </div>
                  <div style={{ fontSize: 14, color: '#94a3b8', lineHeight: 1.6 }}>{step.desc}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

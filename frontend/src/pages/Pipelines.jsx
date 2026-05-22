/**
 * Pipeline Studio — Pipeline List & Management
 * Styled to match ConnectorManager: compact table, identical S tokens.
 */
import React, { useState, useEffect } from 'react'
import {
  Plus, Trash2, Clock, Copy, RefreshCw,
  Calendar, Eye, PowerOff, CheckCircle, XCircle,
  AlertCircle, Zap, Timer, Globe, Database, Activity,
  Search, ChevronRight, Save, MoreVertical,
  Play, History, GitMerge, ToggleLeft, GitBranch, Unlock
} from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import * as api from '../api/client'

// ── Style tokens (identical to ConnectorManager) ─────────────────────────────
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
      ? { background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', color: '#fff' }
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
    whiteSpace: 'nowrap',
  },
  td: {
    padding: '16px 20px', borderBottom: '1px solid #1e293b',
    fontSize: 13, color: '#cbd5e1', verticalAlign: 'middle',
  },
  badge: (color) => ({
    display: 'inline-flex', alignItems: 'center', gap: 6,
    padding: '4px 12px', borderRadius: 20, fontSize: 11, fontWeight: 700,
    background: `${color}15`, color: color, border: `1px solid ${color}30`,
    textTransform: 'uppercase', letterSpacing: '0.05em',
  }),
  overlay: {
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)',
    zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center',
    backdropFilter: 'blur(4px)',
  },
  drawer: {
    background: '#0f172a', border: '1px solid #1e293b',
    borderRadius: 16, width: '100%', maxWidth: 560,
    maxHeight: '90vh', display: 'flex', flexDirection: 'column',
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
  wizardLayerCard: (selected, disabled) => ({
    padding: 20,
    borderRadius: 14,
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

// ── iOS-style Toggle ──────────────────────────────────────────────────────────
const Toggle = ({ active, onChange, disabled, activeColor = '#10b981' }) => (
  <div
    onClick={() => !disabled && onChange(!active)}
    title={active ? 'Click to disable' : 'Click to enable'}
    style={{
      width: 36, height: 20, borderRadius: 20,
      background: active ? activeColor : '#334155',
      position: 'relative', cursor: disabled ? 'not-allowed' : 'pointer',
      transition: 'background 0.3s', opacity: disabled ? 0.5 : 1, flexShrink: 0,
    }}
  >
    <div style={{
      width: 14, height: 14, borderRadius: '50%', background: '#fff',
      position: 'absolute', top: 3, left: active ? 19 : 3,
      transition: 'left 0.3s', boxShadow: '0 2px 4px rgba(0,0,0,0.2)',
    }} />
  </div>
)
// ── SummaryCard (matches ConnectorManager) ────────────────────────────────────
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
      borderRadius: '16px', padding: '24px', position: 'relative', overflow: 'hidden',
      boxShadow: highlight ? `0 0 24px ${c.iconBtn}` : 'var(--shadow-sm)',
      transition: 'all 0.3s ease', display: 'flex', flexDirection: 'column',
    }}
      onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-4px)'; e.currentTarget.style.boxShadow = `0 12px 30px ${c.iconBtn}` }}
      onMouseLeave={e => { e.currentTarget.style.transform = 'none'; e.currentTarget.style.boxShadow = highlight ? `0 0 24px ${c.iconBtn}` : 'var(--shadow-sm)' }}
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

// ── Status badge ──────────────────────────────────────────────────────────────
function StatusBadge({ status }) {
  const map = {
    active: { color: '#10b981', label: 'ACTIVE', icon: <CheckCircle size={11} /> },
    inactive: { color: '#ef4444', label: 'INACTIVE', icon: <PowerOff size={11} /> },
    draft: { color: '#64748b', label: 'DRAFT', icon: <Clock size={11} /> },
    archived: { color: '#475569', label: 'ARCHIVED', icon: <Clock size={11} /> },
  }
  const { color, label, icon } = map[status] || { color: '#94a3b8', label: status?.toUpperCase() || 'UNKNOWN', icon: <Clock size={11} /> }
  return (
    <span style={{
      ...S.badge(color),
      textTransform: 'uppercase', letterSpacing: '0.04em'
    }}>
      {icon} {label}
    </span>
  )
}

// ── Constants ─────────────────────────────────────────────────────────────────
const SCHEDULE_PRESETS = [
  { label: 'Every Minute', value: '* * * * *', desc: 'Every minute' },
  { label: 'Every Hour', value: '0 * * * *', desc: 'Every hour at :00' },
  { label: 'Every Day', value: '0 0 * * *', desc: 'Daily at midnight' },
  { label: 'Every Week', value: '0 0 * * 0', desc: 'Every Sunday midnight' },
  { label: 'Every Month', value: '0 0 1 * *', desc: 'First of month' },
  { label: 'Every 5 Minutes', value: '*/5 * * * *', desc: 'Every 5 minutes' },
  { label: 'Every 15 Minutes', value: '*/15 * * * *', desc: 'Every 15 minutes' },
  { label: 'Every 30 Minutes', value: '*/30 * * * *', desc: 'Every 30 minutes' },
]

const TIMEZONES = [
  'UTC', 'Asia/Ho_Chi_Minh', 'Asia/Bangkok', 'Asia/Singapore',
  'America/New_York', 'America/Los_Angeles', 'Europe/London', 'Europe/Paris',
]

const ENGINE_STYLE = {
  trino: { icon: '🔍', label: 'Trino', color: '#3b82f6' },
  spark: { icon: '⚡', label: 'Spark', color: '#f59e0b' },
}

const SAMPLE_DOMAINS = [
  {
    id: 'finance',
    label: 'Finance Report',
    desc: 'Cost Items, P&L, Budget vs Actual',
    layers: {
      silver: [
        {
          pipeline_name: 'Bronze to Silver: Cost Item 641',
          description: 'Transforms Bronze FI_SUB_641 to Silver Finance_Dim_CostItem_641 (Danh muc Phi Ban hang)',
          source_type: 'connector',
          connector_name: 'api_fi_sub_641',
          target_schema: 'silver',
          target_table: 'Finance_Dim_CostItem_641',
          merge_keys: ['costitemcode'],
          columns: [
            'DISTINCT TRIM(tk_641) AS costitemcode',
            'TRIM(cap_2) AS costgroup_l1',
            'TRIM(mo_ta) AS costgroup_l2',
            'TRIM(level_2__eng) AS costgroup_l1_en',
            'TRIM(level_1__eng) AS costgroup_l2_en'
          ]
        },
        {
          pipeline_name: 'Bronze to Silver: Cost Item 642',
          description: 'Transforms Bronze FI_SUB_642 to Silver Finance_Dim_CostItem_642 (Danh muc Phi Quan ly DN)',
          source_type: 'connector',
          connector_name: 'api_fi_sub_642',
          target_schema: 'silver',
          target_table: 'Finance_Dim_CostItem_642',
          merge_keys: ['costitemcode'],
          columns: [
            'DISTINCT TRIM(tk_642) AS costitemcode',
            "TRIM(ma_cap_2) || ' - ' || TRIM(cap_2) AS costgroup_l1",
            "TRIM(stt) || ' - ' || TRIM(dien_giai) AS costgroup_l2",
            "TRIM(ma_cap_2) || ' - ' || TRIM(level_2__eng) AS costgroup_l1_en",
            "TRIM(stt) || ' - ' || TRIM(level_1__eng) AS costgroup_l2_en"
          ]
        },
        {
          pipeline_name: 'Bronze to Silver: Finance KQKD',
          description: 'Transforms Bronze kqhdkd to Silver Finance_KQKD',
          source_type: 'connector',
          connector_name: 'kqhdkd',
          target_schema: 'silver',
          target_table: 'Finance_KQKD',
          merge_keys: ['ReportDate', 'ItemCode', 'OU_Code'],
          columns: [
            "YEAR || '-' || LPAD(MONTH, 2, '0') AS ReportDate",
            "regexp_extract(TRIM(KHOAN_MUC), '^([0-9]+)') AS ItemCode",
            "TRIM(KHOAN_MUC) AS ItemName",
            "TRIM(OU) AS OU_Code",
            "SO_TIEN AS Amount"
          ]
        }
      ],
      gold: [
        {
          pipeline_name: 'Silver to Gold: Cost Item 641',
          upstream_sample_name: 'Bronze to Silver: Cost Item 641',
          description: 'Transforms Silver Finance_Dim_CostItem_641 to Gold Finance_Dim_CostItem_641',
          source_type: 'table',
          source_catalog: 'iceberg',
          source_schema: 'silver',
          source_table: 'Finance_Dim_CostItem_641',
          target_schema: 'gold',
          target_table: 'Finance_Dim_CostItem_641',
          merge_keys: ['costitemcode'],
          columns: [
            'TRIM(costitemcode) AS costitemcode',
            'TRIM(costgroup_l1) AS costgroup_l1',
            'TRIM(costgroup_l2) AS costgroup_l2',
            'TRIM(costgroup_l2_en) AS costgroup_l1_en',
            'TRIM(costgroup_l1_en) AS costgroup_l2_en'
          ]
        },
        {
          pipeline_name: 'Silver to Gold: Cost Item 642',
          upstream_sample_name: 'Bronze to Silver: Cost Item 642',
          description: 'Transforms Silver Finance_Dim_CostItem_642 to Gold Finance_Dim_CostItem_642',
          source_type: 'table',
          source_catalog: 'iceberg',
          source_schema: 'silver',
          source_table: 'Finance_Dim_CostItem_642',
          target_schema: 'gold',
          target_table: 'Finance_Dim_CostItem_642',
          merge_keys: ['costitemcode'],
          columns: [
            'TRIM(costitemcode) AS costitemcode',
            'TRIM(costgroup_l1) AS costgroup_l1',
            'TRIM(costgroup_l2) AS costgroup_l2',
            'TRIM(costgroup_l2_en) AS costgroup_l1_en',
            'TRIM(costgroup_l1_en) AS costgroup_l2_en'
          ]
        },
        {
          pipeline_name: 'Silver to Gold: Finance Fact PnL Financial',
          upstream_sample_name: 'Bronze to Silver: Finance KQKD',
          description: 'Transforms Silver Finance_KQKD to Gold Finance_Fact_PnL_Financial',
          source_type: 'table',
          source_catalog: 'iceberg',
          source_schema: 'silver',
          source_table: 'Finance_KQKD',
          target_schema: 'gold',
          target_table: 'Finance_Fact_PnL_Financial',
          merge_keys: ['PnL_Key'],
          columns: [
            "to_hex(md5(to_utf8(concat(ReportDate, trim(OU_Code), trim(ItemName))))) AS PnL_Key",
            "CAST(ReportDate || '-01' AS DATE) AS ReportMonth",
            "TRIM(UPPER(OU_Code)) AS OU_Code",
            "TRIM(ItemName) AS PnL_Item_Name",
            "CASE WHEN ItemName LIKE '%Doanh thu%' AND ItemName NOT LIKE '%giảm trừ%' THEN 'Revenue' WHEN ItemName LIKE '%Giá vốn%' THEN 'COGS' WHEN ItemName LIKE '%Chi phí%' OR ItemName LIKE '%Thuế%' OR ItemName LIKE '%giảm trừ%' THEN 'Expense' ELSE 'Profit' END AS PnL_Section",
            "CASE WHEN ItemName LIKE '%Giá vốn%' OR ItemName LIKE '%Chi phí%' OR ItemName LIKE '%Thuế%' OR ItemName LIKE '%giảm trừ%' THEN ABS(Amount) * -1 ELSE ABS(Amount) END AS Amount",
            "LAG(Amount, 12) OVER (PARTITION BY OU_Code, ItemName ORDER BY ReportDate) AS Amount_PY",
            "CASE WHEN Amount_PY = 0 THEN 0 ELSE (Amount - Amount_PY) / ABS(Amount_PY) END AS YoY_Growth_Pct"
          ]
        }
      ]
    }
  }
]

function formatDate(dt) {
  if (!dt) return '—'
  return new Date(dt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function describeCron(cron) {
  const preset = SCHEDULE_PRESETS.find(p => p.value === cron)
  return preset ? preset.label : cron
}

// ── Main Component ────────────────────────────────────────────────────────────
export default function Pipelines() {
  const [pipelines, setPipelines] = useState([])
  const [loading, setLoading] = useState(false)
  const [search, setSearch] = useState('')
  const [togglingId, setTogglingId] = useState(null)
  const [openMenuId, setOpenMenuId] = useState(null)
  const [toast, setToast] = useState(null)
  const [deleteConfirm, setDeleteConfirm] = useState(null)

  // Modals
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [createForm, setCreateForm] = useState({ name: '', description: '', engine: 'trino' })
  const [createLoading, setCreateLoading] = useState(false)
  const [showCloneModal, setShowCloneModal] = useState(false)
  const [cloneForm, setCloneForm] = useState({ id: null, name: '' })
  const [showScheduleModal, setShowScheduleModal] = useState(false)
  const [showSampleWizard, setShowSampleWizard] = useState(false)
  const [wizardStep, setWizardStep] = useState(1)
  const [wizardDomain, setWizardDomain] = useState(null)
  const [wizardLayer, setWizardLayer] = useState(null)
  const [checkingSilver, setCheckingSilver] = useState(false)
  const [silverCheckMap, setSilverCheckMap] = useState({})
  const [selectedPipelines, setSelectedPipelines] = useState(new Set())
  const [generateLoading, setGenerateLoading] = useState(false)

  const defaultScheduleForm = {
    pipelineId: null, pipelineName: '',
    run_type: 'scheduled', cron_expr: '0 * * * *',
    cron_custom: false, run_at: '',
    timezone: 'Asia/Ho_Chi_Minh', enabled: true,
  }
  const [scheduleForm, setScheduleForm] = useState(defaultScheduleForm)
  const [scheduleLoading, setScheduleLoading] = useState(false)

  const [runningId, setRunningId] = useState(null)
  // Map of pipelineId → active run_id (for pipelines currently running/pending)
  const [activeRuns, setActiveRuns] = useState({})
  const navigate = useNavigate()

  // Click outside → close dropdown
  useEffect(() => {
    if (!openMenuId) return
    const close = (e) => {
      // Don't close if click is inside the menu itself
      setOpenMenuId(null)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [openMenuId])

  useEffect(() => { loadPipelines() }, [])

  // ── Auto-poll active runs every 5s until all are done ─────────────────────
  useEffect(() => {
    if (Object.keys(activeRuns).length === 0) return
    const interval = setInterval(async () => {
      const updated = { ...activeRuns }
      let changed = false
      await Promise.allSettled(Object.entries(activeRuns).map(async ([pipelineId, runId]) => {
        try {
          const data = await api.listPipelineRuns(pipelineId, 3)
          const stillActive = (data.runs || []).find(
            r => r.status === 'running' || r.status === 'pending'
          )
          if (!stillActive) {
            delete updated[pipelineId]
            changed = true
          }
        } catch (_) { }
      }))
      if (changed) setActiveRuns({ ...updated })
    }, 5000)
    return () => clearInterval(interval)
  }, [activeRuns])

  async function loadActiveRuns(pipelineList) {
    const result = {}
    await Promise.allSettled((pipelineList || []).map(async (p) => {
      try {
        const data = await api.listPipelineRuns(p.id, 5)
        const active = (data.runs || []).find(r => r.status === 'running' || r.status === 'pending')
        if (active) result[p.id] = active.id
      } catch (_) { }
    }))
    setActiveRuns(result)
  }

  const handleToggleTriggerOuter = async (connectorId, triggerId, newEnabledState, pipelineId) => {
    try {
      await api.updateDownstreamTrigger(connectorId, triggerId, { enabled: newEnabledState })
      setPipelines(prev => prev.map(p => {
        if (p.id === pipelineId) {
          return {
            ...p,
            trigger_sources: p.trigger_sources?.map(t =>
              t.id === triggerId ? { ...t, enabled: newEnabledState } : t
            )
          }
        }
        return p
      }))
      showToast('success', `Trigger was ${newEnabledState ? 'enabled' : 'disabled'} successfully`)
    } catch (e) {
      showToast('error', e.message || 'Failed to toggle trigger')
    }
  }

  async function loadPipelines() {
    setLoading(true)
    try {
      const data = await api.listPipelines()
      const list = data.pipelines || []
      setPipelines(list)
      await loadActiveRuns(list)
    } catch (e) { showToast('error', e.message) }
    setLoading(false)
  }

  function closeWizard() {
    setShowSampleWizard(false)
    setWizardStep(1)
    setWizardDomain(null)
    setWizardLayer(null)
    setCheckingSilver(false)
    setSilverCheckMap({})
    setSelectedPipelines(new Set())
    setGenerateLoading(false)
  }

  function openSampleWizard() {
    setShowSampleWizard(true)
    setWizardStep(1)
    setWizardDomain(null)
    setWizardLayer(null)
    setCheckingSilver(false)
    setSilverCheckMap({})
    setSelectedPipelines(new Set())
    setGenerateLoading(false)
  }

  async function checkSilverTables(domainId) {
    setCheckingSilver(true)
    setSilverCheckMap({})
    const goldSamples = SAMPLE_DOMAINS.find(d => d.id === domainId)?.layers?.gold || []

    const uniqueTables = [...new Map(
      goldSamples
        .filter(s => s.source_type === 'table')
        .map(s => [`${s.source_schema}.${s.source_table}`, s])
    ).values()]

    const result = {}
    await Promise.allSettled(
      uniqueTables.map(async (s) => {
        let exists = false
        try {
          await api.describeTable(s.source_schema, s.source_table)
          exists = true
        } catch (_) { }

        goldSamples
          .filter(g => g.source_schema === s.source_schema && g.source_table === s.source_table)
          .forEach(g => { result[g.pipeline_name] = exists })
      })
    )

    setSilverCheckMap(result)
    setCheckingSilver(false)
  }

  function handleSelectDomain(domainId) {
    setWizardDomain(domainId)
    setWizardLayer(null)
    setSelectedPipelines(new Set())
    setWizardStep(2)
    checkSilverTables(domainId)
  }

  function handleSelectLayer(layer) {
    const domainConfig = SAMPLE_DOMAINS.find(d => d.id === wizardDomain)
    let samples = domainConfig?.layers?.[layer] || []

    if (layer === 'gold') {
      samples = samples.filter(s => silverCheckMap[s.pipeline_name] === true)
    }

    if (layer === 'gold' && samples.length === 0) return

    setWizardLayer(layer)
    setSelectedPipelines(new Set())
    setWizardStep(3)
  }

  function togglePipelineSelection(name) {
    setSelectedPipelines(prev => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }

  function getAvailableSamples() {
    const domainConfig = SAMPLE_DOMAINS.find(d => d.id === wizardDomain)
    let samples = domainConfig?.layers?.[wizardLayer] || []
    if (wizardLayer === 'gold') {
      samples = samples.filter(s => silverCheckMap[s.pipeline_name] === true)
    }
    return samples
  }

  const executeSampleGeneration = async () => {
    const domainConfig = SAMPLE_DOMAINS.find(d => d.id === wizardDomain)
    const allSamples = domainConfig?.layers?.[wizardLayer] || []
    const samples = allSamples.filter(s => selectedPipelines.has(s.pipeline_name))
    if (samples.length === 0) return

    setGenerateLoading(true)
    setLoading(true)
    try {
      const m = await import('../api/connectors')
      const res = await m.listConnectors()
      const connectors = res.connectors || []

      let successCount = 0
      for (const sample of samples) {
        const sourceType = sample.source_type || 'connector'
        let connector = null
        if (sourceType === 'connector') {
          connector = connectors.find(c => c.name.toLowerCase() === sample.connector_name.toLowerCase())
          if (!connector) {
            console.warn(`Connector ${sample.connector_name} not found. Skipping.`)
            continue
          }
        }

        let pipelineId
        try {
          const freshPipelinesData = await api.listPipelines()
          const freshPipelines = freshPipelinesData.pipelines || []
          const existingPipeline = freshPipelines.find(
            p => p.name === sample.pipeline_name && p.status !== 'archived'
          )

          if (existingPipeline) {
            pipelineId = existingPipeline.id
          } else {
            const createRes = await api.createPipeline({ name: sample.pipeline_name, description: sample.description, engine: 'trino' })
            pipelineId = createRes.pipeline.id
          }
        } catch (err) {
          console.warn('Error getting/creating pipeline:', err)
          continue
        }

        let column_mapping = {}
        let defJson
        const sinkSchema = sample.target_schema || 'silver'
        const sourceNode = sourceType === 'table'
          ? {
            id: 'source_1',
            type: 'source',
            position: { x: 300, y: 50 },
            data: {
              label: sample.source_table,
              catalog: sample.source_catalog || 'iceberg',
              schema: sample.source_schema || 'silver',
              table: sample.source_table,
              source_mode: 'always_full_load',
            }
          }
          : {
            id: 'source_1',
            type: 'source',
            position: { x: 300, y: 50 },
            data: {
              label: sample.connector_name,
              catalog: 'iceberg',
              schema: 'bronze',
              table: sample.connector_name,
              source_mode: 'incremental_changes',
            }
          }

        if (sample.sql) {
          column_mapping = sample.column_mapping || {}
          defJson = {
            nodes: [
              sourceNode,
              { id: 'sql_1', type: 'custom_sql', position: { x: 300, y: 160 }, data: { label: 'Transform CostItem', sql: sample.sql } },
              { id: 'sink_1', type: 'sink', position: { x: 300, y: 270 }, data: { label: sample.target_table, catalog: 'iceberg', schema: sinkSchema, table: sample.target_table, write_mode: 'merge', merge_keys: sample.merge_keys, column_mapping } }
            ],
            edges: [
              { id: 'e1', source: 'source_1', target: 'sql_1' },
              { id: 'e2', source: 'sql_1', target: 'sink_1' }
            ]
          }
        } else {
          sample.columns.forEach(col => {
            if (col !== '*') {
              const match = col.match(/\s+AS\s+([a-zA-Z0-9_]+)\s*$/i)
              if (match) {
                column_mapping[match[1]] = match[1]
              } else {
                const parts = col.trim().split(/\s+/)
                if (parts.length > 0) {
                  const alias = parts[parts.length - 1]
                  column_mapping[alias] = alias
                }
              }
            }
          })
          defJson = {
            nodes: [
              sourceNode,
              { id: 'select_1', type: 'select', position: { x: 300, y: 160 }, data: { label: 'Transform', columns: sample.columns } },
              { id: 'sink_1', type: 'sink', position: { x: 300, y: 270 }, data: { label: sample.target_table, catalog: 'iceberg', schema: sinkSchema, table: sample.target_table, write_mode: 'merge', merge_keys: sample.merge_keys, column_mapping: Object.keys(column_mapping).length > 0 ? column_mapping : undefined } }
            ],
            edges: [
              { id: 'e1', source: 'source_1', target: 'select_1' },
              { id: 'e2', source: 'select_1', target: 'sink_1' }
            ]
          }
        }

        try {
          await api.describeTable(sinkSchema, sample.target_table)
        } catch (_) {
          const tableCols = Object.keys(column_mapping).map(c => ({ name: c.toLowerCase(), type: 'VARCHAR', comment: '' }))
          try {
            await api.createTable({ schema_name: sinkSchema, table_name: sample.target_table, columns: tableCols, file_format: 'PARQUET' })
          } catch (ce) {
            console.warn('[GenerateSample] createTable:', ce.message)
          }
        }

        await api.publishPipeline(pipelineId, { definition_json: defJson, validate_schema: false })
        if (sourceType === 'connector' && connector) {
          try {
            await api.addDownstreamTrigger(connector.id, { pipeline_id: pipelineId, enabled: true })
          } catch (triggerErr) {
            console.log('Trigger might already exist:', triggerErr)
          }
        }
        if (sample.upstream_sample_name) {
          try {
            const freshPipelinesData = await api.listPipelines()
            const freshPipelines = freshPipelinesData.pipelines || []
            const upstreamPipeline = freshPipelines.find(p => p.name === sample.upstream_sample_name && p.status !== 'archived')
            if (upstreamPipeline) {
              await api.addPipelineDownstreamTrigger(upstreamPipeline.id, {
                downstream_pipeline_id: pipelineId,
                enabled: true,
                only_if_new_rows: true
              })
              console.log(`Successfully linked trigger from upstream '${sample.upstream_sample_name}' to downstream '${sample.pipeline_name}'`)
            }
          } catch (trigErr) {
            console.log('Error adding pipeline-to-pipeline trigger:', trigErr)
          }
        }
        successCount++
      }

      showToast('success', `Generated ${successCount} sample pipelines!`)
      closeWizard()
      await loadPipelines()
    } catch (e) {
      showToast('error', e.message)
    } finally {
      setGenerateLoading(false)
      setLoading(false)
    }
  }

  function showToast(type, msg) {
    setToast({ type, msg })
    setTimeout(() => setToast(null), 3500)
  }

  // ── Actions ───────────────────────────────────────────────────────────────

  async function handleCreate() {
    if (!createForm.name.trim()) return
    setCreateLoading(true)
    try {
      const data = await api.createPipeline(createForm)
      setShowCreateModal(false)
      setCreateForm({ name: '', description: '', engine: 'trino' })
      navigate(`/pipelines/${data.pipeline.id}`)
    } catch (e) { showToast('error', e.message) }
    setCreateLoading(false)
  }

  async function handleDelete(p, e) {
    e.stopPropagation()
    setDeleteConfirm({ type: 'pipeline', id: p.id, name: p.name, title: 'Archive Pipeline', warning: 'Can be restored later.' })
  }

  async function executeDelete() {
    if (!deleteConfirm) return
    const { type, id, name } = deleteConfirm
    setDeleteConfirm(null)

    if (type === 'pipeline') {
      try {
        await api.deletePipeline(id)
        showToast('success', `Archived "${name}"`)
        loadPipelines()
      } catch (e) { showToast('error', e.message) }
    } else if (type === 'schedule') {
      try {
        await api.deletePipelineSchedule(id)
        showToast('success', 'Schedule removed')
        loadPipelines()
      } catch (e) { showToast('error', e.message) }
    }
  }

  async function handleToggleEnabled(p) {
    if (togglingId) return
    setTogglingId(p.id)
    // Optimistic
    setPipelines(prev => prev.map(item => item.id === p.id ? { ...item, is_enabled: !item.is_enabled } : item))
    try {
      const data = await api.togglePipelineEnabled(p.id)
      showToast('success', `Pipeline "${p.name}" ${data.is_enabled ? 'enabled' : 'disabled'}`)
    } catch (err) {
      showToast('error', err.message)
      loadPipelines()
    }
    setTogglingId(null)
  }

  async function handleClone(p, e) {
    e.stopPropagation()
    setCloneForm({ id: p.id, name: p.name + ' - Copy' })
    setShowCloneModal(true)
  }

  async function submitClone() {
    if (!cloneForm.name.trim()) return
    try {
      await api.clonePipeline(cloneForm.id, { name: cloneForm.name })
      setShowCloneModal(false)
      showToast('success', `Cloned as "${cloneForm.name}"`)
      loadPipelines()
    } catch (e) { showToast('error', e.message) }
  }

  async function handleSchedule(p, e) {
    e.stopPropagation()
    const form = { ...defaultScheduleForm, pipelineId: p.id, pipelineName: p.name }
    try {
      const data = await api.getPipelineSchedule(p.id)
      if (data.schedule) {
        const s = data.schedule
        form.run_type = s.run_type || 'scheduled'
        form.cron_expr = s.cron_expr || '0 * * * *'
        form.run_at = s.run_at ? s.run_at.slice(0, 16) : ''
        form.timezone = s.timezone || 'Asia/Ho_Chi_Minh'
        form.enabled = s.enabled
        form.cron_custom = !SCHEDULE_PRESETS.some(pr => pr.value === form.cron_expr)
      }
    } catch (e) { console.error(e) }
    setScheduleForm(form)
    setShowScheduleModal(true)
  }

  async function submitSchedule() {
    setScheduleLoading(true)
    try {
      const payload = { run_type: scheduleForm.run_type, timezone: scheduleForm.timezone, enabled: scheduleForm.enabled }
      if (scheduleForm.run_type === 'scheduled') payload.cron_expr = scheduleForm.cron_expr
      else payload.run_at = scheduleForm.run_at ? new Date(scheduleForm.run_at).toISOString() : null
      await api.setPipelineSchedule(scheduleForm.pipelineId, payload)
      setShowScheduleModal(false)
      showToast('success', `Schedule updated for "${scheduleForm.pipelineName}"`)
      loadPipelines()
    } catch (e) { showToast('error', e.message) }
    setScheduleLoading(false)
  }

  async function handleDeleteSchedule(pipelineId, pipelineName) {
    setDeleteConfirm({ type: 'schedule', id: pipelineId, name: pipelineName, title: 'Remove Schedule', warning: 'Schedule will be deleted permanently.' })
  }

  async function handleRunNow(p, e, runMode = 'incremental') {
    e.stopPropagation()
    if (runningId || !p.is_enabled || p.latest_version === 0) return
    if (activeRuns[p.id]) {
      showToast('error', `Pipeline "${p.name}" is already running. Stop it before starting a new run.`)
      return
    }
    setRunningId(p.id)
    try {
      const data = await api.triggerPipelineRun(p.id, { run_mode: runMode })
      showToast('success', `⏵ Pipeline "${p.name}" triggered! Run ID: ${(data.run_id || '').slice(0, 8)} [${runMode}]`)
      setActiveRuns(prev => ({ ...prev, [p.id]: data.run_id }))
    } catch (err) {
      // 409 = already running — refresh state
      if (err.status === 409 || (err.message || '').includes('409')) {
        showToast('error', `Pipeline "${p.name}" is already running!`)
        loadPipelines()
      } else {
        showToast('error', `Failed to run: ${err.message}`)
      }
    } finally {
      setRunningId(null)
    }
  }

  async function handleStopRun(p, e) {
    e.stopPropagation()
    const runId = activeRuns[p.id]
    if (!runId) return
    try {
      await api.cancelPipelineRun(runId)
      setActiveRuns(prev => { const n = { ...prev }; delete n[p.id]; return n })
      showToast('success', `⏹ Pipeline "${p.name}" has been stopped.`)
    } catch (err) {
      showToast('error', `Failed to stop: ${err.message}`)
    }
  }

  async function handleForceUnlock(p) {
    const msg = `CẢNH BÁO QUAN TRỌNG:
Hành động Force Unlock giả định rằng lượt chạy Dagster tương ứng đã chết hoặc bị treo hoàn toàn.
Nếu bạn thực hiện khi pipeline vẫn đang chạy thực sự trên Dagster, điều này có thể dẫn tới ghi đè dữ liệu đồng thời (race conditions) hoặc lỗi dữ liệu nghiêm trọng.

Bạn có chắc chắn muốn giải phóng Watermark Lock cho pipeline "${p.name}"?`
    
    if (!window.confirm(msg)) return
    
    try {
      const res = await api.forceUnlockPipeline(p.id)
      showToast('success', res.message || 'Pipeline force unlocked successfully.')
      await loadPipelines()
    } catch (err) {
      showToast('error', `Failed to force unlock: ${err.message}`)
    }
  }

  async function toggleScheduleEnabled(p, newEnabled) {
    if (!p.schedule) return
    const targetEnabled = newEnabled !== undefined ? newEnabled : !p.schedule.enabled
    setPipelines(prev => prev.map(item =>
      item.id === p.id ? { ...item, schedule: { ...item.schedule, enabled: targetEnabled } } : item
    ))
    try {
      await api.setPipelineSchedule(p.id, {
        run_type: p.schedule.run_type, cron_expr: p.schedule.cron_expr,
        run_at: p.schedule.run_at, timezone: p.schedule.timezone, enabled: targetEnabled,
      })
      showToast('success', `Schedule ${targetEnabled ? 'enabled' : 'disabled'} for "${p.name}"`)
    } catch (err) {
      showToast('error', err.message)
      loadPipelines()
    }
  }

  // ── Derived data ──────────────────────────────────────────────────────────

  const visible = (pipelines || [])
    .filter(p => {
      if (!p || p.status === 'archived') return false
      const s = (search || '').toLowerCase()
      return (p.name || '').toLowerCase().includes(s) ||
        (p.description || '').toLowerCase().includes(s) ||
        (p.engine || '').toLowerCase().includes(s)
    })
    .sort((a, b) => new Date(b.updated_at || b.created_at || 0) - new Date(a.updated_at || a.created_at || 0))

  const stats = {
    total: visible.length,
    active: visible.filter(p => p?.status === 'active').length,
    scheduled: visible.filter(p => p?.schedule?.enabled).length,
    triggered: visible.filter(p => (p?.trigger_source_count || 0) > 0).length,
    error: visible.filter(p => !p?.is_enabled || p?.status === 'error').length,
  }

  const selectedDomainConfig = SAMPLE_DOMAINS.find(d => d.id === wizardDomain) || null
  const silverSamples = selectedDomainConfig?.layers?.silver || []
  const goldSamples = selectedDomainConfig?.layers?.gold || []
  const goldReadyCount = goldSamples.filter(s => silverCheckMap[s.pipeline_name] === true).length
  const wizardAvailableSamples = getAvailableSamples()
  const allWizardSelected = wizardAvailableSamples.length > 0 && selectedPipelines.size === wizardAvailableSamples.length

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div style={{ ...S.page, padding: '32px' }}>

      {/* ── Header ── */}
      <div style={S.header}>
        <div style={{ ...S.title, fontSize: 26 }}>
          <div style={{ background: 'rgba(99,102,241,0.15)', padding: 12, borderRadius: 16, display: 'flex', boxShadow: '0 0 20px rgba(99,102,241,0.2)' }}>
            <Zap size={28} color="#818cf8" />
          </div>
          Pipeline Studio
          <span style={{ fontSize: 10, color: '#475569', marginLeft: 12, fontWeight: 500, letterSpacing: 1 }}>v1.0.0</span>
        </div>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <div style={{ position: 'relative' }}>
            <Search size={15} color="#64748b" style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)' }} />
            <input
              placeholder="Search pipelines..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              style={{ ...S.input, paddingLeft: 40, width: 280, background: 'rgba(0,0,0,0.3)', height: 44, borderRadius: 12 }}
            />
          </div>
          <button style={{ ...S.btn('ghost'), width: 44, height: 44, padding: 0, justifyContent: 'center' }} onClick={loadPipelines} disabled={loading} title="Refresh">
            <RefreshCw size={18} className={loading ? 'spin' : ''} />
          </button>
          <button style={{ ...S.btn('ghost'), height: 44, padding: '0 24px', borderRadius: 12, color: '#facc15', borderColor: 'rgba(250,204,21,0.3)', background: 'rgba(250,204,21,0.05)' }} onClick={openSampleWizard} disabled={loading}>
            ⚡ Generate Samples
          </button>
          <button style={{ ...S.btn('primary'), height: 44, padding: '0 24px', borderRadius: 12 }} onClick={() => setShowCreateModal(true)}>
            <Plus size={18} /> New Pipeline
          </button>
        </div>
      </div>

      {/* ── Summary Cards ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 20, marginBottom: 36 }}>
        <SummaryCard icon={Database} label="TOTAL PIPELINES" value={stats.total} colorClass="purple" />
        <SummaryCard icon={CheckCircle} label="ACTIVE" value={stats.active} colorClass="green" sub="Published & running" />
        <SummaryCard icon={Calendar} label="SCHEDULED" value={stats.scheduled} colorClass="cyan" sub="Auto-triggered" />
        <SummaryCard icon={GitMerge} label="TRIGGERED" value={stats.triggered} colorClass="amber" sub="Has connector trigger" />
        <SummaryCard icon={AlertCircle} label="ERROR / DISABLED" value={stats.error} colorClass="red" highlight={stats.error > 0} sub={stats.error > 0 ? 'Needs attention' : 'All healthy'} />
      </div>

      {/* ── Table ── */}
      <div style={S.card}>
        {visible.length === 0 && !loading ? (
          <div style={{ textAlign: 'center', padding: '60px 20px' }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>⚡</div>
            <h3 style={{ fontSize: 18, color: '#e2e8f0', marginBottom: 8 }}>No pipelines yet</h3>
            <p style={{ color: '#64748b', fontSize: 14, marginBottom: 20 }}>Create your first pipeline to start transforming data.</p>
            <button style={{ ...S.btn('primary'), margin: '0 auto' }} onClick={() => setShowCreateModal(true)}>
              <Plus size={14} /> Create Pipeline
            </button>
          </div>
        ) : (
          <table style={S.table}>
            <thead>
              <tr style={{ background: 'rgba(0,0,0,0.3)' }}>
                {[
                  { h: '', width: 50, align: 'center' },
                  { h: 'Pipeline', width: '25%', align: 'left' },
                  { h: 'Status', width: '10%', align: 'center' },
                  { h: 'Trigger By', width: '12%', align: 'center' },
                  { h: 'Trigger', width: '10%', align: 'center' },
                  { h: 'Version', width: '7%', align: 'center' },
                  { h: 'Schedule', width: '18%', align: 'center' },
                  { h: 'Last Updated', width: '12%', align: 'center' },
                  { h: 'Actions', align: 'right' },
                ].map(col => (
                  <th key={col.h} style={{ ...S.th, padding: col.h === '' ? '16px 12px' : '16px 20px', fontSize: 12, width: col.width, textAlign: col.align }}>{col.h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visible.map(p => {
                const isDisabled = !p.is_enabled
                return (
                  <tr
                    key={p.id}
                    style={{ transition: 'background 0.2s', opacity: isDisabled ? 0.75 : 1, position: openMenuId === p.id ? 'relative' : 'static', zIndex: openMenuId === p.id ? 99 : 1 }}
                    onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.02)'}
                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                  >
                    {/* ── Master Toggle ── */}
                    <td style={{ ...S.td, padding: '16px 12px', width: 40 }}>
                      <div style={{ display: 'flex', justifyContent: 'center' }}>
                        <Toggle active={!isDisabled} onChange={() => handleToggleEnabled(p)} disabled={!!togglingId} activeColor="#6366f1" />
                      </div>
                    </td>

                    {/* ── Name ── */}
                    <td style={{ ...S.td, maxWidth: 280 }}>
                      <div 
                        title={p.name}
                        style={{ fontWeight: 700, color: '#f1f5f9', fontSize: 14, cursor: 'pointer', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} 
                        onClick={() => navigate(`/pipelines/${p.id}`)}
                      >
                        {p.name}
                      </div>
                      <div 
                        title={p.description || 'No description'}
                        style={{ fontSize: 11, color: '#64748b', marginTop: 2, fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                      >
                        {p.description || 'No description'}
                      </div>
                    </td>

                    {/* ── Status ── */}
                    <td style={{ ...S.td, textAlign: 'center' }}>
                      <div style={{ display: 'flex', justifyContent: 'center' }}>
                        <StatusBadge status={isDisabled ? 'inactive' : p.status} />
                      </div>
                    </td>

                    {/* ── Trigger By (Source / Triggered By) ── */}
                    <td style={{ ...S.td, textAlign: 'center' }}>
                      {p.trigger_sources && p.trigger_sources.length > 0 ? (() => {
                        const count = p.trigger_sources.length
                        const label = count === 1 ? '1 CONNECTOR' : `${count} CONNECTORS`
                        const connId = p.trigger_sources[0].connector_id
                        const tooltip = p.trigger_sources.map(s => s.connector_name).join('\n')
                        return (
                          <span
                            onClick={(e) => {
                              e.stopPropagation()
                              if (count === 1) {
                                navigate(`/connectors?highlight=${connId}&open=history`)
                              } else {
                                navigate('/connectors')
                              }
                            }}
                            style={{
                              fontSize: 11, padding: '4px 10px', borderRadius: 20,
                              background: 'rgba(251,191,36,0.1)', color: '#fbbf24',
                              border: '1px solid rgba(251,191,36,0.3)', fontWeight: 600,
                              display: 'inline-flex', alignItems: 'center', gap: 4,
                              cursor: 'pointer', transition: 'all 0.2s',
                            }}
                            onMouseEnter={e => {
                              e.currentTarget.style.background = 'rgba(251,191,36,0.2)'
                              e.currentTarget.style.boxShadow = '0 0 10px rgba(251,191,36,0.2)'
                            }}
                            onMouseLeave={e => {
                              e.currentTarget.style.background = 'rgba(251,191,36,0.1)'
                              e.currentTarget.style.boxShadow = 'none'
                            }}
                            title={tooltip}
                          >
                            <Database size={10} /> {label}
                          </span>
                        )
                      })() : p.trigger_by_pipelines && p.trigger_by_pipelines.length > 0 ? (() => {
                        const count = p.trigger_by_pipelines.length
                        const label = count === 1 ? '1 PIPELINE' : `${count} PIPELINES`
                        const upId = p.trigger_by_pipelines[0].upstream_pipeline_id
                        const tooltip = p.trigger_by_pipelines.map(s => s.upstream_pipeline_name).join('\n')
                        return (
                          <span
                            onClick={(e) => {
                              e.stopPropagation()
                              navigate(`/pipelines/${upId}?tab=history`)
                            }}
                            style={{
                              fontSize: 11, padding: '4px 10px', borderRadius: 20,
                              background: 'rgba(251,191,36,0.1)', color: '#fbbf24',
                              border: '1px solid rgba(251,191,36,0.3)', fontWeight: 600,
                              display: 'inline-flex', alignItems: 'center', gap: 4,
                              cursor: 'pointer', transition: 'all 0.2s',
                            }}
                            onMouseEnter={e => {
                              e.currentTarget.style.background = 'rgba(251,191,36,0.2)'
                              e.currentTarget.style.boxShadow = '0 0 10px rgba(251,191,36,0.2)'
                            }}
                            onMouseLeave={e => {
                              e.currentTarget.style.background = 'rgba(251,191,36,0.1)'
                              e.currentTarget.style.boxShadow = 'none'
                            }}
                            title={tooltip}
                          >
                            <GitBranch size={10} /> {label}
                          </span>
                        )
                      })() : (
                        <span style={{ fontSize: 11, color: '#64748b' }}>Manual</span>
                      )}
                    </td>

                    {/* ── Trigger (Downstream targets) ── */}
                    <td style={{ ...S.td, textAlign: 'center' }}>
                      <div
                        onClick={(e) => { e.stopPropagation(); navigate(`/pipelines/${p.id}?tab=trigger`); }}
                        style={{ display: 'flex', justifyContent: 'center', gap: 6, alignItems: 'center', cursor: 'pointer', opacity: 0.9 }}
                        onMouseEnter={e => e.currentTarget.style.opacity = 1}
                        onMouseLeave={e => e.currentTarget.style.opacity = 0.9}
                        title={p.trigger_targets && p.trigger_targets.length > 0 ? p.trigger_targets.map(t => t.downstream_pipeline_name).join('\n') : 'Manage Trigger Targets'}
                      >
                        {p.trigger_count > 0 ? (
                          <span style={{ fontSize: 11, padding: '4px 12px', borderRadius: 20, background: 'rgba(251,191,36,0.1)', color: '#fbbf24', border: '1px solid rgba(251,191,36,0.3)', fontWeight: 700, transition: 'all 0.2s', boxShadow: '0 0 10px rgba(251,191,36,0.1)' }}>
                            {p.trigger_count === 1 ? '1 PIPELINE' : `${p.trigger_count} PIPELINES`}
                          </span>
                        ) : (
                          <span style={{ fontSize: 11, color: '#64748b' }}>None</span>
                        )}
                      </div>
                    </td>

                    {/* ── Version ── */}
                    <td style={{ ...S.td, textAlign: 'center' }}>
                      {p.latest_version > 0 ? (
                        <span style={{ fontSize: 11, color: '#818cf8', background: 'rgba(99,102,241,0.1)', padding: '3px 8px', borderRadius: 20, border: '1px solid rgba(99,102,241,0.25)', fontWeight: 600, fontFamily: 'JetBrains Mono, monospace' }}>
                          v{p.latest_version}
                        </span>
                      ) : (
                        <span style={{ fontSize: 11, color: '#475569' }}>draft</span>
                      )}
                    </td>

                    {/* ── Schedule ── */}
                    <td style={S.td}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                        <div title={p.schedule?.enabled ? 'Disable schedule' : 'Enable schedule'}>
                          <Toggle
                            active={!!p.schedule?.enabled}
                            onChange={val => toggleScheduleEnabled(p, val)}
                            disabled={isDisabled || !p.schedule}
                            activeColor="#22d3ee"
                          />
                        </div>
                        <span style={{
                          fontSize: 13,
                          color: isDisabled || !p.schedule ? '#64748b' : '#cbd5e1',
                          visibility: p.schedule ? 'visible' : 'hidden',
                          whiteSpace: 'nowrap',
                        }}>
                          {p.schedule?.run_type === 'onetime'
                            ? (p.schedule.run_at ? formatDate(p.schedule.run_at) : 'One-time')
                            : describeCron(p.schedule?.cron_expr || '—')}
                        </span>
                      </div>
                    </td>

                    {/* ── Last Updated ── */}
                    <td style={{ ...S.td, textAlign: 'center' }}>
                      <div style={{ fontSize: 12, color: '#64748b', whiteSpace: 'nowrap' }}>
                        {p.updated_at ? formatDate(p.updated_at) : '—'}
                      </div>
                    </td>

                    {/* ── Actions ── */}
                    <td style={{ ...S.td, textAlign: 'right' }}>
                      <div style={{ display: 'flex', gap: 6, alignItems: 'center', justifyContent: 'flex-end', position: 'relative' }}>
                        {/* Run / Stop button */}
                        {activeRuns[p.id] ? (
                          <button
                            style={{
                              ...S.btn('ghost'), padding: '6px 10px', height: 32,
                              color: '#f87171', borderColor: 'rgba(248,113,113,0.4)',
                              background: 'rgba(248,113,113,0.08)',
                              animation: 'pulse 2s infinite',
                            }}
                            onClick={e => handleStopRun(p, e)}
                            title="Pipeline is running — Click to stop"
                          >
                            <RefreshCw size={12} className="spin" /> Running...
                          </button>
                        ) : (
                          <button
                            style={{
                              ...S.btn('ghost'), padding: '6px 10px', height: 32,
                              color: '#34d399', borderColor: 'rgba(52,211,153,0.35)',
                              opacity: (isDisabled || p.latest_version === 0 || runningId === p.id) ? 0.45 : 1,
                            }}
                            onClick={e => handleRunNow(p, e, 'incremental')}
                            disabled={isDisabled || p.latest_version === 0 || !!runningId}
                            title={isDisabled ? 'Enable pipeline first' : p.latest_version === 0 ? 'Save Pipeline first' : 'Run pipeline (incremental)'}
                          >
                            {runningId === p.id ? <RefreshCw size={12} className="spin" /> : <Play size={12} />}
                            Run
                          </button>
                        )}

                        {/* History */}
                        <button
                          style={{ ...S.btn('ghost'), padding: '6px 10px', height: 32, color: '#60a5fa', borderColor: 'rgba(96,165,250,0.3)' }}
                          onClick={() => navigate(`/pipelines/${p.id}?tab=history`)}
                          title="View run history"
                        >
                          <History size={12} /> History
                        </button>

                        {/* ⋯ Menu */}
                        <div style={{ position: 'relative' }}>
                          <button
                            style={{ ...S.btn('ghost'), padding: '6px', height: 32, aspectRatio: '1/1', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                            onClick={e => { e.stopPropagation(); setOpenMenuId(openMenuId === p.id ? null : p.id) }}
                          >
                            <MoreVertical size={16} color="#94a3b8" />
                          </button>

                          {openMenuId === p.id && (() => {
                            const rowIndex = visible.findIndex(x => x.id === p.id)
                            const isNearBottom = rowIndex >= visible.length - 2
                            return (
                              <div
                                onMouseDown={e => e.stopPropagation()}
                                style={{
                                  position: 'absolute', right: 0,
                                  ...(isNearBottom ? { bottom: '100%', marginBottom: 8 } : { top: '100%', marginTop: 8 }),
                                  background: '#1e293b', border: '1px solid #334155', borderRadius: 10,
                                  padding: 6, minWidth: 175, zIndex: 1000,
                                  boxShadow: '0 12px 30px rgba(0,0,0,0.6)',
                                  display: 'flex', flexDirection: 'column', gap: 2,
                                }}
                              >
                                {!isDisabled && p.latest_version > 0 && (
                                  <button
                                    style={{ ...S.btn('ghost'), width: '100%', justifyContent: 'flex-start', color: '#fbbf24', border: 'none', height: 34, opacity: runningId === p.id ? 0.5 : 1 }}
                                    onClick={e => { handleRunNow(p, e, 'full_refresh'); setOpenMenuId(null) }}
                                    disabled={!!runningId}
                                    title="Full load (reprocess all data)"
                                  >
                                    <RefreshCw size={14} style={{ marginRight: 8 }} /> Full load
                                  </button>
                                )}
                                <button
                                  style={{ ...S.btn('ghost'), width: '100%', justifyContent: 'flex-start', color: '#c084fc', border: 'none', opacity: isDisabled ? 0.5 : 1, height: 34 }}
                                  onClick={e => { if (!isDisabled) handleSchedule(p, e); setOpenMenuId(null) }}
                                  disabled={isDisabled}
                                  title={isDisabled ? 'Enable pipeline first' : 'Configure schedule'}
                                >
                                  <Calendar size={14} style={{ marginRight: 8 }} /> Schedule
                                </button>
                                <button
                                  style={{ ...S.btn('ghost'), width: '100%', justifyContent: 'flex-start', color: '#34d399', border: 'none', height: 34 }}
                                  onClick={e => { handleClone(p, e); setOpenMenuId(null) }}
                                >
                                  <Copy size={14} style={{ marginRight: 8 }} /> Clone
                                </button>
                                <button
                                  style={{ ...S.btn('ghost'), width: '100%', justifyContent: 'flex-start', color: '#60a5fa', border: 'none', height: 34 }}
                                  onClick={() => { navigate(`/pipelines/${p.id}`); setOpenMenuId(null) }}
                                >
                                  <Eye size={14} style={{ marginRight: 8 }} /> Open Editor
                                 </button>
                                 <button
                                   style={{ ...S.btn('ghost'), width: '100%', justifyContent: 'flex-start', color: '#f43f5e', border: 'none', height: 34 }}
                                   onClick={e => { handleForceUnlock(p); setOpenMenuId(null) }}
                                   title="Force release watermark lock and mark stuck runs as failed"
                                 >
                                   <Unlock size={14} style={{ marginRight: 8 }} /> Force Unlock
                                 </button>
                                <div style={{ height: 1, background: '#334155', margin: '3px 4px' }} />
                                <button
                                  style={{ ...S.btn('ghost'), width: '100%', justifyContent: 'flex-start', color: '#ef4444', border: 'none', height: 34 }}
                                  onClick={e => { handleDelete(p, e); setOpenMenuId(null) }}
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
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* ── Sample Wizard Modal ── */}
      {showSampleWizard && (
        <Overlay onClose={closeWizard}>
          <div style={{ ...S.drawer, maxWidth: 600 }}>
            <div style={S.drawerHeader}>
              <div style={{ fontWeight: 700, fontSize: 16, color: '#e2e8f0', display: 'flex', alignItems: 'center', gap: 8 }}>
                <Zap size={18} color="#facc15" /> Generate Sample Pipelines
              </div>
              <button onClick={closeWizard} style={{ background: 'none', border: 'none', color: '#64748b', cursor: 'pointer' }}>✕</button>
            </div>
            <div style={S.drawerBody}>
              <div style={S.breadcrumb}>
                <span style={wizardStep >= 1 ? { color: '#e2e8f0' } : {}}>Domain</span>
                <ChevronRight size={12} />
                <span style={wizardStep >= 2 ? { color: '#e2e8f0' } : { opacity: 0.4 }}>Layer</span>
                <ChevronRight size={12} />
                <span style={wizardStep >= 3 ? { color: '#e2e8f0' } : { opacity: 0.4 }}>Confirm</span>
              </div>

              {wizardStep === 1 && (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 12 }}>
                  {SAMPLE_DOMAINS.map((domain) => (
                    <div
                      key={domain.id}
                      onClick={() => handleSelectDomain(domain.id)}
                      style={S.wizardLayerCard(false, false)}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <div>
                          <div style={{ fontSize: 16, fontWeight: 700, color: '#e2e8f0' }}>{domain.icon && `${domain.icon} `}{domain.label}</div>
                          <div style={{ fontSize: 12, color: '#64748b', marginTop: 6 }}>{domain.desc}</div>
                        </div>
                        <ChevronRight size={16} color="#94a3b8" />
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {wizardStep === 2 && selectedDomainConfig && (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 12 }}>
                  <div
                    onClick={() => handleSelectLayer('silver')}
                    style={S.wizardLayerCard(false, false)}
                  >
                    <div style={{ fontSize: 16, fontWeight: 700, color: '#e2e8f0' }}>🥈 Silver</div>
                    <div style={{ fontSize: 12, color: '#64748b', marginTop: 6 }}>{silverSamples.length} pipelines</div>
                  </div>

                  <div
                    onClick={() => !checkingSilver && goldReadyCount > 0 && handleSelectLayer('gold')}
                    style={S.wizardLayerCard(false, checkingSilver || goldReadyCount === 0)}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <div style={{ fontSize: 16, fontWeight: 700, color: '#e2e8f0' }}>🥇 Gold</div>
                      {checkingSilver ? (
                        <span style={{ fontSize: 12, color: '#94a3b8', display: 'flex', alignItems: 'center', gap: 6 }}>
                          <RefreshCw size={12} className="spin" /> Checking Silver tables...
                        </span>
                      ) : (
                        <span style={{ fontSize: 12, color: goldReadyCount > 0 ? '#22c55e' : '#f59e0b' }}>
                          {goldReadyCount} pipelines ready
                        </span>
                      )}
                    </div>
                    {!checkingSilver && (
                      <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
                        {goldSamples.map((s) => {
                          const exists = silverCheckMap[s.pipeline_name] === true
                          return (
                            <div key={s.pipeline_name} style={{ fontSize: 12, color: exists ? '#cbd5e1' : '#64748b' }}>
                              {exists ? '✅' : '⚠️'} {s.pipeline_name}{exists ? '' : ' (Silver table missing)'}
                            </div>
                          )
                        })}
                      </div>
                    )}
                    {!checkingSilver && goldSamples.length > goldReadyCount && (
                      <div style={{ marginTop: 10, fontSize: 11, color: '#f59e0b' }}>
                        {goldSamples.length} pipelines available, {goldSamples.length - goldReadyCount} skipped (missing Silver source)
                      </div>
                    )}
                  </div>
                </div>
              )}

              {wizardStep === 3 && (
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                    <div style={{ fontSize: 12, color: '#94a3b8' }}>{wizardAvailableSamples.length} pipelines available</div>
                    {wizardAvailableSamples.length > 0 && (
                      <button
                        onClick={() => {
                          if (allWizardSelected) setSelectedPipelines(new Set())
                          else setSelectedPipelines(new Set(wizardAvailableSamples.map(s => s.pipeline_name)))
                        }}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#818cf8', fontSize: 12 }}
                      >
                        {allWizardSelected ? 'Deselect All' : 'Select All'}
                      </button>
                    )}
                  </div>
                  <div style={{ border: '1px solid #1e293b', borderRadius: 10, padding: '0 14px', maxHeight: 300, overflowY: 'auto' }}>
                    {wizardAvailableSamples.map(s => (
                      <div key={s.pipeline_name} style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '12px 0', borderBottom: '1px solid #1e293b' }}>
                        <input
                          type="checkbox"
                          checked={selectedPipelines.has(s.pipeline_name)}
                          onChange={() => togglePipelineSelection(s.pipeline_name)}
                          style={{ marginTop: 2, accentColor: '#6366f1', width: 15, height: 15, cursor: 'pointer' }}
                        />
                        <div>
                          <div style={{ fontSize: 13, fontWeight: 600, color: '#e2e8f0' }}>{s.pipeline_name}</div>
                          <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>
                            {s.source_type === 'connector'
                              ? `Source: ${s.connector_name}`
                              : `Source: ${s.source_schema}.${s.source_table}`}
                            {' -> '}Target: {(s.target_schema || 'silver')}.{s.target_table}
                          </div>
                        </div>
                      </div>
                    ))}
                    {wizardAvailableSamples.length === 0 && (
                      <div style={{ padding: '16px 0', fontSize: 12, color: '#64748b' }}>No pipelines available for this selection.</div>
                    )}
                  </div>
                </div>
              )}
            </div>

            <div style={S.drawerFooter}>
              <div style={{ display: 'flex', gap: 10 }}>
                {wizardStep > 1 && (
                  <button
                    style={S.btn('ghost')}
                    onClick={() => {
                      if (wizardStep === 3) {
                        setWizardStep(2)
                        setWizardLayer(null)
                        setSelectedPipelines(new Set())
                      } else if (wizardStep === 2) {
                        setWizardStep(1)
                        setWizardDomain(null)
                        setWizardLayer(null)
                        setSilverCheckMap({})
                        setSelectedPipelines(new Set())
                      }
                    }}
                  >
                    ← Back
                  </button>
                )}
              </div>
              <div style={{ display: 'flex', gap: 10 }}>
                <button style={S.btn('ghost')} onClick={closeWizard}>Cancel</button>
                {wizardStep === 3 && (
                  <button
                    style={S.btn('primary')}
                    onClick={executeSampleGeneration}
                    disabled={generateLoading || selectedPipelines.size === 0}
                  >
                    {generateLoading ? <RefreshCw size={13} className="spin" /> : <Zap size={13} />}
                    {`Generate ${selectedPipelines.size} Pipeline${selectedPipelines.size > 1 ? 's' : ''}`}
                  </button>
                )}
              </div>
            </div>
          </div>
        </Overlay>
      )}

      {/* ── Create Modal ── */}
      {showCreateModal && (
        <Overlay onClose={() => setShowCreateModal(false)}>
          <div style={S.drawer}>
            <div style={S.drawerHeader}>
              <div style={{ fontWeight: 700, fontSize: 16, color: '#e2e8f0', display: 'flex', alignItems: 'center', gap: 8 }}>
                <Zap size={18} color="#818cf8" /> New Pipeline
              </div>
              <button onClick={() => setShowCreateModal(false)} style={{ background: 'none', border: 'none', color: '#64748b', cursor: 'pointer' }}>✕</button>
            </div>
            <div style={S.drawerBody}>
              <div style={S.formGroup}>
                <label style={S.label}>Pipeline Name (snake_case) *</label>
                <input style={S.input} placeholder="bronze_to_silver_orders" value={createForm.name}
                  onChange={e => setCreateForm({ ...createForm, name: e.target.value.toLowerCase().replace(/\s+/g, '_') })}
                  onKeyDown={e => e.key === 'Enter' && handleCreate()} autoFocus />
              </div>
              <div style={S.formGroup}>
                <label style={S.label}>Description (optional)</label>
                <input style={S.input} placeholder="Describe what this pipeline does…" value={createForm.description}
                  onChange={e => setCreateForm({ ...createForm, description: e.target.value })} />
              </div>
              <div style={S.formGroup}>
                <label style={S.label}>Execution Engine</label>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  {[
                    { value: 'trino', label: '🔍 Trino', desc: 'CTE SQL · Fast queries' },
                    { value: 'spark', label: '⚡ Spark', desc: 'Coming soon · Complex ETL', disabled: true },
                  ].map(opt => (
                    <div
                      key={opt.value}
                      onClick={() => !opt.disabled && setCreateForm({ ...createForm, engine: opt.value })}
                      style={{
                        padding: 14, borderRadius: 10, cursor: opt.disabled ? 'not-allowed' : 'pointer',
                        border: `2px solid ${createForm.engine === opt.value ? '#6366f1' : '#334155'}`,
                        background: createForm.engine === opt.value ? 'rgba(99,102,241,0.1)' : 'transparent',
                        opacity: opt.disabled ? 0.45 : 1, transition: 'all 0.15s',
                      }}
                    >
                      <div style={{ fontSize: 15, fontWeight: 600, color: '#e2e8f0', marginBottom: 4 }}>{opt.label}</div>
                      <div style={{ fontSize: 11, color: '#64748b' }}>{opt.desc}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <div style={S.drawerFooter}>
              <button style={S.btn('ghost')} onClick={() => setShowCreateModal(false)}>Cancel</button>
              <button style={S.btn('primary')} onClick={handleCreate} disabled={!createForm.name.trim() || createLoading}>
                {createLoading ? <RefreshCw size={13} className="spin" /> : <Plus size={13} />}
                Create Pipeline
              </button>
            </div>
          </div>
        </Overlay>
      )}

      {/* ── Clone Modal ── */}
      {showCloneModal && (
        <Overlay onClose={() => setShowCloneModal(false)}>
          <div style={{ ...S.drawer, maxWidth: 440 }}>
            <div style={S.drawerHeader}>
              <div style={{ fontWeight: 700, fontSize: 16, color: '#e2e8f0', display: 'flex', alignItems: 'center', gap: 8 }}>
                <Copy size={18} color="#34d399" /> Clone Pipeline
              </div>
              <button onClick={() => setShowCloneModal(false)} style={{ background: 'none', border: 'none', color: '#64748b', cursor: 'pointer' }}>✕</button>
            </div>
            <div style={S.drawerBody}>
              <div style={S.formGroup}>
                <label style={S.label}>New Pipeline Name *</label>
                <input style={S.input} value={cloneForm.name} onChange={e => setCloneForm({ ...cloneForm, name: e.target.value })}
                  onKeyDown={e => e.key === 'Enter' && submitClone()} autoFocus />
                <p style={{ fontSize: 12, color: '#64748b', marginTop: 8 }}>Copies the workflow graph and compiled SQL. Run history and schedules are not copied.</p>
              </div>
            </div>
            <div style={S.drawerFooter}>
              <button style={S.btn('ghost')} onClick={() => setShowCloneModal(false)}>Cancel</button>
              <button style={S.btn('primary')} onClick={submitClone} disabled={!cloneForm.name.trim()}>
                <Copy size={13} /> Duplicate
              </button>
            </div>
          </div>
        </Overlay>
      )}

      {/* ── Schedule Modal ── */}
      {showScheduleModal && (
        <Overlay onClose={() => setShowScheduleModal(false)}>
          <div style={{ ...S.drawer, maxWidth: 540 }}>
            <div style={S.drawerHeader}>
              <div style={{ fontWeight: 700, fontSize: 16, color: '#e2e8f0', display: 'flex', alignItems: 'center', gap: 8 }}>
                <Calendar size={18} color="#22d3ee" /> Configure Schedule
              </div>
              <button onClick={() => setShowScheduleModal(false)} style={{ background: 'none', border: 'none', color: '#64748b', cursor: 'pointer' }}>✕</button>
            </div>
            <div style={S.drawerBody}>
              {/* Pipeline name tag */}
              <div style={{ padding: '8px 14px', borderRadius: 8, background: 'rgba(99,102,241,0.08)', border: '1px solid rgba(99,102,241,0.2)', fontSize: 13, color: '#94a3b8', marginBottom: 20 }}>
                Pipeline: <strong style={{ color: '#e2e8f0' }}>{scheduleForm.pipelineName}</strong>
              </div>

              {/* Run Type */}
              <div style={S.formGroup}>
                <label style={S.label}>Execution Mode</label>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  {[
                    { value: 'scheduled', icon: '🔄', label: 'Scheduled (Cron)', desc: 'Recurring — runs on a cron expression' },
                    { value: 'onetime', icon: '📅', label: 'One-time', desc: 'Runs once at a specific date/time' },
                  ].map(opt => (
                    <div key={opt.value} onClick={() => setScheduleForm(f => ({ ...f, run_type: opt.value }))}
                      style={{ padding: 14, borderRadius: 10, cursor: 'pointer', border: `2px solid ${scheduleForm.run_type === opt.value ? '#6366f1' : '#334155'}`, background: scheduleForm.run_type === opt.value ? 'rgba(99,102,241,0.1)' : 'transparent', transition: 'all 0.15s' }}>
                      <div style={{ fontSize: 20, marginBottom: 6 }}>{opt.icon}</div>
                      <div style={{ fontSize: 13, fontWeight: 600, color: '#e2e8f0', marginBottom: 3 }}>{opt.label}</div>
                      <div style={{ fontSize: 11, color: '#64748b' }}>{opt.desc}</div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Cron fields */}
              {scheduleForm.run_type === 'scheduled' && (
                <div style={S.formGroup}>
                  <label style={S.label}>Frequency</label>
                  <select style={S.select}
                    value={scheduleForm.cron_custom ? 'custom' : scheduleForm.cron_expr}
                    onChange={e => {
                      if (e.target.value === 'custom') setScheduleForm(f => ({ ...f, cron_custom: true }))
                      else setScheduleForm(f => ({ ...f, cron_expr: e.target.value, cron_custom: false }))
                    }}>
                    {SCHEDULE_PRESETS.map(p => (
                      <option key={p.value} value={p.value}>{p.label} ({p.value})</option>
                    ))}
                    <option value="custom">✏️ Custom cron expression...</option>
                  </select>
                  {scheduleForm.cron_custom && (
                    <input style={{ ...S.input, marginTop: 10, fontFamily: 'monospace' }} placeholder="0 6 * * 1-5"
                      value={scheduleForm.cron_expr} onChange={e => setScheduleForm(f => ({ ...f, cron_expr: e.target.value }))} autoFocus />
                  )}
                  <div style={{ marginTop: 8, padding: '8px 12px', background: '#0a0f1e', borderRadius: 6, fontSize: 11, color: '#64748b', fontFamily: 'monospace' }}>
                    Format: <span style={{ color: '#94a3b8' }}>minute hour day(month) month day(week)</span>
                    <span style={{ color: '#6366f1', marginLeft: 12 }}>{scheduleForm.cron_expr || '* * * * *'}</span>
                  </div>
                </div>
              )}

              {/* One-time */}
              {scheduleForm.run_type === 'onetime' && (
                <div style={S.formGroup}>
                  <label style={S.label}>Run At (Date & Time)</label>
                  <input type="datetime-local" style={S.input} value={scheduleForm.run_at}
                    onChange={e => setScheduleForm(f => ({ ...f, run_at: e.target.value }))}
                    min={new Date().toISOString().slice(0, 16)} />
                  <div style={{ marginTop: 6, fontSize: 11, color: '#64748b' }}>
                    Pipeline will run once at this time (in the selected timezone).
                  </div>
                </div>
              )}

              {/* Timezone + Status */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                <div>
                  <label style={{ ...S.label, display: 'flex', alignItems: 'center', gap: 5 }}><Globe size={11} /> Timezone</label>
                  <select style={S.select} value={scheduleForm.timezone} onChange={e => setScheduleForm(f => ({ ...f, timezone: e.target.value }))}>
                    {TIMEZONES.map(tz => <option key={tz} value={tz}>{tz}</option>)}
                  </select>
                </div>
                <div>
                  <label style={S.label}>Status</label>
                  <div style={{ padding: '10px 14px', border: '1px solid #334155', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: '#1e293b', cursor: 'pointer' }}
                    onClick={() => setScheduleForm(f => ({ ...f, enabled: !f.enabled }))}>
                    <span style={{ fontSize: 13, color: scheduleForm.enabled ? '#22c55e' : '#64748b', display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ width: 8, height: 8, borderRadius: '50%', background: scheduleForm.enabled ? '#22c55e' : '#475569', boxShadow: scheduleForm.enabled ? '0 0 6px #22c55e' : 'none' }} />
                      {scheduleForm.enabled ? 'Enabled' : 'Disabled'}
                    </span>
                    <Toggle active={scheduleForm.enabled} onChange={v => setScheduleForm(f => ({ ...f, enabled: v }))} activeColor="#22c55e" />
                  </div>
                </div>
              </div>
            </div>
            <div style={S.drawerFooter}>
              <button style={S.btn('danger')} onClick={() => { handleDeleteSchedule(scheduleForm.pipelineId, scheduleForm.pipelineName); setShowScheduleModal(false) }}>
                <Trash2 size={13} /> Remove Schedule
              </button>
              <div style={{ display: 'flex', gap: 10 }}>
                <button style={S.btn('ghost')} onClick={() => setShowScheduleModal(false)}>Cancel</button>
                <button style={S.btn('primary')} onClick={submitSchedule}
                  disabled={scheduleLoading || (scheduleForm.run_type === 'scheduled' && !scheduleForm.cron_expr.trim()) || (scheduleForm.run_type === 'onetime' && !scheduleForm.run_at)}>
                  {scheduleLoading ? <RefreshCw size={13} className="spin" /> : <Save size={13} />}
                  Save Schedule
                </button>
              </div>
            </div>
          </div>
        </Overlay>
      )}

      {/* ── Delete Confirm Modal ── */}
      {deleteConfirm && (
        <Overlay onClose={() => setDeleteConfirm(null)}>
          <div style={{ ...S.card, width: 400, animation: 'fadeInUp 0.15s ease-out' }}>
            <div style={{ padding: 24, borderBottom: '1px solid #1e293b' }}>
              <h3 style={{ fontSize: 18, color: '#e2e8f0', margin: 0 }}>{deleteConfirm.title}</h3>
              <p style={{ color: '#64748b', fontSize: 13, margin: '6px 0 0' }}>
                Are you sure you want to {deleteConfirm.type === 'pipeline' ? 'archive pipeline' : 'remove schedule for'}: <strong style={{ color: '#f87171' }}>{deleteConfirm.name}</strong>?
                <br />
                {deleteConfirm.warning}
              </p>
            </div>
            <div style={{ padding: 24, display: 'flex', gap: 12, justifyContent: 'flex-end', background: '#0a0f1e', borderRadius: '0 0 12px 12px' }}>
              <button style={S.btn('ghost')} onClick={() => setDeleteConfirm(null)}>Cancel</button>
              <button style={S.btn('danger')} onClick={executeDelete}>
                <Trash2 size={14} /> Confirm
              </button>
            </div>
          </div>
        </Overlay>
      )}

      {/* ── Toast ── */}
      {toast && (
        <div style={{
          position: 'fixed', bottom: 32, right: 32, zIndex: 9999,
          background: toast.type === 'error' ? '#ef4444' : '#10b981',
          color: '#fff', padding: '12px 24px', borderRadius: 12,
          boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
          display: 'flex', alignItems: 'center', gap: 10,
          fontWeight: 600, fontSize: 14,
          animation: 'slideInRight 0.3s ease-out',
        }}>
          {toast.type === 'error' ? <AlertCircle size={18} /> : <CheckCircle size={18} />}
          {toast.msg}
        </div>
      )}
      <style>{`
        @keyframes slideInRight { from { transform: translateX(100%); opacity: 0; } to { transform: translateX(0); opacity: 1; } }
        @keyframes fadeInUp { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
      `}</style>
    </div>
  )
}

// ── Overlay helper ────────────────────────────────────────────────────────────
function Overlay({ children, onClose }) {
  return (
    <div style={S.overlay} onClick={e => e.target === e.currentTarget && onClose()}>
      {children}
    </div>
  )
}

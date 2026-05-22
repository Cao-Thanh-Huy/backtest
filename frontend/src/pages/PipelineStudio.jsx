/**
 * Pipeline Studio — Main Page
 * Visual DAG editor with React Flow + DAG → Backend pipeline registry
 * Full UI overhaul: premium dark theme, better UX, enable/disable aware.
 */
import React, { useState, useEffect, useCallback, useRef } from 'react'
import {
  ReactFlow, addEdge, useNodesState, useEdgesState,
  Background, Controls, BackgroundVariant, MarkerType,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'

import {
  Play, Upload, Code, History, Zap, AlertCircle, CheckCircle, Save,
  X, ChevronRight, Loader, ArrowLeft, Layers, Power, PowerOff,
  GitBranch, Terminal, Info, Database, Link2, ExternalLink, ArrowRight, RefreshCw, Plus, Unlock
} from 'lucide-react'
import { useParams, useNavigate, useLocation } from 'react-router-dom'

import * as api from '../api/client'
import { getPipelineTriggerSources } from '../api/client'
import { NODE_TYPES } from './pipeline-studio/nodes/NodeTypes'
import NodePanel from './pipeline-studio/components/NodePanel'
import NodeConfigForm from './pipeline-studio/components/NodeConfigForm'
import RunHistory from './pipeline-studio/components/RunHistory'

// ── Unique ID generator ───────────────────────────────────────────────────────
let nodeCounter = 0
const genId = () => `node_${Date.now()}_${++nodeCounter}`

// ── Edge style ────────────────────────────────────────────────────────────────
const DEFAULT_EDGE_OPTIONS = {
  animated: false,
  style: { stroke: '#3b4a6b', strokeWidth: 2 },
  markerEnd: { type: MarkerType.ArrowClosed, color: '#3b4a6b', width: 16, height: 16 },
}

// ─────────────────────────────────────────────────────────────────────────────
export default function PipelineStudio() {
  const { id } = useParams()
  const navigate = useNavigate()

  // ── State ──────────────────────────────────────────────────────────────────
  const [selectedPipeline, setSelectedPipeline] = useState(null)
  const [selectedNode, setSelectedNode] = useState(null)
  const [mainTab, setMainTab] = useState('visual')   // 'visual' | 'sql' | 'history'
  const [loading, setLoading] = useState(false)
  const [running, setRunning] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [togging, setToggling] = useState(false)
  const [refreshTrigger, setRefreshTrigger] = useState(0)
  const [toast, setToast] = useState(null)
  const [showValidationPanel, setShowValidationPanel] = useState(false)
  const [validationErrors, setValidationErrors] = useState([])
  const [compiledSQL, setCompiledSQL] = useState('')
  const [wapPlan, setWapPlan] = useState(null)
  const [loadingWap, setLoadingWap] = useState(false)
  // Trigger sources (reverse lookup: which connectors trigger this pipeline)
  const [triggerSources, setTriggerSources] = useState([])
  const [upstreamPipelineTriggers, setUpstreamPipelineTriggers] = useState([])
  const [downstreamTriggers, setDownstreamTriggers] = useState([])
  const [loadingTriggers, setLoadingTriggers] = useState(false)
  const [showDownstreamDrawer, setShowDownstreamDrawer] = useState(false)
  const [confirmDialog, setConfirmDialog] = useState(null)

  function confirmCustom({ title, message, onConfirm, onCancel }) {
    setConfirmDialog({ title, message, onConfirm, onCancel })
  }

  // ── React Flow state ───────────────────────────────────────────────────────
  const [nodes, setNodes, onNodesChange] = useNodesState([])
  const [edges, setEdges, onEdgesChange] = useEdgesState([])
  const reactFlowWrapper = useRef(null)
  const [reactFlowInstance, setReactFlowInstance] = useState(null)

  // ── Load pipeline ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (id) loadPipeline(id)
  }, [id])

  // ── Auto fit view when nodes loaded ─────────────────────────────────────────
  useEffect(() => {
    if (reactFlowInstance && nodes.length > 0) {
      const timer = setTimeout(() => {
        reactFlowInstance.fitView({ padding: 0.25, duration: 450 })
      }, 150)
      return () => clearTimeout(timer)
    }
  }, [nodes.length, reactFlowInstance])

  // ── Sync tab from URL query ───────────────────────────────────────────────
  const location = useLocation()
  useEffect(() => {
    const params = new URLSearchParams(location.search)
    const tab = params.get('tab')
    if (tab === 'runs' || tab === 'history') {
      setMainTab('history')
    } else if (tab === 'sql') {
      setMainTab('sql')
    } else if (tab === 'triggers' || tab === 'triggered_by') {
      setMainTab('triggered_by')
    } else if (tab === 'trigger' || tab === 'triggers_next') {
      setMainTab('triggers_next')
    }
  }, [location.search])

  // ── Load trigger sources when Triggers tab is active ─────────────────────
  useEffect(() => {
    if (['triggered_by', 'triggers_next'].includes(mainTab) && selectedPipeline?.id) {
      setLoadingTriggers(true)
      Promise.all([
        getPipelineTriggerSources(selectedPipeline.id),
        api.getPipelineDownstreamTriggers(selectedPipeline.id)
      ])
        .then(([srcRes, downRes]) => {
          setTriggerSources(srcRes.sources || [])
          setUpstreamPipelineTriggers(srcRes.pipelines || [])
          setDownstreamTriggers(downRes.triggers || [])
        })
        .catch(e => showToast('error', 'Failed to load triggers: ' + e.message))
        .finally(() => setLoadingTriggers(false))
    }
  }, [mainTab, selectedPipeline?.id])

  // ── Load WAP Plan when SQL tab is active ──────────────────────────────────
  useEffect(() => {
    if (mainTab === 'sql' && selectedPipeline?.id && selectedPipeline.latest_version > 0) {
      setLoadingWap(true)
      api.getWapPlan(selectedPipeline.id, selectedPipeline.latest_version, '<RUN_ID_PLACEHOLDER>', '<WATERMARK_PLACEHOLDER>')
        .then(res => setWapPlan(res))
        .catch(err => console.error("Failed to fetch WAP plan:", err))
        .finally(() => setLoadingWap(false))
    }
  }, [mainTab, selectedPipeline?.id, selectedPipeline?.latest_version])

  async function loadPipeline(pipelineId) {
    setLoading(true)
    try {
      const p = await api.getPipeline(pipelineId)
      setSelectedPipeline(p)

      const def = p.definition_json
      if (def?.nodes && def?.edges) {
        const rfNodes = def.nodes.map(n => ({
          id: n.id,
          type: n.type,
          position: n.position || { x: Math.random() * 600, y: Math.random() * 300 },
          data: { ...n.data, label: n.data?.label || n.type },
        }))
        const rfEdges = def.edges.map(e => ({
          ...e,
          ...DEFAULT_EDGE_OPTIONS,
        }))
        setNodes(rfNodes)
        setEdges(rfEdges)
      } else {
        setNodes([])
        setEdges([])
      }
      if (p.compiled_sql) setCompiledSQL(p.compiled_sql)
    } catch (e) {
      showToast('error', e.message)
      navigate('/pipelines')
    }
    setLoading(false)
  }

  // ── Toast ──────────────────────────────────────────────────────────────────
  function showToast(type, msg) {
    setToast({ type, msg })
    setTimeout(() => setToast(null), 4000)
  }

  // ── React Flow: drag-drop ─────────────────────────────────────────────────
  const onDragOver = useCallback(e => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
  }, [])

  const onDrop = useCallback(e => {
    e.preventDefault()
    const type = e.dataTransfer.getData('application/reactflow')
    if (!type || !reactFlowInstance) return

    const bounds = reactFlowWrapper.current.getBoundingClientRect()
    const position = reactFlowInstance.screenToFlowPosition({
      x: e.clientX - bounds.left,
      y: e.clientY - bounds.top,
    })

    const nodeId = genId()
    setNodes(prev => [...prev, {
      id: nodeId,
      type,
      position,
      data: { label: type.charAt(0).toUpperCase() + type.slice(1), selected: false },
    }])
  }, [reactFlowInstance])

  // ── Edge connection validation ─────────────────────────────────────────────
  const isValidConnection = useCallback(
    (connection) => {
      const targetNode = nodes.find((n) => n.id === connection.target)
      if (!targetNode) return false
      if (targetNode.type === 'source') return false
      const incomingEdges = edges.filter((e) => e.target === connection.target)
      if (targetNode.type === 'join') {
        const handleEdges = incomingEdges.filter(e => e.targetHandle === connection.targetHandle)
        return handleEdges.length < 1
      }
      if (targetNode.type === 'union' || targetNode.type === 'custom_sql') return true
      return incomingEdges.length < 1
    },
    [nodes, edges]
  )

  const onConnect = useCallback(params => {
    setEdges(prev => addEdge({ ...params, ...DEFAULT_EDGE_OPTIONS }, prev))
  }, [])

  // ── Node interactions ─────────────────────────────────────────────────────
  const onNodeClick = useCallback((_, node) => setSelectedNode(node), [])
  const onPaneClick = useCallback(() => setSelectedNode(null), [])

  function handleNodeDataChange(nodeId, newData) {
    setNodes(prev => prev.map(n => n.id === nodeId ? { ...n, data: newData } : n))
    setSelectedNode(prev => prev?.id === nodeId ? { ...prev, data: newData } : prev)
  }

  // ── Build definition JSON ──────────────────────────────────────────────────
  function buildDefinitionJSON() {
    return {
      nodes: nodes.map(n => ({
        id: n.id,
        type: n.type,
        position: n.position,
        data: n.data,
      })),
      edges: edges.map(e => ({
        id: e.id,
        source: e.source,
        target: e.target,
        sourceHandle: e.sourceHandle,
        targetHandle: e.targetHandle,
      })),
    }
  }

  // ── Publish ────────────────────────────────────────────────────────────────
  async function handlePublish() {
    if (!selectedPipeline) return
    setPublishing(true)
    setValidationErrors([])
    setCompiledSQL('')

    try {
      const definition_json = buildDefinitionJSON()
      const data = await api.publishPipeline(selectedPipeline.id, { definition_json, validate_schema: true })

      if (!data.success) {
        setValidationErrors(data.errors || [])
        setShowValidationPanel(true)
        showToast('error', `Validation failed: ${data.errors?.length} error(s)`)
      } else {
        setCompiledSQL(data.compiled_sql || '')
        setShowValidationPanel(false)
        showToast('success', `✓ Published v${data.version}`)
        setSelectedPipeline(prev => ({ ...prev, latest_version: data.version, status: 'active' }))
        setMainTab('sql')
      }
    } catch (e) {
      showToast('error', e.message)
    }
    setPublishing(false)
  }

  // ── Run ────────────────────────────────────────────────────────────────────
  async function handleRun() {
    if (!selectedPipeline) return
    if (!selectedPipeline.is_enabled) {
      showToast('error', 'Pipeline is disabled. Enable it before running.')
      return
    }
    if (selectedPipeline.latest_version === 0) {
      showToast('error', 'Publish pipeline before running.')
      return
    }
    setRunning(true)
    try {
      const data = await api.triggerPipelineRun(selectedPipeline.id, { run_mode: 'incremental' })
      showToast('success', `🚀 Run started! ID: ${data.run_id.slice(0, 8)}`)
      setRefreshTrigger(Date.now())
      setMainTab('history')
      // Small artificial delay so the user clearly sees the spinner
      await new Promise(r => setTimeout(r, 800))
    } catch (e) {
      showToast('error', e.message)
    } finally {
      setRunning(false)
    }
  }

  // ── Toggle Enable/Disable ─────────────────────────────────────────────────
  async function handleToggleEnabled() {
    if (!selectedPipeline) return
    setToggling(true)
    try {
      const data = await api.togglePipelineEnabled(selectedPipeline.id)
      setSelectedPipeline(prev => ({ ...prev, is_enabled: data.is_enabled }))
      showToast('success', `Pipeline ${data.is_enabled ? 'enabled ✓' : 'disabled'}`)
    } catch (e) {
      showToast('error', e.message)
    }
    setToggling(false)
  }
  const [unlocking, setUnlocking] = useState(false)
  const [resettingWatermark, setResettingWatermark] = useState(false)

  async function handleForceUnlock() {
    if (!selectedPipeline) return
    const msg = `CẢNH BÁO QUAN TRỌNG:
Hành động Force Unlock giả định rằng lượt chạy Dagster tương ứng đã chết hoặc bị treo hoàn toàn.
Nếu bạn thực hiện khi pipeline vẫn đang chạy thực sự trên Dagster, điều này có thể dẫn tới ghi đè dữ liệu đồng thời (race conditions) hoặc lỗi dữ liệu nghiêm trọng.

Bạn có chắc chắn muốn giải phóng Watermark Lock cho pipeline "${selectedPipeline.name}"?`
    
    if (!window.confirm(msg)) return
    
    setUnlocking(true)
    try {
      const res = await api.forceUnlockPipeline(selectedPipeline.id)
      showToast('success', res.message || 'Pipeline force unlocked successfully.')
      await loadPipeline(selectedPipeline.id)
    } catch (err) {
      showToast('error', `Failed to force unlock: ${err.message}`)
    } finally {
      setUnlocking(false)
    }
  }

  async function handleResetWatermark() {
    if (!selectedPipeline) return
    const msg = `Bạn có chắc chắn muốn reset Watermark cho pipeline "${selectedPipeline.name}"?
Lần chạy tiếp theo của pipeline sẽ thực hiện Full Backfill từ đầu.`
    
    if (!window.confirm(msg)) return
    
    setResettingWatermark(true)
    try {
      const res = await api.resetWatermark(selectedPipeline.id)
      showToast('success', res.message || 'Watermark reset successfully.')
      await loadPipeline(selectedPipeline.id)
    } catch (err) {
      showToast('error', `Failed to reset watermark: ${err.message}`)
    } finally {
      setResettingWatermark(false)
    }
  }
  const refreshAllTriggers = async () => {
    if (!selectedPipeline?.id) return
    setLoadingTriggers(true)
    try {
      const [srcRes, downRes] = await Promise.all([
        getPipelineTriggerSources(selectedPipeline.id),
        api.getPipelineDownstreamTriggers(selectedPipeline.id)
      ])
      setTriggerSources(srcRes.sources || [])
      setUpstreamPipelineTriggers(srcRes.pipelines || [])
      setDownstreamTriggers(downRes.triggers || [])
    } catch (e) {
      showToast('error', 'Failed to refresh triggers: ' + e.message)
    } finally {
      setLoadingTriggers(false)
    }
  }

  // ── Remove Triggers/Relationships ─────────────────────────────────────────
  const handleRemoveConnectorTrigger = async (connectorId, triggerId) => {
    setLoadingTriggers(true)
    try {
      await api.removeDownstreamTrigger(connectorId, triggerId)
      showToast('success', 'Successfully removed trigger relationship between Connector and Pipeline ✓')
      await refreshAllTriggers()
    } catch (e) {
      showToast('error', 'Failed to remove trigger: ' + e.message)
      setLoadingTriggers(false)
    }
  }

  const handleRemovePipelineTrigger = async (upstreamPipelineId, triggerId) => {
    setLoadingTriggers(true)
    const activePipelineId = typeof upstreamPipelineId === 'string' && triggerId ? upstreamPipelineId : selectedPipeline.id
    const activeTriggerId = triggerId || upstreamPipelineId
    try {
      await api.removePipelineDownstreamTrigger(activePipelineId, activeTriggerId)
      showToast('success', 'Successfully removed trigger relationship between Pipelines ✓')
      await refreshAllTriggers()
    } catch (e) {
      showToast('error', 'Failed to remove trigger: ' + e.message)
      setLoadingTriggers(false)
    }
  }

  const handleToggleConnectorTrigger = async (connectorId, triggerId, currentEnabled) => {
    try {
      await api.updateDownstreamTrigger(connectorId, triggerId, { enabled: !currentEnabled })
      showToast('success', `Trigger status updated to ${!currentEnabled ? 'Active' : 'Paused'} ✓`)
      await refreshAllTriggers()
    } catch (e) {
      showToast('error', 'Failed to update trigger status: ' + e.message)
    }
  }

  const handleTogglePipelineTrigger = async (upstreamPipelineId, triggerId, currentEnabled) => {
    const activePipelineId = typeof upstreamPipelineId === 'string' && typeof triggerId === 'string' ? upstreamPipelineId : selectedPipeline.id
    const activeTriggerId = typeof triggerId === 'string' ? triggerId : upstreamPipelineId
    const activeCurrentEnabled = typeof currentEnabled === 'boolean' ? currentEnabled : triggerId
    try {
      await api.updatePipelineDownstreamTrigger(activePipelineId, activeTriggerId, { enabled: !activeCurrentEnabled })
      showToast('success', `Trigger status updated to ${!activeCurrentEnabled ? 'Active' : 'Paused'} ✓`)
      await refreshAllTriggers()
    } catch (e) {
      showToast('error', 'Failed to update trigger status: ' + e.message)
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  const isDisabled = selectedPipeline && !selectedPipeline.is_enabled
  const canRun = selectedPipeline?.latest_version > 0 && selectedPipeline?.is_enabled
  const hasEventTriggers = triggerSources.length > 0 || downstreamTriggers.length > 0

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden', background: '#080c18' }}>

      {/* ── Top Bar ── */}
      <div style={{
        flexShrink: 0,
        padding: '0 20px',
        height: 58,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        background: 'linear-gradient(135deg, #0d1117 0%, #111827 100%)',
        borderBottom: '1px solid rgba(255,255,255,0.07)',
        boxShadow: '0 1px 20px rgba(0,0,0,0.4)',
      }}>
        {/* Left: back + pipeline name */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <button
            onClick={() => navigate('/pipelines')}
            style={{
              background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)',
              color: '#94a3b8', cursor: 'pointer',
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '6px 10px', borderRadius: 7, fontSize: 12, transition: 'all 0.15s',
            }}
            onMouseEnter={e => { e.currentTarget.style.color = '#e2e8f0'; e.currentTarget.style.background = 'rgba(255,255,255,0.09)' }}
            onMouseLeave={e => { e.currentTarget.style.color = '#94a3b8'; e.currentTarget.style.background = 'rgba(255,255,255,0.05)' }}
            title="Back to Pipelines"
          >
            <ArrowLeft size={14} /> Back
          </button>

          <div style={{ width: 1, height: 24, background: 'rgba(255,255,255,0.08)' }} />

          {loading ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Loader size={16} className="spin" style={{ color: '#6366f1' }} />
              <span style={{ fontSize: 14, color: '#64748b' }}>Loading...</span>
            </div>
          ) : selectedPipeline ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              {/* Status indicator */}
              <div style={{
                width: 8, height: 8, borderRadius: '50%',
                background: isDisabled ? '#475569' : (selectedPipeline.status === 'active' ? '#22c55e' : '#94a3b8'),
                boxShadow: !isDisabled && selectedPipeline.status === 'active' ? '0 0 8px #22c55e' : 'none',
              }} />
              <span style={{ fontSize: 15, fontWeight: 600, color: isDisabled ? '#64748b' : '#f1f5f9' }}>
                {selectedPipeline.name}
              </span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                <span style={{
                  fontSize: 11, color: '#6366f1',
                  background: 'rgba(99,102,241,0.12)', border: '1px solid rgba(99,102,241,0.25)',
                  padding: '2px 8px', borderRadius: 20, fontWeight: 500,
                }}>
                  {selectedPipeline.engine === 'spark' ? '⚡ Spark' : '🔍 Trino'}
                </span>
                {selectedPipeline.latest_version > 0 && (
                  <span style={{ fontSize: 11, color: '#64748b', background: 'rgba(255,255,255,0.05)', padding: '2px 8px', borderRadius: 20, border: '1px solid rgba(255,255,255,0.08)' }}>
                    v{selectedPipeline.latest_version}
                  </span>
                )}
                {isDisabled && (
                  <span style={{ fontSize: 11, color: '#ef4444', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.25)', padding: '2px 8px', borderRadius: 20, fontWeight: 600 }}>
                    DISABLED
                  </span>
                )}
                {/* Event-Driven badge — appears when trigger sources exist */}
                {hasEventTriggers && (
                  <span style={{
                    fontSize: 11, color: '#22d3ee',
                    background: 'rgba(34,211,238,0.1)',
                    border: '1px solid rgba(34,211,238,0.3)',
                    padding: '2px 9px', borderRadius: 20, fontWeight: 700,
                    display: 'inline-flex', alignItems: 'center', gap: 4,
                    animation: 'eventPulse 2.5s ease-in-out infinite',
                  }}>
                    <GitBranch size={10} /> EVENT-DRIVEN
                  </span>
                )}
              </div>
            </div>
          ) : null}
        </div>

        {/* Right: action buttons */}
        {selectedPipeline && !loading && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {/* Enable/Disable toggle */}
            <button
              onClick={handleToggleEnabled}
              disabled={togging}
              title={selectedPipeline.is_enabled ? 'Disable pipeline' : 'Enable pipeline'}
              style={{
                display: 'flex', alignItems: 'center', gap: 6, padding: '7px 14px',
                borderRadius: 8, border: `1px solid ${selectedPipeline.is_enabled ? 'rgba(245,158,11,0.3)' : 'rgba(34,197,94,0.3)'}`,
                background: selectedPipeline.is_enabled ? 'rgba(245,158,11,0.1)' : 'rgba(34,197,94,0.1)',
                color: selectedPipeline.is_enabled ? '#f59e0b' : '#22c55e',
                fontSize: 12, fontWeight: 600, cursor: 'pointer', transition: 'all 0.15s',
              }}
            >
              {togging ? <Loader size={13} className="spin" /> : (selectedPipeline.is_enabled ? <PowerOff size={13} /> : <Power size={13} />)}
              {selectedPipeline.is_enabled ? 'Disable' : 'Enable'}
            </button>

            <div style={{ width: 1, height: 20, background: 'rgba(255,255,255,0.08)' }} />

            {/* Save Pipeline */}
            <button
              className="btn btn-secondary btn-sm"
              onClick={handlePublish}
              disabled={publishing || nodes.length === 0}
              title="Validate + Compile + Save version"
              style={{ gap: 6 }}
            >
              {publishing ? <Loader size={13} className="spin" /> : <Save size={13} />}
              {publishing ? 'Saving…' : 'Save Pipeline'}
            </button>

            {/* Run */}
            <button
              className="btn btn-sm"
              onClick={handleRun}
              disabled={running || !canRun}
              title={!selectedPipeline.is_enabled ? 'Enable pipeline first' : selectedPipeline.latest_version === 0 ? 'Save Pipeline first' : 'Run latest version'}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                padding: '7px 16px', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: !canRun ? 'not-allowed' : 'pointer',
                background: canRun ? 'linear-gradient(135deg,#6366f1,#8b5cf6)' : 'rgba(99,102,241,0.15)',
                color: canRun ? 'white' : '#64748b',
                border: 'none',
                boxShadow: canRun ? '0 2px 12px rgba(99,102,241,0.35)' : 'none',
                transition: 'all 0.2s',
                opacity: !canRun ? 0.6 : 1,
              }}
            >
              {running ? <Loader size={13} className="spin" /> : <Zap size={13} />}
              {running ? 'Running…' : 'Run'}
            </button>
          </div>
        )}
      </div>

      {/* ── Tab Bar ── */}
      {selectedPipeline && !loading && (
        <div style={{
          display: 'flex', gap: 0,
          background: '#0d1117',
          borderBottom: '1px solid rgba(255,255,255,0.06)',
          flexShrink: 0, padding: '0 20px',
        }}>
          {[
            { key: 'visual',   Icon: Layers,    label: 'Visual Editor' },
            { key: 'history',  Icon: History,   label: 'Run History' },
            { key: 'sql',      Icon: Terminal,  label: 'Compiled SQL' },
            { key: 'triggered_by', Icon: ArrowRight, label: 'Trigger By', badge: triggerSources.length || null },
            { key: 'triggers_next', Icon: GitBranch, label: 'Trigger', badge: downstreamTriggers.length || null },
          ].map(tab => (
            <button
              key={tab.key}
              onClick={() => setMainTab(tab.key)}
              style={{
                padding: '11px 18px', border: 'none', cursor: 'pointer',
                background: 'none', fontSize: 12.5, fontWeight: 500,
                display: 'flex', alignItems: 'center', gap: 7,
                color: mainTab === tab.key ? '#a5b4fc' : '#64748b',
                borderBottom: mainTab === tab.key ? '2px solid #6366f1' : '2px solid transparent',
                marginBottom: -1,
                transition: 'all 0.15s',
              }}
              onMouseEnter={e => { if (mainTab !== tab.key) e.currentTarget.style.color = '#94a3b8' }}
              onMouseLeave={e => { if (mainTab !== tab.key) e.currentTarget.style.color = '#64748b' }}
            >
              <tab.Icon size={13} />
              {tab.label}
              {tab.key === 'history' && selectedPipeline && (
                <span style={{
                  fontSize: 10, padding: '1px 6px', borderRadius: 10,
                  background: mainTab === 'history' ? 'rgba(99,102,241,0.25)' : 'rgba(255,255,255,0.08)',
                  color: mainTab === 'history' ? '#a5b4fc' : '#64748b',
                }}>
                  v{selectedPipeline.latest_version}
                </span>
              )}
              {tab.key === 'triggers' && tab.badge > 0 && (
                <span style={{
                  fontSize: 10, padding: '1px 6px', borderRadius: 10, fontWeight: 700,
                  background: ['triggered_by', 'triggers_next'].includes(mainTab) && mainTab === tab.key ? 'rgba(34,211,238,0.25)' : 'rgba(34,211,238,0.1)',
                  color: ['triggered_by', 'triggers_next'].includes(mainTab) && mainTab === tab.key ? '#22d3ee' : '#67e8f9',
                }}>
                  {tab.badge}
                </span>
              )}
            </button>
          ))}
        </div>
      )}

      {/* ── Content ── */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minHeight: 0 }}>
        {!selectedPipeline && !loading ? (
          <EmptyEditorState />
        ) : loading ? (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#080c18' }}>
            <div style={{ textAlign: 'center' }}>
              <Loader size={32} className="spin" style={{ color: '#6366f1', marginBottom: 16 }} />
              <div style={{ fontSize: 14, color: '#64748b' }}>Loading pipeline…</div>
            </div>
          </div>
        ) : (
          <div style={{ flex: 1, display: 'flex', overflow: 'hidden', minHeight: 0 }}>

            {/* ── VISUAL TAB ── */}
            {mainTab === 'visual' && (
              <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
                <NodePanel />
                <div ref={reactFlowWrapper} style={{ flex: 1, position: 'relative' }}>
                  {/* Disabled overlay */}
                  {isDisabled && (
                    <div style={{
                      position: 'absolute', inset: 0, zIndex: 10,
                      background: 'rgba(8,12,24,0.6)', backdropFilter: 'blur(2px)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      pointerEvents: 'none',
                    }}>
                      <div style={{
                        textAlign: 'center', padding: '20px 32px',
                        background: 'rgba(17,24,39,0.9)', borderRadius: 12,
                        border: '1px solid rgba(239,68,68,0.3)',
                      }}>
                        <PowerOff size={28} style={{ color: '#ef4444', marginBottom: 10 }} />
                        <div style={{ fontSize: 15, fontWeight: 600, color: '#f87171', marginBottom: 6 }}>Pipeline Disabled</div>
                        <div style={{ fontSize: 13, color: '#64748b' }}>Enable the pipeline to run it.</div>
                      </div>
                    </div>
                  )}
                  <ReactFlow
                    nodes={nodes}
                    edges={edges}
                    onNodesChange={onNodesChange}
                    onEdgesChange={onEdgesChange}
                    onConnect={onConnect}
                    isValidConnection={isValidConnection}
                    onInit={setReactFlowInstance}
                    onDrop={onDrop}
                    onDragOver={onDragOver}
                    onNodeClick={onNodeClick}
                    onPaneClick={onPaneClick}
                    nodeTypes={NODE_TYPES}
                    defaultEdgeOptions={DEFAULT_EDGE_OPTIONS}
                    fitView
                    deleteKeyCode={['Backspace', 'Delete']}
                    selectionKeyCode="Shift"
                    style={{ background: 'var(--bg-primary)' }}
                  >
                    <Background color="#94a3b8" gap={24} size={1} opacity={0.15} />
                    <Controls style={{
                      background: '#111827', border: '1px solid rgba(255,255,255,0.08)',
                      borderRadius: 8, overflow: 'hidden',
                    }} />
                    {nodes.length === 0 && (
                      <div style={{
                        position: 'absolute', top: '50%', left: '50%',
                        transform: 'translate(-50%, -50%)',
                        textAlign: 'center', pointerEvents: 'none',
                      }}>
                        <div style={{ fontSize: 52, marginBottom: 16, opacity: 0.4 }}>🎨</div>
                        <div style={{ fontSize: 16, fontWeight: 600, color: '#2d3a57', marginBottom: 8 }}>
                          Drag nodes from the left panel
                        </div>
                        <div style={{ fontSize: 13, color: '#1e293b' }}>
                          Build your pipeline visually
                        </div>
                      </div>
                    )}
                  </ReactFlow>
                </div>
                <NodeConfigForm
                  node={selectedNode}
                  nodes={nodes}
                  edges={edges}
                  onChange={handleNodeDataChange}
                  onClose={() => setSelectedNode(null)}
                />
              </div>
            )}

            {/* ── SQL TAB ── */}
            {mainTab === 'sql' && (
              <div style={{ flex: 1, padding: '28px 32px', overflowY: 'auto', background: '#080c18' }}>
                {showValidationPanel && validationErrors.length > 0 && (
                  <div style={{ marginBottom: 20 }}>
                    <div style={{ fontSize: 13, color: '#ef4444', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 6, fontWeight: 600 }}>
                      <AlertCircle size={14} /> {validationErrors.length} Validation Error(s)
                    </div>
                    {validationErrors.map((err, i) => (
                      <div key={i} style={{
                        padding: '12px 16px', marginBottom: 8,
                        background: 'rgba(45,10,10,0.8)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 8,
                        fontSize: 13, color: '#f87171',
                      }}>
                        <strong>[{err.code}]</strong> {err.message}
                        {err.node_id && <span style={{ color: '#94a3b8', marginLeft: 8 }}>({err.node_id})</span>}
                      </div>
                    ))}
                  </div>
                )}

                {loadingWap ? (
                  <div style={{ padding: 40, textAlign: 'center', color: '#64748b' }}>
                    <Loader size={24} className="spin" style={{ color: '#6366f1', marginBottom: 10 }} />
                    <div>Loading 5-Step WAP Execution Plan...</div>
                  </div>
                ) : wapPlan ? (() => {
                  const STEP_META = {
                    pre_clean:           { badge: '#64748b', label: 'CLEAN',     bg: 'rgba(71,85,105,0.18)',    border: 'rgba(71,85,105,0.4)'   },
                    insert_staging:      { badge: '#38bdf8', label: 'STAGE',     bg: 'rgba(56,189,248,0.06)',   border: 'rgba(56,189,248,0.2)'  },
                    validate:            { badge: '#fbbf24', label: 'VALIDATE',  bg: 'rgba(251,191,36,0.06)',   border: 'rgba(251,191,36,0.25)' },
                    merge_main:          { badge: '#818cf8', label: 'MERGE',     bg: 'rgba(99,102,241,0.06)',   border: 'rgba(99,102,241,0.25)' },
                    partition_recompute: { badge: '#c084fc', label: 'RECOMPUTE', bg: 'rgba(168,85,247,0.06)',   border: 'rgba(168,85,247,0.25)' },
                    post_clean:          { badge: '#64748b', label: 'CLEAN',     bg: 'rgba(71,85,105,0.18)',    border: 'rgba(71,85,105,0.4)'   },
                  }

                  const combinedSteps = wapPlan.steps || [
                    ...(wapPlan.core_steps || []),
                    ...(wapPlan.success_steps || []),
                    ...(wapPlan.rollback_steps || []),
                    ...(wapPlan.cleanup_steps || [])
                  ]

                  const allSteps = combinedSteps.map(s => {
                    const isBackend = s.step_type === 'query_state' || s.step_type === 'postgres_sql' || s.step_type === 'execute'
                    const m = STEP_META[s.step_name] || STEP_META[s.step_type] || {
                      badge: isBackend ? '#94a3b8' : '#6366f1',
                      label: s.step_type?.toUpperCase(),
                      bg: isBackend ? 'rgba(148,163,184,0.05)' : 'rgba(99,102,241,0.06)',
                      border: isBackend ? 'rgba(148,163,184,0.18)' : 'rgba(99,102,241,0.2)'
                    }
                    return {
                      ...s,
                      ...m,
                      // Prefer runtime from backend, fall back to guess
                      runtime: s.runtime || (isBackend ? 'Backend · PostgreSQL' : 'Dagster → Trino · Iceberg'),
                      _kind: isBackend ? 'orchestration' : 'sql'
                    }
                  })

                  // Phase boundaries for section headers
                  const coreLen = (wapPlan.core_steps || []).length
                  const successLen = (wapPlan.success_steps || []).length
                  const rollbackLen = (wapPlan.rollback_steps || []).length
                  const SECTION_LABELS = {
                    0: { text: '① WAP Execution Plan', color: '#6366f1' },
                    ...(successLen > 0 ? { [coreLen]: { text: '② Commit', color: '#22c55e' } } : {}),
                    ...(rollbackLen > 0 ? { [coreLen + successLen]: { text: '③ Failure Handler', color: '#ef4444' } } : {}),
                  }

                  return (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
                      {/* Header */}
                      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
                        <div style={{ fontSize: 15, color: '#e2e8f0', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8 }}>
                          <CheckCircle size={18} color="#22c55e" />
                          Full Execution Plan
                          <span style={{
                            fontSize: 10, padding: '2px 8px', borderRadius: 10,
                            background: wapPlan.source === 'history' ? 'rgba(234,179,8,0.15)' : 'rgba(99,102,241,0.15)',
                            color: wapPlan.source === 'history' ? '#fbbf24' : '#818cf8',
                            fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em'
                          }}>
                            {wapPlan.source === 'history' ? 'Run History' : 'Live Preview'}
                          </span>
                          <span style={{ fontSize: 11, color: '#475569', fontWeight: 400 }}>
                            {allSteps.length} steps total
                          </span>
                        </div>
                        <div style={{ display: 'flex', gap: 16, fontSize: 12, flexWrap: 'wrap', alignItems: 'center' }}>
                          <span style={{ color: '#64748b' }}>Staging: <span style={{ color: '#38bdf8', fontFamily: 'monospace' }}>{wapPlan.staging_table}</span></span>
                          <span style={{ color: '#64748b' }}>Main: <span style={{ color: '#a5b4fc', fontFamily: 'monospace' }}>{wapPlan.main_table}</span></span>
                        </div>
                      </div>

                      {/* Watermark / Snapshot info bar */}
                      <div style={{
                        display: 'flex', gap: 16, flexWrap: 'wrap',
                        padding: '10px 16px', borderRadius: 8,
                        background: 'rgba(15,23,42,0.6)', border: '1px solid rgba(255,255,255,0.07)',
                        fontSize: 12, alignItems: 'center',
                      }}>
                        <span style={{ color: '#64748b' }}>
                          Watermark: <span style={{ color: '#94a3b8', fontFamily: 'monospace' }}>{wapPlan.watermark || '{{ pipeline_watermark }}'}</span>
                        </span>
                        <span style={{ color: '#334155' }}>│</span>
                        <span style={{ color: '#64748b' }}>
                          Snapshot range:{' '}
                          <span style={{ color: '#34d399', fontFamily: 'monospace' }}>{wapPlan.start_snapshot_id || '{{ start_snapshot_id }}'}</span>
                          {' → '}
                          <span style={{ color: '#34d399', fontFamily: 'monospace' }}>{wapPlan.end_snapshot_id || '{{ end_snapshot_id }}'}</span>
                          <span style={{ color: '#475569', marginLeft: 6 }}>(frozen at run start)</span>
                        </span>
                      </div>

                      {/* All steps */}
                      {allSteps.map((step, idx) => {
                        const sectionLabel = SECTION_LABELS[idx]
                        return (
                          <React.Fragment key={idx}>
                            {sectionLabel && (
                              <div style={{
                                display: 'flex', alignItems: 'center', gap: 10, marginTop: idx > 0 ? 4 : 0,
                              }}>
                                <div style={{ flex: 1, height: 1, background: `${sectionLabel.color}30` }} />
                                <span style={{ fontSize: 11, fontWeight: 700, color: sectionLabel.color, textTransform: 'uppercase', letterSpacing: '0.08em', whiteSpace: 'nowrap' }}>
                                  {sectionLabel.text}
                                </span>
                                <div style={{ flex: 1, height: 1, background: `${sectionLabel.color}30` }} />
                              </div>
                            )}
                            <div style={{ background: step.bg, border: `1px solid ${step.border}`, borderRadius: 10, overflow: 'hidden' }}>
                              <div style={{
                                padding: '10px 18px', borderBottom: `1px solid ${step.border}`,
                                display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8
                              }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                  <span style={{
                                    width: 22, height: 22, borderRadius: '50%', background: step.badge,
                                    color: '#0f172a', display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    fontSize: 11, fontWeight: 800, flexShrink: 0,
                                  }}>{idx + 1}</span>
                                  <span style={{ fontSize: 13, fontWeight: 600, color: '#f1f5f9', fontFamily: 'monospace' }}>{step.step_name}</span>
                                  <span style={{
                                    fontSize: 10, padding: '1px 7px', borderRadius: 4,
                                    background: `${step.badge}25`, color: step.badge,
                                    fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em'
                                  }}>
                                    {step.label}
                                  </span>
                                </div>
                                <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexShrink: 0 }}>
                                  {step.runtime && (
                                    <span style={{ fontSize: 10, color: '#475569', fontFamily: 'monospace' }}>{step.runtime}</span>
                                  )}
                                  {step.fail_on_rows && (
                                    <span style={{ fontSize: 11, color: '#f87171', display: 'flex', alignItems: 'center', gap: 4 }}>
                                      <AlertCircle size={11} /> Abort if rows &gt; 0
                                    </span>
                                  )}
                                  {step.fail_on_zero && (
                                    <span style={{ fontSize: 11, color: '#fb923c', display: 'flex', alignItems: 'center', gap: 4 }}>
                                      <AlertCircle size={11} /> Abort if no rows
                                    </span>
                                  )}
                                </div>
                              </div>
                              <pre style={{
                                fontFamily: 'JetBrains Mono, Fira Code, monospace',
                                fontSize: 12, color: step._kind === 'orchestration' ? '#94a3b8' : '#e2e8f0',
                                lineHeight: 1.65, whiteSpace: 'pre-wrap', margin: 0,
                                padding: '14px 18px', background: '#080c18', overflowX: 'auto',
                              }}>
                                {step.sql}
                              </pre>
                            </div>
                          </React.Fragment>
                        )
                      })}
                    </div>
                  )
                })() : compiledSQL ? (
                  <>
                    <div style={{ fontSize: 12, color: '#22c55e', marginBottom: 14, display: 'flex', alignItems: 'center', gap: 6, fontWeight: 600 }}>
                      <CheckCircle size={14} /> Compiled CTE SQL — Trino (Legacy View)
                    </div>
                    <pre style={{
                      fontFamily: 'JetBrains Mono, Fira Code, monospace',
                      fontSize: 13, color: '#e2e8f0', lineHeight: 1.7,
                      whiteSpace: 'pre-wrap', margin: 0, wordBreak: 'break-all',
                      background: '#0a0f1e', padding: '20px 24px',
                      borderRadius: 10, border: '1px solid rgba(255,255,255,0.07)',
                      boxShadow: '0 4px 24px rgba(0,0,0,0.4)',
                    }}>
                      {compiledSQL}
                    </pre>
                  </>
                ) : (
                  <div style={{
                    flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center',
                    justifyContent: 'center', height: '60vh', gap: 12,
                  }}>
                    <Terminal size={40} style={{ color: '#1e293b' }} />
                    <div style={{ color: '#475569', fontSize: 14, textAlign: 'center' }}>
                      Click <strong style={{ color: '#6366f1' }}>Save Pipeline</strong> in the Visual Editor<br />
                      to validate and compile WAP Plan
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* ── HISTORY TAB ── */}
            {mainTab === 'history' && (
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: '#080c18' }}>
                <RunHistory pipelineId={selectedPipeline?.id} refreshTrigger={refreshTrigger} />
              </div>
            )}

            {/* ── TRIGGERED BY TAB ── */}
            {mainTab === 'triggered_by' && (
              <TriggersTab
                pipeline={selectedPipeline}
                sources={triggerSources}
                upstreamPipelines={upstreamPipelineTriggers}
                downstreams={[]}
                loading={loadingTriggers}
                onRefresh={refreshAllTriggers}
                onNavigateConnectors={() => navigate('/connectors')}
                onNavigateConnectorTrigger={(connectorId) => navigate(`/connectors?highlight=${connectorId}&open=triggers`)}
                onOpenDownstreamDrawer={() => setShowDownstreamDrawer(true)}
                mode="triggered_by"
                onRemoveConnectorTrigger={handleRemoveConnectorTrigger}
                onToggleConnectorTrigger={handleToggleConnectorTrigger}
                onRemovePipelineTrigger={handleRemovePipelineTrigger}
                onTogglePipelineTrigger={handleTogglePipelineTrigger}
                confirm={confirmCustom}
              />
            )}

            {/* ── TRIGGERS TAB ── */}
            {mainTab === 'triggers_next' && (
              <TriggersTab
                pipeline={selectedPipeline}
                sources={[]}
                downstreams={downstreamTriggers}
                loading={loadingTriggers}
                onRefresh={() => {
                  setLoadingTriggers(true)
                  api.getPipelineDownstreamTriggers(selectedPipeline.id)
                    .then(downRes => setDownstreamTriggers(downRes.triggers || []))
                    .finally(() => setLoadingTriggers(false))
                }}
                onNavigateConnectors={() => navigate('/connectors')}
                onOpenDownstreamDrawer={() => setShowDownstreamDrawer(true)}
                mode="triggers_next"
                onRemovePipelineTrigger={handleRemovePipelineTrigger}
                onTogglePipelineTrigger={handleTogglePipelineTrigger}
                confirm={confirmCustom}
              />
            )}
          </div>
        )}
      </div>

      {/* ── Toast ── */}
      {toast && (
        <div style={{
          position: 'fixed', bottom: 28, right: 28, zIndex: 9999,
          padding: '14px 22px', borderRadius: 12,
          background: toast.type === 'success' ? 'rgba(5,46,22,0.95)' : 'rgba(45,10,10,0.95)',
          border: `1px solid ${toast.type === 'success' ? '#22c55e40' : '#ef444440'}`,
          color: toast.type === 'success' ? '#22c55e' : '#f87171',
          fontSize: 13, fontWeight: 500,
          display: 'flex', alignItems: 'center', gap: 10,
          boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
          backdropFilter: 'blur(12px)',
          animation: 'slideIn 0.25s cubic-bezier(0.34,1.56,0.64,1)',
        }}>
          {toast.type === 'success' ? <CheckCircle size={16} /> : <AlertCircle size={16} />}
          {toast.msg}
        </div>
      )}

      {showDownstreamDrawer && selectedPipeline && (
        <PipelineDownstreamTriggerDrawer
          pipeline={selectedPipeline}
          onClose={() => {
            setShowDownstreamDrawer(false)
            // refresh
            setLoadingTriggers(true)
            api.getPipelineDownstreamTriggers(selectedPipeline.id)
              .then(res => setDownstreamTriggers(res.triggers || []))
              .catch(e => showToast('error', 'Failed to load downstream triggers: ' + e.message))
              .finally(() => setLoadingTriggers(false))
          }}
          showToast={showToast}
        />
      )}

      {/* Custom Confirm Modal */}
      {confirmDialog && (
        <div className="modal-overlay" style={{ background: 'rgba(0,0,0,0.7)', zIndex: 10000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div className="modal-content" style={{ maxWidth: 450, padding: 24, background: '#0b0f19', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16, color: '#f59e0b' }}>
              <AlertCircle size={22} />
              <h3 style={{ margin: 0, fontSize: 18, color: '#f1f5f9' }}>{confirmDialog.title}</h3>
            </div>
            <p style={{ color: '#94a3b8', fontSize: 13, lineHeight: 1.6, margin: '0 0 24px 0' }}>
              {confirmDialog.message}
            </p>
            <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
              <button
                className="btn btn-secondary btn-sm"
                onClick={() => {
                  if (confirmDialog.onCancel) confirmDialog.onCancel();
                  setConfirmDialog(null);
                }}
              >
                Hủy
              </button>
              <button
                className="btn btn-primary btn-sm"
                style={{ background: '#ef4444', borderColor: '#ef4444', color: '#fff' }}
                onClick={() => {
                  if (confirmDialog.onConfirm) confirmDialog.onConfirm();
                  setConfirmDialog(null);
                }}
              >
                Xác nhận
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Triggers Tab ─────────────────────────────────────────────────────────────
function TriggersTab({ pipeline, sources, upstreamPipelines = [], downstreams, loading, onRefresh, onNavigateConnectors, onNavigateConnectorTrigger, onOpenDownstreamDrawer, mode, onRemoveConnectorTrigger, onRemovePipelineTrigger, onToggleConnectorTrigger, onTogglePipelineTrigger, confirm }) {
  const isTriggerBy = mode === 'triggered_by'
  const enabledSources = sources.filter(s => s.enabled)
  const disabledSources = sources.filter(s => !s.enabled)
  const enabledUpstreams = upstreamPipelines.filter(u => u.enabled)
  const disabledUpstreams = upstreamPipelines.filter(u => !u.enabled)

  return (
    <div style={{ flex: 1, overflowY: 'auto', background: '#080c18', padding: '28px 32px' }}>
      {/* ── keyframes for animations ── */}
      <style>{`
        @keyframes eventPulse {
          0%, 100% { opacity: 1; box-shadow: 0 0 0 0 rgba(34,211,238,0.4); }
          50% { opacity: 0.85; box-shadow: 0 0 0 4px rgba(34,211,238,0); }
        }
        @keyframes flowPulse {
          0% { stroke-dashoffset: 20; }
          100% { stroke-dashoffset: 0; }
        }
        @keyframes arrowGlow {
          0%, 100% { opacity: 0.6; transform: translateX(0); }
          50% { opacity: 1; transform: translateX(3px); }
        }
        @keyframes nodePop {
          0% { transform: scale(0.95); opacity: 0; }
          100% { transform: scale(1); opacity: 1; }
        }
      `}</style>

      {/* ── Header section ── */}
      <div style={{ marginBottom: 28, display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
            <div style={{
              width: 36, height: 36, borderRadius: 10,
              background: isTriggerBy ? 'rgba(34,211,238,0.12)' : 'rgba(168,85,247,0.12)',
              border: `1px solid ${isTriggerBy ? 'rgba(34,211,238,0.3)' : 'rgba(168,85,247,0.3)'}`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              {isTriggerBy ? <ArrowRight size={18} color="#22d3ee" /> : <GitBranch size={18} color="#a855f7" />}
            </div>
            <div>
              <div style={{ fontSize: 18, fontWeight: 700, color: '#f1f5f9' }}>
                {isTriggerBy ? 'Triggered By Sources' : 'Trigger'}
              </div>
              <div style={{ fontSize: 13, color: '#64748b' }}>
                {isTriggerBy 
                  ? 'Connectors or parent pipelines that trigger this pipeline'
                  : 'Pipelines that will auto-run after this pipeline completes'}
              </div>
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button
            onClick={onRefresh}
            disabled={loading}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '7px 14px', borderRadius: 8,
              background: 'rgba(255,255,255,0.05)',
              border: '1px solid rgba(255,255,255,0.1)',
              color: '#94a3b8', cursor: 'pointer', fontSize: 12, fontWeight: 500,
            }}
          >
            {loading ? <Loader size={13} className="spin" /> : <RefreshCw size={13} />}
            Refresh
          </button>
          {isTriggerBy ? (
            <button
              onClick={onNavigateConnectors}
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '7px 14px', borderRadius: 8,
                background: 'rgba(34,211,238,0.1)',
                border: '1px solid rgba(34,211,238,0.25)',
                color: '#22d3ee', cursor: 'pointer', fontSize: 12, fontWeight: 600,
              }}
            >
              <ExternalLink size={13} /> Manage Connectors
            </button>
          ) : (
            <button
              onClick={onOpenDownstreamDrawer}
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '7px 14px', borderRadius: 8,
                background: 'rgba(168,85,247,0.1)',
                border: '1px solid rgba(168,85,247,0.25)',
                color: '#c084fc', cursor: 'pointer', fontSize: 12, fontWeight: 600,
              }}
            >
              <Plus size={13} /> Add Trigger Pipeline
            </button>
          )}
        </div>
      </div>

      {loading ? (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 240 }}>
          <div style={{ textAlign: 'center' }}>
            <Loader size={32} className="spin" style={{ color: isTriggerBy ? '#22d3ee' : '#a855f7', marginBottom: 12 }} />
            <div style={{ color: '#64748b', fontSize: 14 }}>Loading triggers...</div>
          </div>
        </div>
      ) : (isTriggerBy && sources.length === 0 && upstreamPipelines.length === 0) || (!isTriggerBy && downstreams.length === 0) ? (
        /* ── Empty state ── */
        <div style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center',
          justifyContent: 'center', height: 320, gap: 16, textAlign: 'center',
        }}>
          <div style={{
            width: 80, height: 80, borderRadius: '50%',
            background: isTriggerBy ? 'rgba(34,211,238,0.06)' : 'rgba(168,85,247,0.06)',
            border: `1px dashed ${isTriggerBy ? 'rgba(34,211,238,0.2)' : 'rgba(168,85,247,0.2)'}`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            {isTriggerBy ? <ArrowRight size={36} style={{ color: '#1e3a4a' }} /> : <GitBranch size={36} style={{ color: '#4c1d95' }} />}
          </div>
          <div>
            <div style={{ fontSize: 16, fontWeight: 600, color: '#334155', marginBottom: 8 }}>
              {isTriggerBy ? 'No "Triggered By" Sources configured' : 'No "Trigger" Targets configured'}
            </div>
            <div style={{ fontSize: 13, color: '#1e293b', lineHeight: 1.7 }}>
              {isTriggerBy 
                ? <>This pipeline runs on-demand only.<br/>To make it event-driven, open a connector or another pipeline, and link this pipeline as a trigger target.</>
                : <>This pipeline does not trigger any other pipelines.<br/>Click "Add Trigger Pipeline" to configure event-driven chains.</>
              }
            </div>
          </div>
          {isTriggerBy ? (
            <button
              onClick={onNavigateConnectors}
              style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '9px 20px', borderRadius: 9,
                background: 'rgba(34,211,238,0.1)',
                border: '1px solid rgba(34,211,238,0.25)',
                color: '#22d3ee', cursor: 'pointer', fontSize: 13, fontWeight: 600,
              }}
            >
              <ExternalLink size={14} /> Go to Connector Studio
            </button>
          ) : (
            <button
              onClick={onOpenDownstreamDrawer}
              style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '9px 20px', borderRadius: 9,
                background: 'rgba(168,85,247,0.1)',
                border: '1px solid rgba(168,85,247,0.25)',
                color: '#c084fc', cursor: 'pointer', fontSize: 13, fontWeight: 600,
              }}
            >
              <Plus size={14} /> Add Trigger Pipeline
            </button>
          )}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

          {/* ── Stats bar ── */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 8 }}>
            {[
              { label: isTriggerBy ? 'Total Trigger Sources' : 'Total Trigger Targets', value: isTriggerBy ? (sources.length + upstreamPipelines.length) : downstreams.length, color: isTriggerBy ? '#22d3ee' : '#a855f7' },
              { label: 'Active', value: isTriggerBy ? (enabledSources.length + enabledUpstreams.length) : downstreams.filter(d => d.enabled).length, color: '#22c55e' },
              { label: 'Paused', value: isTriggerBy ? (disabledSources.length + disabledUpstreams.length) : downstreams.filter(d => !d.enabled).length, color: '#64748b' },
            ].map(stat => (
              <div key={stat.label} style={{
                padding: '14px 18px',
                background: 'rgba(255,255,255,0.03)',
                border: `1px solid ${stat.color}20`,
                borderRadius: 10,
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              }}>
                <span style={{ fontSize: 12, color: '#64748b', fontWeight: 500 }}>{stat.label}</span>
                <span style={{ fontSize: 22, fontWeight: 800, color: stat.color }}>{stat.value}</span>
              </div>
            ))}
          </div>

          {/* ── Visual flow diagram for each connector source ── */}
          {isTriggerBy && sources.length > 0 && (
            <div style={{ marginBottom: 24 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#94a3b8', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
                <Database size={14} color="#22d3ee" />
                Connector Sources
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {sources.map((src, idx) => (
                  <TriggerFlowCard
                    key={`up-conn-${src.trigger_id}`}
                    source={src}
                    pipeline={pipeline}
                    index={idx}
                    onNavigateConnectorTrigger={onNavigateConnectorTrigger}
                    onRemoveTrigger={onRemoveConnectorTrigger}
                    onToggleTrigger={onToggleConnectorTrigger}
                    confirm={confirm}
                  />
                ))}
              </div>
            </div>
          )}

          {/* ── Visual flow diagram for each upstream pipeline source ── */}
          {isTriggerBy && upstreamPipelines.length > 0 && (
            <div style={{ marginBottom: 24 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#94a3b8', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
                <Zap size={14} color="#a855f7" />
                Triggering Pipeline Sources
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {upstreamPipelines.map((up, idx) => (
                  <UpstreamPipelineTriggerFlowCard
                    key={`up-pipe-${up.trigger_id}`}
                    upstream={up}
                    pipeline={pipeline}
                    index={idx}
                    onRemoveTrigger={onRemovePipelineTrigger}
                    onToggleTrigger={onTogglePipelineTrigger}
                    confirm={confirm}
                  />
                ))}
              </div>
            </div>
          )}

          {/* ── Visual flow diagram for downstream pipelines ── */}
          {!isTriggerBy && downstreams.length > 0 && (
            <div style={{ marginBottom: 24 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {downstreams.map((down, idx) => (
                  <PipelineTriggerFlowCard
                    key={`down-${down.id}`}
                    downstream={down}
                    pipeline={pipeline}
                    index={idx}
                    onRemoveTrigger={onRemovePipelineTrigger}
                    onToggleTrigger={onTogglePipelineTrigger}
                    confirm={confirm}
                  />
                ))}
              </div>
            </div>
          )}

          {/* ── Help banner ── */}
          <div style={{
            padding: '14px 18px',
            background: 'rgba(99,102,241,0.05)',
            border: '1px solid rgba(99,102,241,0.15)',
            borderRadius: 10,
            fontSize: 12, color: '#64748b', lineHeight: 1.7,
            display: 'flex', alignItems: 'flex-start', gap: 10,
          }}>
            <Info size={15} color="#6366f1" style={{ marginTop: 1, flexShrink: 0 }} />
            <span>
              {isTriggerBy ? (
                <>These triggers are <strong style={{ color: '#a5b4fc' }}>read-only</strong> in Pipeline Studio. To add, remove, or configure trigger conditions, manage them from the respective <button onClick={onNavigateConnectors} style={{ background: 'none', border: 'none', color: '#22d3ee', cursor: 'pointer', padding: 0, fontSize: 12, fontWeight: 600, textDecoration: 'underline' }}>Connector Studio</button> or the triggering Pipeline's <strong style={{ color: '#e2e8f0' }}>Trigger</strong> tab.</>
              ) : (
                <>Trigger target pipelines are executed sequentially after <strong style={{ color: '#e2e8f0' }}>{pipeline.name}</strong> successfully completes. Click "Add Trigger Pipeline" to chain another workflow.</>
              )}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}


function TriggerFlowCard({ source, pipeline, index, onNavigateConnectorTrigger, onRemoveTrigger, onToggleTrigger, confirm }) {
  const isEnabled = source.enabled;
  const lastTriggered = source.last_triggered_at
    ? new Date(source.last_triggered_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
    : null;

  const lastSynced = source.last_synced_at
    ? new Date(source.last_synced_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
    : null;

  return (
    <div style={{
      background: 'rgba(17, 24, 39, 0.4)',
      border: `1px solid ${isEnabled ? 'rgba(34, 211, 238, 0.15)' : 'rgba(255, 255, 255, 0.05)'}`,
      borderRadius: 12,
      padding: '14px 20px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 16,
      animation: `nodePop 0.3s ease forwards`,
      animationDelay: `${index * 0.05}s`,
      opacity: 0,
      transition: 'all 0.2s ease',
    }}
    className="trigger-row"
    >
      {/* Left side: Compact flow illustration */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0, flex: 1 }}>
        {/* Source Connector box */}
        <div 
          onClick={() => onNavigateConnectorTrigger && onNavigateConnectorTrigger(source.connector_id)}
          style={{ 
            display: 'flex', 
            alignItems: 'center', 
            gap: 10, 
            background: 'rgba(129, 140, 248, 0.06)',
            border: '1px solid rgba(129, 140, 248, 0.2)',
            padding: '6px 12px',
            borderRadius: 8,
            cursor: onNavigateConnectorTrigger ? 'pointer' : 'default',
            transition: 'all 0.2s',
          }}
          onMouseEnter={e => { e.currentTarget.style.borderColor = 'rgba(129,140,248,0.5)' }}
          onMouseLeave={e => { e.currentTarget.style.borderColor = 'rgba(129,140,248,0.2)' }}
        >
          <Database size={15} color="#818cf8" style={{ flexShrink: 0 }} />
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#a5b4fc', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 140 }}>
              {source.connector_name}
            </div>
            <div style={{ fontSize: 9, color: source.connector_status === 'active' ? '#34d399' : '#f87171', fontWeight: 600, textTransform: 'uppercase' }}>
              {source.connector_status || 'UNKNOWN'}
            </div>
          </div>
        </div>

        {/* Connection arrow */}
        <ArrowRight size={14} color="#475569" style={{ flexShrink: 0 }} />

        {/* Target Pipeline box */}
        <div style={{ 
          display: 'flex', 
          alignItems: 'center', 
          gap: 10, 
          background: 'rgba(34, 211, 238, 0.04)',
          border: '1px solid rgba(34, 211, 238, 0.15)',
          padding: '6px 12px',
          borderRadius: 8,
        }}>
          <Zap size={15} color="#22d3ee" style={{ flexShrink: 0 }} />
          <div>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#e2e8f0', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 140 }}>
              {pipeline.name}
            </div>
            <div style={{ fontSize: 9, color: '#64748b' }}>
              {pipeline.engine?.toUpperCase()} · v{pipeline.latest_version}
            </div>
          </div>
        </div>
      </div>

      {/* Middle side: Trigger Conditions & History */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
        {source.only_if_new_rows ? (
          <span style={{ fontSize: 10, padding: '3px 8px', borderRadius: 20, fontWeight: 600, background: 'rgba(34, 197, 94, 0.08)', border: '1px solid rgba(34, 197, 94, 0.15)', color: '#22c55e' }}>
            Only if new rows
          </span>
        ) : (
          <span style={{ fontSize: 10, padding: '3px 8px', borderRadius: 20, fontWeight: 600, background: 'rgba(245, 158, 11, 0.08)', border: '1px solid rgba(245, 158, 11, 0.15)', color: '#f59e0b' }}>
            Always Trigger
          </span>
        )}
        <span style={{ fontSize: 10, padding: '3px 8px', borderRadius: 20, fontWeight: 600, background: 'rgba(100, 116, 139, 0.08)', border: '1px solid rgba(100, 116, 139, 0.15)', color: '#94a3b8' }}>
          {source.delay_seconds === 0 ? 'Immediate' : `Delay: ${source.delay_seconds}s`}
        </span>
        
        {/* Sync/Trigger Metadata */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', marginLeft: 8, gap: 1 }}>
          {lastSynced && (
            <div style={{ fontSize: 10, color: '#475569', lineHeight: 1 }}>
              Last sync: <strong style={{ color: '#64748b' }}>{lastSynced}</strong>
              {source.rows_last_sync != null && ` (${source.rows_last_sync.toLocaleString()} rows)`}
            </div>
          )}
          {lastTriggered && (
            <div style={{ fontSize: 10, color: '#475569', lineHeight: 1 }}>
              Last triggered: <strong style={{ color: '#64748b' }}>{lastTriggered}</strong>
            </div>
          )}
        </div>
      </div>

      {/* Right side: Actions (Toggle Switch + Remove Button) */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexShrink: 0 }}>
        {/* Premium Switch Switch */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 10, color: isEnabled ? '#22d3ee' : '#64748b', fontWeight: 600 }}>
            {isEnabled ? 'ACTIVE' : 'PAUSED'}
          </span>
          <div 
            onClick={() => onToggleTrigger && onToggleTrigger(source.connector_id, source.trigger_id, isEnabled)}
            style={{
              width: 34,
              height: 18,
              borderRadius: 99,
              background: isEnabled ? '#22d3ee' : '#334155',
              position: 'relative',
              cursor: 'pointer',
              transition: 'all 0.2s ease',
            }}
          >
            <div style={{
              width: 12,
              height: 12,
              borderRadius: '50%',
              background: '#ffffff',
              position: 'absolute',
              top: 3,
              left: isEnabled ? 19 : 3,
              transition: 'all 0.2s ease',
            }} />
          </div>
        </div>

        {/* Disconnect button */}
        {onRemoveTrigger && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              const action = () => onRemoveTrigger(source.connector_id, source.trigger_id);
              if (confirm) {
                confirm({
                  title: 'Disconnect Trigger',
                  message: `Are you sure you want to disconnect the trigger relationship between Connector "${source.connector_name}" and Pipeline "${pipeline.name}"?`,
                  onConfirm: action
                });
              } else {
                if (window.confirm(`Are you sure you want to disconnect the trigger relationship between Connector "${source.connector_name}" and Pipeline "${pipeline.name}"?`)) {
                  action();
                }
              }
            }}
            style={{
              background: 'rgba(239, 68, 68, 0.06)',
              border: '1px solid rgba(239, 68, 68, 0.15)',
              color: '#f87171',
              padding: '4px 10px',
              borderRadius: 6,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 11,
              fontWeight: 600,
              gap: 4,
              transition: 'all 0.2s',
            }}
            onMouseEnter={e => { e.currentTarget.style.background = 'rgba(239, 68, 68, 0.12)'; e.currentTarget.style.borderColor = 'rgba(239, 68, 68, 0.3)' }}
            onMouseLeave={e => { e.currentTarget.style.background = 'rgba(239, 68, 68, 0.06)'; e.currentTarget.style.borderColor = 'rgba(239, 68, 68, 0.15)' }}
          >
            <X size={11} /> Disconnect
          </button>
        )}
      </div>
    </div>
  );
}

function Chip({ label, color }) {
  return (
    <span style={{
      fontSize: 11, padding: '3px 10px', borderRadius: 20, fontWeight: 600,
      background: `${color}12`,
      border: `1px solid ${color}25`,
      color: color,
    }}>{label}</span>
  )
}

// ── Empty State ───────────────────────────────────────────────────────────────
function EmptyEditorState() {
  return (
    <div style={{
      flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: '#080c18',
    }}>
      <div style={{ textAlign: 'center', maxWidth: 460 }}>
        <div style={{
          width: 80, height: 80, borderRadius: '50%',
          background: 'rgba(99,102,241,0.1)', border: '1px solid rgba(99,102,241,0.2)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          margin: '0 auto 24px', fontSize: 36,
        }}>⚡</div>
        <div style={{ fontSize: 24, fontWeight: 700, color: '#e2e8f0', marginBottom: 12 }}>
          Pipeline Studio
        </div>
        <div style={{ fontSize: 14, color: '#475569', lineHeight: 1.8, marginBottom: 28 }}>
          Build visual data pipelines with drag-and-drop nodes.<br />
          Powered by <strong style={{ color: '#6366f1' }}>Trino CTE SQL</strong> with automatic compilation.
        </div>
      </div>
    </div>
  )
}

function PipelineTriggerFlowCard({ downstream, pipeline, index, onRemoveTrigger, onToggleTrigger, confirm }) {
  const isEnabled = downstream.enabled;
  const lastTriggered = downstream.last_triggered_at
    ? new Date(downstream.last_triggered_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
    : null;

  return (
    <div style={{
      background: 'rgba(17, 24, 39, 0.4)',
      border: `1px solid ${isEnabled ? 'rgba(168, 85, 247, 0.15)' : 'rgba(255, 255, 255, 0.05)'}`,
      borderRadius: 12,
      padding: '14px 20px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 16,
      animation: `nodePop 0.3s ease forwards`,
      animationDelay: `${index * 0.05}s`,
      opacity: 0,
      transition: 'all 0.2s ease',
    }}
    className="trigger-row"
    >
      {/* Left side: Compact flow illustration */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0, flex: 1 }}>
        {/* Source Pipeline box */}
        <div style={{ 
          display: 'flex', 
          alignItems: 'center', 
          gap: 10, 
          background: 'rgba(99, 102, 241, 0.06)',
          border: '1px solid rgba(99, 102, 241, 0.2)',
          padding: '6px 12px',
          borderRadius: 8,
        }}>
          <Zap size={15} color="#818cf8" style={{ flexShrink: 0 }} />
          <div>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#a5b4fc', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 140 }}>
              {pipeline.name}
            </div>
            <div style={{ fontSize: 9, color: '#64748b' }}>
              v{pipeline.latest_version}
            </div>
          </div>
        </div>

        {/* Connection arrow */}
        <ArrowRight size={14} color="#475569" style={{ flexShrink: 0 }} />

        {/* Target Downstream Pipeline box */}
        <div style={{ 
          display: 'flex', 
          alignItems: 'center', 
          gap: 10, 
          background: 'rgba(168, 85, 247, 0.04)',
          border: '1px solid rgba(168, 85, 247, 0.15)',
          padding: '6px 12px',
          borderRadius: 8,
        }}>
          <Zap size={15} color="#a855f7" style={{ flexShrink: 0 }} />
          <div>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#e9d5ff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 140 }}>
              {downstream.downstream_pipeline_name}
            </div>
            <div style={{ fontSize: 9, color: downstream.downstream_pipeline_status === 'active' ? '#34d399' : '#64748b' }}>
              {downstream.downstream_pipeline_status?.toUpperCase() || 'UNKNOWN'}
            </div>
          </div>
        </div>
      </div>

      {/* Middle side: Trigger Conditions & History */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
        {downstream.only_if_new_rows ? (
          <span style={{ fontSize: 10, padding: '3px 8px', borderRadius: 20, fontWeight: 600, background: 'rgba(34, 197, 94, 0.08)', border: '1px solid rgba(34, 197, 94, 0.15)', color: '#22c55e' }}>
            If new rows
          </span>
        ) : (
          <span style={{ fontSize: 10, padding: '3px 8px', borderRadius: 20, fontWeight: 600, background: 'rgba(245, 158, 11, 0.08)', border: '1px solid rgba(245, 158, 11, 0.15)', color: '#f59e0b' }}>
            Always Trigger
          </span>
        )}
        <span style={{ fontSize: 10, padding: '3px 8px', borderRadius: 20, fontWeight: 600, background: 'rgba(100, 116, 139, 0.08)', border: '1px solid rgba(100, 116, 139, 0.15)', color: '#94a3b8' }}>
          {downstream.delay_seconds === 0 ? 'Immediate' : `Delay: ${downstream.delay_seconds}s`}
        </span>
        
        {/* Trigger Metadata */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', marginLeft: 8, gap: 1 }}>
          {lastTriggered && (
            <div style={{ fontSize: 10, color: '#475569', lineHeight: 1 }}>
              Last triggered: <strong style={{ color: '#64748b' }}>{lastTriggered}</strong>
            </div>
          )}
        </div>
      </div>

      {/* Right side: Actions (Toggle Switch + Remove Button) */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexShrink: 0 }}>
        {/* Premium Switch Switch */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 10, color: isEnabled ? '#a855f7' : '#64748b', fontWeight: 600 }}>
            {isEnabled ? 'ACTIVE' : 'PAUSED'}
          </span>
          <div 
            onClick={() => onToggleTrigger && onToggleTrigger(downstream.id, isEnabled)}
            style={{
              width: 34,
              height: 18,
              borderRadius: 99,
              background: isEnabled ? '#a855f7' : '#334155',
              position: 'relative',
              cursor: 'pointer',
              transition: 'all 0.2s ease',
            }}
          >
            <div style={{
              width: 12,
              height: 12,
              borderRadius: '50%',
              background: '#ffffff',
              position: 'absolute',
              top: 3,
              left: isEnabled ? 19 : 3,
              transition: 'all 0.2s ease',
            }} />
          </div>
        </div>

        {/* Disconnect button */}
        {onRemoveTrigger && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              const action = () => onRemoveTrigger(downstream.id);
              if (confirm) {
                confirm({
                  title: 'Disconnect Trigger',
                  message: `Are you sure you want to disconnect the trigger relationship between Pipeline "${pipeline.name}" and Pipeline "${downstream.downstream_pipeline_name}"?`,
                  onConfirm: action
                });
              } else {
                if (window.confirm(`Are you sure you want to disconnect the trigger relationship between Pipeline "${pipeline.name}" and Pipeline "${downstream.downstream_pipeline_name}"?`)) {
                  action();
                }
              }
            }}
            style={{
              background: 'rgba(239, 68, 68, 0.06)',
              border: '1px solid rgba(239, 68, 68, 0.15)',
              color: '#f87171',
              padding: '4px 10px',
              borderRadius: 6,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 11,
              fontWeight: 600,
              gap: 4,
              transition: 'all 0.2s',
            }}
            onMouseEnter={e => { e.currentTarget.style.background = 'rgba(239, 68, 68, 0.12)'; e.currentTarget.style.borderColor = 'rgba(239, 68, 68, 0.3)' }}
            onMouseLeave={e => { e.currentTarget.style.background = 'rgba(239, 68, 68, 0.06)'; e.currentTarget.style.borderColor = 'rgba(239, 68, 68, 0.15)' }}
          >
            <X size={11} /> Disconnect
          </button>
        )}
      </div>
    </div>
  );
}

function UpstreamPipelineTriggerFlowCard({ upstream, pipeline, index, onRemoveTrigger, onToggleTrigger, confirm }) {
  const isEnabled = upstream.enabled;
  const lastTriggered = upstream.last_triggered_at
    ? new Date(upstream.last_triggered_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
    : null;

  return (
    <div style={{
      background: 'rgba(17, 24, 39, 0.4)',
      border: `1px solid ${isEnabled ? 'rgba(168, 85, 247, 0.15)' : 'rgba(255, 255, 255, 0.05)'}`,
      borderRadius: 12,
      padding: '14px 20px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 16,
      animation: `nodePop 0.3s ease forwards`,
      animationDelay: `${index * 0.05}s`,
      opacity: 0,
      transition: 'all 0.2s ease',
    }}
    className="trigger-row"
    >
      {/* Left side: Compact flow illustration */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0, flex: 1 }}>
        {/* Source Upstream Pipeline box */}
        <div style={{ 
          display: 'flex', 
          alignItems: 'center', 
          gap: 10, 
          background: 'rgba(168, 85, 247, 0.04)',
          border: '1px solid rgba(168, 85, 247, 0.15)',
          padding: '6px 12px',
          borderRadius: 8,
        }}>
          <Zap size={15} color="#a855f7" style={{ flexShrink: 0 }} />
          <div>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#e9d5ff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 140 }}>
              {upstream.upstream_pipeline_name}
            </div>
            <div style={{ fontSize: 9, color: upstream.upstream_pipeline_status === 'active' ? '#34d399' : '#64748b' }}>
              {upstream.upstream_pipeline_status?.toUpperCase() || 'UNKNOWN'}
            </div>
          </div>
        </div>

        {/* Connection arrow */}
        <ArrowRight size={14} color="#475569" style={{ flexShrink: 0 }} />

        {/* Current Pipeline box (Target) */}
        <div style={{ 
          display: 'flex', 
          alignItems: 'center', 
          gap: 10, 
          background: 'rgba(99, 102, 241, 0.06)',
          border: '1px solid rgba(99, 102, 241, 0.2)',
          padding: '6px 12px',
          borderRadius: 8,
        }}>
          <Zap size={15} color="#818cf8" style={{ flexShrink: 0 }} />
          <div>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#a5b4fc', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 140 }}>
              {pipeline.name}
            </div>
            <div style={{ fontSize: 9, color: '#64748b' }}>
              v{pipeline.latest_version}
            </div>
          </div>
        </div>
      </div>

      {/* Middle side: Trigger Conditions & History */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
        {upstream.only_if_new_rows ? (
          <span style={{ fontSize: 10, padding: '3px 8px', borderRadius: 20, fontWeight: 600, background: 'rgba(34, 197, 94, 0.08)', border: '1px solid rgba(34, 197, 94, 0.15)', color: '#22c55e' }}>
            If new rows
          </span>
        ) : (
          <span style={{ fontSize: 10, padding: '3px 8px', borderRadius: 20, fontWeight: 600, background: 'rgba(245, 158, 11, 0.08)', border: '1px solid rgba(245, 158, 11, 0.15)', color: '#f59e0b' }}>
            Always Trigger
          </span>
        )}
        <span style={{ fontSize: 10, padding: '3px 8px', borderRadius: 20, fontWeight: 600, background: 'rgba(100, 116, 139, 0.08)', border: '1px solid rgba(100, 116, 139, 0.15)', color: '#94a3b8' }}>
          {upstream.delay_seconds === 0 ? 'Immediate' : `Delay: ${upstream.delay_seconds}s`}
        </span>
        
        {/* Trigger Metadata */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', marginLeft: 8, gap: 1 }}>
          {lastTriggered && (
            <div style={{ fontSize: 10, color: '#475569', lineHeight: 1 }}>
              Last triggered: <strong style={{ color: '#64748b' }}>{lastTriggered}</strong>
            </div>
          )}
        </div>
      </div>

      {/* Right side: Actions (Toggle Switch + Remove Button) */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexShrink: 0 }}>
        {/* Premium Switch Switch */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 10, color: isEnabled ? '#a855f7' : '#64748b', fontWeight: 600 }}>
            {isEnabled ? 'ACTIVE' : 'PAUSED'}
          </span>
          <div 
            onClick={() => onToggleTrigger && onToggleTrigger(upstream.upstream_pipeline_id, upstream.trigger_id, isEnabled)}
            style={{
              width: 34,
              height: 18,
              borderRadius: 99,
              background: isEnabled ? '#a855f7' : '#334155',
              position: 'relative',
              cursor: 'pointer',
              transition: 'all 0.2s ease',
            }}
          >
            <div style={{
              width: 12,
              height: 12,
              borderRadius: '50%',
              background: '#ffffff',
              position: 'absolute',
              top: 3,
              left: isEnabled ? 19 : 3,
              transition: 'all 0.2s ease',
            }} />
          </div>
        </div>

        {/* Disconnect button */}
        {onRemoveTrigger && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              const action = () => onRemoveTrigger(upstream.upstream_pipeline_id, upstream.trigger_id);
              if (confirm) {
                confirm({
                  title: 'Disconnect Trigger',
                  message: `Are you sure you want to disconnect the trigger relationship between Pipeline "${upstream.upstream_pipeline_name}" and Pipeline "${pipeline.name}"?`,
                  onConfirm: action
                });
              } else {
                if (window.confirm(`Are you sure you want to disconnect the trigger relationship between Pipeline "${upstream.upstream_pipeline_name}" and Pipeline "${pipeline.name}"?`)) {
                  action();
                }
              }
            }}
            style={{
              background: 'rgba(239, 68, 68, 0.06)',
              border: '1px solid rgba(239, 68, 68, 0.15)',
              color: '#f87171',
              padding: '4px 10px',
              borderRadius: 6,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 11,
              fontWeight: 600,
              gap: 4,
              transition: 'all 0.2s',
            }}
            onMouseEnter={e => { e.currentTarget.style.background = 'rgba(239, 68, 68, 0.12)'; e.currentTarget.style.borderColor = 'rgba(239, 68, 68, 0.3)' }}
            onMouseLeave={e => { e.currentTarget.style.background = 'rgba(239, 68, 68, 0.06)'; e.currentTarget.style.borderColor = 'rgba(239, 68, 68, 0.15)' }}
          >
            <X size={11} /> Disconnect
          </button>
        )}
      </div>
    </div>
  );
}

// ── PipelineDownstreamTriggerDrawer ─────────────────────────────────────────
function PipelineDownstreamTriggerDrawer({ pipeline, onClose, showToast }) {
  const [triggers, setTriggers] = useState([])
  const [allPipelines, setAllPipelines] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [togglingId, setTogglingId] = useState(null)
  const [removingId, setRemovingId] = useState(null)

  // New trigger form state
  const [form, setForm] = useState({
    downstream_pipeline_id: '',
    enabled: true,
    only_if_new_rows: true,
    delay_seconds: 0,
  })

  const load = async () => {
    setLoading(true)
    try {
      const [tRes, pRes] = await Promise.all([
        api.getPipelineDownstreamTriggers(pipeline.id),
        api.listPipelines(),
      ])
      setTriggers(tRes.triggers || [])
      setAllPipelines((pRes.pipelines || []).filter(p => p.status !== 'archived' && p.id !== pipeline.id))
    } catch (e) {
      showToast('error', 'Failed to load downstream triggers: ' + e.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [pipeline.id])

  const handleAdd = async () => {
    if (!form.downstream_pipeline_id) {
      showToast('error', 'Please select a pipeline')
      return
    }
    setSaving(true)
    try {
      await api.addPipelineDownstreamTrigger(pipeline.id, form)
      showToast('success', 'Downstream trigger added ✓')
      setForm({ downstream_pipeline_id: '', enabled: true, only_if_new_rows: true, delay_seconds: 0 })
      load()
    } catch (e) {
      showToast('error', e.message)
    } finally {
      setSaving(false)
    }
  }

  const handleToggle = async (t) => {
    setTogglingId(t.id)
    try {
      await api.updatePipelineDownstreamTrigger(pipeline.id, t.id, {
        enabled: !t.enabled,
        only_if_new_rows: t.only_if_new_rows,
        delay_seconds: t.delay_seconds,
      })
      load()
    } catch (e) {
      showToast('error', e.message)
    } finally {
      setTogglingId(null)
    }
  }

  const handleRemove = async (triggerId) => {
    setRemovingId(triggerId)
    try {
      await api.removePipelineDownstreamTrigger(pipeline.id, triggerId)
      showToast('success', 'Trigger removed')
      load()
    } catch (e) {
      showToast('error', e.message)
    } finally {
      setRemovingId(null)
    }
  }

  // iOS-style Toggle Switch
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

  // Pipelines not yet linked
  const linkedIds = new Set(triggers.map(t => t.downstream_pipeline_id))
  const availablePipelines = allPipelines.filter(p => !linkedIds.has(p.id))

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 10000, display: 'flex', alignItems: 'center', justifyContent: 'center', backdropFilter: 'blur(4px)' }} onClick={e => e.target === e.currentTarget && onClose()}>
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
                Pipeline Trigger Targets
              </div>
              <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>
                Pipeline: <span style={{ color: '#22d3ee', fontFamily: 'monospace' }}>{pipeline.name}</span>
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
            After <strong style={{ color: '#22d3ee' }}>{pipeline.name}</strong> finishes executing successfully,
            the pipelines below will automatically run. This enables creating long <strong style={{ color: '#a5b4fc' }}>event-driven</strong> data flows.
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
                <Loader size={20} className="spin" style={{ marginBottom: 8 }} /><br />Loading...
              </div>
            ) : triggers.length === 0 ? (
              <div style={{
                padding: '28px', textAlign: 'center',
                background: 'rgba(255,255,255,0.02)',
                border: '1px dashed rgba(255,255,255,0.08)',
                borderRadius: 12,
              }}>
                <GitBranch size={36} style={{ color: '#1e293b', marginBottom: 12 }} />
                <div style={{ fontSize: 14, color: '#475569', marginBottom: 6 }}>No trigger target pipelines configured</div>
                <div style={{ fontSize: 12, color: '#334155' }}>Add a pipeline below to auto-trigger it after this pipeline completes</div>
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
                      {/* Mini flow */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1 }}>
                        {/* Pipeline box */}
                        <div style={{
                          display: 'flex', alignItems: 'center', gap: 6,
                          padding: '5px 10px', borderRadius: 7,
                          background: 'rgba(99,102,241,0.12)',
                          border: '1px solid rgba(99,102,241,0.25)',
                          fontSize: 12, color: '#818cf8', fontWeight: 600,
                        }}>
                          <Zap size={12} />
                          {pipeline.name.slice(0, 20)}
                        </div>
                        {/* Arrow */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: 4, color: t.enabled ? '#22d3ee' : '#334155' }}>
                          <div style={{ height: 1, width: 24, background: 'currentColor', opacity: 0.6 }} />
                          <GitBranch size={13} style={{ opacity: t.enabled ? 1 : 0.3 }} />
                          <div style={{ height: 1, width: 24, background: 'currentColor', opacity: 0.6 }} />
                        </div>
                        {/* Downstream Pipeline box */}
                        <div style={{
                          display: 'flex', alignItems: 'center', gap: 6,
                          padding: '5px 10px', borderRadius: 7,
                          background: t.enabled ? 'rgba(34,211,238,0.1)' : 'rgba(255,255,255,0.04)',
                          border: `1px solid ${t.enabled ? 'rgba(34,211,238,0.3)' : 'rgba(255,255,255,0.08)'}`,
                          fontSize: 12, color: t.enabled ? '#22d3ee' : '#475569', fontWeight: 600,
                        }}>
                          <Zap size={12} />
                          {(t.downstream_pipeline_name || 'Pipeline').slice(0, 24)}
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
                          color: '#f87171', padding: '6px 8px', borderRadius: 8,
                          cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                          opacity: removingId === t.id ? 0.5 : 1,
                        }}
                      >
                        <X size={14} />
                      </button>
                    </div>

                    {/* Config detail row */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 11, color: '#94a3b8' }}>
                      <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        <div style={{ width: 6, height: 6, borderRadius: '50%', background: t.only_if_new_rows ? '#22c55e' : '#f59e0b' }} />
                        {t.only_if_new_rows ? 'Trigger ONLY IF new rows processed' : 'Trigger ALWAYS (Even if 0 rows)'}
                      </span>
                      <span>•</span>
                      <span>Delay: {t.delay_seconds}s</span>
                      {t.last_triggered_at && (
                        <>
                          <span>•</span>
                          <span style={{ color: '#64748b' }}>Last run: {new Date(t.last_triggered_at).toLocaleString()}</span>
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Add new section */}
          <div style={{ background: '#1e293b50', border: '1px solid #1e293b', borderRadius: 12, padding: 20 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#f1f5f9', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
              <Plus size={16} color="#3b82f6" /> Add New Target
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: '#94a3b8', marginBottom: 6, display: 'block' }}>Select Pipeline to Trigger *</label>
                <select
                  style={{
                    width: '100%', padding: '10px 12px', borderRadius: 8, fontSize: 13,
                    background: '#0f172a', border: '1px solid #334155', color: '#e2e8f0', outline: 'none'
                  }}
                  value={form.downstream_pipeline_id}
                  onChange={e => setForm({ ...form, downstream_pipeline_id: e.target.value })}
                >
                  <option value="">-- Choose Pipeline --</option>
                  {availablePipelines.map(p => (
                    <option key={p.id} value={p.id}>{p.name} {p.status !== 'active' ? `(${p.status})` : ''}</option>
                  ))}
                </select>
                {availablePipelines.length === 0 && <div style={{ fontSize: 11, color: '#64748b', marginTop: 6 }}>All available pipelines are already linked.</div>}
              </div>

              <div style={{ display: 'flex', gap: 16 }}>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: 12, fontWeight: 600, color: '#94a3b8', marginBottom: 6, display: 'block' }}>Trigger Condition</label>
                  <div style={{
                    display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px',
                    background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)', borderRadius: 8,
                    cursor: 'pointer'
                  }} onClick={() => setForm({ ...form, only_if_new_rows: !form.only_if_new_rows })}>
                    <input type="checkbox" checked={form.only_if_new_rows} readOnly style={{ cursor: 'pointer' }} />
                    <span style={{ fontSize: 12, color: form.only_if_new_rows ? '#e2e8f0' : '#94a3b8' }}>
                      Only trigger if new rows were inserted
                    </span>
                  </div>
                </div>

                <div style={{ width: 120 }}>
                  <label style={{ fontSize: 12, fontWeight: 600, color: '#94a3b8', marginBottom: 6, display: 'block' }}>Delay (seconds)</label>
                  <input
                    type="number" min="0"
                    style={{
                      width: '100%', padding: '10px 12px', borderRadius: 8, fontSize: 13,
                      background: '#0f172a', border: '1px solid #334155', color: '#e2e8f0', outline: 'none', boxSizing: 'border-box'
                    }}
                    value={form.delay_seconds}
                    onChange={e => setForm({ ...form, delay_seconds: parseInt(e.target.value) || 0 })}
                  />
                </div>
              </div>

              <button
                onClick={handleAdd}
                disabled={saving || !form.downstream_pipeline_id}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                  padding: '10px 16px', borderRadius: 8, fontSize: 13, fontWeight: 600,
                  background: 'linear-gradient(135deg, #0284c7, #2563eb)', color: '#fff',
                  border: 'none', cursor: (!form.downstream_pipeline_id || saving) ? 'not-allowed' : 'pointer',
                  opacity: (!form.downstream_pipeline_id || saving) ? 0.6 : 1,
                  marginTop: 4,
                }}
              >
                {saving ? <Loader size={16} className="spin" /> : <Plus size={16} />}
                Add Pipeline Trigger
              </button>
            </div>
          </div>

        </div>
      </div>
    </div>
  )
}

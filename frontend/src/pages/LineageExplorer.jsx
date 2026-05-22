import React, { useState, useCallback, useEffect, useMemo } from 'react'
import {
  ReactFlow, Background, Controls,
  useNodesState, useEdgesState, MarkerType,
  Handle, Position, ReactFlowProvider, useReactFlow
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { Search, Plug, Play, Database, Zap, AlertTriangle, X, ChevronDown, ExternalLink, Network, Globe, Check, Loader2, RefreshCw, Clock } from 'lucide-react'
import { lineageSearchNodes, lineageGetGraph, lineageGetAllGraph, lineageGetImpact } from '../api/client'
import { Link } from 'react-router-dom'
import dagre from 'dagre'

/* ── Node colors & shapes ─────────────────────────────────────────────────── */
const NODE_STYLES = {
  connector:  { bg: 'rgba(139,92,246,0.18)',  border: '#8b5cf6', icon: Plug,     color: '#a78bfa', label: 'Connector', shape: 'pill' },
  pipeline:   { bg: 'rgba(59,130,246,0.18)',   border: '#3b82f6', icon: Play,     color: '#60a5fa', label: 'Pipeline', shape: 'lg' },
  bronze:     { bg: 'rgba(245,158,11,0.18)',   border: '#f59e0b', icon: Database, color: '#fbbf24', label: 'Bronze', shape: 'rect' },
  silver:     { bg: 'rgba(148,163,184,0.18)',  border: '#94a3b8', icon: Database, color: '#cbd5e1', label: 'Silver', shape: 'rect' },
  gold:       { bg: 'rgba(251,191,36,0.18)',   border: '#eab308', icon: Database, color: '#fcd34d', label: 'Gold', shape: 'rect' },
  serving:    { bg: 'rgba(16,185,129,0.18)',   border: '#10b981', icon: Zap,      color: '#34d399', label: 'Serving', shape: 'rect' },
  table:      { bg: 'rgba(99,102,241,0.18)',   border: '#6366f1', icon: Database, color: '#818cf8', label: 'Table', shape: 'rect' },
}

function getStyle(node) {
  if (node.node_type === 'connector') return NODE_STYLES.connector
  if (node.node_type === 'pipeline') return NODE_STYLES.pipeline
  const layer = node.metadata?.layer
  if (layer && NODE_STYLES[layer]) return NODE_STYLES[layer]
  return NODE_STYLES.table
}

/* ── Custom Node Component ──────────────────────────────────────────────────── */
function LineageNode({ data }) {
  const s = data._style
  const Icon = s.icon
  const isCenter = data._isCenter

  let borderRadius = 8
  let width = 220
  if (s.shape === 'pill') { borderRadius = 999; width = 240 }
  if (s.shape === 'lg') { borderRadius = 12; width = 250 }

  const meta = data._raw?.metadata || data._raw?.metadata_json || {}
  const status = meta.status || meta.sync_status || 'never_run'
  const exists = meta.exists !== false
  
  let statusColor = '#94a3b8' // gray
  let isRunning = false
  let isFailed = false
  let isSuccess = false
  let isNeverRun = status === 'never_run' || status === 'draft'

  if (['error', 'failed', 'schema_drift'].includes(status)) {
    statusColor = '#ef4444' // red
    isFailed = true
  } else if (['running', 'syncing', 'pending'].includes(status)) {
    statusColor = '#eab308' // yellow
    isRunning = true
  } else if (['success', 'active'].includes(status)) {
    statusColor = '#10b981' // green
    isSuccess = true
  }

  // Format status text nicely for the tooltip
  const statusText = status.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())

  // Calculate Box Shadow for center node
  let boxShadow = isCenter ? `0 0 0 2px var(--bg-primary), 0 0 0 4px ${exists ? s.border : '#f87171'}, 0 0 24px ${exists ? s.border : '#f87171'}88` : 'none'

  // Determine Icon for Status Badge
  let StatusIcon = null;
  if (isFailed) StatusIcon = X;
  else if (isRunning) StatusIcon = Loader2;
  else if (isSuccess) StatusIcon = Check;

  return (
    <>
      <style>{`
        @keyframes spin-slow {
          100% { transform: rotate(360deg); }
        }
      `}</style>
      <div
        onClick={() => data.onSelect?.(data._raw)}
        onMouseEnter={() => data.onHover?.(data._raw.id)}
        onMouseLeave={() => data.onHover?.(null)}
        style={{
          background: exists ? s.bg : 'rgba(239,68,68,0.03)', 
          border: exists ? `1.5px solid ${s.border}` : '1.5px dashed #f8717188', 
          borderRadius,
          padding: s.shape === 'pill' ? '8px 14px' : '10px 14px', 
          width, cursor: 'pointer',
          backdropFilter: 'blur(8px)', transition: 'all .2s',
          boxShadow,
          transform: data._isHovered ? 'translateY(-2px)' : 'none',
          opacity: data._isDimmed ? 0.3 : (exists ? 1 : 0.7),
          position: 'relative'
        }}
      >
        {/* BIG STATUS BADGE */}
        {!isNeverRun && StatusIcon && (
          <div style={{
            position: 'absolute',
            top: -10,
            right: -10,
            width: 24,
            height: 24,
            borderRadius: '50%',
            background: statusColor,
            border: '2px solid var(--bg-primary)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#fff',
            boxShadow: `0 0 16px ${statusColor}cc`,
            zIndex: 15
          }} title={`Status: ${statusText}`}>
            <StatusIcon size={14} strokeWidth={3} style={{ animation: isRunning ? 'spin-slow 2s linear infinite' : 'none' }} />
          </div>
        )}

        {/* HANDLES: Bắt buộc để vẽ edges */}
        <Handle type="target" position={Position.Left} style={{ background: exists ? s.border : '#ef4444', border: '2px solid var(--bg-primary)', width: 10, height: 10, left: -5, zIndex: 10 }} />
        
        {isCenter && (
          <div style={{ position: 'absolute', bottom: -12, left: '50%', transform: 'translateX(-50%)', background: 'var(--accent-primary)', color: '#fff', fontSize: 9, fontWeight: 800, padding: '2px 8px', borderRadius: 12, border: '2px solid var(--bg-primary)', boxShadow: '0 2px 8px rgba(0,0,0,0.4)', zIndex: 10, pointerEvents: 'none', whiteSpace: 'nowrap' }}>
            🎯 SELECTED
          </div>
        )}

        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: s.shape === 'pill' ? 0 : 4 }}>
          {isNeverRun && <div style={{ width: 8, height: 8, borderRadius: '50%', background: exists ? statusColor : '#ef4444' }} title="Never Run" />}
          <Icon size={14} color={exists ? s.color : '#f87171'} />
          <span style={{ fontSize: 9, color: exists ? s.color : '#f87171', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.5px', flexShrink: 0 }}>{s.label}</span>
          {!exists && (
            <span style={{ fontSize: 7, color: '#f87171', fontWeight: 800, background: '#ef444415', padding: '1px 4px', borderRadius: 4, marginLeft: 'auto', border: '1px solid #ef444430' }}>
              NOT CREATED
            </span>
          )}
          {s.shape === 'pill' && <div style={{ fontSize: 13, fontWeight: isCenter ? 700 : 600, color: exists ? '#f1f5f9' : '#94a3b8', marginLeft: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{data.label}</div>}
        </div>
        {s.shape !== 'pill' && (
          <div style={{ fontSize: 13, fontWeight: isCenter ? 700 : 600, color: exists ? '#f1f5f9' : '#94a3b8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{data.label}</div>
        )}
        
        <Handle type="source" position={Position.Right} style={{ background: exists ? s.border : '#ef4444', border: '2px solid var(--bg-primary)', width: 10, height: 10, right: -5, zIndex: 10 }} />
      </div>
    </>
  )
}
const nodeTypes = { lineage: LineageNode }

/* ── Layout ─────────────────────────────────────────────────────────────────── */
const LAYER_ORDER = { connector: 0, bronze: 1, pipeline: 2, silver: 3, gold: 4, serving: 5, table: 3 }

function layoutGraph(apiNodes, apiEdges, centerId, hoveredId, onSelect, onHover) {
  const dagreGraph = new dagre.graphlib.Graph()
  dagreGraph.setDefaultEdgeLabel(() => ({}))
  dagreGraph.setGraph({ rankdir: 'LR', nodesep: 40, ranksep: 200 })

  const connectedNodeIds = new Set()
  if (hoveredId) {
    connectedNodeIds.add(hoveredId)
    apiEdges.forEach(e => {
      if (e.source_node_id === hoveredId) connectedNodeIds.add(e.target_node_id)
      if (e.target_node_id === hoveredId) connectedNodeIds.add(e.source_node_id)
    })
  }

  apiNodes.forEach(n => {
    const style = getStyle(n)
    const isPill = style.shape === 'pill'
    const isLg = style.shape === 'lg'
    const width = isLg ? 160 : (isPill ? 130 : 140)
    const height = isPill ? 40 : 60
    dagreGraph.setNode(n.id, { width, height })
  })

  apiEdges.forEach(e => {
    dagreGraph.setEdge(e.source_node_id, e.target_node_id)
  })

  dagre.layout(dagreGraph)

  const resultNodes = apiNodes.map(n => {
    const nodeWithPosition = dagreGraph.node(n.id)
    return {
      id: n.id,
      type: 'lineage',
      position: { x: nodeWithPosition.x - nodeWithPosition.width / 2, y: nodeWithPosition.y - nodeWithPosition.height / 2 },
      data: {
        label: n.name, _raw: n, _style: getStyle(n), _isCenter: n.id === centerId,
        _isHovered: hoveredId === n.id,
        _isDimmed: hoveredId && !connectedNodeIds.has(n.id),
        onSelect, onHover
      }
    }
  })

  // 3. Layout Edges
  const resultEdges = apiEdges.map(e => {
    const isConnectedToHovered = hoveredId && (e.source_node_id === hoveredId || e.target_node_id === hoveredId)
    const isDimmed = hoveredId && !isConnectedToHovered
    return {
      id: e.id,
      source: e.source_node_id,
      target: e.target_node_id,
      animated: true,
      markerEnd: {
        type: MarkerType.ArrowClosed,
        width: 15,
        height: 15,
        color: isConnectedToHovered ? '#818cf8' : '#475569',
      },
      style: { 
        stroke: isConnectedToHovered ? '#818cf8' : '#475569', 
        strokeWidth: isConnectedToHovered ? 2 : 1.5, 
        opacity: isDimmed ? 0.2 : 1,
        transition: 'all .2s'
      },
    }
  })

  return { nodes: resultNodes, edges: resultEdges }
}

/* ── Main Content Component ─────────────────────────────────────────────────── */
function LineageFlowContent() {
  const [sidebarNodes, setSidebarNodes] = useState([])
  const [searchQuery, setSearchQuery] = useState('')
  const [expandedGroups, setExpandedGroups] = useState({ connectors: false, pipelines: false, bronze: false, silver: false, gold: false, serving: false })

  const [nodes, setNodes, onNodesChange] = useNodesState([])
  const [edges, setEdges, onEdgesChange] = useEdgesState([])
  const [selected, setSelected] = useState(null)
  const [impact, setImpact] = useState(null)
  
  const [direction, setDirection] = useState('both')
  const [depth, setDepth] = useState(10)
  const [graphLoaded, setGraphLoaded] = useState(false)
  const [hoveredNodeId, setHoveredNodeId] = useState(null)

  const [rightPanelWidth, setRightPanelWidth] = useState(260)
  const [isResizingRight, setIsResizingRight] = useState(false)

  useEffect(() => {
    if (!isResizingRight) return
    const handleMouseMove = e => {
      const newWidth = Math.max(200, Math.min(600, window.innerWidth - e.clientX))
      setRightPanelWidth(newWidth)
    }
    const handleMouseUp = () => setIsResizingRight(false)
    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }
  }, [isResizingRight])

  const { fitView } = useReactFlow()
  const [currentGraphData, setCurrentGraphData] = useState({ nodes: [], edges: [], centerId: null })

  const [autoReloadInterval, setAutoReloadInterval] = useState(0) // 0: OFF, 5: 5s, 10: 10s, 30: 30s
  const [isRefreshing, setIsRefreshing] = useState(false)

  // 1. Load Graph (Must be defined before useEffect that depends on it)
  const loadGraph = useCallback(async (nodeId, dir, d, skipFit = false) => {
    try {
      let graph
      if (nodeId === 'all') {
        graph = await lineageGetAllGraph()
      } else {
        graph = await lineageGetGraph(nodeId, dir || direction, d || depth)
      }
      setCurrentGraphData({ nodes: graph.nodes, edges: graph.edges, centerId: graph.center_node_id })
      setGraphLoaded(true)
      if (!skipFit) {
        setTimeout(() => fitView({ padding: 0.4, duration: 600 }), 50)
      }
    } catch (e) { console.error('Graph load failed:', e) }
  }, [direction, depth, fitView])

  const refreshAll = useCallback(async (skipFit = true) => {
    const activeNodeId = selected ? selected.id : 'all'
    await loadGraph(activeNodeId, direction, depth, skipFit)
    try {
      const data = await lineageSearchNodes('', null, 1000)
      setSidebarNodes(data.nodes || [])
      if (selected) {
        const freshSelected = data.nodes?.find(n => n.id === selected.id)
        if (freshSelected) {
          setSelected(freshSelected)
        }
        const imp = await lineageGetImpact(selected.id)
        setImpact(imp)
      }
    } catch (e) { console.error('Refresh metadata failed:', e) }
  }, [selected, direction, depth, loadGraph])

  const handleManualRefresh = async () => {
    setIsRefreshing(true)
    await refreshAll(true)
    setIsRefreshing(false)
  }

  useEffect(() => {
    if (autoReloadInterval <= 0) return
    const timer = setInterval(async () => {
      setIsRefreshing(true)
      await refreshAll(true)
      setIsRefreshing(false)
    }, autoReloadInterval * 1000)
    return () => clearInterval(timer)
  }, [autoReloadInterval, refreshAll])

  // 2. Fetch catalog
  useEffect(() => {
    async function loadSidebar() {
      try {
        const data = await lineageSearchNodes('', null, 1000)
        setSidebarNodes(data.nodes || [])
        // Bình thường chỉ show block được chọn đầu tiên
        if (data.nodes && data.nodes.length > 0) {
          const first = data.nodes.find(n => n.node_type === 'table' && n.metadata?.layer === 'serving') || data.nodes[0]
          handleNodeSelect(first)
        }
      } catch (e) { console.error('Failed to load catalog', e) }
    }
    loadSidebar()
  }, [loadGraph])

  // 3. Filter & Group Sidebar
  const filteredNodes = useMemo(() => {
    if (!searchQuery) return sidebarNodes
    const q = searchQuery.toLowerCase()
    return sidebarNodes.filter(n => n.name.toLowerCase().includes(q) || n.node_key.toLowerCase().includes(q))
  }, [sidebarNodes, searchQuery])

  const groupedNodes = useMemo(() => ({
    connectors: filteredNodes.filter(n => n.node_type === 'connector'),
    pipelines: filteredNodes.filter(n => n.node_type === 'pipeline'),
    bronze: filteredNodes.filter(n => n.node_type === 'table' && n.metadata?.layer === 'bronze'),
    silver: filteredNodes.filter(n => n.node_type === 'table' && n.metadata?.layer === 'silver'),
    gold: filteredNodes.filter(n => n.node_type === 'table' && n.metadata?.layer === 'gold'),
    serving: filteredNodes.filter(n => n.node_type === 'table' && n.metadata?.layer === 'serving'),
  }), [filteredNodes])

  const toggleGroup = (g) => setExpandedGroups(prev => ({ ...prev, [g]: !prev[g] }))


  // React to Hover changes
  useEffect(() => {
    if (!currentGraphData.nodes || currentGraphData.nodes.length === 0) {
      setNodes([])
      setEdges([])
      return
    }
    const { nodes: fnodes, edges: fedges } = layoutGraph(
      currentGraphData.nodes, currentGraphData.edges, currentGraphData.centerId, 
      hoveredNodeId, handleNodeSelect, setHoveredNodeId
    )
    setNodes(fnodes)
    setEdges(fedges)
  }, [currentGraphData, hoveredNodeId])

  // React to Control changes
  useEffect(() => {
    if (selected) loadGraph(selected.id, direction, depth)
  }, [direction, depth])

  // Handle Select
  const handleNodeSelect = useCallback(async (node) => {
    setSelected(node)
    loadGraph(node.id)
    try {
      const imp = await lineageGetImpact(node.id)
      setImpact(imp)
    } catch { setImpact(null) }
  }, [loadGraph])

  // Render Sidebar Group
  const renderGroup = (id, title, icon, color) => {
    const items = groupedNodes[id]
    // if (items.length === 0) return null // Removed to always show the header
    return (
      <div style={{ marginBottom: 4 }}>
        <div onClick={() => toggleGroup(id)} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 12px', cursor: 'pointer', fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '.5px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {icon} {title} ({items.length})
          </div>
          <ChevronDown size={14} style={{ transform: expandedGroups[id] ? 'rotate(0deg)' : 'rotate(-90deg)', transition: 'transform .2s' }} />
        </div>
        {expandedGroups[id] && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2, padding: '0 8px 8px' }}>
            {items.map(n => {
              const s = getStyle(n)
              const Icon = s.icon
              const isSel = selected?.id === n.id
              return (
                <div key={n.id} onClick={() => handleNodeSelect(n)}
                  style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', borderRadius: 6, cursor: 'pointer', background: isSel ? 'var(--bg-active)' : 'transparent', color: isSel ? 'var(--text-primary)' : 'var(--text-muted)', transition: 'all .15s' }}
                  onMouseEnter={e => { if (!isSel) { e.currentTarget.style.background = 'var(--bg-hover)'; e.currentTarget.style.color = 'var(--text-primary)' } }}
                  onMouseLeave={e => { if (!isSel) { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--text-muted)' } }}
                >
                  <Icon size={12} color={s.color} style={{ opacity: isSel ? 1 : 0.7 }} />
                  <span style={{ fontSize: 12, fontWeight: isSel ? 600 : 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{n.name}</span>
                </div>
              )
            })}
          </div>
        )}
      </div>
    )
  }

  return (
    <div style={{ height: '100%', display: 'flex', background: 'var(--bg-primary)', overflow: 'hidden' }}>
      <style>{`
        @keyframes spin-slow {
          100% { transform: rotate(360deg); }
        }
      `}</style>
      
      {/* Left Sidebar: Explorer */}
      <div style={{ width: 260, display: 'flex', flexDirection: 'column', background: 'var(--bg-secondary)', borderRight: '1px solid var(--border-color)', flexShrink: 0 }}>
        {/* Header & Filter */}
        <div style={{ padding: '16px 12px 12px', borderBottom: '1px solid var(--border-color)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Network size={16} color="var(--accent-primary)" />
              <h1 style={{ fontSize: 14, fontWeight: 700, margin: 0 }}>Explorer</h1>
            </div>
            <button onClick={() => { setSelected(null); loadGraph('all') }} style={{ display: 'flex', alignItems: 'center', gap: 4, background: 'var(--bg-primary)', border: '1px solid var(--border-color)', color: 'var(--text-secondary)', padding: '4px 8px', borderRadius: 4, fontSize: 10, fontWeight: 600, cursor: 'pointer' }} onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-hover)'} onMouseLeave={e => e.currentTarget.style.background = 'var(--bg-primary)'}>
              <Globe size={10} /> View All
            </button>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px', background: 'var(--bg-primary)', border: '1px solid var(--border-color)', borderRadius: 6 }}>
            <Search size={12} color="var(--text-muted)" />
            <input
              value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
              placeholder="Filter catalog..."
              style={{ flex: 1, background: 'none', border: 'none', outline: 'none', color: 'var(--text-primary)', fontSize: 12 }}
            />
            {searchQuery && <X size={12} color="var(--text-muted)" style={{ cursor: 'pointer' }} onClick={() => setSearchQuery('')} />}
          </div>
        </div>

        {/* Catalog Tree */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '8px 0' }}>
          {renderGroup('connectors', 'Connectors', <Plug size={12} />)}
          {renderGroup('pipelines', 'Pipelines', <Play size={12} />)}
          {renderGroup('bronze', 'Bronze Layer', <Database size={12} />)}
          {renderGroup('silver', 'Silver Layer', <Database size={12} />)}
          {renderGroup('gold', 'Gold Layer', <Database size={12} />)}
          {renderGroup('serving', 'Serving Layer', <Zap size={12} />)}
          {Object.values(groupedNodes).flat().length === 0 && (
            <div style={{ padding: 16, textAlign: 'center', fontSize: 12, color: 'var(--text-muted)' }}>No matches found.</div>
          )}
        </div>
      </div>

      {/* Main Canvas Area */}
      <div style={{ flex: 1, position: 'relative', display: 'flex' }}>
        
        {!graphLoaded ? (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', gap: 16 }}>
            <Network size={48} style={{ opacity: .3 }} />
            <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--text-secondary)' }}>Data Lineage Graph</div>
            <div style={{ fontSize: 13 }}>Select an entity from the explorer to view its data flow.</div>
          </div>
        ) : (
          <ReactFlow
            nodes={nodes} edges={edges}
            onNodesChange={onNodesChange} onEdgesChange={onEdgesChange}
            nodeTypes={nodeTypes}
            proOptions={{ hideAttribution: true }}
            style={{ background: 'var(--bg-primary)' }}
            nodesDraggable={false}
          >
            <Background color="#94a3b8" gap={24} size={1} opacity={0.15} />
            <Controls style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: 6, boxShadow: 'var(--shadow-md)' }} showInteractive={false} />
            
            {/* Graph Toolbar Overlay */}
            <div style={{ position: 'absolute', top: 16, right: 16, zIndex: 5, display: 'flex', gap: 8, padding: '6px', background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: 8, boxShadow: 'var(--shadow-lg)' }}>
              <select value={direction} onChange={e => setDirection(e.target.value)}
                style={{ padding: '6px 10px', background: 'var(--bg-primary)', border: '1px solid var(--border-color)', borderRadius: 6, color: 'var(--text-primary)', fontSize: 12, cursor: 'pointer', outline: 'none' }}>
                <option value="upstream">← Trigger By (Sources)</option>
                <option value="downstream">→ Trigger (Impact)</option>
                <option value="both">↔ Both Directions</option>
              </select>
              <select value={depth} onChange={e => setDepth(+e.target.value)}
                style={{ padding: '6px 10px', background: 'var(--bg-primary)', border: '1px solid var(--border-color)', borderRadius: 6, color: 'var(--text-primary)', fontSize: 12, cursor: 'pointer', outline: 'none' }}>
                {[1,2,3,4,5,6,7,8,9,10].map(d => <option key={d} value={d}>{d} Hops</option>)}
              </select>
              
              {/* Manual Refresh */}
              <button 
                onClick={handleManualRefresh}
                title="Refresh lineage graph"
                style={{ 
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  padding: '6px 10px', background: 'var(--bg-primary)', border: '1px solid var(--border-color)', 
                  borderRadius: 6, color: 'var(--text-primary)', cursor: 'pointer', outline: 'none',
                  transition: 'all 0.2s'
                }}
                onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-hover)'}
                onMouseLeave={e => e.currentTarget.style.background = 'var(--bg-primary)'}
              >
                <RefreshCw size={14} style={{ animation: isRefreshing ? 'spin-slow 1s linear infinite' : 'none' }} />
              </button>

              {/* Auto Reload */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '0 4px 0 8px', background: 'var(--bg-primary)', border: '1px solid var(--border-color)', borderRadius: 6 }}>
                <Clock size={12} color="var(--text-muted)" />
                <select 
                  value={autoReloadInterval} 
                  onChange={e => setAutoReloadInterval(+e.target.value)}
                  style={{ 
                    background: 'none', border: 'none', color: 'var(--text-primary)', 
                    fontSize: 12, cursor: 'pointer', outline: 'none', padding: '6px 4px'
                  }}
                >
                  <option value={0}>Auto: OFF</option>
                  <option value={5}>Auto: 5s</option>
                  <option value={10}>Auto: 10s</option>
                  <option value={30}>Auto: 30s</option>
                </select>
              </div>
            </div>
          </ReactFlow>
        )}

        {/* Right Impact Panel */}
        {selected && (
          <div style={{ position: 'relative', width: rightPanelWidth, borderLeft: '1px solid var(--border-color)', background: 'var(--bg-secondary)', display: 'flex', flexDirection: 'column', flexShrink: 0, boxShadow: '-4px 0 16px rgba(0,0,0,0.2)' }}>
            
            {/* Resizer Handle */}
            <div 
              onMouseDown={() => setIsResizingRight(true)}
              style={{ position: 'absolute', top: 0, left: -4, width: 8, height: '100%', cursor: 'col-resize', zIndex: 100 }}
            />

            {/* Header */}
            <div style={{ padding: '16px', borderBottom: '1px solid var(--border-color)' }}>
              {(() => {
                const s = getStyle(selected)
                const Icon = s.icon
                const meta = selected.metadata || selected.metadata_json || {}
                const connectorId = meta.connector_id || selected.id
                const pipelineId = meta.pipeline_id || selected.id
                return (
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                      <div style={{ width: 32, height: 32, borderRadius: 8, background: s.bg, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <Icon size={16} color={s.color} />
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 14, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{selected.name}</div>
                        <span style={{ fontSize: 9, padding: '2px 6px', borderRadius: 4, background: s.bg, color: s.color, fontWeight: 700, textTransform: 'uppercase' }}>{s.label}</span>
                      </div>
                    </div>
                    {s.label === 'Connector' && (
                      <Link to={`/connectors?highlight=${connectorId}&open=history`} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '6px', background: 'var(--bg-primary)', border: '1px solid var(--border-color)', borderRadius: 6, fontSize: 11, fontWeight: 600, color: 'var(--text-primary)', textDecoration: 'none' }}>
                        Manage Connectors <ExternalLink size={12} />
                      </Link>
                    )}
                    {s.label === 'Pipeline' && (
                      <Link to={`/pipelines/${pipelineId}?tab=history`} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '6px', background: 'var(--bg-primary)', border: '1px solid var(--border-color)', borderRadius: 6, fontSize: 11, fontWeight: 600, color: 'var(--text-primary)', textDecoration: 'none' }}>
                        Open in Studio <ExternalLink size={12} />
                      </Link>
                    )}
                  {['Bronze', 'Silver', 'Gold'].includes(s.label) && (
                    <Link to={`/models?schema=${s.label.toLowerCase()}&table=${selected.name}`} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '6px', background: 'var(--bg-primary)', border: '1px solid var(--border-color)', borderRadius: 6, fontSize: 11, fontWeight: 600, color: 'var(--text-primary)', textDecoration: 'none' }}>
                      View in Data Models <ExternalLink size={12} />
                    </Link>
                  )}
                  {s.label === 'Serving' && (
                    <Link to={`/serving`} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '6px', background: 'var(--bg-primary)', border: '1px solid var(--border-color)', borderRadius: 6, fontSize: 11, fontWeight: 600, color: 'var(--text-primary)', textDecoration: 'none' }}>
                      Manage Serving <ExternalLink size={12} />
                    </Link>
                  )}
                </div>
              )})()}
            </div>

            {/* Properties */}
            <div style={{ padding: 16, borderBottom: '1px solid var(--border-color)' }}>
              <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.8px', color: 'var(--text-muted)', marginBottom: 12 }}>
                Properties
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16 }}>
                  <span style={{ color: 'var(--text-muted)' }}>Name:</span>
                  <span style={{ color: 'var(--text-primary)', fontWeight: 500, textAlign: 'right', wordBreak: 'break-word', flex: 1 }}>{selected.name}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: 'var(--text-muted)' }}>Type:</span>
                  <span style={{ color: 'var(--text-primary)', fontWeight: 500, textTransform: 'capitalize' }}>{selected.node_type}</span>
                </div>
                
                {Object.entries(selected.metadata_json || selected.metadata || {}).map(([key, val]) => {
                  if (typeof val === 'object' || val == null) return null; // Skip complex objects or nulls
                  
                  // Format the value nicely, especially for dates
                  let displayVal = String(val)
                  if (key.includes('at') && typeof val === 'string' && val.includes('T')) {
                    displayVal = new Date(val).toLocaleString()
                  }
                  
                  // Highlight status
                  let valColor = 'var(--text-primary)'
                  let valWeight = 500
                  if (key === 'status') {
                    valWeight = 700
                    if (['error', 'failed', 'schema_drift'].includes(val)) valColor = '#ef4444'
                    else if (['running', 'syncing', 'pending'].includes(val)) valColor = '#eab308'
                    else if (['success', 'active'].includes(val)) valColor = '#10b981'
                  }

                  return (
                    <div key={key} style={{ display: 'flex', justifyContent: 'space-between', gap: 16 }}>
                      <span style={{ color: 'var(--text-muted)', textTransform: 'capitalize', flexShrink: 0 }}>{key.replace(/_/g, ' ')}:</span>
                      <span style={{ color: valColor, fontWeight: valWeight, textAlign: 'right', wordBreak: 'break-word', flex: 1 }}>
                        {displayVal}
                      </span>
                    </div>
                  )
                })}
              </div>
            </div>

            {/* Impact Details */}
            {impact && (
              <div style={{ padding: 16, flex: 1, overflowY: 'auto' }}>
                {impact.upstream?.length > 0 && (
                  <div style={{ marginBottom: 24 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.8px', color: 'var(--text-muted)', marginBottom: 12 }}>
                      <Zap size={14} color="#3b82f6" /> Trigger By
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {impact.upstream.map(item => {
                        const s = getStyle(item)
                        const Icon = s.icon
                        return (
                          <div key={item.id} onClick={() => handleNodeSelect(item)} style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', padding: '4px', borderRadius: 4 }} onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-hover)'} onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                            <Icon size={12} color={s.color} />
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.name}</div>
                              <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{s.label}</div>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}
                
                {impact.downstream?.length > 0 && (
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.8px', color: 'var(--text-muted)', marginBottom: 12 }}>
                      <AlertTriangle size={14} color="#fbbf24" /> Trigger Target
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {impact.downstream.map(item => {
                        const s = getStyle(item)
                        const Icon = s.icon
                        return (
                          <div key={item.id} onClick={() => handleNodeSelect(item)} style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', padding: '4px', borderRadius: 4 }} onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-hover)'} onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                            <Icon size={12} color={s.color} />
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.name}</div>
                              <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{s.label}</div>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}

                {(!impact.upstream?.length && !impact.downstream?.length) && (
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>No trigger target or trigger by dependencies.</div>
                )}
              </div>
            )}
            
            {/* Raw Metadata (collapsed at bottom) */}
            <div style={{ padding: 16, borderTop: '1px solid var(--border-color)', fontSize: 10, color: 'var(--text-muted)', wordBreak: 'break-all', background: 'var(--bg-primary)' }}>
              <div><b>ID:</b> {selected.id}</div>
              <div style={{ marginTop: 4 }}><b>Key:</b> {selected.node_key}</div>
            </div>

          </div>
        )}
      </div>
    </div>
  )
}

export default function LineageExplorer() {
  return (
    <ReactFlowProvider>
      <LineageFlowContent />
    </ReactFlowProvider>
  )
}

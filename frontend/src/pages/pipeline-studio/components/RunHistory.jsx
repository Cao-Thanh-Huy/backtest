/**
 * RunHistory — Pipeline run history từ Dagster (single source of truth)
 * - Auto-poll 5s khi có active runs
 * - triggered_by: manual | schedule (bao gồm cả sensor)
 * - Error log: lazy-fetch từ Dagster khi click expand
 */
import React, { useEffect, useState, useRef, useCallback } from 'react'
import {
  RefreshCw, ExternalLink, Clock, Zap, AlertCircle,
  CheckCircle, GitBranch, Activity, ChevronDown, ChevronUp,
  Terminal, X, Loader
} from 'lucide-react'
import { Link } from 'react-router-dom'
import * as api from '../../../api/client'

const DAGSTER_UI = 'http://localhost:3000'

const STATUS_STYLE = {
  success:   { color: '#22c55e', bg: 'rgba(34,197,94,0.12)',   border: 'rgba(34,197,94,0.3)',   dot: '#22c55e',  glow: '0 0 8px rgba(34,197,94,0.4)'  },
  failed:    { color: '#ef4444', bg: 'rgba(239,68,68,0.12)',   border: 'rgba(239,68,68,0.3)',   dot: '#ef4444',  glow: 'none' },
  failure:   { color: '#ef4444', bg: 'rgba(239,68,68,0.12)',   border: 'rgba(239,68,68,0.3)',   dot: '#ef4444',  glow: 'none' },
  running:   { color: '#f59e0b', bg: 'rgba(245,158,11,0.12)',  border: 'rgba(245,158,11,0.3)',  dot: '#f59e0b',  glow: '0 0 8px rgba(245,158,11,0.4)'  },
  started:   { color: '#3b82f6', bg: 'rgba(59,130,246,0.12)', border: 'rgba(59,130,246,0.3)',  dot: '#3b82f6',  glow: '0 0 8px rgba(59,130,246,0.4)'  },
  starting:  { color: '#8b5cf6', bg: 'rgba(139,92,246,0.12)', border: 'rgba(139,92,246,0.3)',  dot: '#8b5cf6',  glow: '0 0 8px rgba(139,92,246,0.4)'  },
  queued:    { color: '#a78bfa', bg: 'rgba(167,139,250,0.12)', border: 'rgba(167,139,250,0.3)', dot: '#a78bfa',  glow: 'none' },
  pending:   { color: '#94a3b8', bg: 'rgba(148,163,184,0.1)', border: 'rgba(148,163,184,0.2)', dot: '#94a3b8',  glow: 'none' },
  cancelled: { color: '#f97316', bg: 'rgba(249,115,22,0.12)',  border: 'rgba(249,115,22,0.3)',  dot: '#f97316',  glow: 'none' },
  canceled:  { color: '#f97316', bg: 'rgba(249,115,22,0.12)',  border: 'rgba(249,115,22,0.3)',  dot: '#f97316',  glow: 'none' },
  unknown:   { color: '#64748b', bg: 'rgba(100,116,139,0.1)', border: 'rgba(100,116,139,0.2)', dot: '#64748b',  glow: 'none' },
}

const ACTIVE_STATUSES = new Set(['running', 'started', 'starting', 'queued', 'pending'])
const FAILED_STATUSES = new Set(['failed', 'failure'])

function StatusBadge({ status }) {
  const s = STATUS_STYLE[status?.toLowerCase()] || STATUS_STYLE.unknown
  const isActive = ACTIVE_STATUSES.has(status?.toLowerCase())
  return (
    <span style={{
      fontSize: 10, fontWeight: 700, padding: '3px 9px', borderRadius: 20,
      color: s.color, background: s.bg, border: `1px solid ${s.border}`,
      textTransform: 'uppercase', letterSpacing: 0.5,
      display: 'inline-flex', alignItems: 'center', gap: 5,
    }}>
      <span style={{
        width: 6, height: 6, borderRadius: '50%', background: s.dot,
        boxShadow: isActive ? s.glow : 'none',
        animation: isActive ? 'pulse 1.5s ease-in-out infinite' : 'none',
      }} />
      {status?.toUpperCase() || 'UNKNOWN'}
    </span>
  )
}

// Unified trigger badge — sensor IS schedule for our use-case
function TriggerBadge({ triggeredBy, scheduleName, triggerOrigin }) {
  const isSchedule = triggeredBy === 'schedule' || triggeredBy === 'sensor'
  if (isSchedule) {
    return (
      <span
        title={scheduleName ? `Schedule: ${scheduleName}` : 'Triggered by schedule'}
        style={{
          color: '#c084fc', display: 'inline-flex', alignItems: 'center', gap: 4,
          fontSize: 12, fontWeight: 600,
          background: 'rgba(192,132,252,0.1)', padding: '3px 9px',
          borderRadius: 4, border: '1px solid rgba(192,132,252,0.25)',
          textTransform: 'uppercase', cursor: 'help',
        }}
      >
        <Clock size={11} /> Schedule
      </span>
    )
  }
  const isTriggerBy = triggeredBy === 'upstream_connector'
  if (isTriggerBy) {
    return (
      <span
        title="Triggered by connector sync"
        style={{
          color: '#3b82f6', display: 'inline-flex', alignItems: 'center', gap: 4,
          fontSize: 12, fontWeight: 600,
          background: 'rgba(59,130,246,0.1)', padding: '3px 9px',
          borderRadius: 4, border: '1px solid rgba(59,130,246,0.25)',
          textTransform: 'uppercase', cursor: 'help',
        }}
      >
        <Zap size={11} /> Trigger By
      </span>
    )
  }
  return (
    <span style={{
      color: '#94a3b8', display: 'inline-flex', alignItems: 'center', gap: 4,
      fontSize: 12, fontWeight: 600,
      background: 'rgba(255,255,255,0.05)', padding: '3px 9px',
      borderRadius: 4, border: '1px solid rgba(255,255,255,0.08)',
      textTransform: 'uppercase',
    }}>
      Manual
    </span>
  )
}

function formatDuration(run) {
  if (!run.started_at) return '—'
  const startMs = typeof run.started_at === 'number' ? run.started_at : new Date(run.started_at).getTime()
  const endMs   = run.ended_at
    ? (typeof run.ended_at === 'number' ? run.ended_at : new Date(run.ended_at).getTime())
    : Date.now()
  const diff = (endMs - startMs) / 1000
  if (diff < 60) return `${diff.toFixed(1)}s`
  if (diff < 3600) return `${(diff / 60).toFixed(1)}m`
  return `${(diff / 3600).toFixed(1)}h`
}

function formatTime(ms) {
  if (!ms) return '—'
  return new Date(ms).toLocaleString('en-US', {
    month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  })
}

function RowCell({ children, style = {} }) {
  return (
    <td style={{
      padding: '12px 16px', fontSize: 13,
      borderBottom: '1px solid rgba(255,255,255,0.04)',
      verticalAlign: 'middle', ...style,
    }}>
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', width: '100%', gap: 6 }}>
        {children}
      </div>
    </td>
  )
}

// ── Error log row (lazy-fetch) ────────────────────────────────────────────────
function ErrorLogRow({ run, colSpan }) {
  const [log, setLog]         = useState(null)
  const [loading, setLoading] = useState(false)
  const runId = run.dagster_run_id || run.id

  useEffect(() => {
    let cancelled = false
    async function fetchLog() {
      setLoading(true)
      try {
        const data = await api.getDagsterRunErrorLog(runId)
        if (!cancelled) setLog(data.error_message || run.error_message || 'No detailed error available.')
      } catch {
        if (!cancelled) setLog(run.error_message || 'Could not fetch error log from Dagster.')
      }
      if (!cancelled) setLoading(false)
    }
    fetchLog()
    return () => { cancelled = true }
  }, [runId])

  return (
    <tr>
      <td colSpan={colSpan} style={{ padding: '0 16px 12px 16px', borderBottom: '1px solid rgba(239,68,68,0.15)' }}>
        <div style={{
          background: 'rgba(239,68,68,0.07)', border: '1px solid rgba(239,68,68,0.2)',
          borderRadius: 8, padding: '10px 14px', fontSize: 12,
          color: '#fca5a5', fontFamily: 'JetBrains Mono, monospace',
          maxHeight: 180, overflowY: 'auto',
          display: 'flex', alignItems: 'flex-start', gap: 8,
        }}>
          {loading
            ? <><RefreshCw size={12} className="spin" style={{ marginTop: 2, flexShrink: 0 }} /> Loading error log from Dagster…</>
            : <><AlertCircle size={12} style={{ marginTop: 2, flexShrink: 0, color: '#ef4444' }} /> {log}</>
          }
        </div>
      </td>
    </tr>
  )
}

export default function RunHistory({ pipelineId, refreshTrigger }) {
  const [runs, setRuns]             = useState([])
  const [loading, setLoading]       = useState(false)
  const [autoRefresh, setAutoRefresh] = useState(true)
  const [error, setError]           = useState(null)
  const [expanded, setExpanded]     = useState(new Set()) // expanded error rows
  const [viewSqlRun, setViewSqlRun] = useState(null) // Run selected for viewing SQL
  const intervalRef                 = useRef(null)
  const [highlightRunId, setHighlightRunId] = useState(null)

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const hl = params.get('highlight')
    if (hl) {
      setHighlightRunId(hl)
    }
  }, [])

  useEffect(() => {
    if (highlightRunId && runs.length > 0) {
      const match = runs.find(r => {
        const rId = r.dagster_run_id || r.id
        return rId === highlightRunId || rId?.startsWith(highlightRunId)
      })
      if (match) {
        window.history.replaceState({}, '', window.location.pathname + '?tab=history')
      }
    }
  }, [runs, highlightRunId])

  const loadRuns = useCallback(async (silent = false) => {
    if (!pipelineId) return
    if (!silent) setLoading(true)
    setError(null)
    try {
      const data = await api.getPipelineRunsFromDagster(pipelineId, 30)
      setRuns(data.runs || [])
    } catch (e) {
      console.error('[RunHistory] Failed to fetch from Dagster:', e)
      try {
        const fallback = await api.getPipelineRuns(pipelineId)
        setRuns(fallback.runs || [])
        setError('Dagster unavailable — showing cached data')
      } catch {
        setError('Cannot load run history')
      }
    } finally {
      if (!silent) setLoading(false)
    }
  }, [pipelineId])

  useEffect(() => { loadRuns() }, [loadRuns])

  useEffect(() => {
    if (refreshTrigger) loadRuns(true)
  }, [refreshTrigger, loadRuns])

  const hasActive = runs.some(r => ACTIVE_STATUSES.has((r.status || '').toLowerCase()))
  useEffect(() => {
    clearInterval(intervalRef.current)
    if (autoRefresh) {
      intervalRef.current = setInterval(() => loadRuns(true), 5000)
    }
    return () => clearInterval(intervalRef.current)
  }, [autoRefresh, loadRuns])


  function toggleExpand(runId) {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(runId)) next.delete(runId); else next.add(runId)
      return next
    })
  }

  if (!pipelineId) {
    return <div style={{ padding: 40, color: '#334155', fontSize: 14, textAlign: 'center' }}>Select a pipeline to see run history.</div>
  }

  const COLS = [
    'Dagster Run ID',
    'Status',
    'Version',
    'Mode',
    'Trigger By',
    'Duration',
    'Branch',
    'Start Snapshot ID',
    'End Snapshot ID',
    'Start Time',
    'Actions'
  ]

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', overflowY: 'auto', background: '#080c18' }}>

      {/* ── Header ── */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '14px 20px', borderBottom: '1px solid rgba(255,255,255,0.06)',
        background: '#0d1117', flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Activity size={14} style={{ color: '#6366f1' }} />
          <span style={{ fontSize: 13, fontWeight: 600, color: '#e2e8f0' }}>Run History</span>
          <span style={{
            fontSize: 10, padding: '2px 8px', borderRadius: 20,
            background: 'rgba(6,182,212,0.12)', color: '#22d3ee',
            border: '1px solid rgba(6,182,212,0.25)', fontWeight: 600,
          }}>📡 Dagster Live</span>
          {runs.length > 0 && (
            <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 10, background: 'rgba(99,102,241,0.15)', color: '#818cf8', fontWeight: 600 }}>
              {runs.length} runs
            </span>
          )}
          {hasActive && (
            <span style={{
              fontSize: 10, padding: '2px 8px', borderRadius: 10,
              background: 'rgba(245,158,11,0.15)', color: '#fbbf24',
              border: '1px solid rgba(245,158,11,0.25)', fontWeight: 600,
              display: 'inline-flex', alignItems: 'center', gap: 4,
            }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#f59e0b', animation: 'pulse 1.5s ease-in-out infinite' }} />
              Live polling
            </span>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {/* Auto-refresh toggle */}
          <div
            onClick={() => setAutoRefresh(v => !v)}
            title={autoRefresh ? 'Disable auto-refresh' : 'Enable auto-refresh'}
            style={{ width: 36, height: 20, borderRadius: 20, background: autoRefresh ? '#10b981' : '#334155', position: 'relative', cursor: 'pointer', transition: 'background 0.3s' }}
          >
            <div style={{ width: 14, height: 14, borderRadius: '50%', background: '#fff', position: 'absolute', top: 3, left: autoRefresh ? 19 : 3, transition: 'left 0.3s', boxShadow: '0 2px 4px rgba(0,0,0,0.2)' }} />
          </div>
          <span style={{ fontSize: 11, color: autoRefresh ? '#10b981' : '#64748b' }}>Auto</span>
          <button className="btn btn-secondary btn-sm" onClick={() => loadRuns()} disabled={loading} style={{ gap: 6 }}>
            <RefreshCw size={12} className={loading ? 'spin' : ''} /> Refresh
          </button>
        </div>
      </div>

      {/* ── Error banner ── */}
      {error && (
        <div style={{ padding: '8px 20px', background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.2)', borderLeft: '3px solid #f59e0b', fontSize: 12, color: '#fbbf24', display: 'flex', alignItems: 'center', gap: 8 }}>
          <AlertCircle size={13} /> {error}
        </div>
      )}

      {/* ── Empty ── */}
      {runs.length === 0 && !loading && (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12 }}>
          <Zap size={40} style={{ color: '#1e293b' }} />
          <div style={{ color: '#334155', fontSize: 14, textAlign: 'center' }}>
            No runs yet.<br />
            <span style={{ fontSize: 12, color: '#1e293b' }}>Click <strong style={{ color: '#6366f1' }}>Run</strong> to execute this pipeline.</span>
          </div>
        </div>
      )}

      {/* ── Loading ── */}
      {loading && (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, color: '#64748b', fontSize: 13 }}>
          <RefreshCw size={16} className="spin" style={{ color: '#6366f1' }} />
          Loading from Dagster...
        </div>
      )}

      {/* ── Table ── */}
      {runs.length > 0 && !loading && (
        <div style={{ overflow: 'auto', flex: 1 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'center', fontSize: 13 }}>
            <thead style={{ position: 'sticky', top: 0, zIndex: 5 }}>
              <tr style={{ background: '#0a0f1e', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                {COLS.map(h => (
                  <th key={h} style={{ padding: '11px 16px', fontSize: 10, textTransform: 'uppercase', letterSpacing: 1, color: '#334155', fontWeight: 700 }}>
                    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', width: '100%' }}>
                      {h}
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {runs.map(run => {
                const statusKey  = (run.status || '').toLowerCase()
                const isActive   = ACTIVE_STATUSES.has(statusKey)
                const isFailed   = FAILED_STATUSES.has(statusKey)
                const runId      = run.dagster_run_id || run.id
                const isExpanded = expanded.has(runId)
                const isHighlighted = highlightRunId && (runId === highlightRunId || runId?.startsWith(highlightRunId))

                return (
                  <React.Fragment key={runId}>
                    <tr
                      style={{
                        background: isHighlighted ? 'rgba(251,191,36,0.08)' : (isActive ? 'rgba(245,158,11,0.04)' : 'transparent'),
                        boxShadow: isHighlighted ? 'inset 0 0 0 1px rgba(251,191,36,0.35)' : 'none',
                        transition: 'background 0.2s',
                      }}
                      onMouseEnter={e => { if (!isActive && !isHighlighted) e.currentTarget.style.background = 'rgba(255,255,255,0.02)' }}
                      onMouseLeave={e => { if (!isActive && !isHighlighted) e.currentTarget.style.background = 'transparent' }}
                    >
                      {/* Dagster Run ID */}
                      <RowCell>
                        <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: '#6366f1', background: 'rgba(99,102,241,0.1)', padding: '2px 8px', borderRadius: 5 }}>
                          {(runId || '').slice(0, 8)}
                        </span>
                      </RowCell>

                      {/* Status */}
                      <RowCell><StatusBadge status={run.status} /></RowCell>

                      {/* Version */}
                      <RowCell style={{ color: '#94a3b8', fontWeight: 500 }}>
                        {run.version ? `v${run.version}` : '—'}
                      </RowCell>

                      {/* Mode */}
                      <RowCell>
                        {run.run_mode === 'full_refresh' ? (
                          <span style={{
                            color: '#10b981', display: 'inline-flex', alignItems: 'center', gap: 4,
                            fontSize: 11, fontWeight: 700,
                            background: 'rgba(16,185,129,0.1)', padding: '3px 9px',
                            borderRadius: 20, border: '1px solid rgba(16,185,129,0.25)',
                            textTransform: 'uppercase',
                          }}>
                            Full Load
                          </span>
                        ) : run.run_mode === 'backfill' ? (
                          <span style={{
                            color: '#f59e0b', display: 'inline-flex', alignItems: 'center', gap: 4,
                            fontSize: 11, fontWeight: 700,
                            background: 'rgba(245,158,11,0.1)', padding: '3px 9px',
                            borderRadius: 20, border: '1px solid rgba(245,158,11,0.25)',
                            textTransform: 'uppercase',
                          }}>
                            Backfill
                          </span>
                        ) : (
                          <span style={{
                            color: '#3b82f6', display: 'inline-flex', alignItems: 'center', gap: 4,
                            fontSize: 11, fontWeight: 700,
                            background: 'rgba(59,130,246,0.1)', padding: '3px 9px',
                            borderRadius: 20, border: '1px solid rgba(59,130,246,0.25)',
                            textTransform: 'uppercase',
                          }}>
                            Incremental CDC
                          </span>
                        )}
                      </RowCell>

                      {/* Trigger By */}
                      <RowCell>
                        {run.trigger_origin ? (() => {
                          const decodedOrigin = decodeURIComponent(run.trigger_origin)
                          const parts = decodedOrigin.split('|')
                          if (parts[0] === 'pipeline') {
                            const pipelineId = parts[1] || ''
                            const pipelineName = parts[2] || 'Pipeline'
                            const pipelineRunId = parts[3] || ''
                            const href = pipelineId
                              ? `/pipelines/${pipelineId}?tab=history&highlight=${pipelineRunId}`
                              : '/pipelines'
                            return (
                              <Link
                                to={href}
                                title={`← Go to Upstream Pipeline: ${pipelineName}${pipelineRunId ? '\nRun ID: ' + pipelineRunId.slice(0, 8) : ''}`}
                                style={{
                                  display: 'inline-flex', alignItems: 'center', gap: 4,
                                  fontSize: 11, padding: '3px 9px', borderRadius: 4,
                                  background: 'rgba(99,102,241,0.1)', color: '#818cf8',
                                  border: '1px solid rgba(99,102,241,0.3)',
                                  textDecoration: 'none', fontWeight: 700, transition: 'all 0.15s', whiteSpace: 'nowrap'
                                }}
                                onMouseEnter={e => { e.currentTarget.style.background = 'rgba(99,102,241,0.2)'; e.currentTarget.style.boxShadow = '0 0 8px rgba(99,102,241,0.3)' }}
                                onMouseLeave={e => { e.currentTarget.style.background = 'rgba(99,102,241,0.1)'; e.currentTarget.style.boxShadow = 'none' }}
                              >
                                <Zap size={11} /> PIPELINE
                              </Link>
                            )
                          }
                          const connectorId = parts[0] || ''
                          const connectorName = parts[1] || 'Connector'
                          const connectorRunId = parts[2] || ''
                          const href = connectorId
                            ? `/connectors?highlight=${connectorId}&run=${connectorRunId}`
                            : '/connectors'
                          return (
                            <Link
                              to={href}
                              title={`← Go to Connector: ${connectorName}${connectorRunId ? '\nRun ID: ' + connectorRunId.slice(0, 8) : ''}`}
                              style={{
                                display: 'inline-flex', alignItems: 'center', gap: 4,
                                fontSize: 11, padding: '3px 9px', borderRadius: 4,
                                background: 'rgba(251,191,36,0.1)', color: '#fbbf24',
                                border: '1px solid rgba(251,191,36,0.3)',
                                textDecoration: 'none', fontWeight: 700, transition: 'all 0.15s', whiteSpace: 'nowrap'
                              }}
                              onMouseEnter={e => { e.currentTarget.style.background = 'rgba(251,191,36,0.2)'; e.currentTarget.style.boxShadow = '0 0 8px rgba(251,191,36,0.3)' }}
                              onMouseLeave={e => { e.currentTarget.style.background = 'rgba(251,191,36,0.1)'; e.currentTarget.style.boxShadow = 'none' }}
                            >
                              <Zap size={11} /> CONNECTOR
                            </Link>
                          )
                        })() : (
                          <TriggerBadge triggeredBy={run.triggered_by} scheduleName={run.schedule_name} triggerOrigin={run.trigger_origin} />
                        )}
                      </RowCell>

                      {/* Duration */}
                      <RowCell>
                        <span style={{
                          fontSize: 12, fontWeight: 600,
                          color: run.status === 'success' ? '#22c55e'
                            : isFailed ? '#ef4444'
                            : isActive ? '#f59e0b' : '#94a3b8',
                        }}>
                          {formatDuration(run)}
                          {isActive && <span style={{ marginLeft: 4, animation: 'pulse 1.5s ease-in-out infinite', display: 'inline-block' }}>▸</span>}
                        </span>
                      </RowCell>

                      {/* Branch */}
                      <RowCell>
                        {run.branch_name ? (
                          <span style={{ fontSize: 11, color: '#818cf8', fontFamily: 'JetBrains Mono, monospace', display: 'inline-flex', alignItems: 'center', gap: 4, background: 'rgba(99,102,241,0.08)', padding: '2px 8px', borderRadius: 5 }}>
                            <GitBranch size={10} />
                            {run.branch_name.length > 20 ? run.branch_name.slice(0, 20) + '…' : run.branch_name}
                          </span>
                        ) : (
                          <span style={{ color: '#1e293b', fontSize: 11 }}>—</span>
                        )}
                      </RowCell>

                      {/* Start Snapshot ID */}
                      <RowCell style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: '#94a3b8' }}>
                        {run.start_snapshot_id ? (
                          <span style={{ background: 'rgba(255,255,255,0.05)', padding: '2px 6px', borderRadius: 4 }}>
                            {run.start_snapshot_id}
                          </span>
                        ) : '—'}
                      </RowCell>

                      {/* End Snapshot ID */}
                      <RowCell style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: '#94a3b8' }}>
                        {run.end_snapshot_id ? (
                          <span style={{ background: 'rgba(255,255,255,0.05)', padding: '2px 6px', borderRadius: 4 }}>
                            {run.end_snapshot_id}
                          </span>
                        ) : '—'}
                      </RowCell>

                      {/* Start Time */}
                      <RowCell style={{ color: '#64748b', fontSize: 12, whiteSpace: 'nowrap' }}>
                        {formatTime(run.started_at)}
                      </RowCell>

                      {/* Actions */}
                      <RowCell>
                        <div style={{ display: 'flex', gap: 6, alignItems: 'center', justifyContent: 'center' }}>
                          {/* Error log expand (failed only) */}
                          {isFailed && (
                            <button
                              onClick={() => toggleExpand(runId)}
                              style={{
                                display: 'inline-flex', alignItems: 'center', gap: 4,
                                fontSize: 11, padding: '4px 10px', borderRadius: 6,
                                background: isExpanded ? 'rgba(239,68,68,0.2)' : 'rgba(239,68,68,0.1)',
                                color: '#f87171', border: '1px solid rgba(239,68,68,0.3)',
                                cursor: 'pointer', fontWeight: 600, transition: 'all 0.15s',
                              }}
                              title="Show error log"
                            >
                              {isExpanded ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
                              {isExpanded ? 'Hide' : 'Error'}
                            </button>
                          )}
                          {/* View WAP Plan / SQL */}
                          <button
                            onClick={() => setViewSqlRun(run)}
                            title="View Exact Compiled WAP SQL for this Run"
                            style={{
                              display: 'inline-flex', alignItems: 'center', gap: 4,
                              fontSize: 11, padding: '4px 10px', borderRadius: 6,
                              background: 'rgba(34,211,238,0.1)', color: '#22d3ee',
                              border: '1px solid rgba(34,211,238,0.25)',
                              cursor: 'pointer', fontWeight: 600, transition: 'all 0.15s',
                            }}
                            onMouseEnter={e => e.currentTarget.style.background = 'rgba(34,211,238,0.2)'}
                            onMouseLeave={e => e.currentTarget.style.background = 'rgba(34,211,238,0.1)'}
                          >
                            <Terminal size={10} /> SQL
                          </button>
                        </div>
                      </RowCell>
                    </tr>

                    {/* Error log expansion row */}
                    {isFailed && isExpanded && (
                      <ErrorLogRow run={run} colSpan={COLS.length} />
                    )}
                  </React.Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* WAP Plan Modal */}
      {viewSqlRun && (
        <WapPlanModal
          pipelineId={pipelineId}
          run={viewSqlRun}
          onClose={() => setViewSqlRun(null)}
        />
      )}

      <style>{`
        @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }
      `}</style>
    </div>
  )
}

function WapPlanModal({ pipelineId, run, onClose }) {
  const [wapPlan, setWapPlan] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    // Try to get watermark, fallback to timestamp if missing
    const watermark = run.pipeline_watermark || (new Date().toISOString())
    // For manual/legacy runs, run.id is the UUID
    const runId = run.id || run.dagster_run_id || 'UNKNOWN_RUN_ID'
    const version = run.version || 1
    
    api.getWapPlan(pipelineId, version, runId, watermark)
      .then(res => {
        if (!cancelled) {
          if (res && res.steps) setWapPlan(res)
          else setError("WAP Plan not available. The pipeline version might be missing or corrupted.")
        }
      })
      .catch(err => {
        if (!cancelled) setError("Failed to render WAP Plan: " + err.message)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => { cancelled = true }
  }, [pipelineId, run])

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 99999,
      background: 'rgba(5, 8, 18, 0.8)', backdropFilter: 'blur(6px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 40
    }}>
      <div style={{
        background: '#0a0f1e', width: '100%', maxWidth: 1000, height: '90vh',
        borderRadius: 16, border: '1px solid rgba(255,255,255,0.1)',
        boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
        animation: 'slideIn 0.3s cubic-bezier(0.34,1.56,0.64,1)',
      }}>
        {/* Header */}
        <div style={{
          padding: '16px 24px', background: '#0d1117',
          borderBottom: '1px solid rgba(255,255,255,0.08)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <Terminal style={{ color: '#22d3ee' }} size={20} />
            <span style={{ fontSize: 16, fontWeight: 700, color: '#f1f5f9' }}>Full Action SQL</span>
            <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 4, background: 'rgba(99,102,241,0.1)', color: '#818cf8', fontWeight: 600 }}>
              Run ID: {(run.id || run.dagster_run_id || '').slice(0, 8)}
            </span>
          </div>
          <button onClick={onClose} style={{
            background: 'none', border: 'none', color: '#64748b', cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: 4, borderRadius: '50%', transition: 'background 0.2s',
          }} onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.05)'} onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
            <X size={20} />
          </button>
        </div>

        {/* Content */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '24px 32px', background: '#080c18' }}>
          {loading ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 16, color: '#64748b' }}>
              <Loader size={32} className="spin" style={{ color: '#22d3ee' }} />
              <span>Generating full action SQL for this run...</span>
            </div>
          ) : error ? (
            <div style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', padding: 20, borderRadius: 12, color: '#fca5a5', display: 'flex', alignItems: 'flex-start', gap: 12 }}>
              <AlertCircle size={20} style={{ flexShrink: 0, marginTop: 2, color: '#ef4444' }} />
              <div>
                <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 8 }}>Render Error</div>
                <div style={{ fontSize: 13, lineHeight: 1.6 }}>{error}</div>
              </div>
            </div>
          ) : wapPlan && (() => {
            const runId = run.id || run.dagster_run_id || 'UNKNOWN_RUN_ID'
            const combinedSteps = wapPlan.steps || [
              ...(wapPlan.core_steps || []),
              ...(wapPlan.success_steps || []),
              ...(wapPlan.rollback_steps || []),
              ...(wapPlan.cleanup_steps || [])
            ]
            const allSqlText = combinedSteps.map(s => s.sql || '').join('\n')

            const sourceCandidates = []
            const fromRegex = /\bFROM\s+([A-Za-z0-9_"$]+\.[A-Za-z0-9_"$]+\.[A-Za-z0-9_"$]+)/gi
            let m
            while ((m = fromRegex.exec(allSqlText)) !== null) {
              const fq = m[1]
              if (!fq.includes('.pipeline.')) sourceCandidates.push(fq)
            }
            const sourceFq = sourceCandidates[0] || '<source_catalog>.<source_schema>.<source_table>'
            const sourceParts = sourceFq.split('.')
            const sourceCatalog = sourceParts[0] || '<source_catalog>'
            const sourceSchema = sourceParts[1] || '<source_schema>'
            const sourceTableRaw = sourceParts[2] || '<source_table>'
            const sourceTable = sourceTableRaw.replace(/^"|"$/g, '')

            const startSnapMatch = allSqlText.match(/start_snapshot_id\s*=>\s*'?([0-9]+)'?/i)
            const endSnapMatch = allSqlText.match(/end_snapshot_id\s*=>\s*'?([0-9]+)'?/i)
            const hasSnapshotRange = Boolean(startSnapMatch || endSnapMatch)
            const startSnapshotId = startSnapMatch ? startSnapMatch[1] : 'NULL'
            const endSnapshotId = endSnapMatch ? endSnapMatch[1] : 'NULL'
            const snapshotNote = hasSnapshotRange ? '' : ' -- not used in this run mode'

            const allSteps = combinedSteps.map(s => {
              const isOrchestration = s.step_type === 'query_state' || s.step_type === 'execute'
              return { 
                ...s, 
                runtime: isOrchestration ? 'Backend · PostgreSQL' : 'Dagster → Trino · Iceberg' 
              }
            })

            return (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
                {allSteps.map((step, idx) => {
                  const isOrchestration = step.step_type === 'query_state' || step.step_type === 'execute'
                  return (
                    <div key={idx} style={{
                      background: isOrchestration ? 'rgba(148,163,184,0.05)' : 'rgba(255,255,255,0.02)',
                      border: isOrchestration ? '1px solid rgba(148,163,184,0.18)' : '1px solid rgba(255,255,255,0.08)',
                      borderRadius: 12, overflow: 'hidden',
                    }}>
                      <div style={{
                        padding: '12px 20px', background: 'rgba(255,255,255,0.03)',
                        borderBottom: '1px solid rgba(255,255,255,0.06)',
                        display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8,
                      }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <span style={{
                            width: 24, height: 24, borderRadius: '50%',
                            background: isOrchestration ? '#94a3b8' : '#22d3ee',
                            color: '#080c18', display: 'flex', alignItems: 'center', justifyContent: 'center',
                            fontSize: 12, fontWeight: 800,
                          }}>{idx + 1}</span>
                          <span style={{ fontSize: 14, fontWeight: 600, color: '#f1f5f9', fontFamily: 'monospace' }}>{step.step_name}</span>
                          <span style={{
                            fontSize: 10, padding: '2px 8px', borderRadius: 4,
                            background: isOrchestration ? 'rgba(148,163,184,0.15)' : 'rgba(34,211,238,0.1)',
                            color: isOrchestration ? '#cbd5e1' : '#67e8f9',
                            fontWeight: 600, textTransform: 'uppercase',
                          }}>
                            {step.step_type}
                          </span>
                        </div>
                        <span style={{ fontSize: 10, color: '#64748b', fontFamily: 'monospace' }}>{step.runtime}</span>
                      </div>
                      <pre style={{
                        fontFamily: 'JetBrains Mono, Fira Code, monospace',
                        fontSize: 12, color: isOrchestration ? '#94a3b8' : '#e2e8f0', lineHeight: 1.6,
                        whiteSpace: 'pre-wrap', margin: 0, padding: '16px 20px', overflowX: 'auto',
                      }}>
                        {step.sql}
                      </pre>
                    </div>
                  )
                })}
              </div>
            )
          })()}
        </div>
      </div>
    </div>
  )
}

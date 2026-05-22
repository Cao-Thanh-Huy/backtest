/**
 * Custom React Flow Node Types for Pipeline Studio
 * Each node type has: a unique color, icon, input/output handles
 */
import React from 'react'
import { Handle, Position, useReactFlow } from '@xyflow/react'
import {
  Database, Filter, Columns, GitMerge,
  BarChart2, Layers, Target, X, Plug, Terminal
} from 'lucide-react'

const NODE_STYLES = {
  source:    { bg: '#1e3a5f', border: '#3b82f6', icon: Database,  iconColor: '#60a5fa', label: 'Source'    },
  filter:    { bg: '#1e3a2f', border: '#22c55e', icon: Filter,    iconColor: '#4ade80', label: 'Filter'    },
  extend:    { bg: '#2b1b40', border: '#8b5cf6', icon: Columns,   iconColor: '#a78bfa', label: 'Add Columns' },
  select:    { bg: '#2a2a1e', border: '#eab308', icon: Columns,   iconColor: '#facc15', label: 'Select'    },
  join:      { bg: '#2a1e3a', border: '#a855f7', icon: GitMerge,  iconColor: '#c084fc', label: 'Join'      },
  aggregate: { bg: '#1e2a3a', border: '#06b6d4', icon: BarChart2, iconColor: '#22d3ee', label: 'Aggregate' },
  union:     { bg: '#3a1e2a', border: '#f97316', icon: Layers,    iconColor: '#fb923c', label: 'Union'     },
  sink:      { bg: '#3a1e1e', border: '#ef4444', icon: Target,    iconColor: '#f87171', label: 'Destination'      },
  connector: { bg: '#1a3a2a', border: '#10b981', icon: Plug,      iconColor: '#34d399', label: 'Connector Source'  },
  custom_sql:{ bg: '#1a1a1a', border: '#6b7280', icon: Terminal,  iconColor: '#9ca3af', label: 'Custom SQL'},
}

function BaseNode({ id, data, type, children, hasLeft = false, hasRight = false }) {
  const style = NODE_STYLES[type] || NODE_STYLES.source
  const Icon = style.icon
  const isSelected = data.selected
  const { setNodes, setEdges } = useReactFlow()

  const handleDelete = (e) => {
    e.stopPropagation()
    setNodes((nds) => nds.filter((n) => n.id !== id))
    setEdges((eds) => eds.filter((edge) => edge.source !== id && edge.target !== id))
  }

  return (
    <div
      style={{
        background: '#090d16',
        border: `1px solid ${isSelected ? '#ffffff' : style.border}`,
        borderRadius: 8,
        width: 210,
        height: 80,
        boxShadow: isSelected
          ? `0 0 15px ${style.border}88, 0 8px 32px rgba(0, 0, 0, 0.6)`
          : `0 4px 16px rgba(0, 0, 0, 0.4), inset 0 1px 0 rgba(255, 255, 255, 0.05)`,
        transition: 'all 0.15s ease',
        cursor: 'pointer',
        display: 'flex',
        flexDirection: 'column',
        boxSizing: 'border-box',
      }}
    >
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 6,
        padding: '4px 10px',
        height: 24,
        borderBottom: `1px solid ${style.border}22`,
        background: `${style.border}12`,
        borderRadius: '7px 7px 0 0',
        boxSizing: 'border-box',
      }}>
        <Icon size={12} color={style.iconColor} />
        <span style={{ fontSize: 9.5, fontWeight: 800, color: style.iconColor, textTransform: 'uppercase', letterSpacing: '0.5px', flex: 1 }}>
          {style.label}
        </span>
        <button
          onClick={handleDelete}
          style={{ background: 'transparent', border: 'none', color: '#64748b', cursor: 'pointer', display: 'flex', padding: 1, borderRadius: 3 }}
          onMouseEnter={e => e.currentTarget.style.color = '#ef4444'}
          onMouseLeave={e => e.currentTarget.style.color = '#64748b'}
          title="Delete Node"
        >
          <X size={12} />
        </button>
      </div>

      {/* Body */}
      <div style={{
        padding: '6px 10px',
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        boxSizing: 'border-box',
        overflow: 'hidden'
      }}>
        <div style={{
          fontSize: 11.5,
          fontWeight: 700,
          color: '#f1f5f9',
          marginBottom: 1,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis'
        }}>
          {data.label || `${style.label} Node`}
        </div>
        {children}
      </div>

      {/* Handles */}
      {!hasLeft && !hasRight && type !== 'source' && (
        <Handle
          type="target"
          position={Position.Top}
          style={{ background: style.border, width: 8, height: 8, border: '1px solid #090d16' }}
        />
      )}
      {hasLeft && (
        <Handle
          id="left"
          type="target"
          position={Position.Top}
          style={{ background: style.border, width: 8, height: 8, border: '1px solid #090d16', left: '30%' }}
        />
      )}
      {hasRight && (
        <Handle
          id="right"
          type="target"
          position={Position.Top}
          style={{ background: '#a855f7', width: 8, height: 8, border: '1px solid #090d16', left: '70%' }}
        />
      )}
      {type !== 'sink' && (
        <Handle
          type="source"
          position={Position.Bottom}
          style={{ background: style.border, width: 8, height: 8, border: '1px solid #090d16' }}
        />
      )}
    </div>
  )
}

function MetaText({ children, style }) {
  return (
    <div style={{
      fontSize: 9.5,
      color: '#94a3b8',
      marginTop: 1,
      whiteSpace: 'nowrap',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      maxWidth: 190,
      opacity: 0.85,
      lineHeight: '1.2',
      ...style
    }}>
      {children}
    </div>
  )
}

// ── Node Components ───────────────────────────────────────────────────────────

export function SourceNode({ id, data }) {
  return (
    <BaseNode id={id} data={data} type="source">
      {data.schema && data.table ? (
        <MetaText>{data.catalog || 'iceberg'}.{data.schema}.{data.table}</MetaText>
      ) : (
        <MetaText style={{ color: '#f97316' }}>Chưa chọn bảng nguồn</MetaText>
      )}
      <MetaText style={{ opacity: 0.6 }}>Source Table</MetaText>
    </BaseNode>
  )
}

export function FilterNode({ id, data }) {
  return (
    <BaseNode id={id} data={data} type="filter">
      {data.condition ? (
        <MetaText>WHERE {data.condition}</MetaText>
      ) : (
        <MetaText style={{ color: '#f97316' }}>Chưa thiết lập điều kiện</MetaText>
      )}
      <MetaText style={{ opacity: 0.6 }}>Filter rows</MetaText>
    </BaseNode>
  )
}

export function SelectNode({ id, data }) {
  const cols = Array.isArray(data.columns) ? data.columns : []
  return (
    <BaseNode id={id} data={data} type="select">
      <MetaText>{cols.length ? `${cols.length} column(s) selected` : 'SELECT *'}</MetaText>
      <MetaText style={{ opacity: 0.6 }}>Column mapping</MetaText>
    </BaseNode>
  )
}

export function JoinNode({ id, data }) {
  return (
    <BaseNode id={id} data={data} type="join" hasLeft={true} hasRight={true}>
      <MetaText>{data.join_type || 'INNER'} JOIN</MetaText>
      {data.on_condition ? (
        <MetaText>ON {data.on_condition}</MetaText>
      ) : (
        <MetaText style={{ color: '#f97316' }}>Chưa thiết lập ON</MetaText>
      )}
    </BaseNode>
  )
}

export function AggregateNode({ id, data }) {
  const aggs = Array.isArray(data.aggregations) ? data.aggregations : []
  return (
    <BaseNode id={id} data={data} type="aggregate">
      <MetaText>
        {data.group_by?.length > 0 ? `GROUP BY ${data.group_by.join(', ')}` : 'No GROUP BY'}
      </MetaText>
      <MetaText>{aggs.length > 0 ? `${aggs.length} Aggregation(s)` : 'No aggregations'}</MetaText>
    </BaseNode>
  )
}

export function UnionNode({ id, data }) {
  return (
    <BaseNode id={id} data={data} type="union">
      <MetaText>{data.union_all !== false ? 'UNION ALL' : 'UNION DISTINCT'}</MetaText>
      <MetaText style={{ opacity: 0.6 }}>Merge datasets</MetaText>
    </BaseNode>
  )
}

export function CustomSQLNode({ id, data }) {
  return (
    <BaseNode id={id} data={data} type="custom_sql" hasLeft={false} hasRight={false}>
      <MetaText>{data.sql ? 'SQL Configured' : 'Empty SQL'}</MetaText>
      <MetaText style={{ opacity: 0.6 }}>Custom query</MetaText>
    </BaseNode>
  )
}

export function SinkNode({ id, data }) {
  return (
    <BaseNode id={id} data={data} type="sink">
      {data.schema && data.table ? (
        <MetaText>{data.catalog || 'iceberg'}.{data.schema}.{data.table}</MetaText>
      ) : (
        <MetaText style={{ color: '#f97316' }}>Chưa chọn bảng đích</MetaText>
      )}
      {data.write_mode && (
        <MetaText>Mode: {data.write_mode?.toUpperCase()}</MetaText>
      )}
    </BaseNode>
  )
}

export function ConnectorNode({ id, data }) {
  const statusColor = data.connector_status === 'error' ? '#ef4444'
    : data.connector_status === 'active' ? '#10b981' : '#64748b'
  return (
    <BaseNode id={id} data={data} type="connector">
      {data.connector_name
        ? <MetaText>🔌 {data.connector_name}</MetaText>
        : <MetaText style={{ color: '#f97316' }}>Chưa chọn connector</MetaText>}
      <MetaText style={{ color: statusColor }}>● {data.connector_status || 'inactive'}</MetaText>
    </BaseNode>
  )
}

export function ExtendNode({ id, data }) {
  const cols = Array.isArray(data.columns) ? data.columns : []
  return (
    <BaseNode id={id} data={data} type="extend">
      <MetaText>
        {cols.length ? `+ ${cols.length} new column(s)` : 'No added columns'}
      </MetaText>
      <MetaText style={{ opacity: 0.6 }}>Sequential compiling</MetaText>
    </BaseNode>
  )
}

export const NODE_TYPES = {
  source: SourceNode,
  filter: FilterNode,
  select: SelectNode,
  extend: ExtendNode,
  join: JoinNode,
  aggregate: AggregateNode,
  union: UnionNode,
  sink: SinkNode,
  connector: ConnectorNode,
  custom_sql: CustomSQLNode,
}

export const NODE_META = [
  { type: 'source',     label: 'Source Table', description: 'Read from Iceberg Table', color: '#3b82f6' },
  { type: 'filter',     label: 'Filter',       description: 'Filter rows with WHERE',  color: '#ec4899' },
  { type: 'extend',     label: 'Add Columns',  description: 'Add calculated columns',  color: '#8b5cf6' },
  { type: 'select',     label: 'Select',       description: 'Select & map columns',    color: '#eab308' },
  { type: 'custom_sql', label: 'Custom SQL',   description: 'Write custom SQL query',  color: '#6b7280' },
  { type: 'sink',       label: 'Destination',  description: 'Write to Iceberg Table',  color: '#ef4444' },
]

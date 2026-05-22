/**
 * NodeConfigForm — Right panel config for selected node
 * Shows type-specific fields for each node type
 */
import React, { useState, useEffect } from 'react'
import { X, Plus, Trash2, RefreshCw, Database } from 'lucide-react'
import * as api from '../../../api/client'

const JOIN_TYPES = ['INNER', 'LEFT', 'RIGHT', 'FULL OUTER', 'CROSS']
const WRITE_MODES = [
  { value: 'merge', label: 'Merge (Upsert)' },
  { value: 'overwrite', label: 'Overwrite (Full Replace)' },
  { value: 'append', label: 'Append' },
]
const SOURCE_MODES = [
  { value: 'incremental_changes', label: 'Incremental CDC (Bronze to Silver)' },
  { value: 'always_full_load', label: 'Always Full Load (Silver to Gold)' },
]

export default function NodeConfigForm({ node, nodes = [], edges = [], onChange, onClose }) {
  const [data, setData] = useState(node?.data || {})
  const [schemas, setSchemas] = useState([])
  const [tables, setTables] = useState([])
  const [targetColumns, setTargetColumns] = useState([])
  const [availableColumns, setAvailableColumns] = useState([])
  const [availableColumnTypes, setAvailableColumnTypes] = useState({})
  const [loadingCols, setLoadingCols] = useState(false)
  const [connectorsList, setConnectorsList] = useState([])

  const [width, setWidth] = useState(420)
  const [isResizing, setIsResizing] = useState(false)

  const startResizing = React.useCallback((mouseDownEvent) => {
    mouseDownEvent.preventDefault()
    setIsResizing(true)
  }, [])

  const stopResizing = React.useCallback(() => {
    setIsResizing(false)
  }, [])

  const resize = React.useCallback((mouseMoveEvent) => {
    if (isResizing) {
      const newWidth = window.innerWidth - mouseMoveEvent.clientX
      if (newWidth > 320 && newWidth < 850) {
        setWidth(newWidth)
      }
    }
  }, [isResizing])

  useEffect(() => {
    window.addEventListener("mousemove", resize)
    window.addEventListener("mouseup", stopResizing)
    return () => {
      window.removeEventListener("mousemove", resize)
      window.removeEventListener("mouseup", stopResizing)
    }
  }, [resize, stopResizing])

  useEffect(() => {
    setData(node?.data || {})
  }, [node?.id])

  useEffect(() => {
    if (node?.type === 'connector') {
      import('../../../api/connectors').then(m => {
        m.listConnectors().then(res => setConnectorsList(res.connectors || [])).catch(console.error)
      })
    }
  }, [node?.type])

  const [extendConfigs, setExtendConfigs] = useState([])

  useEffect(() => {
    if (node?.type !== 'extend') return

    const rawColumns = data.columns || []
    const configs = rawColumns.map(colStr => {
      const asMatch = colStr.match(/^(.*?)\s+AS\s+(.*)$/i)
      if (asMatch) {
        return {
          expr: asMatch[1].trim(),
          alias: asMatch[2].trim()
        }
      } else {
        return {
          expr: colStr.trim(),
          alias: colStr.trim()
        }
      }
    })
    
    // So sánh để tránh vòng lặp vô hạn
    const currentStr = JSON.stringify(extendConfigs.map(c => `${c.expr} AS ${c.alias}`))
    const nextStr = JSON.stringify(configs.map(c => `${c.expr} AS ${c.alias}`))
    if (currentStr !== nextStr) {
      setExtendConfigs(configs)
    }
  }, [node?.id, data.columns])

  function handleUpdateExtendConfigs(newConfigs) {
    setExtendConfigs(newConfigs)
    const colStrings = newConfigs
      .filter(c => c.expr.trim() && c.alias.trim())
      .map(c => `${c.expr.trim()} AS ${c.alias.trim()}`)
    update('columns', colStrings)
  }

  const [selectConfigs, setSelectConfigs] = useState([])

  useEffect(() => {
    if (node?.type !== 'select') return

    // 1. Khởi tạo cấu hình mặc định cho các cột upstream
    const initialConfigs = availableColumns.map(col => ({
      column: col,
      checked: false,
      type: 'standard',
      rule: 'NONE',
      customExpr: '',
      alias: col,
    }))

    const standaloneConfigs = []
    const rawColumns = data.columns || []
    const claimedColumns = new Set()

    rawColumns.forEach(colStr => {
      const asMatch = colStr.match(/^(.*?)\s+AS\s+(.*)$/i)
      let left = colStr.trim()
      let alias = ''
      if (asMatch) {
        left = asMatch[1].trim()
        alias = asMatch[2].trim()
      } else {
        alias = left
      }

      // Kiểm tra xem có phải là biến đổi đơn giản của cột upstream không
      let matched = false
      for (const cfg of initialConfigs) {
        const col = cfg.column
        if (claimedColumns.has(col)) continue

        if (left === col) {
          cfg.checked = true; cfg.rule = 'NONE'; cfg.alias = alias
          claimedColumns.add(col); matched = true; break
        } else if (left === `TRIM(${col})`) {
          cfg.checked = true; cfg.rule = 'TRIM'; cfg.alias = alias
          claimedColumns.add(col); matched = true; break
        } else if (left === `UPPER(${col})`) {
          cfg.checked = true; cfg.rule = 'UPPER'; cfg.alias = alias
          claimedColumns.add(col); matched = true; break
        } else if (left === `LOWER(${col})`) {
          cfg.checked = true; cfg.rule = 'LOWER'; cfg.alias = alias
          claimedColumns.add(col); matched = true; break
        } else if (left === `DISTINCT TRIM(${col})`) {
          cfg.checked = true; cfg.rule = 'DISTINCT TRIM'; cfg.alias = alias
          claimedColumns.add(col); matched = true; break
        }
      }

      if (matched) return

      // Nếu là biểu thức custom nhưng có nhắc tới cột upstream chưa chọn, gộp vào cột đó
      let associated = false
      for (const cfg of initialConfigs) {
        const col = cfg.column
        if (claimedColumns.has(col)) continue

        const regex = new RegExp(`\\b${col}\\b`)
        if (regex.test(left)) {
          cfg.checked = true
          cfg.rule = 'CUSTOM'
          cfg.customExpr = left
          cfg.alias = alias
          claimedColumns.add(col)
          associated = true
          break
        }
      }

      if (associated) return

      // Còn lại là cột custom tạo mới hoàn toàn
      standaloneConfigs.push({
        column: null,
        checked: true,
        type: 'custom',
        rule: 'CUSTOM',
        customExpr: left,
        alias: alias,
      })
    })

    setSelectConfigs([...initialConfigs, ...standaloneConfigs])
  }, [node?.id, availableColumns, JSON.stringify(data.columns)])

  useEffect(() => {
    if (node?.type === 'source' || node?.type === 'sink') {
      api.getSchemas().then(res => setSchemas(res.schemas || [])).catch(console.error)
    }
  }, [node?.type])

  useEffect(() => {
    if ((node?.type === 'source' || node?.type === 'sink') && data.schema) {
      api.getTables(data.schema).then(res => setTables(res.tables || [])).catch(console.error)
    } else {
      setTables([])
    }
  }, [node?.type, data.schema])

  useEffect(() => {
    if (node?.type === 'sink' && data.schema && data.table) {
      api.describeTable(data.schema, data.table)
        .then(res => setTargetColumns((res.columns || []).map(c => c.name)))
        .catch(console.error)
    } else {
      setTargetColumns([])
    }
  }, [node?.type, data.schema, data.table])

  // ── Resolve upstream columns ───────────────────────────────────────────────
  const nodesExceptCurrentStr = JSON.stringify(nodes.filter(n => n.id !== node?.id).map(n => ({ id: n.id, type: n.type, data: n.data })))
  const edgesStr = JSON.stringify(edges)

  useEffect(() => {
    if (!node || node.type === 'source') {
      setAvailableColumns([])
      return
    }

    let isCancelled = false
    async function fetchUpstream() {
      setLoadingCols(true)

      const parentNodeIds = edges.filter(e => e.target === node.id).map(e => e.source)
      
      async function resolveNodeOutput(nId, visited = new Set()) {
        if (visited.has(nId)) return []
        visited.add(nId)
        const currNode = nodes.find(n => n.id === nId)
        if (!currNode) return []

        // If source, fetch from Trino API
        if (currNode.type === 'source') {
          if (currNode.data?.schema && currNode.data?.table) {
            try {
              const res = await api.describeTable(currNode.data.schema, currNode.data.table)
              return (res.columns || []).map(c => ({ name: c.name, type: c.type || 'unknown' }))
            } catch (e) {
              return []
            }
          }
          return []
        }

        // If connector, fetch from Trino API using bronze schema and connector name
        if (currNode.type === 'connector') {
          if (currNode.data?.connector_name) {
            try {
              const res = await api.describeTable('bronze', currNode.data.connector_name)
              return (res.columns || []).map(c => ({ name: c.name, type: c.type || 'unknown' }))
            } catch (e) {
              // Table not created yet (connector hasn't run), return empty allowing fallback input
              return []
            }
          }
          return []
        }

        // Aggregate inputs of currNode
        const pEdges = edges.filter(e => e.target === nId)
        let inCols = []
        for (const e of pEdges) {
          inCols.push(...await resolveNodeOutput(e.source, visited))
        }
        
        const uniqueCols = {}
        inCols.forEach(c => uniqueCols[c.name] = c)
        inCols = Object.values(uniqueCols)

        if (currNode.type === 'select') {
          if (currNode.data?.columns && currNode.data.columns.length > 0 && currNode.data.columns[0] !== '*') {
            return currNode.data.columns.map(name => {
              let alias = name;
              const match = name.match(/\s+AS\s+([a-zA-Z0-9_]+)\s*$/i);
              if (match) {
                alias = match[1];
              } else {
                const parts = name.trim().split(/\s+/);
                if (parts.length > 0) alias = parts[parts.length - 1];
              }
              return { name: alias, type: uniqueCols[alias]?.type || 'unknown' };
            })
          }
          return inCols
        }
        if (currNode.type === 'aggregate') {
          const gb = currNode.data?.group_by || []
          const agg = (currNode.data?.aggregations || []).map(a => a.alias).filter(Boolean)
          const allNames = [...new Set([...gb, ...agg])]
          return allNames.map(name => uniqueCols[name] || { name, type: 'unknown' })
        }
        return inCols // filter, join, union passthrough
      }

      let allInputCols = []
      let typesMap = {}
      for (const pId of parentNodeIds) {
        const cols = await resolveNodeOutput(pId)
        cols.forEach(c => {
          allInputCols.push(c.name)
          typesMap[c.name] = c.type
        })
      }

      if (!isCancelled) {
        setAvailableColumns([...new Set(allInputCols)])
        setAvailableColumnTypes(typesMap)
        setLoadingCols(false)
      }
    }
    
    fetchUpstream()
    return () => { isCancelled = true }
  }, [node?.id, nodesExceptCurrentStr, edgesStr])

  if (!node) return null

  function update(field, value) {
    let next = { ...data, [field]: value }
    
    // Smart UX rules: auto-assign source_mode based on schema selection
    if (field === 'schema') {
      if (value === 'silver') {
        next.source_mode = 'always_full_load'
      } else if (value === 'bronze') {
        next.source_mode = 'incremental_changes'
      }
    }
    
    setData(next)
    onChange(node.id, next)
  }

  function updateNested(field, idx, key, value) {
    const arr = [...(data[field] || [])]
    arr[idx] = { ...arr[idx], [key]: value }
    update(field, arr)
  }

  function addToArray(field, defaultItem) {
    update(field, [...(data[field] || []), defaultItem])
  }

  function removeFromArray(field, idx) {
    update(field, (data[field] || []).filter((_, i) => i !== idx))
  }

  return (
    <div style={{ ...panelStyle, width, position: 'relative' }}>
      {/* Resizer drag handle bar */}
      <div
        onMouseDown={startResizing}
        style={{
          position: 'absolute',
          top: 0,
          left: -4,
          width: 8,
          height: '100%',
          cursor: 'col-resize',
          zIndex: 9999,
          background: isResizing ? 'rgba(99, 102, 241, 0.5)' : 'transparent',
          transition: 'background 0.15s',
        }}
        onMouseEnter={e => { if (!isResizing) e.currentTarget.style.background = 'rgba(99, 102, 241, 0.2)' }}
        onMouseLeave={e => { if (!isResizing) e.currentTarget.style.background = 'transparent' }}
      />
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px', borderBottom: '1px solid var(--border-color)' }}>
        <div>
          <div style={{ fontSize: 12, color: '#64748b', textTransform: 'uppercase', letterSpacing: 1 }}>{node.type}</div>
          <div style={{ fontSize: 14, fontWeight: 600, color: '#e2e8f0', marginTop: 2 }}>Configure Node</div>
        </div>
        <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', padding: 4 }}>
          <X size={16} />
        </button>
      </div>

      {/* Fields */}
      <div style={{ padding: '16px', overflowY: 'auto', flex: 1 }}>
        {/* Common: label */}
        <Field label="Node Label">
          <input className="form-input" value={data.label || ''} onChange={e => update('label', e.target.value)} placeholder="My Node" />
        </Field>

        {/* Source */}
        {node.type === 'source' && (() => {
          const sinkNode = nodes.find(n => n.type === 'sink');
          const isCircular = sinkNode && 
                             data.schema && data.table && 
                             data.schema === sinkNode.data?.schema && 
                             data.table === sinkNode.data?.table;
          return (
            <>
              <Field label="Catalog">
                <input className="form-input" value={data.catalog || 'iceberg'} onChange={e => update('catalog', e.target.value)} placeholder="iceberg" />
              </Field>
              <Field label="Schema *">
                <select className="form-select" value={data.schema || ''} onChange={e => update('schema', e.target.value)}>
                  <option value="" disabled>Select a schema...</option>
                  {schemas.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </Field>
              {data.schema === 'silver' && (
                <div style={{ marginTop: -8, marginBottom: 12, padding: '8px 12px', background: 'rgba(234,179,8,0.1)', border: '1px solid rgba(234,179,8,0.2)', borderRadius: 6, fontSize: 11, color: '#facc15', lineHeight: 1.4 }}>
                  ⚠️ Silver tables contain row-level updates/deletes, so Always Full Load mode is required to prevent Trino query errors.
                </div>
              )}
              {data.schema === 'bronze' && (
                <div style={{ marginTop: -8, marginBottom: 12, padding: '8px 12px', background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.2)', borderRadius: 6, fontSize: 11, color: '#34d399', lineHeight: 1.4 }}>
                  ⚡ Bronze tables are append-only. The system automatically assigns the optimal Incremental CDC mode.
                </div>
              )}
              <Field label="Table *">
                <select className="form-select" value={data.table || ''} onChange={e => update('table', e.target.value)} disabled={!data.schema}>
                  <option value="" disabled>Select a table...</option>
                  {tables.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </Field>
              {isCircular && (
                <div style={{ marginTop: -8, marginBottom: 12, padding: '8px 12px', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 6, fontSize: 11, color: '#f87171', lineHeight: 1.4, fontWeight: 'bold' }}>
                  🚨 Error: Source table cannot be the same as the target table in the same pipeline to avoid circular write loops!
                </div>
              )}
              <Field label="Source Mode">
                <select 
                  className="form-select" 
                  value={data.source_mode || 'incremental_changes'} 
                  onChange={e => update('source_mode', e.target.value)}
                  disabled={data.schema === 'silver' || data.schema === 'bronze'}
                >
                  {SOURCE_MODES.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                </select>
                <div style={{ marginTop: 6, fontSize: 11, color: '#94a3b8', lineHeight: 1.5 }}>
                  {(data.source_mode === 'incremental_changes' || !data.source_mode) && '⚡ Automatically runs Full Load for the first execution, and subsequent runs use Incremental CDC (table_changes) to fetch new data.'}
                  {data.source_mode === 'always_full_load' && '🔄 Always run Full Load (secure time-travel query) for each execution, simulating CDC metadata columns.'}
                </div>
              </Field>
            </>
          );
        })()}

        {/* Filter */}
        {node.type === 'filter' && <>
          <Field label="WHERE Condition *">
            <textarea
              className="code-editor"
              style={{ minHeight: 80 }}
              value={data.condition || ''}
              onChange={e => update('condition', e.target.value)}
              placeholder="amount > 100 AND status = 'active'"
            />
          </Field>
        </>}

        {/* Add Columns (Extend) */}
        {node.type === 'extend' && (() => {
          return (
            <>
              <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 16, lineHeight: 1.5 }}>
                💡 <strong>Add Columns Node</strong> keeps all existing columns from the upstream source and lets you add new calculated columns sequentially.
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {extendConfigs.map((cfg, idx) => (
                  <div key={idx} style={{
                    padding: 12,
                    background: 'rgba(255,255,255,0.02)',
                    border: '1px solid rgba(255,255,255,0.05)',
                    borderRadius: 8,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 8,
                    position: 'relative'
                  }}>
                    <button
                      onClick={() => {
                        const next = extendConfigs.filter((_, i) => i !== idx)
                        handleUpdateExtendConfigs(next)
                      }}
                      style={{
                        position: 'absolute', top: 8, right: 8,
                        background: 'transparent', border: 'none', color: '#64748b', cursor: 'pointer'
                      }}
                      onMouseEnter={e => e.currentTarget.style.color = '#ef4444'}
                      onMouseLeave={e => e.currentTarget.style.color = '#64748b'}
                      title="Remove Column"
                    >
                      <Trash2 size={14} />
                    </button>

                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      <span style={{ fontSize: 10, color: '#8b5cf6', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5, width: 70 }}>New Alias *</span>
                      <input
                        className="form-input"
                        style={{ flex: 1, padding: '4px 8px', fontSize: 12, height: 28 }}
                        placeholder="e.g. YoY_Growth_Pct"
                        value={cfg.alias || ''}
                        onChange={e => {
                          const next = [...extendConfigs]
                          next[idx] = { ...next[idx], alias: e.target.value }
                          handleUpdateExtendConfigs(next)
                        }}
                      />
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      <span style={{ fontSize: 10, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.5 }}>SQL Expression *</span>
                      <textarea
                        className="code-editor"
                        style={{
                          width: '100%',
                          minHeight: 48,
                          fontSize: 11,
                          fontFamily: 'JetBrains Mono, monospace',
                          padding: '6px 8px',
                          background: '#090d16',
                          borderColor: 'rgba(255,255,255,0.06)'
                        }}
                        placeholder="e.g. LAG(Amount, 12) OVER (...)"
                        value={cfg.expr || ''}
                        onChange={e => {
                          const next = [...extendConfigs]
                          next[idx] = { ...next[idx], expr: e.target.value }
                          handleUpdateExtendConfigs(next)
                        }}
                      />
                    </div>
                  </div>
                ))}
              </div>

              <div style={{ marginTop: 12, display: 'flex', justifyContent: 'center' }}>
                <button
                  className="btn btn-secondary btn-sm"
                  onClick={() => {
                    const next = [...extendConfigs, { expr: '', alias: '' }]
                    setExtendConfigs(next)
                  }}
                  style={{
                    width: '100%',
                    padding: '6px 12px',
                    background: 'rgba(139,92,246,0.08)',
                    border: '1px solid rgba(139,92,246,0.25)',
                    color: '#c084fc',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 6,
                    borderRadius: 6,
                  }}
                >
                  <Plus size={14} /> Add New Column
                </button>
              </div>
            </>
          )
        })()}

        {/* Select */}
        {node.type === 'select' && (() => {
          const saveConfigs = (newConfigs) => {
            const list = newConfigs
              .filter(cfg => cfg.checked)
              .map(cfg => {
                if (cfg.rule === 'CUSTOM') {
                  const expr = cfg.customExpr || (cfg.column ? cfg.column : '1');
                  return cfg.alias ? `${expr} AS ${cfg.alias}` : expr;
                }
                
                const col = cfg.column;
                let expr = col;
                if (cfg.rule === 'TRIM') expr = `TRIM(${col})`;
                else if (cfg.rule === 'UPPER') expr = `UPPER(${col})`;
                else if (cfg.rule === 'LOWER') expr = `LOWER(${col})`;
                else if (cfg.rule === 'DISTINCT TRIM') expr = `DISTINCT TRIM(${col})`;
                
                return cfg.alias && cfg.alias !== col ? `${expr} AS ${cfg.alias}` : expr;
              });
            
            update('columns', list);
          };

          const handleCheck = (index, checked) => {
            const next = [...selectConfigs];
            next[index].checked = checked;
            if (checked && !next[index].alias) {
              next[index].alias = next[index].column;
            }
            setSelectConfigs(next);
            saveConfigs(next);
          };

          const handleChangeRule = (index, rule) => {
            const next = [...selectConfigs];
            next[index].rule = rule;
            if (rule === 'CUSTOM' && !next[index].customExpr) {
              next[index].customExpr = next[index].column ? `TRIM(${next[index].column})` : '';
            }
            setSelectConfigs(next);
            saveConfigs(next);
          };

          const handleUpdateCustomExpr = (index, expr) => {
            const next = [...selectConfigs];
            next[index].customExpr = expr;
            setSelectConfigs(next);
            saveConfigs(next);
          };

          const handleUpdateAlias = (index, alias) => {
            const next = [...selectConfigs];
            next[index].alias = alias;
            setSelectConfigs(next);
            saveConfigs(next);
          };

          const handleAddStandalone = () => {
            const next = [
              ...selectConfigs,
              {
                column: null,
                checked: true,
                type: 'custom',
                rule: 'CUSTOM',
                customExpr: '1',
                alias: 'new_column',
              }
            ];
            setSelectConfigs(next);
            saveConfigs(next);
          };

          const handleDeleteStandalone = (index) => {
            const next = selectConfigs.filter((_, idx) => idx !== index);
            setSelectConfigs(next);
            saveConfigs(next);
          };

          return (
            <Field label="Target Columns (Select to keep)">
              {loadingCols ? (
                <div style={{ fontSize: 13, color: '#64748b' }}>Loading available columns...</div>
              ) : (
                <>
                  <div style={{ 
                    display: 'flex', 
                    flexDirection: 'column', 
                    gap: 8,
                    maxHeight: 480, 
                    overflowY: 'auto',
                    paddingRight: 4 
                  }}>
                    {selectConfigs.map((cfg, idx) => {
                      const isSelected = cfg.checked;
                      const isCustom = cfg.column === null;
                      const colType = !isCustom ? (availableColumnTypes[cfg.column] || 'varchar') : 'custom';
                      return (
                        <div 
                          key={idx} 
                          style={{ 
                            background: isSelected ? 'rgba(99,102,241,0.05)' : 'rgba(255,255,255,0.01)', 
                            border: `1px solid ${isSelected ? 'rgba(99,102,241,0.3)' : 'rgba(255,255,255,0.04)'}`, 
                            borderRadius: 8, 
                            padding: '10px 12px', 
                            transition: 'all 0.2s',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: 8,
                            boxShadow: isSelected ? '0 0 12px rgba(99,102,241,0.05)' : 'none',
                          }}
                        >
                          <div 
                            style={{ 
                              display: 'flex', 
                              alignItems: 'center', 
                              justifyContent: 'space-between',
                              cursor: !isCustom ? 'pointer' : 'default',
                              userSelect: 'none',
                              padding: '2px 0'
                            }}
                            onClick={() => {
                              if (!isCustom) {
                                handleCheck(idx, !isSelected);
                              }
                            }}
                          >
                            <div style={{ display: 'flex', alignItems: 'center', flex: 1, minWidth: 0 }}>
                              {!isCustom ? (
                                <div 
                                  style={{
                                    width: 16,
                                    height: 16,
                                    borderRadius: 4,
                                    border: `1.5px solid ${isSelected ? '#6366f1' : '#475569'}`,
                                    background: isSelected ? '#6366f1' : 'transparent',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    transition: 'all 0.15s',
                                    marginRight: 10,
                                    flexShrink: 0
                                  }}
                                >
                                  {isSelected && (
                                    <svg width="10" height="8" viewBox="0 0 10 8" fill="none" xmlns="http://www.w3.org/2000/svg">
                                      <path d="M1.5 4L4 6.5L8.5 1.5" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                                    </svg>
                                  )}
                                </div>
                              ) : (
                                <span style={{ fontSize: 13, marginRight: 8 }}>✨</span>
                              )}
                              <span style={{ 
                                fontFamily: 'JetBrains Mono, monospace', 
                                fontSize: 12, 
                                fontWeight: isSelected ? 600 : 400,
                                color: isSelected ? '#f1f5f9' : '#94a3b8',
                                whiteSpace: 'nowrap',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                marginRight: 6
                              }}>
                                {isCustom ? 'Custom Column' : cfg.column}
                              </span>

                              {!isCustom && (
                                <span style={{ 
                                  fontSize: 9, 
                                  fontFamily: 'JetBrains Mono, monospace',
                                  color: isSelected ? '#a5b4fc' : '#475569',
                                  background: isSelected ? 'rgba(99,102,241,0.12)' : 'rgba(255,255,255,0.03)',
                                  padding: '1px 6px',
                                  borderRadius: 4,
                                  textTransform: 'lowercase',
                                  border: `1px solid ${isSelected ? 'rgba(99,102,241,0.2)' : 'rgba(255,255,255,0.05)'}`,
                                  flexShrink: 0
                                }}>
                                  {colType}
                                </span>
                              )}
                            </div>
                            {isCustom && (
                              <button 
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleDeleteStandalone(idx);
                                }}
                                style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', padding: 4 }}
                                title="Delete Custom Column"
                              >
                                <Trash2 size={13} />
                              </button>
                            )}
                          </div>

                          {isSelected && (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, paddingLeft: !isCustom ? 26 : 0, borderLeft: !isCustom ? '1px dashed rgba(99,102,241,0.2)' : 'none', marginLeft: !isCustom ? 8 : 0 }}>
                              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                                <span style={{ fontSize: 10, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.5, flexShrink: 0, width: 60 }}>Transform</span>
                                <select 
                                  className="form-select" 
                                  style={{ flex: 1, padding: '4px 8px', fontSize: 12, height: 28 }}
                                  value={cfg.rule}
                                  onChange={e => handleChangeRule(idx, e.target.value)}
                                >
                                  <option value="NONE">No Transform</option>
                                  <option value="TRIM">TRIM()</option>
                                  <option value="UPPER">UPPER()</option>
                                  <option value="LOWER">LOWER()</option>
                                  <option value="DISTINCT TRIM">DISTINCT TRIM()</option>
                                  <option value="CUSTOM">Custom SQL Expression</option>
                                </select>
                              </div>

                              {cfg.rule === 'CUSTOM' && (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                                  <span style={{ fontSize: 10, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.5 }}>Expression</span>
                                  <textarea
                                    className="code-editor"
                                    style={{ 
                                      width: '100%', 
                                      minHeight: 48, 
                                      fontSize: 11, 
                                      fontFamily: 'JetBrains Mono, monospace', 
                                      padding: '6px 8px',
                                      background: '#090d16',
                                      borderColor: 'rgba(255,255,255,0.06)'
                                    }}
                                    placeholder="e.g. TRIM(col1) || ' - ' || TRIM(col2)"
                                    value={cfg.customExpr}
                                    onChange={e => handleUpdateCustomExpr(idx, e.target.value)}
                                  />
                                </div>
                              )}

                              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                                <span style={{ fontSize: 10, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.5, flexShrink: 0, width: 60 }}>AS Alias</span>
                                <input 
                                  className="form-input" 
                                  style={{ flex: 1, padding: '4px 8px', fontSize: 12, height: 28 }}
                                  placeholder="Alias name"
                                  value={cfg.alias || ''}
                                  onChange={e => handleUpdateAlias(idx, e.target.value)}
                                />
                              </div>
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>

                  <div style={{ marginTop: 12, display: 'flex', justifyContent: 'center' }}>
                    <button 
                      className="btn btn-secondary btn-sm"
                      onClick={handleAddStandalone}
                      style={{ 
                        width: '100%', 
                        padding: '6px 12px',
                        background: 'rgba(99,102,241,0.08)',
                        border: '1px solid rgba(99,102,241,0.25)',
                        color: '#a5b4fc',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: 6,
                        borderRadius: 6,
                      }}
                    >
                      <Plus size={14} /> Add New Custom Column
                    </button>
                  </div>

                  <div style={{ marginTop: 16, borderTop: '1px dashed rgba(255,255,255,0.06)', paddingTop: 12, display: 'flex', gap: 6, alignItems: 'center' }}>
                    <div style={{ flex: 1, height: 1, background: 'rgba(255,255,255,0.05)' }} />
                    <span style={{ fontSize: 10, color: '#475569', textTransform: 'uppercase', letterSpacing: 1 }}>END OF SELECT FIELDS</span>
                    <div style={{ flex: 1, height: 1, background: 'rgba(255,255,255,0.05)' }} />
                  </div>
                </>
              )}
              <div style={{ marginTop: 12, fontSize: 11, color: '#94a3b8', background: 'rgba(255,255,255,0.03)', padding: '8px 12px', borderRadius: 6, border: '1px solid rgba(255,255,255,0.05)' }}>
                💡 Select columns from parents. If empty, it translates to <code style={{color: '#818cf8'}}>SELECT *</code>.
              </div>
            </Field>
          );
        })()}

        {/* Join */}
        {node.type === 'join' && <>
          <Field label="Join Type *">
            <select className="form-select" value={data.join_type || 'INNER'} onChange={e => update('join_type', e.target.value)}>
              {JOIN_TYPES.map(t => <option key={t}>{t}</option>)}
            </select>
          </Field>
          <Field label="ON Condition *">
            <textarea
              className="code-editor"
              style={{ minHeight: 80 }}
              value={data.on_condition || ''}
              onChange={e => update('on_condition', e.target.value)}
              placeholder="l.user_id = r.user_id"
            />
          </Field>
          <Field label="Left Table Alias">
            <input className="form-input" value={data.left_alias || 'l'} onChange={e => update('left_alias', e.target.value)} placeholder="l" />
          </Field>
          <Field label="Right Table Alias">
            <input className="form-input" value={data.right_alias || 'r'} onChange={e => update('right_alias', e.target.value)} placeholder="r" />
          </Field>
          <Field label="Select Columns (optional)">
            <input className="form-input" value={(data.select_columns || ['*']).join(', ')}
              onChange={e => update('select_columns', e.target.value.split(',').map(c => c.trim()).filter(Boolean))}
              placeholder="* (all columns)" />
          </Field>
        </>}

        {/* Aggregate */}
        {node.type === 'aggregate' && <>
          <Field label="GROUP BY Columns">
            {loadingCols ? (
              <div style={{ fontSize: 13, color: '#64748b' }}>Loading available columns...</div>
            ) : availableColumns.length > 0 ? (
              <div style={{ background: '#0f172a', border: '1px solid var(--border-color)', borderRadius: 6, maxHeight: 140, overflowY: 'auto', padding: 8 }}>
                {availableColumns.map(col => {
                  const currentlySelected = data.group_by ? data.group_by.includes(col) : false
                  return (
                    <label key={col} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 6px', cursor: 'pointer', fontSize: 13, color: '#e2e8f0', borderRadius: 4, transition: 'background 0.2s' }} onMouseEnter={e => e.currentTarget.style.background = '#1e293b'} onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                      <input 
                        type="checkbox" 
                        checked={currentlySelected}
                        onChange={e => {
                          let newCols = data.group_by ? [...data.group_by] : []
                          if (e.target.checked) newCols.push(col)
                          else newCols = newCols.filter(c => c !== col)
                          update('group_by', newCols)
                        }}
                      />
                      <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 12 }}>{col}</span>
                    </label>
                  )
                })}
              </div>
            ) : (
              <input className="form-input" value={(data.group_by || []).join(', ')}
                onChange={e => update('group_by', e.target.value.split(',').map(c => c.trim()).filter(Boolean))}
                placeholder="user_id, category" />
            )}
          </Field>
          <Field label="Aggregations">
            {(data.aggregations || []).map((agg, i) => {
              // Warning logic
              const colName = agg.column;
              const colType = availableColumnTypes[colName] || '';
              const numericRules = ['SUM', 'AVG'];
              const isNumeric = colType.includes('int') || colType.includes('decimal') || colType.includes('double') || colType.includes('real');
              let warning = null;
              if (colName && agg.rule && colType !== 'unknown' && numericRules.includes(agg.rule) && !isNumeric) {
                warning = `Function ${agg.rule} requires a numeric type, but the column is '${colType}'!`;
              }
              
              return (
              <div key={i} style={{ marginBottom: 12 }}>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <div style={{ display: 'flex', flex: 1, gap: 4 }}>
                    <select 
                      className="form-select" style={{ flex: '0 0 90px', padding: '6px 8px', borderColor: warning ? '#ef4444' : '' }}
                      value={agg.rule || ''}
                      onChange={e => {
                        const rule = e.target.value;
                        const col = agg.column || '*';
                        const expr = rule === 'COUNT_DISTINCT' ? `COUNT(DISTINCT ${col})` : `${rule}(${col})`;
                        const newAggs = [...data.aggregations];
                        newAggs[i] = { ...newAggs[i], rule, expr };
                        update('aggregations', newAggs);
                      }}
                    >
                      <option value="" disabled>Rule</option>
                      <option value="SUM">SUM</option>
                      <option value="MIN">MIN</option>
                      <option value="MAX">MAX</option>
                      <option value="AVG">AVG</option>
                      <option value="COUNT">COUNT</option>
                      <option value="COUNT_DISTINCT">COUNT DISTINCT</option>
                    </select>
                    
                    {availableColumns.length > 0 ? (
                      <select
                        className="form-select" style={{ flex: 1, padding: '6px 8px', borderColor: warning ? '#ef4444' : '' }}
                        value={agg.column || ''}
                        onChange={e => {
                          const col = e.target.value;
                          const rule = agg.rule || 'SUM';
                          const expr = rule === 'COUNT_DISTINCT' ? `COUNT(DISTINCT ${col})` : `${rule}(${col})`;
                          const newAggs = [...data.aggregations];
                          newAggs[i] = { ...newAggs[i], column: col, rule, expr };
                          update('aggregations', newAggs);
                        }}
                      >
                        <option value="" disabled>Column</option>
                        <option value="*">*</option>
                        {availableColumns.map(c => <option key={c} value={c}>
                          {c} {availableColumnTypes[c] && availableColumnTypes[c] !== 'unknown' ? `(${availableColumnTypes[c]})` : ''}
                        </option>)}
                      </select>
                    ) : (
                      <input 
                        className="form-input" style={{ flex: 1, padding: '6px 8px', borderColor: warning ? '#ef4444' : '' }} 
                        placeholder="column_name" value={agg.column || ''}
                        onChange={e => {
                          const col = e.target.value;
                          const rule = agg.rule || 'SUM';
                          const expr = rule === 'COUNT_DISTINCT' ? `COUNT(DISTINCT ${col})` : `${rule}(${col})`;
                          const newAggs = [...data.aggregations];
                          newAggs[i] = { ...newAggs[i], column: col, rule, expr };
                          update('aggregations', newAggs);
                        }}
                      />
                    )}
                  </div>
                  <span style={{ color: '#64748b', fontSize: 12 }}>AS</span>
                  <input className="form-input" style={{ flex: '0 0 100px', padding: '6px 8px' }} placeholder="Alias" value={agg.alias || ''}
                    onChange={e => updateNested('aggregations', i, 'alias', e.target.value)} />
                  <button onClick={() => removeFromArray('aggregations', i)}
                    style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', padding: 4 }}>
                    <Trash2 size={14} />
                  </button>
                </div>
                {warning && (
                  <div style={{ fontSize: 11, color: '#ef4444', marginTop: 4, paddingLeft: 2 }}>
                    ⚠️ {warning}
                  </div>
                )}
              </div>
            )})}
            <button className="btn btn-secondary btn-sm" onClick={() => addToArray('aggregations', { expr: '', alias: '' })}>
              <Plus size={11} /> Add Aggregation
            </button>
          </Field>
        </>}

        {/* Union */}
        {node.type === 'union' && <>
          <Field label="Union Type">
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13, color: '#e2e8f0' }}>
              <input type="checkbox" checked={data.union_all !== false} onChange={e => update('union_all', e.target.checked)} />
              UNION ALL (keep duplicates)
            </label>
          </Field>
        </>}

        {/* Custom SQL */}
        {node.type === 'custom_sql' && (() => {
          const upstreamNodes = edges
            .filter(e => e.target === node.id)
            .map(e => nodes.find(n => n.id === e.source))
            .filter(Boolean);
            
          return (
            <>
              {upstreamNodes.length > 0 && (
                <Field label="Available Inputs (Click to insert)">
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
                    {upstreamNodes.map(un => {
                      const name = un.data?.label || un.data?.connector_name || un.data?.table || un.id;
                      return (
                        <div 
                          key={un.id}
                          onClick={() => {
                            const newSql = (data.sql || '') + name;
                            update('sql', newSql);
                          }}
                          style={{
                            background: 'rgba(56,189,248,0.1)', border: '1px solid rgba(56,189,248,0.3)',
                            padding: '4px 10px', borderRadius: 6, fontSize: 11, color: '#38bdf8',
                            cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, fontWeight: 600,
                            transition: 'all 0.15s'
                          }}
                          onMouseEnter={e => e.currentTarget.style.background = 'rgba(56,189,248,0.2)'}
                          onMouseLeave={e => e.currentTarget.style.background = 'rgba(56,189,248,0.1)'}
                          title="Click to insert table name into SQL"
                        >
                          <Database size={12} />
                          {name}
                        </div>
                      )
                    })}
                  </div>
                </Field>
              )}
              <Field label="Raw SQL (Trino CTE) *">
                <textarea
                  className="code-editor"
                  style={{ minHeight: 200, fontFamily: 'JetBrains Mono, monospace' }}
                  value={data.sql || ''}
                  onChange={e => update('sql', e.target.value)}
                  placeholder={`SELECT * FROM ${upstreamNodes[0] ? (upstreamNodes[0].data?.label || upstreamNodes[0].data?.connector_name || 'table_name') : 'table_name'}`}
                />
                <div style={{ marginTop: 8, fontSize: 11, color: '#94a3b8', lineHeight: 1.5 }}>
                  You can reference the input Node names directly. Click on the tables above to quickly insert them into your SQL query.
                </div>
                
                {(() => {
                  if (!data.sql || upstreamNodes.length === 0) return null;
                  const sqlLower = data.sql.toLowerCase();
                  const upstreamNames = upstreamNodes.map(un => (un.data?.label || un.data?.connector_name || un.data?.table || un.id).toLowerCase());
                  
                  // Regex to match "FROM table_name" or "JOIN table_name" or "FROM {{ something }}"
                  const tableMatches = [...sqlLower.matchAll(/(?:from|join)\s+([a-z0-9_]+|\{\{.*?\}\})/g)].map(m => m[1]);
                  
                  const invalidTables = tableMatches.filter(t => !upstreamNames.includes(t) && !t.includes('unnest') && !t.includes('select') && !t.includes('unnest('));
                  const hasLegacy = /\{\{\s*(upstream|input\s*node)\s*\}\}/i.test(sqlLower);

                  if (invalidTables.length > 0 || hasLegacy) {
                    return (
                      <div style={{ marginTop: 8, padding: '8px 12px', background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.3)', borderRadius: 6, display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                        <div style={{ color: '#f59e0b', marginTop: 2 }}>⚠️</div>
                        <div style={{ fontSize: 11, color: '#fcd34d', lineHeight: 1.5 }}>
                          {hasLegacy && (
                            <span><strong>Legacy syntax:</strong> The <code>{`{{ }}`}</code> syntax is no longer needed. Reference the table directly by its Node name (e.g., <strong>{upstreamNames[0]}</strong>).<br/></span>
                          )}
                          {invalidTables.length > 0 && !hasLegacy && (
                            <span><strong>Warning:</strong> Table <strong>{invalidTables.join(', ')}</strong> is not connected to this Node. Make sure you use the correct name from the <em>Available Inputs</em> list above.</span>
                          )}
                        </div>
                      </div>
                    );
                  }
                  return null;
                })()}
              </Field>
            </>
          );
        })()}

        {/* Sink */}
        {node.type === 'sink' && <>
          <Field label="Catalog">
            <input className="form-input" value={data.catalog || 'iceberg'} onChange={e => update('catalog', e.target.value)} placeholder="iceberg" />
          </Field>
          <Field label="Schema *">
            <select className="form-select" value={data.schema || ''} onChange={e => update('schema', e.target.value)}>
              <option value="" disabled>Select a schema...</option>
              {schemas.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </Field>
          <Field label="Table *">
            <select 
              className="form-select" 
              value={data.table || ''} 
              onChange={e => update('table', e.target.value)} 
              disabled={!data.schema}
            >
              <option value="" disabled>Select a table...</option>
              {tables.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
            <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 4 }}>
              Table must exist in the target schema. Create it first if it doesn't exist.
            </div>
          </Field>
          <Field label="Write Mode">
            <select className="form-select" value={data.write_mode || 'merge'} onChange={e => update('write_mode', e.target.value)}>
              {WRITE_MODES.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
          </Field>
          {(data.write_mode === 'merge' || !data.write_mode) && (
            <Field label="Merge Keys (for UPSERT)">
              {(() => {
                const mergeKeyCols = targetColumns.length > 0 ? targetColumns : availableColumns;
                return mergeKeyCols.length > 0 ? (
                  <div style={{ background: '#0f172a', border: '1px solid var(--border-color)', borderRadius: 6, maxHeight: 120, overflowY: 'auto', padding: 8 }}>
                    {mergeKeyCols.map(col => {
                      const currentlySelected = data.merge_keys ? data.merge_keys.some(k => k.toLowerCase() === col.toLowerCase()) : false
                      return (
                        <label key={col} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 6px', cursor: 'pointer', fontSize: 13, color: '#e2e8f0', borderRadius: 4, transition: 'background 0.2s' }} onMouseEnter={e => e.currentTarget.style.background = '#1e293b'} onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                          <input 
                            type="checkbox" 
                            checked={currentlySelected}
                            onChange={e => {
                              let newKeys = data.merge_keys ? [...data.merge_keys] : []
                              if (e.target.checked) newKeys.push(col)
                              else newKeys = newKeys.filter(c => c !== col)
                              update('merge_keys', newKeys)
                            }}
                          />
                          <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 12 }}>{col}</span>
                        </label>
                      )
                    })}
                  </div>
                ) : (
                  <input className="form-input" value={(data.merge_keys || []).join(', ')}
                    onChange={e => update('merge_keys', e.target.value.split(',').map(c => c.trim()).filter(Boolean))}
                    placeholder="id, user_id" />
                )
              })()}
              <div style={{ fontSize: 11, color: '#64748b', marginTop: 4 }}>Columns used to match existing rows in target table</div>
            </Field>
          )}

          {(targetColumns.length > 0 || availableColumns.length > 0) && (
            <Field label="Column Mapping (Target ← Source)">
              <div style={{ background: '#0f172a', border: '1px solid var(--border-color)', borderRadius: 6, padding: '8px 12px', maxHeight: 250, overflowY: 'auto' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, paddingBottom: 8, borderBottom: '1px solid var(--border-color)' }}>
                  <div style={{ display: 'flex', fontSize: 10, color: '#64748b', textTransform: 'uppercase', width: '100%' }}>
                    <div style={{ flex: 1 }}>Target Table Col</div>
                    <div style={{ flex: 1 }}>Input Pipeline Col</div>
                  </div>
                </div>
                
                <div style={{ marginBottom: 12 }}>
                  <button 
                    className="btn btn-secondary btn-sm"
                    onClick={() => {
                      const cols = targetColumns.length > 0 ? targetColumns : availableColumns;
                      const newMapping = {};
                      cols.forEach(col => {
                        const match = availableColumns.find(ac => ac.toLowerCase() === col.toLowerCase());
                        if (match) {
                          newMapping[col] = match;
                        }
                      });
                      update('column_mapping', newMapping);
                    }}
                    style={{ width: '100%', justifyContent: 'center' }}
                  >
                    <RefreshCw size={12} /> Auto-Map 1:1
                  </button>
                </div>

                {(() => {
                  const colsToRender = targetColumns.length > 0 ? targetColumns : availableColumns;
                  return colsToRender.map(tgtCol => {
                    const mappedKey = Object.keys(data.column_mapping || {}).find(k => k.toLowerCase() === tgtCol.toLowerCase());
                    const mappedSrc = mappedKey !== undefined ? data.column_mapping[mappedKey] : 'NULL';
                    return (
                      <div key={tgtCol} style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
                        <span style={{ flex: 1, fontFamily: 'JetBrains Mono', fontSize: 12, color: '#e2e8f0', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }} title={tgtCol}>{tgtCol}</span>
                      {availableColumns.length > 0 && availableColumns.includes(mappedSrc) || mappedSrc === 'NULL' || mappedSrc === undefined ? (
                        <select 
                          className="form-select" 
                          style={{ flex: 1, padding: '4px 8px', fontSize: 12, minWidth: 0 }}
                          value={mappedSrc === null ? 'NULL' : mappedSrc}
                          onChange={e => {
                            const mapping = { ...(data.column_mapping || {}) }
                            let val = e.target.value
                            if (val === 'NULL') val = null;
                            if (val === 'EXPRESSION') val = '';
                            mapping[tgtCol] = val
                            update('column_mapping', mapping)
                          }}
                        >
                          <option value="NULL">-- NULL --</option>
                          <option value="EXPRESSION">-- Custom Expression (Click to type manually) --</option>
                          {availableColumns.map(srcCol => <option key={srcCol} value={srcCol}>{srcCol}</option>)}
                        </select>
                      ) : (
                        <div style={{ flex: 1, display: 'flex', gap: 4 }}>
                          <input 
                            className="form-input" 
                            style={{ flex: 1, padding: '4px 8px', fontSize: 12, minWidth: 0 }}
                            value={mappedSrc === null ? '' : mappedSrc}
                            placeholder="Input Column Name"
                            onChange={e => {
                              const mapping = { ...(data.column_mapping || {}) }
                              mapping[tgtCol] = e.target.value
                              update('column_mapping', mapping)
                            }}
                          />
                          <button 
                            style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: 11 }}
                            onClick={() => {
                              const mapping = { ...(data.column_mapping || {}) }
                              mapping[tgtCol] = 'NULL'
                              update('column_mapping', mapping)
                            }}
                          >
                            X
                          </button>
                        </div>
                      )}
                    </div>
                  )
                });
              })()}
              </div>
            </Field>
          )}
        </>}
      </div>
    </div>
  )
}

function Field({ label, children }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: '#94a3b8', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 }}>
        {label}
      </label>
      {children}
    </div>
  )
}

const panelStyle = {
  width: 420,
  flexShrink: 0,
  background: 'var(--bg-secondary)',
  borderLeft: '1px solid var(--border-color)',
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
}

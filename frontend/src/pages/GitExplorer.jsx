import React, { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { GitBranch, Plus, Trash2, GitMerge, GitCommit, RefreshCw, Tag, CheckCircle, AlertTriangle, ExternalLink, Clock } from 'lucide-react'
import * as api from '../api/client'

export default function GitExplorer() {
  const [branches, setBranches] = useState([])
  const [tags, setTags] = useState([])
  const [pipelines, setPipelines] = useState([])
  const [selectedBranch, setSelectedBranch] = useState(null)
  const [log, setLog] = useState([])
  const [contents, setContents] = useState([])
  const [diffs, setDiffs] = useState([])
  const [showCreate, setShowCreate] = useState(false)
  const [showMerge, setShowMerge] = useState(false)
  const [showMRDetails, setShowMRDetails] = useState(false)
  const [activeTab, setActiveTab] = useState('overview')
  const [toast, setToast] = useState(null)
  const [confirmDialog, setConfirmDialog] = useState(null)
  const [newBranch, setNewBranch] = useState({ name: '', source_branch: 'main' })
  const [mergeForm, setMergeForm] = useState({ from_branch: '', to_branch: 'main', message: '' })
  
  const [commitFilter, setCommitFilter] = useState('24h') // all, today, 7d, 1m, custom
  const [customRange, setCustomRange] = useState({ start: '', end: '' })

  const showMessage = (msg, type = 'success') => {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 6000)
  }

  useEffect(() => { loadBranches(); loadTags(); loadPipelines(); }, [])

  async function loadPipelines() {
    try {
      const data = await api.listPipelines()
      setPipelines(data.pipelines || [])
    } catch (e) { console.error(e) }
  }

  async function loadBranches() {
    try {
      const data = await api.listBranches()
      setBranches(data.branches || [])
    } catch (e) { console.error(e) }
  }

  async function loadTags() {
    try {
      const data = await api.listTags()
      setTags(data.tags || [])
    } catch (e) { console.error(e) }
  }

  async function selectBranch(name) {
    setSelectedBranch(name)
    try {
      const pLog = api.getBranchLog(name);
      const pContents = api.getBranchContents(name);
      const pDiff = name !== 'main' ? api.diffBranches(name, 'main') : Promise.resolve({ diff: [] });
      
      const [logData, contentsData, diffData] = await Promise.all([pLog, pContents, pDiff])
      setLog(logData.log || [])
      setContents(contentsData.contents || [])
      setDiffs(diffData.diff || [])
    } catch (e) { console.error(e) }
  }

  async function handleCreateBranch() {
    try {
      await api.createBranch(newBranch)
      setShowCreate(false)
      setNewBranch({ name: '', source_branch: 'main' })
      loadBranches()
      showMessage('Branch created successfully!', 'success')
    } catch (e) { showMessage(e.message, 'error') }
  }

  const promptDeleteBranch = (name) => {
    setConfirmDialog({
      title: 'Confirm branch deletion',
      message: `Are you sure you want to delete branch "${name}"? This action cannot be undone.`,
      confirmLabel: 'Delete branch',
      confirmClass: 'btn-danger',
      action: () => handleDeleteBranch(name)
    });
  }

  async function handleDeleteBranch(name) {
    try {
      await api.deleteBranch(name)
      if (selectedBranch === name) setSelectedBranch(null)
      loadBranches()
      showMessage(`Deleted branch ${name}`, 'success')
    } catch (e) { showMessage(e.message, 'error') }
  }

  async function handleMerge() {
    try {
      await api.mergeBranches(mergeForm)
      setShowMerge(false)
      showMessage('Merged successfully!', 'success')
      loadBranches()
    } catch (e) { 
      if (e.message && e.message.includes('409 Conflict')) {
        showMessage('❌ MERGE CONFLICT:\n\nThe target branch (main) has been updated. Nessie cannot automatically merge due to overlapping data.\nPlease check the synchronization between branches.', 'error');
      } else {
        showMessage('Error: ' + e.message, 'error');
      }
    }
  }

  const promptApproveMR = (name) => {
    setConfirmDialog({
      title: 'Confirm Merge & Approve',
      message: `Data from pipeline "${name}" will be merged directly into the "main" branch.\n\nYour Production data state will be changed. This action cannot be undone.\nAre you sure you want to proceed?`,
      confirmLabel: 'Approve & Merge',
      confirmClass: 'btn-success',
      action: () => handleApproveMR(name)
    });
  }

  async function handleApproveMR(name) {
    try {
      await api.mergeBranches({ from_branch: name, to_branch: 'main', message: `Merge pipeline run: ${name}` })
      await api.deleteBranch(name)
      if (selectedBranch === name) setSelectedBranch(null)
      showMessage('Successfully merged data into main!', 'success')
      loadBranches()
    } catch (e) { 
      if (e.message && e.message.includes('409 Conflict')) {
        showMessage('❌ DATA CONFLICT (MERGE CONFLICT):\n\nThe main branch has been modified by another pipeline since this branch was created.\nNessie has automatically blocked this Merge action to prevent corrupting overlapping data.\n\n👉 Resolution: Please REJECT this branch, and re-run the Pipeline to fetch the latest data from main!', 'error');
      } else {
        showMessage('Merge error: ' + e.message, 'error');
      }
    }
  }

  const normalBranches = branches.filter(b => !b.name.startsWith('pipeline_'))
  const mrBranches = branches.filter(b => b.name.startsWith('pipeline_')).sort((a, b) => {
    // Branch format: pipeline_{timestamp}_{name}_run_{id} OR pipeline_{name}_run_{id}
    const partsA = a.name.split('_');
    const partsB = b.name.split('_');
    const timeA = (partsA.length > 2 && !isNaN(parseInt(partsA[1]))) ? parseInt(partsA[1]) : 0;
    const timeB = (partsB.length > 2 && !isNaN(parseInt(partsB[1]))) ? parseInt(partsB[1]) : 0;
    return timeB - timeA; // Newest first
  })
  const hasDeleted = diffs.some(d => !d.from && d.to)

  const filteredLog = log.filter(entry => {
    if (commitFilter === 'all') return true;
    if (!entry.commitMeta?.authorTime) return true;
    
    const commitDate = new Date(entry.commitMeta.authorTime);
    const now = new Date();
    
    if (commitFilter === '1h') {
      const boundary = new Date(now.getTime() - 1 * 60 * 60 * 1000);
      return commitDate >= boundary;
    }
    if (commitFilter === '6h') {
      const boundary = new Date(now.getTime() - 6 * 60 * 60 * 1000);
      return commitDate >= boundary;
    }
    if (commitFilter === '12h') {
      const boundary = new Date(now.getTime() - 12 * 60 * 60 * 1000);
      return commitDate >= boundary;
    }
    if (commitFilter === '24h') {
      const boundary = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      return commitDate >= boundary;
    }
    if (commitFilter === '7d') {
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(now.getDate() - 7);
      return commitDate >= sevenDaysAgo;
    }
    if (commitFilter === '1m') {
      const oneMonthAgo = new Date();
      oneMonthAgo.setMonth(now.getMonth() - 1);
      return commitDate >= oneMonthAgo;
    }
    if (commitFilter === 'custom') {
      if (customRange.start) {
        const start = new Date(customRange.start);
        if (commitDate < start) return false;
      }
      if (customRange.end) {
        const end = new Date(customRange.end);
        end.setHours(23, 59, 59, 999);
        if (commitDate > end) return false;
      }
      return true;
    }
    return true;
  });

  return (
    <>
      <div className="top-bar">
        <h1><GitBranch size={18} /> Git Explorer (Nessie)</h1>
        <div className="flex gap-2">
          <button className="btn btn-secondary btn-sm" onClick={loadBranches}><RefreshCw size={14} /></button>
          <button className="btn btn-secondary btn-sm" onClick={() => setShowMerge(true)}><GitMerge size={14} /> Merge</button>
          <button className="btn btn-primary btn-sm" onClick={() => setShowCreate(true)}><Plus size={14} /> Branch</button>
        </div>
      </div>
      <div className="page-container">
        <div style={{ display: 'grid', gridTemplateColumns: '300px 1fr', gap: '16px' }}>
          {/* Branches panel */}
          <div className="flex flex-col gap-3">
            <div className="card">
              <div className="card-header"><h2>Branches</h2></div>
              <div className="card-body" style={{ padding: '8px' }}>
                {normalBranches.map(b => (
                  <div key={b.name}
                    className={`sidebar-link ${selectedBranch === b.name ? 'active' : ''}`}
                    onClick={() => selectBranch(b.name)}
                  >
                    <GitBranch size={14} />
                    <span className="truncate" style={{ flex: 1 }}>{b.name}</span>
                    {b.name !== 'main' && (
                      <button className="btn btn-danger btn-sm" style={{ padding: '2px 6px' }} onClick={(e) => { e.stopPropagation(); promptDeleteBranch(b.name) }}><Trash2 size={10} /></button>
                    )}
                  </div>
                ))}
              </div>
            </div>
            {mrBranches.length > 0 && (
              <div className="card" style={{ borderColor: 'var(--accent-success)' }}>
                <div className="card-header" style={{ background: 'rgba(16, 185, 129, 0.1)' }}>
                  <h2 style={{ color: 'var(--accent-success)' }}>Merge Requests</h2>
                </div>
                <div className="card-body" style={{ padding: '8px', maxHeight: '300px', overflowY: 'auto' }}>
                  {mrBranches.map(b => {
                    // Extract human-readable name by stripping prefix and run_id
                    let displayName = b.name.replace('pipeline_', '');
                    let timestamp = null;
                    let runId = null;
                    const parts = b.name.split('_');
                    if (parts.length > 2 && !isNaN(parseInt(parts[1]))) {
                      // Has timestamp: pipeline_{timestamp}_{name}_run_{id}
                      timestamp = parseInt(parts[1]);
                      const runIndex = b.name.indexOf('_run_');
                      if (runIndex > -1) {
                        displayName = b.name.substring(`pipeline_${parts[1]}_`.length, runIndex);
                        runId = b.name.substring(runIndex + 5);
                      }
                    }
                    
                    const pipeline = pipelines.find(p => p.name.replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_|_$/g, '').toLowerCase() === displayName.toLowerCase());
                    const timeStr = timestamp ? new Date(timestamp * 1000).toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' }) : '';

                    return (
                      <div key={b.name}
                        className={`sidebar-link ${selectedBranch === b.name ? 'active' : ''}`}
                        style={{ 
                          borderLeft: selectedBranch === b.name ? '3px solid var(--accent-success)' : 'none',
                          flexDirection: 'column', 
                          alignItems: 'flex-start',
                          padding: '8px 12px',
                          cursor: 'pointer'
                        }}
                      >
                        <div className="flex align-center w-full" onClick={() => selectBranch(b.name)} style={{ width: '100%', justifyContent: 'space-between' }}>
                          <div className="flex align-center" style={{ overflow: 'hidden' }}>
                            <GitMerge size={14} style={{ color: 'var(--accent-success)', marginRight: '8px', flexShrink: 0 }} />
                            <span className="truncate" style={{ fontWeight: 500 }} title={b.name}>{displayName}</span>
                          </div>
                          {pipeline && (
                            <Link 
                              to={`/pipelines/${pipeline.id}?tab=runs`} 
                              onClick={e => e.stopPropagation()}
                              title="Jump to Pipeline Run"
                              style={{ color: 'var(--text-muted)' }}
                            >
                              <ExternalLink size={14} />
                            </Link>
                          )}
                        </div>
                        {(timeStr || runId) && (
                          <div className="flex align-center gap-2 text-xs text-muted" style={{ paddingLeft: '22px', marginTop: '4px' }} onClick={() => selectBranch(b.name)}>
                            {timeStr && <span className="flex align-center"><Clock size={10} style={{ marginRight: '4px' }}/> {timeStr}</span>}
                            {runId && <span>#{runId.substring(0, 8)}</span>}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
            <div className="card">
              <div className="card-header"><h2><Tag size={14} /> Tags</h2></div>
              <div className="card-body" style={{ padding: '8px' }}>
                {tags.length === 0 ? <p className="text-muted text-sm" style={{ padding: '8px' }}>No tags</p> : (
                  tags.map(t => (
                    <div key={t.name} className="sidebar-link">
                      <Tag size={14} />
                      <span>{t.name}</span>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>

          {/* Branch details */}
          <div className="flex flex-col gap-3">
            {selectedBranch ? (
              <>
                <div className="flex justify-between align-center" style={{ paddingBottom: '8px', borderBottom: '1px solid var(--border-color)' }}>
                  <h2 style={{ fontSize: '1.25rem', margin: 0 }}>
                    <GitBranch size={16} className="inline-block mr-2" style={{ verticalAlign: 'text-bottom' }} /> 
                    {selectedBranch}
                  </h2>
                  {selectedBranch.startsWith('pipeline_') && (
                    <div className="flex gap-2">
                      <button 
                        className="btn btn-sm" 
                        style={{ 
                          background: hasDeleted ? 'var(--border-color)' : 'var(--accent-success)', 
                          color: hasDeleted ? 'var(--text-muted)' : '#fff',
                          cursor: hasDeleted ? 'not-allowed' : 'pointer',
                          opacity: hasDeleted ? 0.6 : 1
                        }} 
                        onClick={() => { if (!hasDeleted) promptApproveMR(selectedBranch) }}
                        title={hasDeleted ? "Locked because a DROP table command was detected." : ""}
                        disabled={hasDeleted}
                      >
                        Approve & Merge
                      </button>
                      <button className="btn btn-danger btn-sm" onClick={() => promptDeleteBranch(selectedBranch)}>
                        Reject
                      </button>
                    </div>
                  )}
                </div>

                {selectedBranch.startsWith('pipeline_') && hasDeleted && (
                  <div style={{ background: 'rgba(239, 68, 68, 0.15)', borderLeft: '4px solid var(--accent-danger)', padding: '12px 16px', marginBottom: '12px', borderRadius: '0 var(--radius-sm) var(--radius-sm) 0', color: 'var(--text-primary)', fontSize: '0.9rem' }}>
                    <div className="flex align-center gap-2 mb-1">
                      <Trash2 size={16} color="var(--accent-danger)" />
                      <strong style={{ color: 'var(--accent-danger)' }}>Dangerous action blocked!</strong>
                    </div>
                    <p style={{ margin: 0, opacity: 0.9 }}>This Merge Request contains a Drop request! The system has automatically disabled the Merge feature to protect the data on the <code style={{color: 'var(--accent-danger)'}}>main</code> branch. You can only Reject this request.</p>
                  </div>
                )}

                <div className="flex gap-2 mb-2">
                  <button className={`btn btn-sm ${activeTab === 'overview' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setActiveTab('overview')}>Overview</button>
                  <button className={`btn btn-sm ${activeTab === 'commits' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setActiveTab('commits')}>Commit Log</button>
                </div>

                {activeTab === 'overview' && (
                  <>
                    {/* Diff summary vs main */}
                    {selectedBranch !== 'main' && (
                      <div className="card">
                        <div className="card-header"><h2>Changes compared to "main"</h2></div>
                        <div className="card-body">
                          {diffs.length === 0 ? (
                            <p className="text-muted text-sm">No data changes.</p>
                          ) : (
                            <div className="flex flex-col gap-2">
                              {diffs.map((d, i) => {
                                const tableName = d.key?.elements?.join('.') || 'Unknown';
                                let status = 'Unknown';
                                let color = 'var(--text-muted)';
                                let icon = <GitCommit size={14} />;
                                let badgeClass = '';
                                
                                if (d.from && !d.to) {
                                  status = 'Added';
                                  color = 'var(--accent-success)';
                                  icon = <Plus size={14} color={color} />;
                                  badgeClass = 'badge-success';
                                } else if (!d.from && d.to) {
                                  status = 'Deleted';
                                  color = 'var(--accent-danger)';
                                  icon = <Trash2 size={14} color={color} />;
                                  badgeClass = 'badge-danger';
                                } else if (d.from && d.to) {
                                  status = 'Modified';
                                  color = 'var(--accent-warning)';
                                  icon = <GitCommit size={14} color={color} />;
                                  badgeClass = 'badge-warning';
                                }
                                
                                return (
                                  <div key={i} className="flex justify-between align-center" style={{ padding: '8px 12px', borderLeft: `3px solid ${color}`, background: 'var(--bg-glass)', borderRadius: '0 var(--radius-sm) var(--radius-sm) 0' }}>
                                    <div className="flex gap-2 align-center">
                                      {icon}
                                      <span className="font-mono text-sm">{tableName}</span>
                                    </div>
                                    <div>
                                      <span className={`badge ${badgeClass}`}>{status}</span>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      </div>
                    )}

                    {/* Contents */}
                    <div className="card">
                      <div className="card-header">
                        <h2>All Objects on branch</h2>
                      </div>
                      <div className="card-body">
                        {contents.length === 0 ? (
                          <p className="text-muted text-sm">No objects</p>
                        ) : (
                          <div className="table-container">
                            <table>
                              <thead><tr><th>Name</th><th>Type</th></tr></thead>
                              <tbody>
                                {contents.map((c, i) => (
                                  <tr key={i}>
                                    <td className="font-mono text-sm">{c.name?.elements?.join('.') || JSON.stringify(c.name)}</td>
                                    <td><span className="badge badge-info">{c.type}</span></td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>
                    </div>
                  </>
                )}

                {activeTab === 'commits' && (
                  <div className="card">
                    <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <h2 style={{ display: 'flex', alignItems: 'center', gap: '8px', margin: 0, fontSize: '1.1rem' }}>
                        <GitCommit size={16} /> Commit Log
                      </h2>
                      <div className="flex gap-2 align-center">
                        <select 
                          className="form-select" 
                          style={{ padding: '6px 12px', background: 'var(--bg-glass)', border: '1px solid var(--border-color)', borderRadius: '6px', color: '#e2e8f0', fontSize: '13px', outline: 'none' }}
                          value={commitFilter}
                          onChange={(e) => setCommitFilter(e.target.value)}
                        >
                          <option value="all">All time</option>
                          <option value="1h">Last 1 hour</option>
                          <option value="6h">Last 6 hours</option>
                          <option value="12h">Last 12 hours</option>
                          <option value="24h">Last 24 hours</option>
                          <option value="7d">Last 7 days</option>
                          <option value="1m">Last 1 month</option>
                          <option value="custom">Custom range...</option>
                        </select>
                        {commitFilter === 'custom' && (
                          <div className="flex gap-2 align-center">
                            <input 
                               type="date" 
                               style={{ padding: '5px 10px', background: 'var(--bg-glass)', border: '1px solid var(--border-color)', borderRadius: '6px', color: '#e2e8f0', fontSize: '13px', colorScheme: 'dark' }}
                               value={customRange.start} 
                               onChange={e => setCustomRange({...customRange, start: e.target.value})} 
                            />
                            <span style={{ color: 'var(--text-muted)' }}>-</span>
                            <input 
                               type="date" 
                               style={{ padding: '5px 10px', background: 'var(--bg-glass)', border: '1px solid var(--border-color)', borderRadius: '6px', color: '#e2e8f0', fontSize: '13px', colorScheme: 'dark' }}
                               value={customRange.end} 
                               onChange={e => setCustomRange({...customRange, end: e.target.value})} 
                            />
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="card-body">
                      {filteredLog.length === 0 ? (
                        <div style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--text-muted)' }}>
                           <Clock size={24} style={{ margin: '0 auto 12px', opacity: 0.5 }} />
                           <p>No commits found matching the filter criteria.</p>
                        </div>
                      ) : (
                        <div className="flex flex-col gap-2">
                          {filteredLog.map((entry, i) => {
                            // Format the authorTime to be more readable
                            let timeStr = 'No timestamp';
                            if (entry.commitMeta?.authorTime) {
                              try {
                                timeStr = new Date(entry.commitMeta.authorTime).toLocaleString('vi-VN', {
                                  day: '2-digit', month: '2-digit', year: 'numeric',
                                  hour: '2-digit', minute: '2-digit', second: '2-digit'
                                });
                              } catch(e) {
                                timeStr = entry.commitMeta.authorTime;
                              }
                            }
                            return (
                              <div key={i} style={{ padding: '12px 16px', borderLeft: '3px solid var(--accent-primary)', background: 'var(--bg-glass)', borderRadius: '0 var(--radius-sm) var(--radius-sm) 0', boxShadow: 'var(--shadow-sm)' }}>
                                <div className="text-sm" style={{ fontWeight: 600, color: '#f8fafc', marginBottom: 6 }}>{entry.commitMeta?.message || 'No message'}</div>
                                <div className="text-xs text-muted flex gap-3 align-center">
                                  <span style={{ display: 'flex', alignItems: 'center', gap: '4px', fontFamily: 'monospace', color: '#94a3b8' }}>
                                    <Tag size={12} /> {entry.commitMeta?.hash?.slice(0, 12)}
                                  </span>
                                  <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                    <Clock size={12} /> {timeStr}
                                  </span>
                                </div>
                              </div>
                            )
                          })}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </>
            ) : (
              <div className="card"><div className="card-body"><div className="empty-state"><GitBranch size={40} /><h3>Select a branch</h3><p>Select a branch from the left panel to view details</p></div></div></div>
            )}
          </div>
        </div>

        {/* Create Branch Modal */}
        {showCreate && (
          <div className="modal-overlay" onClick={() => setShowCreate(false)}>
            <div className="modal" onClick={e => e.stopPropagation()}>
              <div className="modal-header"><h2>Create new Branch</h2></div>
              <div className="modal-body">
                <div className="form-group">
                  <label className="form-label">Branch name</label>
                  <input className="form-input" placeholder="feature/add-silver-tables" value={newBranch.name} onChange={e => setNewBranch({ ...newBranch, name: e.target.value })} />
                </div>
                <div className="form-group">
                  <label className="form-label">Create from branch</label>
                  <select className="form-select" value={newBranch.source_branch} onChange={e => setNewBranch({ ...newBranch, source_branch: e.target.value })}>
                    {branches.map(b => <option key={b.name} value={b.name}>{b.name}</option>)}
                  </select>
                </div>
              </div>
              <div className="modal-footer">
                <button className="btn btn-secondary" onClick={() => setShowCreate(false)}>Cancel</button>
                <button className="btn btn-primary" onClick={handleCreateBranch}>Create Branch</button>
              </div>
            </div>
          </div>
        )}

        {/* Merge Modal */}
        {showMerge && (
          <div className="modal-overlay" onClick={() => setShowMerge(false)}>
            <div className="modal" onClick={e => e.stopPropagation()}>
              <div className="modal-header"><h2>Merge Branches</h2></div>
              <div className="modal-body">
                <div className="form-group">
                  <label className="form-label">From branch</label>
                  <select className="form-select" value={mergeForm.from_branch} onChange={e => setMergeForm({ ...mergeForm, from_branch: e.target.value })}>
                    <option value="">-- Select --</option>
                    {branches.map(b => <option key={b.name} value={b.name}>{b.name}</option>)}
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">To branch</label>
                  <select className="form-select" value={mergeForm.to_branch} onChange={e => setMergeForm({ ...mergeForm, to_branch: e.target.value })}>
                    {branches.map(b => <option key={b.name} value={b.name}>{b.name}</option>)}
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">Commit message</label>
                  <input className="form-input" placeholder="Merge feature branch" value={mergeForm.message} onChange={e => setMergeForm({ ...mergeForm, message: e.target.value })} />
                </div>
              </div>
              <div className="modal-footer">
                <button className="btn btn-secondary" onClick={() => setShowMerge(false)}>Cancel</button>
                <button className="btn btn-primary" onClick={handleMerge}><GitMerge size={14} /> Merge</button>
              </div>
            </div>
          </div>
        )}

        {/* Generic Confirm Modal */}
        {confirmDialog && (
          <div className="modal-overlay" onClick={() => setConfirmDialog(null)} style={{ zIndex: 10000 }}>
            <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: '420px' }}>
              <div className="modal-header">
                <h2 style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  {confirmDialog.confirmClass === 'btn-success' ? <GitMerge size={18} color="var(--accent-success)" /> : <AlertTriangle size={18} color="var(--accent-danger)" />}
                  {confirmDialog.title}
                </h2>
              </div>
              <div className="modal-body">
                <p style={{ margin: 0, lineHeight: 1.6, whiteSpace: 'pre-wrap', color: 'var(--text-primary)' }}>{confirmDialog.message}</p>
              </div>
              <div className="modal-footer">
                <button className="btn btn-secondary" onClick={() => setConfirmDialog(null)}>Cancel</button>
                <button 
                  className={`btn ${confirmDialog.confirmClass || 'btn-primary'}`} 
                  style={confirmDialog.confirmClass === 'btn-success' ? { background: 'var(--accent-success)', color: '#fff' } : {}}
                  onClick={() => {
                    confirmDialog.action();
                    setConfirmDialog(null);
                  }}
                >
                  {confirmDialog.confirmLabel || 'Confirm'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Toast Notification positioned absolutely */}
      {toast && (
        <div style={{
          position: 'fixed',
          bottom: '20px',
          right: '20px',
          zIndex: 9999,
          background: toast.type === 'success' ? 'rgba(5, 46, 22, 0.95)' : 'rgba(69, 10, 10, 0.95)',
          border: `1px solid ${toast.type === 'success' ? 'rgba(34, 197, 94, 0.3)' : 'rgba(239, 68, 68, 0.3)'}`,
          color: toast.type === 'success' ? '#4ade80' : '#fca5a5',
          padding: '16px 20px',
          borderRadius: '8px',
          boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.5), 0 8px 10px -6px rgba(0, 0, 0, 0.3)',
          display: 'flex',
          alignItems: 'baseline',
          gap: '12px',
          maxWidth: '450px',
          backdropFilter: 'blur(10px)',
          animation: 'slideIn 0.3s ease-out forwards'
        }}>
          <div>{toast.type === 'success' ? <CheckCircle size={18} /> : <AlertTriangle size={18} />}</div>
          <div style={{ fontSize: '0.95rem', whiteSpace: 'pre-wrap', lineHeight: '1.4' }}>{toast.msg}</div>
        </div>
      )}
      <style>{`
        @keyframes slideIn {
          from { transform: translateX(100%); opacity: 0; }
          to { transform: translateX(0); opacity: 1; }
        }
      `}</style>
    </>
  )
}

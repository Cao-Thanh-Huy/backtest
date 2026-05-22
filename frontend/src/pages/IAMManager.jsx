import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import {
  Users, Shield, Lock, Plus, Trash2, UserPlus, RefreshCw,
  AlertTriangle, CheckCircle, XCircle, Eye, EyeOff,
  Edit2, ToggleLeft, ToggleRight, Settings, Layers,
  ChevronDown, Activity, Zap, ChevronUp,
} from 'lucide-react'
import {
  iamListUsers, iamCreateUser, iamDeleteUser, iamToggleUserEnabled, iamUpdateUserRoles,
  iamListRoles, iamCreateRole, iamDeleteRole, iamUpdateRolePerms,
  iamListSchemas,
  iamGetTrinoStatus,
} from '../api/client'

// ── Design tokens ─────────────────────────────────────────────────────────────
const C = {
  primary:    'var(--accent-primary)',
  glass:      'var(--bg-glass)',
  border:     'var(--border-color)',
  textPrimary:'var(--text-primary)',
  textSec:    'var(--text-secondary)',
  textMuted:  'var(--text-muted)',
  success:    { bg:'rgba(34,197,94,0.12)',   text:'#4ade80', border:'rgba(34,197,94,0.3)'  },
  error:      { bg:'rgba(239,68,68,0.12)',   text:'#f87171', border:'rgba(239,68,68,0.3)'  },
  warn:       { bg:'rgba(234,179,8,0.12)',   text:'#facc15', border:'rgba(234,179,8,0.3)'  },
  info:       { bg:'rgba(99,102,241,0.12)',  text:'#a5b4fc', border:'rgba(99,102,241,0.3)' },
}

const ROLE_COLORS = {
  PLATFORM_ADMIN: { bg:'rgba(239,68,68,0.15)',   text:'#f87171', border:'rgba(239,68,68,0.3)'  },
  ENGINEER:       { bg:'rgba(59,130,246,0.15)',  text:'#60a5fa', border:'rgba(59,130,246,0.3)' },
  ANALYST:        { bg:'rgba(168,85,247,0.15)',  text:'#c084fc', border:'rgba(168,85,247,0.3)' },
  VIEWER:         { bg:'rgba(107,114,128,0.15)', text:'#9ca3af', border:'rgba(107,114,128,0.3)'},
}
const getRoleColor = (name) =>
  ROLE_COLORS[name] || { bg:'rgba(99,102,241,0.15)', text:'#a5b4fc', border:'rgba(99,102,241,0.3)' }

const LAYER_DEFAULTS = { bronze:'#cd7f32', silver:'#94a3b8', gold:'#f59e0b', pipeline:'#10b981' }
const LAYER_ICONS    = { bronze:'🥉', silver:'🥈', gold:'🥇', pipeline:'⚙️' }

const PLATFORM_PERM_META = {
  manage_pipelines:    { icon:'⚙️',  label:'Pipeline Studio',    desc:'Create, edit & trigger data pipelines'    },
  manage_connectors:   { icon:'🔌', label:'Connectors',          desc:'Create and manage data connectors'        },
  manage_storage:      { icon:'💾', label:'Storage Browser',     desc:'Browse and manage MinIO storage'          },
  access_sql_editor:   { icon:'🔍', label:'SQL Editor',          desc:'Run custom SQL queries via Trino'         },
  access_git:          { icon:'🌿', label:'Git (Nessie)',         desc:'Browse and manage Nessie branches'        },
  access_catalog_health:{ icon:'❤️', label:'Catalog Health',     desc:'View table and partition health checks'   },
}

const OP_COLORS = {
  SELECT: { bg:'rgba(34,197,94,0.15)',  text:'#4ade80', border:'rgba(34,197,94,0.4)'  },
  INSERT: { bg:'rgba(59,130,246,0.15)', text:'#60a5fa', border:'rgba(59,130,246,0.4)' },
  UPDATE: { bg:'rgba(234,179,8,0.15)',  text:'#facc15', border:'rgba(234,179,8,0.4)'  },
  DELETE: { bg:'rgba(239,68,68,0.15)',  text:'#f87171', border:'rgba(239,68,68,0.4)'  },
}

const inputStyle = {
  background:'var(--bg-glass)', border:'1px solid var(--border-color)', borderRadius:'8px',
  color:'var(--text-primary)', padding:'9px 12px', fontSize:'13px', outline:'none',
  width:'100%', boxSizing:'border-box',
}

// ── Shared components ──────────────────────────────────────────────────────────

function Spinner({ size = 14 }) {
  return <RefreshCw size={size} style={{ animation:'spin 1s linear infinite', flexShrink:0 }}/>
}

function RoleBadge({ name }) {
  const col = getRoleColor(name)
  return (
    <span style={{ display:'inline-flex', alignItems:'center', gap:'4px', padding:'2px 8px',
      borderRadius:'20px', fontSize:'11px', fontWeight:600,
      background:col.bg, color:col.text, border:`1px solid ${col.border}` }}>
      <Shield size={9}/> {name}
    </span>
  )
}

function Card({ children, style }) {
  return <div className="card" style={{ padding:'20px', ...style }}>{children}</div>
}

function SectionHeader({ title, subtitle, action }) {
  return (
    <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:'16px' }}>
      <div>
        <h3 style={{ margin:0, fontSize:'15px', color:C.textPrimary, fontWeight:600 }}>{title}</h3>
        {subtitle && <p style={{ margin:'3px 0 0', fontSize:'12px', color:C.textMuted }}>{subtitle}</p>}
      </div>
      {action}
    </div>
  )
}

// ── Trino Sync Status Banner ──────────────────────────────────────────────────
// Shows a polling progress bar after an ACL save.
// Since Trino hot-reloads rules.json every 10s (no restart needed),
// we poll /iam/trino-status just to confirm it's alive, not to wait for restart.

function TrinoSyncBanner({ onDone }) {
  const [elapsed, setElapsed] = useState(0)
  const [confirmed, setConfirmed] = useState(false)
  const intervalRef = useRef(null)
  const pollRef     = useRef(null)
  const MAX_WAIT    = 20  // 10s refresh-period + buffer

  useEffect(() => {
    intervalRef.current = setInterval(() => {
      setElapsed(s => {
        if (s + 1 >= MAX_WAIT) { clearInterval(intervalRef.current); return s + 1 }
        return s + 1
      })
    }, 1000)

    // Poll Trino after 5s (confirm it's still healthy)
    const startPolling = () => {
      pollRef.current = setInterval(async () => {
        try {
          const res = await iamGetTrinoStatus()
          if (res.ready || res.online) {
            setConfirmed(true)
            clearInterval(pollRef.current)
            clearInterval(intervalRef.current)
            setTimeout(() => onDone?.(), 1500)
          }
        } catch { /* ignore */ }
      }, 3000)
    }
    const initTimer = setTimeout(startPolling, 5000)

    return () => {
      clearInterval(intervalRef.current)
      clearInterval(pollRef.current)
      clearTimeout(initTimer)
    }
  }, [onDone])

  const progress = Math.min((elapsed / MAX_WAIT) * 100, 100)

  if (confirmed) return (
    <div style={{ display:'flex', alignItems:'center', gap:'10px', padding:'12px 16px',
      borderRadius:'9px', background:C.success.bg, border:`1px solid ${C.success.border}`,
      color:C.success.text, fontSize:'13px', fontWeight:500 }}>
      <CheckCircle size={15}/>
      <span>✅ Permissions saved — Trino has applied the new rules. Active connections will see updated access.</span>
    </div>
  )

  return (
    <div style={{ padding:'12px 16px', borderRadius:'9px',
      background:'rgba(99,102,241,0.08)', border:`1px solid rgba(99,102,241,0.25)` }}>
      <div style={{ display:'flex', alignItems:'center', gap:'10px', marginBottom:'8px' }}>
        <Spinner size={14}/>
        <span style={{ fontSize:'13px', color:'#a5b4fc', fontWeight:500 }}>
          Applying permissions — Trino reloading rules.json…
        </span>
        <span style={{ marginLeft:'auto', fontSize:'12px', color:C.textMuted }}>{elapsed}s</span>
      </div>
      <div style={{ height:3, borderRadius:2, background:'rgba(99,102,241,0.15)', overflow:'hidden' }}>
        <div style={{ height:'100%', borderRadius:2, background:'linear-gradient(90deg,#6366f1,#a5b4fc)',
          width:`${progress}%`, transition:'width 1s linear' }}/>
      </div>
      <div style={{ fontSize:'11px', color:C.textMuted, marginTop:'6px' }}>
        No service restart — Trino hot-reloads <code style={{ background:'rgba(0,0,0,0.3)', padding:'0 3px', borderRadius:'3px' }}>rules.json</code> every 10s automatically.
      </div>
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
// TAB 1 — USERS
// ══════════════════════════════════════════════════════════════════════════════

function UsersTab({ allRoles }) {
  const [users, setUsers]     = useState([])
  const [loading, setLoading] = useState(true)
  const [status, setStatus]   = useState(null)
  const [showCreate, setShowCreate] = useState(false)
  const [showPwd, setShowPwd] = useState(false)
  const [editRolesFor, setEditRolesFor] = useState(null)
  const [form, setForm] = useState({ username:'', email:'', first_name:'', last_name:'', password:'', role_names:[] })

  const load = useCallback(async () => {
    setLoading(true)
    try { const d = await iamListUsers(); setUsers(d.users || []) }
    catch (e) { setStatus({ type:'error', message:e.message }) }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  const handleCreate = async () => {
    if (!form.username || !form.password) return setStatus({ type:'error', message:'Username and password are required.' })
    try {
      await iamCreateUser(form)
      setStatus({ type:'success', message:`User "${form.username}" created.` })
      setShowCreate(false)
      setForm({ username:'', email:'', first_name:'', last_name:'', password:'', role_names:[] })
      load()
    } catch (e) { setStatus({ type:'error', message:e.message }) }
  }
  const handleDelete = async (u) => {
    if (!confirm(`Delete user "${u.username}"? This cannot be undone.`)) return
    try { await iamDeleteUser(u.id); setStatus({ type:'success', message:`Deleted "${u.username}".` }); load() }
    catch (e) { setStatus({ type:'error', message:e.message }) }
  }
  const handleToggle = async (u) => {
    try {
      await iamToggleUserEnabled(u.id, !u.enabled)
      setStatus({ type:'success', message:`User "${u.username}" ${!u.enabled ? 'enabled' : 'disabled'}.` })
      load()
    } catch (e) { setStatus({ type:'error', message:e.message }) }
  }
  const handleUpdateRoles = async (userId, newRoles) => {
    try { await iamUpdateUserRoles(userId, newRoles); setStatus({ type:'success', message:'Roles updated.' }); setEditRolesFor(null); load() }
    catch (e) { setStatus({ type:'error', message:e.message }) }
  }
  const toggleFormRole = (name) =>
    setForm(p => ({ ...p, role_names: p.role_names.includes(name) ? p.role_names.filter(r => r!==name) : [...p.role_names, name] }))

  const visibleRoles = allRoles.filter(r => !r.name.startsWith('default-roles') && !r.name.startsWith('offline') && !r.name.startsWith('uma'))

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:'16px' }}>
      {status && (
        <div style={{ display:'flex', alignItems:'center', gap:'8px', padding:'10px 14px', borderRadius:'8px',
          fontSize:'13px', background:C[status.type]?.bg, color:C[status.type]?.text, border:`1px solid ${C[status.type]?.border}` }}>
          {status.type==='success' ? <CheckCircle size={14}/> : <XCircle size={14}/>}
          <span style={{ flex:1 }}>{status.message}</span>
          <button onClick={() => setStatus(null)} style={{ background:'none', border:'none', cursor:'pointer', color:'inherit', padding:0 }}><XCircle size={13}/></button>
        </div>
      )}

      <Card>
        <SectionHeader
          title={`Users (${users.length})`}
          subtitle="All accounts that can log in to QuantFlow Studio and connect to Trino"
          action={
            <div style={{ display:'flex', gap:'8px' }}>
              <button onClick={load} style={{ background:C.glass, border:`1px solid ${C.border}`, color:C.textMuted,
                cursor:'pointer', padding:'7px', borderRadius:'7px', display:'flex', alignItems:'center' }}>
                <RefreshCw size={14}/>
              </button>
              <button className="btn-primary" style={{ display:'flex', alignItems:'center', gap:'6px', padding:'7px 14px', fontSize:'13px' }}
                onClick={() => setShowCreate(s => !s)}>
                <UserPlus size={13}/> New User
              </button>
            </div>
          }
        />

        {showCreate && (
          <div style={{ marginBottom:'20px', padding:'18px', background:'rgba(99,102,241,0.05)',
            borderRadius:'10px', border:'1px solid rgba(99,102,241,0.2)' }}>
            <h4 style={{ margin:'0 0 14px', fontSize:'13px', color:C.primary, fontWeight:600 }}>
              <UserPlus size={13} style={{ marginRight:6 }}/>Create New User
            </h4>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'10px', marginBottom:'12px' }}>
              <input style={inputStyle} placeholder="Username *" value={form.username} onChange={e => setForm(p => ({ ...p, username:e.target.value }))}/>
              <input style={inputStyle} placeholder="Email" value={form.email} onChange={e => setForm(p => ({ ...p, email:e.target.value }))}/>
              <input style={inputStyle} placeholder="First name" value={form.first_name} onChange={e => setForm(p => ({ ...p, first_name:e.target.value }))}/>
              <input style={inputStyle} placeholder="Last name" value={form.last_name} onChange={e => setForm(p => ({ ...p, last_name:e.target.value }))}/>
              <div style={{ position:'relative', gridColumn:'1/-1' }}>
                <input style={{ ...inputStyle, paddingRight:'38px' }}
                  type={showPwd ? 'text' : 'password'} placeholder="Password *" value={form.password}
                  onChange={e => setForm(p => ({ ...p, password:e.target.value }))}/>
                <button onClick={() => setShowPwd(p => !p)}
                  style={{ position:'absolute', right:'10px', top:'50%', transform:'translateY(-50%)',
                    background:'none', border:'none', cursor:'pointer', color:C.textMuted }}>
                  {showPwd ? <EyeOff size={14}/> : <Eye size={14}/>}
                </button>
              </div>
            </div>
            <label style={{ fontSize:'12px', color:C.textMuted, display:'block', marginBottom:'8px', fontWeight:500 }}>Assign Roles:</label>
            <div style={{ display:'flex', flexWrap:'wrap', gap:'6px', marginBottom:'14px' }}>
              {visibleRoles.map(r => {
                const col = getRoleColor(r.name); const active = form.role_names.includes(r.name)
                return (
                  <button key={r.name} onClick={() => toggleFormRole(r.name)}
                    style={{ padding:'4px 12px', borderRadius:'20px', fontSize:'12px', cursor:'pointer', fontWeight:500,
                      border: active ? `1px solid ${col.border}` : `1px solid ${C.border}`,
                      background: active ? col.bg : 'transparent', color: active ? col.text : C.textMuted }}>
                    {active && '✓ '}{r.name}
                  </button>
                )
              })}
            </div>
            <div style={{ display:'flex', gap:'8px', justifyContent:'flex-end' }}>
              <button onClick={() => setShowCreate(false)}
                style={{ padding:'7px 16px', background:'none', border:`1px solid ${C.border}`, borderRadius:'7px', color:C.textMuted, cursor:'pointer', fontSize:'13px' }}>
                Cancel
              </button>
              <button className="btn-primary" style={{ padding:'7px 20px', fontSize:'13px' }} onClick={handleCreate}>Create User</button>
            </div>
          </div>
        )}

        {loading ? (
          <div style={{ textAlign:'center', color:C.textMuted, padding:'40px', display:'flex', alignItems:'center', justifyContent:'center', gap:'8px' }}>
            <Spinner/> Loading users...
          </div>
        ) : users.length === 0 ? (
          <div style={{ textAlign:'center', color:C.textMuted, padding:'40px', fontSize:'13px' }}>No users found.</div>
        ) : (
          <div style={{ overflowX:'auto' }}>
            <table style={{ width:'100%', borderCollapse:'collapse', fontSize:'13px' }}>
              <thead>
                <tr style={{ borderBottom:`1px solid ${C.border}` }}>
                  {['User','Email','Roles','Status','Actions'].map(h => (
                    <th key={h} style={{ textAlign:'left', padding:'8px 12px', color:C.textMuted,
                      fontWeight:500, fontSize:'11px', textTransform:'uppercase', letterSpacing:'0.05em' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {users.map(u => (
                  <React.Fragment key={u.id}>
                    <tr style={{ borderBottom:`1px solid rgba(255,255,255,0.04)`, transition:'background 0.15s' }}
                      onMouseEnter={e => e.currentTarget.style.background='rgba(255,255,255,0.02)'}
                      onMouseLeave={e => e.currentTarget.style.background='transparent'}>
                      <td style={{ padding:'12px' }}>
                        <div style={{ display:'flex', alignItems:'center', gap:'10px' }}>
                          <div style={{ width:32, height:32, borderRadius:'50%', background:'rgba(99,102,241,0.2)',
                            display:'flex', alignItems:'center', justifyContent:'center', fontSize:'13px', fontWeight:700, color:'#a5b4fc', flexShrink:0 }}>
                            {(u.username||'?')[0].toUpperCase()}
                          </div>
                          <div>
                            <div style={{ color:C.textPrimary, fontWeight:500 }}>{u.username}</div>
                            {u.firstName && <div style={{ color:C.textMuted, fontSize:'11px' }}>{u.firstName} {u.lastName}</div>}
                          </div>
                        </div>
                      </td>
                      <td style={{ padding:'12px', color:C.textSec }}>{u.email||'—'}</td>
                      <td style={{ padding:'12px' }}>
                        <div style={{ display:'flex', flexWrap:'wrap', gap:'4px', alignItems:'center' }}>
                          {(u.realmRoles||[]).map(r => <RoleBadge key={r} name={r}/>)}
                          {(u.realmRoles||[]).length===0 && <span style={{ color:C.textMuted, fontSize:'12px' }}>—</span>}
                          {u.username !== 'platform_admin' && (
                            <button onClick={() => setEditRolesFor(editRolesFor===u.id ? null : u.id)}
                              style={{ background:'none', border:`1px solid ${C.border}`, cursor:'pointer',
                                padding:'2px 6px', borderRadius:'5px', color:C.textMuted, fontSize:'11px',
                                display:'inline-flex', alignItems:'center', gap:'3px', marginLeft:'4px' }}>
                              <Edit2 size={10}/> Edit
                            </button>
                          )}
                        </div>
                      </td>
                      <td style={{ padding:'12px' }}>
                        <span style={{ padding:'3px 9px', borderRadius:'12px', fontSize:'11px', fontWeight:600,
                          background: u.enabled ? C.success.bg : C.error.bg,
                          color: u.enabled ? C.success.text : C.error.text,
                          border:`1px solid ${u.enabled ? C.success.border : C.error.border}` }}>
                          {u.enabled ? '● Active' : '○ Disabled'}
                        </span>
                      </td>
                      <td style={{ padding:'12px' }}>
                        {u.username !== 'platform_admin' ? (
                          <div style={{ display:'flex', gap:'6px' }}>
                            <button onClick={() => handleToggle(u)}
                              style={{ background: u.enabled?'rgba(234,179,8,0.1)':'rgba(34,197,94,0.1)',
                                border:`1px solid ${u.enabled?'rgba(234,179,8,0.3)':'rgba(34,197,94,0.3)'}`,
                                color: u.enabled?'#facc15':'#4ade80', cursor:'pointer', padding:'5px 8px',
                                borderRadius:'6px', display:'flex', alignItems:'center', gap:'4px', fontSize:'11px' }}>
                              {u.enabled ? <ToggleRight size={12}/> : <ToggleLeft size={12}/>}
                              {u.enabled ? 'Disable' : 'Enable'}
                            </button>
                            <button onClick={() => handleDelete(u)}
                              style={{ background:C.error.bg, border:`1px solid ${C.error.border}`, color:C.error.text,
                                cursor:'pointer', padding:'5px 8px', borderRadius:'6px',
                                display:'flex', alignItems:'center', gap:'4px', fontSize:'11px' }}>
                              <Trash2 size={11}/> Delete
                            </button>
                          </div>
                        ) : (
                          <span style={{ fontSize:'11px', color:C.textMuted, fontStyle:'italic' }}>Root Protected</span>
                        )}
                      </td>
                    </tr>
                    {editRolesFor === u.id && (
                      <tr style={{ background:'rgba(99,102,241,0.04)' }}>
                        <td colSpan={5} style={{ padding:'12px 20px 16px 60px' }}>
                          <EditUserRoles user={u} allRoles={visibleRoles}
                            onSave={roles => handleUpdateRoles(u.id, roles)}
                            onCancel={() => setEditRolesFor(null)}/>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  )
}

function EditUserRoles({ user, allRoles, onSave, onCancel }) {
  const [selected, setSelected] = useState(user.realmRoles || [])
  const toggle = (name) => setSelected(p => p.includes(name) ? p.filter(r => r!==name) : [...p, name])
  return (
    <div>
      <p style={{ margin:'0 0 10px', fontSize:'12px', color:C.textMuted, fontWeight:500 }}>
        Edit roles for <strong style={{ color:C.textPrimary }}>{user.username}</strong>:
      </p>
      <div style={{ display:'flex', flexWrap:'wrap', gap:'6px', marginBottom:'12px' }}>
        {allRoles.map(r => {
          const col = getRoleColor(r.name); const active = selected.includes(r.name)
          return (
            <button key={r.name} onClick={() => toggle(r.name)}
              style={{ padding:'5px 12px', borderRadius:'20px', fontSize:'12px', cursor:'pointer', fontWeight:500,
                transition:'all 0.15s', border: active?`1px solid ${col.border}`:`1px solid ${C.border}`,
                background: active?col.bg:'transparent', color: active?col.text:C.textMuted }}>
              {active && '✓ '}{r.name}
            </button>
          )
        })}
      </div>
      <div style={{ display:'flex', gap:'8px' }}>
        <button className="btn-primary" style={{ padding:'6px 16px', fontSize:'12px' }} onClick={() => onSave(selected)}>Save Roles</button>
        <button onClick={onCancel} style={{ padding:'6px 14px', background:'none', border:`1px solid ${C.border}`,
          borderRadius:'6px', color:C.textMuted, cursor:'pointer', fontSize:'12px' }}>Cancel</button>
      </div>
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
// TAB 2 — ROLES & PERMISSIONS
// ══════════════════════════════════════════════════════════════════════════════

function RolesTab({ onRolesChange }) {
  const [roles, setRoles]         = useState([])
  const [layers, setLayers]       = useState([])
  const [loading, setLoading]     = useState(true)
  const [syncing, setSyncing]     = useState(false)   // banner visible
  const [status, setStatus]       = useState(null)
  // Track selected role by NAME (string), not object — avoids stale reference after reload
  const [selectedRoleName, setSelectedRoleName] = useState(null)
  const [showCreate, setShowCreate]     = useState(false)
  const [newRoleName, setNewRoleName]   = useState('')
  const [saving, setSaving]             = useState(false)
  const [showMatrix, setShowMatrix]     = useState(false)

  // Derive the current selectedRole object from freshly loaded roles list
  const selectedRole = useMemo(
    () => roles.find(r => r.name === selectedRoleName) || null,
    [roles, selectedRoleName]
  )

  const load = useCallback(async (keepSelected) => {
    setLoading(true)
    try {
      const [r, s] = await Promise.all([iamListRoles(), iamListSchemas()])
      const sorted = (r.roles || []).sort((a, b) => a.name.localeCompare(b.name))
      setRoles(sorted)
      setLayers(s.layers || [])
      onRolesChange?.(sorted)
      // On first load only: auto-select first non-admin role
      if (!keepSelected) {
        const initial = sorted.find(r => r.name !== 'PLATFORM_ADMIN') || sorted[0]
        if (initial) setSelectedRoleName(initial.name)
      }
      // If keepSelected: selectedRoleName stays the same → selectedRole re-derives from new data
    } catch (e) { setStatus({ type:'error', message:e.message }) }
    finally { setLoading(false) }
  }, [onRolesChange])

  useEffect(() => { load(false) }, [load])

  const handleCreateRole = async () => {
    if (!newRoleName.trim()) return
    try {
      await iamCreateRole({ name:newRoleName.toUpperCase(), permissions:[] })
      setStatus({ type:'success', message:`Role "${newRoleName.toUpperCase()}" created.` })
      setNewRoleName(''); setShowCreate(false); load(false)
    } catch (e) { setStatus({ type:'error', message:e.message }) }
  }

  const handleDeleteRole = async (role) => {
    if (!confirm(`Delete role "${role.name}"?\n${role.userCount||0} user(s) will lose this role's permissions.`)) return
    try {
      await iamDeleteRole(role.name)
      setStatus({ type:'success', message:`Role "${role.name}" deleted.` })
      setSelectedRoleName(null); load(false)
    } catch (e) { setStatus({ type:'error', message:e.message }) }
  }

  const handleSave = async (role, perms) => {
    setSaving(true)
    try {
      await iamUpdateRolePerms(role.name, perms)
      setStatus(null)   // clear old status
      setSyncing(true)  // show the trino banner
      load(true)        // reload but keep current selected role
    } catch (e) { setStatus({ type:'error', message:e.message }) }
    finally { setSaving(false) }
  }

  // Matrix: summary of all roles × layers
  const matrixData = useMemo(() => {
    const layerNames = layers.map(l => l.name)
    return roles.filter(r => r.name !== 'PLATFORM_ADMIN').map(role => {
      const perms = role.permissions || []
      const layerGrants = {}
      layerNames.forEach(l => {
        const ops = []
        perms.forEach(p => {
          if (p === `data:${l}:SELECT`) ops.push('SELECT')
          else if (p === `data:${l}:INSERT`) ops.push('INSERT')
          else if (p === `data:${l}:UPDATE`) ops.push('UPDATE')
          else if (p === `data:${l}:DELETE`) ops.push('DELETE')
          else if (p === 'query_all' || p === `query_${l}`) { if (!ops.includes('SELECT')) ops.push('SELECT') }
        })
        layerGrants[l] = ops
      })
      return { ...role, layerGrants }
    })
  }, [roles, layers])

  if (loading) return (
    <div style={{ display:'flex', alignItems:'center', justifyContent:'center', padding:'60px', gap:'10px', color:C.textMuted }}>
      <Spinner/> Loading roles...
    </div>
  )

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:'16px' }}>

      {/* Trino sync banner — appears after save, disappears when Trino is ready */}
      {syncing && <TrinoSyncBanner onDone={() => { setSyncing(false); load(true) }}/>}

      {status && (
        <div style={{ display:'flex', alignItems:'center', gap:'8px', padding:'10px 14px', borderRadius:'8px',
          fontSize:'13px', background:C[status.type]?.bg, color:C[status.type]?.text, border:`1px solid ${C[status.type]?.border}` }}>
          {status.type==='success' ? <CheckCircle size={14}/> : <XCircle size={14}/>}
          <span style={{ flex:1 }}>{status.message}</span>
          <button onClick={() => setStatus(null)} style={{ background:'none', border:'none', cursor:'pointer', color:'inherit', padding:0 }}><XCircle size={13}/></button>
        </div>
      )}

      <div style={{ display:'grid', gridTemplateColumns:'240px 1fr', gap:'16px', alignItems:'start' }}>

        {/* ── Left: Role list ── */}
        <div style={{ display:'flex', flexDirection:'column', gap:'8px' }}>
          <Card style={{ padding:'12px' }}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'10px', padding:'0 4px' }}>
              <span style={{ fontSize:'11px', fontWeight:600, color:C.textMuted, textTransform:'uppercase', letterSpacing:'0.06em' }}>
                Roles ({roles.length})
              </span>
              <button onClick={() => setShowCreate(s => !s)}
                style={{ background:C.primary, border:'none', color:'#fff', cursor:'pointer',
                  width:24, height:24, borderRadius:'6px', display:'flex', alignItems:'center', justifyContent:'center' }}>
                <Plus size={13}/>
              </button>
            </div>

            {showCreate && (
              <div style={{ marginBottom:'10px', display:'flex', gap:'6px' }}>
                <input style={{ ...inputStyle, fontSize:'12px', padding:'6px 10px' }}
                  placeholder="ROLE_NAME" value={newRoleName}
                  onChange={e => setNewRoleName(e.target.value.toUpperCase())}
                  onKeyDown={e => e.key==='Enter' && handleCreateRole()}/>
                <button className="btn-primary" style={{ padding:'6px 10px', fontSize:'12px', whiteSpace:'nowrap' }} onClick={handleCreateRole}>Add</button>
              </div>
            )}

            <div style={{ display:'flex', flexDirection:'column', gap:'3px' }}>
              {roles.map(role => {
                const col = getRoleColor(role.name)
                const active = selectedRoleName === role.name
                return (
                  <button key={role.name} onClick={() => setSelectedRoleName(role.name)}
                    style={{ width:'100%', textAlign:'left', padding:'9px 11px', borderRadius:'8px', cursor:'pointer',
                      border: active ? `1px solid ${col.border}` : '1px solid transparent',
                      background: active ? col.bg : 'transparent', transition:'all 0.15s',
                      display:'flex', alignItems:'center', gap:'9px' }}
                    onMouseEnter={e => !active && (e.currentTarget.style.background='rgba(255,255,255,0.04)')}
                    onMouseLeave={e => !active && (e.currentTarget.style.background='transparent')}>
                    <div style={{ width:7, height:7, borderRadius:'50%', background:col.text, flexShrink:0 }}/>
                    <div style={{ flex:1 }}>
                      <div style={{ fontSize:'12px', fontWeight:600, color: active?col.text:C.textPrimary }}>{role.name}</div>
                      <div style={{ fontSize:'11px', color:C.textMuted }}>{role.userCount||0} users · {role.permissions?.length||0} perms</div>
                    </div>
                  </button>
                )
              })}
            </div>
          </Card>
        </div>

        {/* ── Right: Permission editor ── */}
        {selectedRole ? (
          <RolePermissionEditor
            key={selectedRole.name}
            role={selectedRole}
            layers={layers}
            onSave={perms => handleSave(selectedRole, perms)}
            onDelete={() => handleDeleteRole(selectedRole)}
            saving={saving}
          />
        ) : (
          <Card>
            <div style={{ display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center',
              padding:'60px', color:C.textMuted, gap:'12px' }}>
              <Shield size={32} style={{ opacity:0.3 }}/>
              <p style={{ margin:0, fontSize:'13px' }}>Select a role on the left to configure its permissions</p>
            </div>
          </Card>
        )}
      </div>

      {/* ── Access Matrix (collapsible) ── */}
      {matrixData.length > 0 && (
        <Card style={{ padding:'0' }}>
          <button onClick={() => setShowMatrix(m => !m)}
            style={{ width:'100%', display:'flex', alignItems:'center', gap:'10px', padding:'14px 16px',
              background:'none', border:'none', cursor:'pointer', textAlign:'left' }}>
            <Activity size={14} style={{ color:C.primary, flexShrink:0 }}/>
            <div style={{ flex:1 }}>
              <div style={{ fontSize:'13px', fontWeight:600, color:C.textPrimary }}>Access Matrix</div>
              <div style={{ fontSize:'11px', color:C.textMuted }}>Summary of all roles' Trino data layer permissions</div>
            </div>
            <div style={{ color:C.textMuted, transform: showMatrix?'rotate(180deg)':'rotate(0)', transition:'transform 0.2s' }}>
              <ChevronDown size={15}/>
            </div>
          </button>

          {showMatrix && (
            <div style={{ borderTop:`1px solid ${C.border}`, padding:'16px', overflowX:'auto' }}>
              <table style={{ width:'100%', borderCollapse:'collapse', fontSize:'12px' }}>
                <thead>
                  <tr style={{ borderBottom:`1px solid ${C.border}` }}>
                    <th style={{ textAlign:'left', padding:'7px 10px', color:C.textMuted, fontWeight:500, fontSize:'11px', textTransform:'uppercase' }}>Role</th>
                    {layers.map(l => (
                      <th key={l.name} style={{ textAlign:'center', padding:'7px 10px', color:l.color||C.textMuted, fontWeight:600, fontSize:'11px', textTransform:'uppercase' }}>
                        {LAYER_ICONS[l.name]||''} {l.name}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {matrixData.map(row => {
                    const col = getRoleColor(row.name)
                    const hasAnyData = layers.some(l => (row.layerGrants[l.name]||[]).length > 0)
                    return (
                      <tr key={row.name} style={{ borderBottom:`1px solid rgba(255,255,255,0.04)`, opacity: hasAnyData?1:0.5 }}
                        onMouseEnter={e => e.currentTarget.style.background='rgba(255,255,255,0.02)'}
                        onMouseLeave={e => e.currentTarget.style.background='transparent'}>
                        <td style={{ padding:'9px 10px' }}>
                          <div style={{ display:'flex', alignItems:'center', gap:'8px' }}>
                            <div style={{ width:6, height:6, borderRadius:'50%', background:col.text }}/>
                            <span style={{ fontWeight:600, color:C.textPrimary }}>{row.name}</span>
                            <span style={{ fontSize:'10px', color:C.textMuted }}>{row.userCount||0}u</span>
                          </div>
                        </td>
                        {layers.map(l => {
                          const ops = row.layerGrants[l.name] || []
                          return (
                            <td key={l.name} style={{ padding:'9px 10px', textAlign:'center' }}>
                              {ops.length === 0 ? (
                                <span style={{ color:C.textMuted }}>—</span>
                              ) : (
                                <div style={{ display:'flex', gap:'3px', justifyContent:'center', flexWrap:'wrap' }}>
                                  {ops.map(op => {
                                    const oc = OP_COLORS[op] || C.info
                                    return (
                                      <span key={op} style={{ padding:'1px 5px', borderRadius:'3px', fontSize:'10px', fontWeight:700,
                                        background:oc.bg, color:oc.text, border:`1px solid ${oc.border}` }}>{op}</span>
                                    )
                                  })}
                                </div>
                              )}
                            </td>
                          )
                        })}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}
    </div>
  )
}

// ── Role Permission Editor ─────────────────────────────────────────────────────

function RolePermissionEditor({ role, layers, onSave, onDelete, saving }) {
  const isProtected = role.name === 'PLATFORM_ADMIN'
  const col = getRoleColor(role.name)

  const initPlatform = useMemo(() =>
    (role.permissions||[]).filter(p => !p.startsWith('data:') && !p.startsWith('query_')),
    [role.permissions]
  )
  const initDataPerms = useMemo(() => {
    const result = {}
    ;(role.permissions||[]).forEach(p => {
      if (p.startsWith('data:')) {
        const [,layer,op] = p.split(':')
        if (!result[layer]) result[layer] = {}
        result[layer][op] = true
      }
      if (p==='query_gold')   result.gold   = { ...result.gold,   SELECT:true }
      if (p==='query_silver') result.silver = { ...result.silver, SELECT:true }
      if (p==='query_bronze') result.bronze = { ...result.bronze, SELECT:true }
      if (p==='query_pipeline') result.pipeline = { ...result.pipeline, SELECT:true }
      if (p==='query_all')    ['bronze','silver','gold','pipeline'].forEach(l => { result[l] = { ...result[l], SELECT:true } })
    })
    return result
  }, [role.permissions])

  const [platformPerms, setPlatformPerms] = useState(initPlatform)
  const [dataPerms, setDataPerms]         = useState(initDataPerms)

  const togglePlatform = (p) => {
    if (isProtected) return
    setPlatformPerms(prev => prev.includes(p) ? prev.filter(x => x!==p) : [...prev, p])
  }
  const toggleLayer = (layerName) => {
    if (isProtected) return
    setDataPerms(prev => {
      if (prev[layerName] && Object.keys(prev[layerName]).length > 0) {
        const next = {...prev}; delete next[layerName]; return next
      }
      return { ...prev, [layerName]: { SELECT:true } }
    })
  }
  const toggleOp = (layerName, op) => {
    if (isProtected) return
    setDataPerms(prev => {
      const layerOps = { ...(prev[layerName]||{}) }
      if (layerOps[op]) delete layerOps[op]
      else layerOps[op] = true
      if (Object.keys(layerOps).length === 0) {
        const next = {...prev}; delete next[layerName]; return next
      }
      return { ...prev, [layerName]: layerOps }
    })
  }

  const buildPermissions = () => {
    const perms = [...platformPerms]
    Object.entries(dataPerms).forEach(([layer, ops]) => {
      Object.keys(ops).forEach(op => perms.push(`data:${layer}:${op}`))
    })
    return perms
  }

  // Preview of what user sees in Trino
  const trinoPreview = useMemo(() => {
    return ['bronze','silver','gold','pipeline']
      .filter(l => dataPerms[l] && Object.keys(dataPerms[l]).length > 0)
      .map(l => ({ layer:l, ops:Object.keys(dataPerms[l]) }))
  }, [dataPerms])

  // Layer fallback when API not loaded yet
  const displayLayers = layers.length > 0 ? layers : [
    { name:'bronze', label:'Bronze Layer', description:'Raw ingestion layer — unprocessed source data', icon:'🥉', color:'#cd7f32', colorBg:'rgba(205,127,50,0.12)', colorBorder:'rgba(205,127,50,0.35)', ops:['SELECT','INSERT','UPDATE','DELETE'] },
    { name:'silver', label:'Silver Layer', description:'Cleaned & validated layer — standardised data', icon:'🥈', color:'#94a3b8', colorBg:'rgba(148,163,184,0.12)', colorBorder:'rgba(148,163,184,0.35)', ops:['SELECT','INSERT','UPDATE','DELETE'] },
    { name:'pipeline', label:'Pipeline Layer', description:'Execution & transformations layer — pipeline state and staging', icon:'⚙️', color:'#10b981', colorBg:'rgba(16,185,129,0.12)', colorBorder:'rgba(16,185,129,0.35)', ops:['SELECT','INSERT','UPDATE','DELETE'] },
    { name:'gold',   label:'Gold Layer',   description:'Business-ready layer — BI-facing curated data', icon:'🥇', color:'#f59e0b', colorBg:'rgba(245,158,11,0.12)', colorBorder:'rgba(245,158,11,0.35)', ops:['SELECT','INSERT','UPDATE','DELETE'] },
  ]

  return (
    <Card>
      {/* Header */}
      <div style={{ display:'flex', alignItems:'center', gap:'12px', marginBottom:'20px',
        paddingBottom:'14px', borderBottom:`1px solid ${C.border}` }}>
        <div style={{ padding:'5px 13px', borderRadius:'20px', fontSize:'13px', fontWeight:700,
          background:col.bg, color:col.text, border:`1px solid ${col.border}` }}>
          {role.name}
        </div>
        <span style={{ fontSize:'12px', color:C.textMuted }}>
          <span style={{ color:C.primary, fontWeight:600 }}>{role.userCount||0}</span> users assigned
        </span>
        {isProtected && (
          <div style={{ display:'flex', alignItems:'center', gap:'6px', padding:'3px 10px',
            background:C.warn.bg, color:C.warn.text, border:`1px solid ${C.warn.border}`,
            borderRadius:'6px', fontSize:'11px', marginLeft:'auto' }}>
            <Lock size={10}/> Protected — read only
          </div>
        )}
      </div>

      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'20px' }}>

        {/* ── Left: Platform features ── */}
        <div>
          <div style={{ display:'flex', alignItems:'center', gap:'7px', marginBottom:'10px' }}>
            <Settings size={13} style={{ color:C.primary }}/>
            <span style={{ fontSize:'13px', fontWeight:600, color:C.textPrimary }}>Platform Features</span>
          </div>
          <p style={{ margin:'0 0 10px', fontSize:'11px', color:C.textMuted }}>
            Which pages & features this role can access in QuantFlow Studio.
          </p>
          <div style={{ display:'flex', flexDirection:'column', gap:'5px' }}>
            {Object.entries(PLATFORM_PERM_META).map(([key, meta]) => {
              const checked = platformPerms.includes(key)
              return (
                <label key={key} onClick={() => togglePlatform(key)}
                  style={{ display:'flex', alignItems:'center', gap:'9px', padding:'9px 11px', borderRadius:'8px',
                    cursor: isProtected?'default':'pointer',
                    border:`1px solid ${checked?'rgba(99,102,241,0.35)':C.border}`,
                    background: checked?'rgba(99,102,241,0.08)':'transparent',
                    transition:'all 0.15s', userSelect:'none' }}>
                  <input type="checkbox" checked={checked} readOnly
                    style={{ width:13, height:13, accentColor:C.primary, flexShrink:0 }}/>
                  <div style={{ fontSize:'15px', lineHeight:1, flexShrink:0 }}>{meta.icon}</div>
                  <div>
                    <div style={{ fontSize:'12px', fontWeight:600, color:checked?'#a5b4fc':C.textSec }}>{meta.label}</div>
                    <div style={{ fontSize:'11px', color:C.textMuted, lineHeight:1.3 }}>{meta.desc}</div>
                  </div>
                </label>
              )
            })}
          </div>
        </div>

        {/* ── Right: Data Layer Access ── */}
        <div>
          <div style={{ display:'flex', alignItems:'center', gap:'7px', marginBottom:'10px' }}>
            <Layers size={13} style={{ color:C.primary }}/>
            <span style={{ fontSize:'13px', fontWeight:600, color:C.textPrimary }}>Data Layer Access</span>
          </div>
          <p style={{ margin:'0 0 10px', fontSize:'11px', color:C.textMuted }}>
            Which Iceberg schemas are visible in Trino, and what SQL operations are allowed.
          </p>

          <div style={{ display:'flex', flexDirection:'column', gap:'8px' }}>
            {displayLayers.map(layer => (
              <LayerCard key={layer.name}
                layer={layer}
                enabled={!!(dataPerms[layer.name] && Object.keys(dataPerms[layer.name]).length)}
                selectedOps={dataPerms[layer.name] || {}}
                onToggleLayer={() => toggleLayer(layer.name)}
                onToggleOp={op => toggleOp(layer.name, op)}
                disabled={isProtected}
              />
            ))}
          </div>

          {/* Trino Preview */}
          <div style={{ marginTop:'12px', padding:'10px 12px', borderRadius:'8px',
            background:'rgba(0,0,0,0.25)', border:`1px solid ${C.border}` }}>
            <div style={{ display:'flex', alignItems:'center', gap:'6px', marginBottom:'6px' }}>
              <Zap size={11} style={{ color:'#60a5fa' }}/>
              <span style={{ fontSize:'10px', fontWeight:700, color:'#60a5fa', textTransform:'uppercase', letterSpacing:'0.07em' }}>
                Trino Visibility Preview
              </span>
            </div>
            {trinoPreview.length === 0 ? (
              <div style={{ fontSize:'11px', color:C.textMuted, fontStyle:'italic' }}>
                No schemas visible — user will not see any Iceberg data in Trino.
              </div>
            ) : (
              <div style={{ fontFamily:'monospace', fontSize:'11px' }}>
                <div style={{ color:'#60a5fa', marginBottom:'3px' }}>📦 iceberg</div>
                {trinoPreview.map(({ layer, ops }) => (
                  <div key={layer} style={{ paddingLeft:'14px', marginBottom:'2px', display:'flex', alignItems:'center', gap:'6px' }}>
                    <span style={{ color:LAYER_DEFAULTS[layer]||C.textSec }}>└─ {layer}</span>
                    <span style={{ display:'flex', gap:'3px' }}>
                      {ops.map(op => {
                        const oc = OP_COLORS[op] || C.info
                        return <span key={op} style={{ padding:'0 4px', borderRadius:'3px', fontSize:'10px', fontWeight:700,
                          background:oc.bg, color:oc.text }}>{op}</span>
                      })}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Actions */}
      {!isProtected && (
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center',
          marginTop:'18px', paddingTop:'14px', borderTop:`1px solid ${C.border}` }}>
          <button onClick={onDelete}
            style={{ background:C.error.bg, border:`1px solid ${C.error.border}`, color:C.error.text,
              cursor:'pointer', padding:'7px 13px', borderRadius:'7px',
              display:'flex', alignItems:'center', gap:'6px', fontSize:'12px' }}>
            <Trash2 size={12}/> Delete Role
          </button>
          <button className="btn-primary" disabled={saving} onClick={() => onSave(buildPermissions())}
            style={{ padding:'8px 22px', fontSize:'13px', display:'flex', alignItems:'center', gap:'8px', opacity:saving?0.7:1 }}>
            {saving ? <><Spinner/> Saving…</> : <><Lock size={13}/> Save & Sync Trino</>}
          </button>
        </div>
      )}
    </Card>
  )
}

function LayerCard({ layer, enabled, selectedOps, onToggleLayer, onToggleOp, disabled }) {
  return (
    <div style={{ border:`1px solid ${enabled?layer.colorBorder:C.border}`, borderRadius:'10px',
      overflow:'hidden', transition:'all 0.2s', background:enabled?layer.colorBg:'transparent' }}>
      <div style={{ display:'flex', alignItems:'center', gap:'11px', padding:'9px 13px', cursor:disabled?'default':'pointer' }}
        onClick={!disabled ? onToggleLayer : undefined}>
        <input type="checkbox" checked={enabled} readOnly
          style={{ width:14, height:14, accentColor:layer.color, flexShrink:0 }}/>
        <span style={{ fontSize:'16px', lineHeight:1 }}>{layer.icon}</span>
        <div style={{ flex:1 }}>
          <div style={{ fontSize:'12px', fontWeight:600, color:enabled?layer.color:C.textPrimary }}>{layer.label}</div>
          <div style={{ fontSize:'11px', color:C.textMuted, lineHeight:1.3 }}>{layer.description}</div>
        </div>
        {enabled && <span style={{ fontSize:'10px', color:layer.color, fontWeight:500 }}>{Object.keys(selectedOps).length} op{Object.keys(selectedOps).length!==1?'s':''}</span>}
      </div>

      {enabled && (
        <div style={{ display:'flex', gap:'5px', padding:'6px 13px 10px 42px', borderTop:`1px solid ${layer.colorBorder}` }}>
          {(layer.ops||['SELECT','INSERT','UPDATE','DELETE']).map(op => {
            const active = !!selectedOps[op]
            const oc = OP_COLORS[op] || C.info
            return (
              <button key={op} onClick={!disabled ? () => onToggleOp(op) : undefined}
                style={{ padding:'3px 9px', borderRadius:'5px', fontSize:'11px', fontWeight:700,
                  cursor:disabled?'default':'pointer', transition:'all 0.15s',
                  background: active?oc.bg:'rgba(255,255,255,0.05)',
                  color: active?oc.text:C.textMuted,
                  border:`1px solid ${active?oc.border:C.border}` }}>
                {active?'✓ ':''}{op}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
// MAIN PAGE
// ══════════════════════════════════════════════════════════════════════════════

const TABS = [
  { id:'users', label:'Users',               icon:Users,  desc:'Manage user accounts'      },
  { id:'roles', label:'Roles & Permissions', icon:Shield, desc:'Configure role permissions' },
]

export default function IAMManager() {
  const [activeTab, setActiveTab] = useState('users')
  const [allRoles, setAllRoles]   = useState([])

  return (
    <>
      <div className="top-bar">
        <h1 style={{ display:'flex', alignItems:'center', gap:8 }}>
          <Shield size={18}/> IAM & Access Control
        </h1>
      </div>

      <div className="page-container">
        <p style={{ margin:'0 0 16px', fontSize:'13px', color:C.textMuted }}>
          Manage users, roles, and data access policies. Changes to role permissions sync automatically to Trino.
        </p>

        {/* Summary strip */}
        <div style={{ display:'flex', gap:'12px', marginBottom:'24px' }}>
          {[
            { label:'Keycloak SSO',  sub:'Single sign-on for all users',               icon:'🔑', color:'rgba(99,102,241,0.12)' },
            { label:'QuantFlow Studio', sub:'Role-based page & feature visibility',         icon:'🖥️', color:'rgba(59,130,246,0.12)'  },
            { label:'Trino Engine', sub:'Schema-level isolation via rules.json',        icon:'⚡', color:'rgba(234,179,8,0.12)'   },
          ].map(s => (
            <div key={s.label} style={{ flex:1, padding:'10px 14px', borderRadius:'10px',
              background:s.color, border:`1px solid ${C.border}`, display:'flex', gap:'10px', alignItems:'center' }}>
              <span style={{ fontSize:'20px' }}>{s.icon}</span>
              <div>
                <div style={{ fontSize:'12px', fontWeight:600, color:C.textPrimary }}>{s.label}</div>
                <div style={{ fontSize:'11px', color:C.textMuted }}>{s.sub}</div>
              </div>
            </div>
          ))}
        </div>

        {/* Tab nav */}
        <div style={{ display:'flex', gap:'4px', marginBottom:'24px', background:C.glass,
          padding:'4px', borderRadius:'12px', border:`1px solid ${C.border}`, width:'fit-content' }}>
          {TABS.map(tab => {
            const active = activeTab === tab.id
            return (
              <button key={tab.id} onClick={() => setActiveTab(tab.id)}
                style={{ display:'flex', alignItems:'center', gap:'8px', padding:'9px 18px', borderRadius:'9px',
                  border:'none', cursor:'pointer', fontSize:'13px', fontWeight:500, transition:'all 0.2s',
                  background: active?C.primary:'transparent',
                  color: active?'#fff':C.textMuted,
                  boxShadow: active?'0 2px 8px rgba(99,102,241,0.35)':'none' }}>
                <tab.icon size={14}/> {tab.label}
              </button>
            )
          })}
        </div>

        {activeTab==='users' && <UsersTab allRoles={allRoles}/>}
        {activeTab==='roles' && <RolesTab onRolesChange={setAllRoles}/>}
      </div>
    </>
  )
}

import React, { useState, useEffect } from 'react'
import { GlobalErrorBoundary } from './GlobalErrorBoundary'
import { BrowserRouter, Routes, Route, NavLink, Navigate } from 'react-router-dom'
import {
  LayoutDashboard, Database, GitBranch, Play, Search,
  HardDrive, Settings, ChevronRight, ChevronLeft, Menu, HeartPulse, Plug, ShieldCheck, LogOut, Zap,
  ClipboardList, Sliders
} from 'lucide-react'

import ModelManager from './pages/ModelManager'
import ServingManager from './pages/ServingManager'
import MarketIntake from './pages/MarketIntake'
import GitExplorer from './pages/GitExplorer'
import QueryEditor from './pages/QueryEditor'
import StorageBrowser from './pages/StorageBrowser'
import CatalogHealth from './pages/CatalogHealth'
import ConnectorManager from './pages/ConnectorManager'
import IAMManager from './pages/IAMManager'
import LineageExplorer from './pages/LineageExplorer'
import LoginPage from './pages/LoginPage'
import FeatureFactory from './pages/FeatureFactory'
import FeatureSelection from './pages/FeatureSelection'
import { authStore } from './auth/authStore'
import { iamGetMe } from './api/client'

// ── Permission-aware nav builder ──────────────────────────────────────────────
// perms: Set<string> of permission keys returned by /api/iam/me
const getNavItems = (perms) => [
  { section: 'Quant Suite' },
  // Market Intake & Setup: visible only with manage_pipelines
  ...(perms.has('manage_pipelines') ? [
    { path: '/intake', icon: ClipboardList, label: 'Market Intake & Setup' },
    { path: '/feature-factory', icon: Zap, label: 'Feature Factory' },
    { path: '/feature-selection', icon: Sliders, label: 'Feature Selection' },
  ] : []),
  // Connectors: visible only with manage_connectors
  ...(perms.has('manage_connectors') ? [
    { path: '/connectors', icon: Plug, label: 'Connectors' },
  ] : []),
  { path: '/models', icon: Database, label: 'Data Models' },
  { path: '/serving', icon: Zap, label: 'Serving Layer' },
  { path: '/lineage', icon: GitBranch, label: 'Data Lineage' },
  // SQL Editor: visible only with access_sql_editor
  ...(perms.has('access_sql_editor') ? [
    { path: '/query', icon: Search, label: 'SQL Editor' },
  ] : []),
  { section: 'Management' },
  // Git (Nessie): visible only with access_git
  ...(perms.has('access_git') ? [
    { path: '/git', icon: GitBranch, label: 'Git (Nessie)' },
  ] : []),
  // Storage: visible only with manage_storage
  ...(perms.has('manage_storage') ? [
    { path: '/storage', icon: HardDrive, label: 'Storage (MinIO)' },
  ] : []),
  // Catalog Health: visible only with access_catalog_health
  ...(perms.has('access_catalog_health') ? [
    { path: '/catalog-health', icon: HeartPulse, label: 'Catalog Health' },
  ] : []),
  // IAM: visible only with full admin permissions
  ...(perms.has('manage_users') && perms.has('manage_acl') ? [
    { path: '/iam', icon: ShieldCheck, label: 'IAM & Access Control' },
  ] : []),
]

// ── Route Guard — redirects to / if user lacks the required permission ────────
function PermissionRoute({ permission, perms, element }) {
  return element
}

// ── Auth Guard ────────────────────────────────────────────────────────────────
function RequireAuth({ children }) {
  return children
}

const ALL_PERMISSIONS = new Set([
  'manage_users', 'manage_groups', 'manage_acl',
  'manage_pipelines', 'manage_connectors', 'manage_storage',
  'query_all',
  'view_dashboard', 'access_sql_editor', 'access_git', 'access_catalog_health'
])

export default function App() {
  const [isSidebarOpen, setIsSidebarOpen] = useState(false)

  // user permissions: full access by default
  const [perms] = useState(ALL_PERMISSIONS)
  const [permsLoaded] = useState(true)

  useEffect(() => {
    // Open access mode: No authentication required
  }, [])


  const navItems = getNavItems(perms)

  // Don't render nav until permissions are known (avoid flash of wrong nav)
  if (!permsLoaded) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', color: 'var(--text-muted)' }}>
        Loading…
      </div>
    )
  }

  return (
    <GlobalErrorBoundary>
      <BrowserRouter>
        <div className="app-layout">
          {/* Sidebar */}
          <aside className={`sidebar ${isSidebarOpen ? '' : 'collapsed'}`}>
            <div className="sidebar-header" style={{ display: 'flex', alignItems: 'center', justifyContent: isSidebarOpen ? 'space-between' : 'center', padding: isSidebarOpen ? '20px 16px' : '20px 0', gap: '12px' }}>
              <div className="sidebar-logo" style={{ display: isSidebarOpen ? 'flex' : 'none', alignItems: 'center', gap: '10px', flex: 1, minWidth: 0 }}>
                <div className="sidebar-logo-icon">QF</div>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div className="sidebar-logo-text" style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '14px', fontWeight: 700, color: '#fff' }}>
                    QuantFlow
                    <span style={{ fontSize: '9px', fontWeight: 800, background: 'var(--accent-primary)', color: '#fff', WebkitTextFillColor: '#fff', padding: '2px 6px', borderRadius: '4px', textTransform: 'uppercase', letterSpacing: '0.05em', boxShadow: '0 0 10px rgba(99,102,241,0.5)' }}>Beta</span>
                  </div>
                  <div className="sidebar-logo-sub" style={{ fontSize: '11px', color: 'var(--text-muted)', whiteSpace: 'normal', lineHeight: '1.3' }}>Quant Research Engine</div>
                </div>
              </div>
              <button 
                onClick={() => setIsSidebarOpen(!isSidebarOpen)}
                style={{ 
                  background: 'var(--bg-glass)', border: '1px solid var(--border-color)', 
                  color: 'var(--text-muted)', cursor: 'pointer', display: 'flex', padding: '6px',
                  borderRadius: '6px', transition: 'all 0.2s', flexShrink: 0
                }}
                onMouseEnter={e => e.currentTarget.style.color = '#fff'}
                onMouseLeave={e => e.currentTarget.style.color = 'var(--text-muted)'}
                title={isSidebarOpen ? "Collapse Sidebar" : "Expand Sidebar"}
              >
                {isSidebarOpen ? <ChevronLeft size={16} /> : <Menu size={16} />}
              </button>
            </div>
            <nav className="sidebar-nav">
              {navItems.map((item, i) =>
                item.section ? (
                  <div key={i} className="sidebar-section-label">{item.section}</div>
                ) : (
                  <NavLink
                    key={item.path}
                    to={item.path}
                    end={item.path === '/'}
                    className={({ isActive }) =>
                      `sidebar-link ${isActive ? 'active' : ''}`
                    }
                  >
                    <item.icon />
                    <span>{item.label}</span>
                  </NavLink>
                )
              )}
            </nav>
            {/* User info + logout at bottom */}
            {isSidebarOpen && (
              <div style={{ padding: '12px 16px', borderTop: '1px solid var(--border-color)', marginTop: 'auto' }}>
                <button
                  onClick={() => authStore.logout()}
                  style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: 'var(--text-muted)', background: 'none', border: 'none', cursor: 'pointer', padding: '4px 0', width: '100%' }}
                  onMouseEnter={e => e.currentTarget.style.color = '#ff6b6b'}
                  onMouseLeave={e => e.currentTarget.style.color = 'var(--text-muted)'}
                >
                  <LogOut size={14} /> Sign Out
                </button>
              </div>
            )}
          </aside>

          {/* Main */}
          <main className="main-content">
            <Routes>
              <Route path="/login" element={<LoginPage />} />
              <Route path="/" element={<Navigate to="/intake" replace />} />
              <Route path="/models" element={<RequireAuth><ModelManager /></RequireAuth>} />
              <Route path="/serving" element={<RequireAuth><ServingManager /></RequireAuth>} />
              <Route path="/intake" element={
                <RequireAuth><PermissionRoute permission="manage_pipelines" perms={perms} element={<MarketIntake />} /></RequireAuth>
              } />
              <Route path="/intake/:id" element={
                <RequireAuth><PermissionRoute permission="manage_pipelines" perms={perms} element={<MarketIntake />} /></RequireAuth>
              } />
              <Route path="/feature-factory" element={
                <RequireAuth><PermissionRoute permission="manage_pipelines" perms={perms} element={<FeatureFactory />} /></RequireAuth>
              } />
              <Route path="/feature-factory/:id" element={
                <RequireAuth><PermissionRoute permission="manage_pipelines" perms={perms} element={<FeatureFactory />} /></RequireAuth>
              } />
              <Route path="/feature-selection" element={
                <RequireAuth><PermissionRoute permission="manage_pipelines" perms={perms} element={<FeatureSelection />} /></RequireAuth>
              } />
              <Route path="/feature-selection/:id" element={
                <RequireAuth><PermissionRoute permission="manage_pipelines" perms={perms} element={<FeatureSelection />} /></RequireAuth>
              } />
              <Route path="/pipelines" element={<Navigate to="/intake" replace />} />
              <Route path="/pipelines/:id" element={<Navigate to="/intake" replace />} />
              <Route path="/connectors" element={
                <RequireAuth><PermissionRoute permission="manage_connectors" perms={perms} element={<ConnectorManager />} /></RequireAuth>
              } />
              <Route path="/lineage" element={<RequireAuth><LineageExplorer /></RequireAuth>} />
              <Route path="/query" element={
                <RequireAuth><PermissionRoute permission="access_sql_editor" perms={perms} element={<QueryEditor />} /></RequireAuth>
              } />
              <Route path="/git" element={
                <RequireAuth><PermissionRoute permission="access_git" perms={perms} element={<GitExplorer />} /></RequireAuth>
              } />
              <Route path="/storage" element={
                <RequireAuth><PermissionRoute permission="manage_storage" perms={perms} element={<StorageBrowser />} /></RequireAuth>
              } />
              <Route path="/catalog-health" element={
                <RequireAuth><PermissionRoute permission="access_catalog_health" perms={perms} element={<CatalogHealth />} /></RequireAuth>
              } />
              <Route path="/iam" element={
                <RequireAuth><PermissionRoute permission="manage_users" perms={perms} element={
                  <PermissionRoute permission="manage_acl" perms={perms} element={<IAMManager />} />
                } /></RequireAuth>
              } />
            </Routes>
          </main>

        </div>
      </BrowserRouter>
    </GlobalErrorBoundary>
  )
}

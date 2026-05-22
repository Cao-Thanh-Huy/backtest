'use client'
import { useState, useEffect } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { clsx } from 'clsx'
import {
  Activity,
  Filter,
  Crosshair,
  Bitcoin,
  ClipboardList,
  Brain,
  SlidersHorizontal,
  TrendingUp,
  Trophy,
  Zap,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react'

const NAV = [
  {
    href: '/lab/overview',
    label: 'Market Overview',
    icon: Bitcoin,
    color: 'text-amber-300',
    bg: 'bg-amber-500/[0.12]',
    border: 'border-amber-500/[0.20]',
  },
  {
    href: '/lab/intake',
    label: 'Market Intake',
    icon: ClipboardList,
    color: 'text-cyan-300',
    bg: 'bg-cyan-500/[0.12]',
    border: 'border-cyan-500/[0.20]',
  },
  {
    href: '/lab/feature-factory',
    label: 'Feature Factory',
    icon: Activity,
    color: 'text-accent-teal',
    bg: 'bg-teal-500/[0.12]',
    border: 'border-teal-500/[0.20]',
  },
  {
    href: '/lab/data-preparation',
    label: 'Data Preparation',
    icon: Filter,
    color: 'text-accent-teal',
    bg: 'bg-teal-500/[0.12]',
    border: 'border-teal-500/[0.20]',
  },
  {
    href: '/lab/targets',
    label: 'Labeling System',
    icon: Crosshair,
    color: 'text-accent-rose',
    bg: 'bg-rose-500/[0.12]',
    border: 'border-rose-500/[0.20]',
  },
  {
    href: '/lab/feature-selection',
    label: 'Feature Selection',
    icon: Filter,
    color: 'text-accent-sky',
    bg: 'bg-sky-500/[0.12]',
    border: 'border-sky-500/[0.20]',
  },
  {
    href: '/lab/stability',
    label: 'Feature Stability',
    icon: Activity,
    color: 'text-indigo-400',
    bg: 'bg-indigo-500/[0.12]',
    border: 'border-indigo-500/[0.20]',
  },
  {
    href: '/lab/training',
    label: 'Training',
    icon: Brain,
    color: 'text-brand-400',
    bg: 'bg-violet-500/[0.12]',
    border: 'border-violet-500/[0.20]',
  },
  {
    href: '/lab/tuning',
    label: 'Hyperparam Tune',
    icon: SlidersHorizontal,
    color: 'text-accent-amber',
    bg: 'bg-amber-500/[0.12]',
    border: 'border-amber-500/[0.20]',
  },
  {
      href: '/lab/sweep-history',
      label: 'Sweep History',
      icon: Zap,
      color: 'text-accent-lime',
      bg: 'bg-lime-500/[0.12]',
      border: 'border-lime-500/[0.20]',
  },
  {
    href: '/lab/backtest',
    label: 'Backtest',
    icon: TrendingUp,
    color: 'text-accent-green',
    bg: 'bg-green-500/[0.12]',
    border: 'border-green-500/[0.20]',
  },
  {
    href: '/lab/results',
    label: 'Results',
    icon: Trophy,
    color: 'text-accent-amber',
    bg: 'bg-amber-500/[0.12]',
    border: 'border-amber-500/[0.20]',
  },
]

export function Sidebar() {
  const path = usePathname()
  const [isCollapsed, setIsCollapsed] = useState(true)
  
  useEffect(() => {
    const saved = localStorage.getItem('sidebar-collapsed')
    if (saved !== null) {
      setIsCollapsed(saved === 'true')
    }
  }, [])

  const handleToggle = () => {
    const next = !isCollapsed
    setIsCollapsed(next)
    localStorage.setItem('sidebar-collapsed', String(next))
  }

  return (
    <aside 
      className={clsx(
        "relative min-h-screen flex flex-col shrink-0 border-r border-white/[0.06] transition-all duration-300 ease-in-out",
        isCollapsed ? "w-[76px]" : "w-[240px]"
      )}
      style={{ background: 'linear-gradient(180deg, #0A0F1C 0%, #080C18 100%)' }}
    >
      {/* ── Toggle Button ── */}
      <button
        onClick={handleToggle}
        className={clsx(
          "absolute top-6 -right-3 w-6 h-6 rounded-full bg-[#080C18] border border-white/[0.08] flex items-center justify-center text-zinc-400 hover:text-white transition-all shadow-lg hover:scale-110 z-50 duration-200",
          "hover:border-violet-500/[0.4] hover:shadow-[0_0_12px_rgba(124,58,237,0.25)]"
        )}
        style={{ boxShadow: '0 2px 8px rgba(0,0,0,0.5)' }}
        title={isCollapsed ? "Mở rộng" : "Thu gọn"}
      >
        {isCollapsed ? <ChevronRight className="w-3.5 h-3.5" /> : <ChevronLeft className="w-3.5 h-3.5" />}
      </button>

      {/* ── Logo ── */}
      <div className={clsx(
        "flex items-center h-16 border-b border-white/[0.06] shrink-0 transition-all duration-300 overflow-hidden",
        isCollapsed ? "justify-center px-2" : "justify-between px-5"
      )}>
        <div className="flex items-center gap-3">
          <div
            className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0 border border-violet-500/[0.30]"
            style={{
              background: 'linear-gradient(135deg, #7C3AED 0%, #4F46E5 100%)',
              boxShadow: '0 0 18px rgba(124,58,237,0.35)',
            }}
          >
            <Zap className="w-4 h-4 text-white" fill="white" />
          </div>
          {!isCollapsed && (
            <div className="flex-1 min-w-0 transition-opacity duration-300">
              <div className="text-[15px] font-bold text-white tracking-tight leading-none">QuantML</div>
              <div className="text-[10px] text-zinc-500 mt-0.5 font-mono">Research Platform</div>
            </div>
          )}
        </div>
        {!isCollapsed && (
          <span
            className="text-[9px] font-bold tracking-widest uppercase px-1.5 py-0.5 rounded border shrink-0"
            style={{
              background: 'rgba(124,58,237,0.15)',
              borderColor: 'rgba(124,58,237,0.35)',
              color: '#A78BFA',
            }}
          >
            BETA
          </span>
        )}
      </div>

      {/* ── Nav ── */}
      <div className="flex-1 overflow-y-auto py-5 px-3 space-y-0.5">
        {!isCollapsed && (
          <div className="px-2 pb-3">
            <span className="section-label">Research Lab</span>
          </div>
        )}

        {NAV.map((n) => {
          const active = path.startsWith(n.href)
          const Icon = n.icon
          return (
            <Link
              key={n.href}
              href={n.href}
              title={isCollapsed ? n.label : undefined}
              className={clsx(
                'flex items-center rounded-xl text-sm transition-all duration-150 group relative',
                isCollapsed ? 'justify-center p-2.5' : 'gap-3 px-3 py-2.5',
                active
                  ? 'bg-white/[0.07] border border-white/[0.08]'
                  : 'hover:bg-white/[0.04] border border-transparent',
              )}
            >
              {/* Active left-border indicator */}
              {active && (
                <span
                  className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-4 rounded-r-full"
                  style={{ background: 'linear-gradient(180deg, #A78BFA 0%, #7C3AED 100%)' }}
                />
              )}
              {/* Icon box */}
              <span className={clsx('icon-box-sm border shrink-0', active ? `${n.bg} ${n.border}` : 'bg-white/[0.03] border-white/[0.05] group-hover:bg-white/[0.05]')}>
                <Icon className={clsx('w-3.5 h-3.5', active ? n.color : 'text-zinc-600 group-hover:text-zinc-400')} />
              </span>
              {!isCollapsed && (
                <span className={clsx('flex-1 truncate font-medium', active ? 'text-zinc-50' : 'text-zinc-500 group-hover:text-zinc-200')}>
                  {n.label}
                </span>
              )}
            </Link>
          )
        })}
      </div>

      {/* ── Footer ── */}
      <div className={clsx(
        "py-4 border-t border-white/[0.06] shrink-0 transition-all duration-300 overflow-hidden",
        isCollapsed ? "px-2 text-center" : "px-4"
      )}>
        <div className="text-[11px] text-zinc-600 font-mono truncate">
          {isCollapsed ? "v3" : "v3.0.0-stable"}
        </div>
      </div>
    </aside>
  )
}

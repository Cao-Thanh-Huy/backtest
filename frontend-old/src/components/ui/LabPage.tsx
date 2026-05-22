'use client'
/**
 * Shared two-panel layout used by every lab page.
 * Left: library list. Right: detail / preview.
 */
import { ReactNode } from 'react'
import { X } from 'lucide-react'

interface Props {
  title: string
  subtitle?: string
  action?: ReactNode
  list?: ReactNode
  detail?: ReactNode
  icon?: ReactNode
  children?: ReactNode
}

export function LabPage({ title, subtitle, action, list, detail, icon, children }: Props) {
  return (
    <div className="flex flex-col h-full min-h-screen">
      {/* Page header — prominent, DE-Studio-style */}
      <div
        className="flex items-center justify-between px-7 h-[62px] border-b border-white/[0.06] shrink-0"
        style={{ background: 'var(--bg-secondary)' }}
      >
        <div className="flex items-center gap-3 min-w-0 flex-1">
          {icon && (
            <span className="text-brand-400 opacity-80">{icon}</span>
          )}
          <div className="min-w-0">
            <h1 className="text-[18px] font-bold text-white tracking-tight leading-snug">{title}</h1>
            {subtitle && <p className="text-xs text-zinc-500 mt-0.5 leading-none truncate">{subtitle}</p>}
          </div>
        </div>
        {action && <div className="shrink-0 ml-3">{action}</div>}
      </div>

      {/* Body */}
      {children ? (
        <div className="flex-1 overflow-y-auto p-6 bg-[var(--bg-primary)]">
          {children}
        </div>
      ) : (
        <div className="flex flex-1 overflow-hidden">
          {/* Left — library list */}
          <div className="w-[280px] shrink-0 border-r border-white/[0.06] overflow-y-auto flex flex-col"
            style={{ background: 'linear-gradient(180deg, #0C1018 0%, #0A0F1A 100%)' }}
          >
            {list}
          </div>
          {/* Right — detail / preview */}
          <div className="flex-1 overflow-y-auto p-6 bg-[var(--bg-primary)]">
            {detail}
          </div>
        </div>
      )}
    </div>
  )
}

/** Reusable status badge */
export function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    pending:   'badge-pending',
    running:   'badge-running',
    completed: 'badge-completed',
    failed:    'badge-failed',
  }
  return <span className={map[status] ?? 'badge-pending'}>{status}</span>
}

/** Scrollable data preview table */
export function PreviewTable({
  columns,
  rows,
}: {
  columns: { name: string; type: string }[]
  rows: Record<string, unknown>[]
}) {
  if (!columns.length) return <div className="text-xs text-zinc-600 text-center py-8">No preview data available</div>
  return (
    <div className="overflow-auto max-h-[480px] rounded-xl border border-white/[0.04] bg-slate-950/20 text-xs">
      <table className="min-w-max w-full border-collapse">
        <thead className="sticky top-0 z-10 bg-slate-900/90 backdrop-blur-md">
          <tr>
            {columns.map((c) => (
              <th
                key={c.name}
                className="px-4 py-3 text-left font-semibold border-b border-white/[0.05] whitespace-nowrap"
              >
                <div className="text-zinc-200 font-semibold tracking-wide">{c.name}</div>
                <div className="text-zinc-500 font-mono text-[9px] font-medium mt-0.5 uppercase tracking-wider">{c.type}</div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-white/[0.02]">
          {rows.map((row, ri) => (
            <tr 
              key={ri} 
              className="hover:bg-white/[0.015] transition-colors duration-150 bg-slate-900/10"
            >
              {columns.map((c) => (
                <td key={c.name} className="px-4 py-2 text-zinc-300 whitespace-nowrap font-mono tabular-nums tracking-tight">
                  {String(row[c.name] ?? '')}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** Task progress bar shown during async operations */
export function TaskBar({
  progress,
  message,
  status,
  onDismiss,
}: {
  progress: number
  message: string
  status: string
  onDismiss?: () => void
}) {
  const isActive = status === 'PROGRESS' || status === 'STARTED'
  const isFail = status === 'FAILURE'
  return (
    <div className="rounded-[14px] border border-white/[0.07] p-4 space-y-2.5 relative overflow-hidden"
      style={{ background: 'linear-gradient(135deg, #131e30 0%, #0e1724 100%)' }}
    >
      <div className="flex items-center justify-between">
        <div className="text-sm font-medium text-zinc-200">{message || 'Processing...'}</div>
        <div className="flex items-center gap-3">
          <div className="text-xs text-zinc-500 num">{progress}%</div>
          {onDismiss && (
            <button
              onClick={onDismiss}
              className="text-zinc-500 hover:text-zinc-300 p-0.5 rounded hover:bg-white/[0.05] transition-all"
              title="Dismiss status bar"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>
      <div className="h-1.5 bg-white/[0.06] rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-300 ${isFail ? 'bg-down' : ''} ${isActive ? 'animate-pulse' : ''}`}
          style={{
            width: `${Math.max(progress, 2)}%`,
            background: isFail ? undefined : 'linear-gradient(90deg, #7C3AED 0%, #6366F1 100%)',
          }}
        />
      </div>
    </div>
  )
}

/** Empty state placeholder */
export function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center justify-center h-full py-24 text-zinc-600 text-sm">
      <div className="w-12 h-12 rounded-2xl bg-white/[0.03] border border-white/[0.06] flex items-center justify-center mb-4">
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" className="text-zinc-700">
          <circle cx="10" cy="10" r="7" stroke="currentColor" strokeWidth="1.5" strokeDasharray="3 2"/>
        </svg>
      </div>
      {message}
    </div>
  )
}

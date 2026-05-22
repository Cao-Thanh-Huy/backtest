'use client'
/**
 * Sweep History page
 * ─────────────────
 * View all hyperparameter sweep sessions with status, progress, and results
 */
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { listSweeps, getSweep, type Sweep } from '@/lib/api'
import { LabPage, EmptyState } from '@/components/ui/LabPage'
import { toast } from 'sonner'

export default function SweepHistoryPage() {
  const { data: sweeps = [], isLoading } = useQuery<Sweep[]>({
    queryKey: ['sweeps'],
    queryFn: () => listSweeps().then(r => r.data),
    refetchInterval: 5000,
  })

  const [selectedSweepId, setSelectedSweepId] = useState<string | null>(null)
  const selectedSweep = sweeps.find(s => s.id === selectedSweepId)

  const { data: sweepDetail } = useQuery<Sweep>({
    queryKey: ['sweep', selectedSweepId],
    queryFn: () => getSweep(selectedSweepId!).then(r => r.data),
    enabled: !!selectedSweepId,
    refetchInterval: 3000,
  })

  const displaySweep = sweepDetail || selectedSweep

  const getProgressPercent = (s: Sweep) => {
    const total = parseInt(s.total_jobs || '0', 10)
    if (total === 0) return 0
    const completed = parseInt(s.completed_jobs || '0', 10)
    return Math.round((completed / total) * 100)
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'completed': return 'text-emerald-400'
      case 'running': return 'text-brand-400'
      case 'failed': return 'text-red-400'
      default: return 'text-zinc-500'
    }
  }

  const getStatusBg = (status: string) => {
    switch (status) {
      case 'completed': return 'bg-emerald-500/10'
      case 'running': return 'bg-brand-500/10'
      case 'failed': return 'bg-red-500/10'
      default: return 'bg-zinc-500/10'
    }
  }

  return (
    <LabPage
      title="Sweep History"
      subtitle="View all hyperparameter tuning sessions and results"
      list={
        <div className="p-3 space-y-2">
          {isLoading ? (
            <div className="text-xs text-zinc-500 p-4">Loading sweeps...</div>
          ) : sweeps.length === 0 ? (
            <EmptyState message="No sweeps yet. Go to Hyperparameter Tuning to create one." />
          ) : (
            sweeps.map(sweep => {
              const progress = getProgressPercent(sweep)
              const isSelected = sweep.id === selectedSweepId
              return (
                <button
                  key={sweep.id}
                  onClick={() => setSelectedSweepId(sweep.id)}
                  className={`w-full text-left p-3 rounded-lg border transition-all ${
                    isSelected
                      ? 'bg-brand-500/10 border-brand-500/40'
                      : 'bg-surface-card border-white/[0.06] hover:border-white/[0.1]'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <div className="text-xs font-semibold text-zinc-300">
                      {sweep.model_type} · {sweep.total_jobs} jobs
                    </div>
                    <div className={`text-[10px] font-semibold uppercase ${getStatusColor(sweep.status)}`}>
                      {sweep.status}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="flex-1 h-2 bg-white/[0.05] rounded overflow-hidden">
                      <div
                        className="h-full bg-gradient-to-r from-brand-500 to-brand-400 rounded transition-all"
                        style={{ width: `${progress}%` }}
                      />
                    </div>
                    <span className="text-[10px] text-zinc-600 w-12 text-right">{progress}%</span>
                  </div>
                  <div className="text-[10px] text-zinc-600 mt-1.5">
                    {new Date(sweep.created_at).toLocaleString()}
                  </div>
                </button>
              )
            })
          )}
        </div>
      }
      detail={
        !displaySweep ? (
          <EmptyState message="Select a sweep to view details" />
        ) : (
          <div className="space-y-4">
            {/* Summary */}
            <div className="rounded-lg border border-white/[0.06] bg-surface-card p-4 space-y-2">
              <div className="text-sm font-semibold text-zinc-200">Sweep Details</div>
              <div className="grid grid-cols-2 gap-3 text-xs">
                <div>
                  <div className="text-zinc-600">Model Type</div>
                  <div className="font-mono text-zinc-300">{displaySweep.model_type}</div>
                </div>
                <div>
                  <div className="text-zinc-600">Status</div>
                  <div className={`font-semibold ${getStatusColor(displaySweep.status)}`}>
                    {displaySweep.status}
                  </div>
                </div>
                <div>
                  <div className="text-zinc-600">CV Preset</div>
                  <div className="font-mono text-zinc-300">{displaySweep.cv_splits}-fold, gap={displaySweep.cv_gap}</div>
                </div>
                <div>
                  <div className="text-zinc-600">Created</div>
                  <div className="text-zinc-300">{new Date(displaySweep.created_at).toLocaleString()}</div>
                </div>
              </div>
            </div>

            {/* Progress */}
            <div className="rounded-lg border border-white/[0.06] bg-surface-card p-4">
              <div className="text-sm font-semibold text-zinc-200 mb-3">Progress</div>
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-zinc-500">Total Jobs</span>
                  <span className="font-semibold text-zinc-300">{displaySweep.total_jobs}</span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-emerald-400">Completed</span>
                  <span className="font-semibold text-emerald-400">{displaySweep.completed_jobs}</span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-red-400">Failed</span>
                  <span className="font-semibold text-red-400">{displaySweep.failed_jobs}</span>
                </div>
                <div className="h-3 bg-white/[0.05] rounded overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-emerald-500 to-emerald-400 rounded"
                    style={{
                      width: `${parseInt(displaySweep.total_jobs || '1', 10) > 0
                        ? (parseInt(displaySweep.completed_jobs || '0', 10) / parseInt(displaySweep.total_jobs, 10)) * 100
                        : 0
                      }%`,
                    }}
                  />
                </div>
              </div>
            </div>

            {/* Parameter Grid */}
            {displaySweep.param_grid && (
              <div className="rounded-lg border border-white/[0.06] bg-surface-card p-4">
                <div className="text-sm font-semibold text-zinc-200 mb-2">Parameter Grid</div>
                <div className="space-y-1">
                  {Object.entries(displaySweep.param_grid as Record<string, unknown>).map(([key, values]) => (
                    <div key={key} className="text-[11px]">
                      <span className="font-mono text-zinc-400">{key}</span>
                      <span className="text-zinc-600"> = </span>
                      <span className="font-mono text-emerald-400">
                        {Array.isArray(values) ? values.join(', ') : String(values)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Top 5 Results */}
            {displaySweep.jobs && displaySweep.jobs.length > 0 && (
              <div className="rounded-lg border border-white/[0.06] bg-surface-card p-4">
                <div className="text-sm font-semibold text-zinc-200 mb-3">🏆 Top Results</div>
                <div className="space-y-2">
                  {displaySweep.jobs
                    .filter(j => j.status === 'completed' && j.cv_metrics)
                    .sort((a, b) => {
                      // Sort by first metric value (usually the optimize metric)
                      const metricsA = Object.values(a.cv_metrics || {}).slice(0, 1)
                      const metricsB = Object.values(b.cv_metrics || {}).slice(0, 1)
                      const valA = metricsA[0] || 0
                      const valB = metricsB[0] || 0
                      return valB - valA
                    })
                    .slice(0, 5)
                    .map((job, idx) => (
                      <div key={job.id} className="p-2.5 rounded bg-white/[0.02] text-xs">
                        <div className="flex items-center justify-between mb-1">
                          <span className="font-semibold text-zinc-400">#{idx + 1}</span>
                          {idx === 0 && <span className="text-emerald-400">★ Best</span>}
                        </div>
                        <div className="text-[10px] text-zinc-500 font-mono space-y-1">
                          {Object.entries(job.hyperparameters).map(([k, v]) => (
                            <div key={k}>
                              {k} = {String(v)}
                            </div>
                          ))}
                        </div>
                        {job.cv_metrics && (
                          <div className="text-[10px] text-emerald-400 mt-1.5 font-semibold">
                            {Object.entries(job.cv_metrics)
                              .slice(0, 2)
                              .map(([k, v]) => `${k}: ${(v as number).toFixed(4)}`)
                              .join(' · ')}
                          </div>
                        )}
                      </div>
                    ))}
                </div>
              </div>
            )}

            {/* All Jobs Table */}
            {displaySweep.jobs && displaySweep.jobs.length > 0 && (
              <div className="rounded-lg border border-white/[0.06] bg-surface-card p-4">
                <div className="text-sm font-semibold text-zinc-200 mb-3">All Jobs</div>
                <div className="overflow-auto max-h-96">
                  <table className="min-w-full text-[10px]">
                    <thead className="sticky top-0 bg-surface">
                      <tr>
                        <th className="px-2 py-1 text-left text-zinc-600 border-b border-white/[0.06]">Rank</th>
                        <th className="px-2 py-1 text-left text-zinc-600 border-b border-white/[0.06]">Status</th>
                        <th className="px-2 py-1 text-left text-zinc-600 border-b border-white/[0.06]">Params</th>
                        <th className="px-2 py-1 text-right text-zinc-600 border-b border-white/[0.06]">Metrics</th>
                      </tr>
                    </thead>
                    <tbody>
                      {displaySweep.jobs.map((job, idx) => (
                        <tr key={job.id} className="border-b border-white/[0.06] hover:bg-white/[0.02]">
                          <td className="px-2 py-1 text-zinc-500">{idx + 1}</td>
                          <td className="px-2 py-1">
                            {job.status === 'completed' && <span className="text-emerald-400">✓</span>}
                            {job.status === 'running' && <span className="text-brand-400">⟳</span>}
                            {job.status === 'failed' && <span className="text-red-400">✕</span>}
                            {job.status === 'pending' && <span className="text-zinc-600">◌</span>}
                          </td>
                          <td className="px-2 py-1 font-mono text-zinc-400 truncate">
                            {Object.entries(job.hyperparameters)
                              .map(([k, v]) => `${k}=${v}`)
                              .join(', ')}
                          </td>
                          <td className="px-2 py-1 text-right text-emerald-300">
                            {job.cv_metrics
                              ? Object.entries(job.cv_metrics)
                                  .slice(0, 1)
                                  .map(([k, v]) => `${(v as number).toFixed(4)}`)
                                  .join(' ')
                              : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )
      }
    />
  )
}

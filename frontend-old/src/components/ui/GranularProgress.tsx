'use client'

interface SubProgress {
  indicator?: string
  done?: number
  total?: number
  fold?: number
  total_folds?: number
  model?: string
  elapsed_sec?: number
  remaining_sec?: number
  best_metric?: number | null
  total_features?: number
  [key: string]: unknown
}

interface GranularProgressProps {
  progress: number
  message: string
  step?: string
  sub?: SubProgress
  status?: string
}

function formatSeconds(sec?: number): string {
  if (!sec) return '—'
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return m > 0 ? `${m}m ${s}s` : `${s}s`
}

export function GranularProgress({ progress, message, step, sub, status }: GranularProgressProps) {
  const isRunning = status === 'PROGRESS' || (progress > 0 && progress < 100)
  const isError = status === 'FAILURE'
  const isDone = status === 'SUCCESS' || progress === 100

  return (
    <div className="rounded-xl border border-surface-border bg-surface p-4 space-y-3">
      {/* Step label */}
      {step && (
        <div className="text-xs font-semibold text-brand-500 uppercase tracking-wider">{step}</div>
      )}

      {/* Message */}
      <div className={`text-sm ${isError ? 'text-red-400' : isDone ? 'text-emerald-400' : 'text-zinc-300'}`}>
        {isError ? '✗ ' : isDone ? '✓ ' : isRunning ? '⟳ ' : ''}{message || 'Waiting...'}
      </div>

      {/* Progress bar */}
      <div className="relative h-2 rounded-full bg-surface-border overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-300 ${
            isError ? 'bg-red-500' : isDone ? 'bg-emerald-500' : 'bg-brand-500'
          }`}
          style={{ width: `${progress}%` }}
        />
      </div>
      <div className="flex justify-between text-xs text-zinc-500">
        <span>{progress}%</span>
        {sub?.elapsed_sec && <span>Elapsed: {formatSeconds(sub.elapsed_sec as number)}</span>}
        {sub?.remaining_sec && <span>ETA: {formatSeconds(sub.remaining_sec as number)}</span>}
      </div>

      {/* Sub-progress rows */}
      {sub && (
        <div className="space-y-1 text-xs text-zinc-400 border-t border-surface-border pt-2">
          {sub.indicator && (
            <div className="flex justify-between">
              <span>Indicator</span>
              <span className="text-zinc-300">{sub.indicator}</span>
            </div>
          )}
          {typeof sub.done === 'number' && typeof sub.total === 'number' && (
            <div className="flex justify-between">
              <span>Progress</span>
              <span className="text-zinc-300">{sub.done} / {sub.total}</span>
            </div>
          )}
          {sub.model && (
            <div className="flex justify-between">
              <span>Model</span>
              <span className="text-zinc-300">{(sub.model as string).toUpperCase()}</span>
            </div>
          )}
          {typeof sub.fold === 'number' && typeof sub.total_folds === 'number' && (
            <div className="flex justify-between">
              <span>Fold</span>
              <span className="text-zinc-300">{sub.fold} / {sub.total_folds}</span>
            </div>
          )}
          {sub.best_metric !== null && sub.best_metric !== undefined && (
            <div className="flex justify-between">
              <span>Best Score</span>
              <span className="text-brand-400 font-medium">{String(sub.best_metric)}</span>
            </div>
          )}
          {typeof sub.total_features === 'number' && (
            <div className="flex justify-between">
              <span>Feature Candidates</span>
              <span className="text-zinc-300">{sub.total_features}</span>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

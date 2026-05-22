'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'

interface TargetConfig {
  name: string
  method: string
  params: Record<string, number | string>
  enabled: boolean
}

const TARGET_DEFAULTS: TargetConfig[] = [
  {
    name: 'y_return_1',
    method: 'n_bar',
    params: { shift: 1, type: 'regression' },
    enabled: true,
  },
  {
    name: 'y_return_4',
    method: 'n_bar',
    params: { shift: 4, type: 'regression' },
    enabled: false,
  },
  {
    name: 'y_return_24',
    method: 'n_bar',
    params: { shift: 24, type: 'regression' },
    enabled: false,
  },
  {
    name: 'y_direction_1',
    method: 'n_bar',
    params: { shift: 1, type: 'classification' },
    enabled: true,
  },
  {
    name: 'y_direction_4',
    method: 'n_bar',
    params: { shift: 4, type: 'classification' },
    enabled: false,
  },
  {
    name: 'y_tb_2_1_24',
    method: 'triple_barrier',
    params: { tp: 0.02, sl: 0.01, max_bars: 24 },
    enabled: false,
  },
  {
    name: 'y_tb_5_2_48',
    method: 'triple_barrier',
    params: { tp: 0.05, sl: 0.02, max_bars: 48 },
    enabled: false,
  },
]

function methodBadge(method: string) {
  return method === 'triple_barrier'
    ? <span className="text-xs bg-purple-500/20 text-purple-400 border border-purple-500/30 rounded px-1.5 py-0.5">Triple Barrier</span>
    : <span className="text-xs bg-blue-500/20 text-blue-400 border border-blue-500/30 rounded px-1.5 py-0.5">N-Bar Return</span>
}

export function TargetsStep({
  onComplete,
}: {
  onComplete: (targets: object[]) => void
}) {
  const [targets, setTargets] = useState<TargetConfig[]>(TARGET_DEFAULTS)

  function toggle(name: string) {
    setTargets((prev) => prev.map((t) => (t.name === name ? { ...t, enabled: !t.enabled } : t)))
  }

  function updateParam(name: string, param: string, val: string | number) {
    setTargets((prev) =>
      prev.map((t) => (t.name === name ? { ...t, params: { ...t.params, [param]: val } } : t))
    )
  }

  function updateName(oldName: string, newName: string) {
    setTargets((prev) => prev.map((t) => (t.name === oldName ? { ...t, name: newName } : t)))
  }

  const enabledTargets = targets.filter((t) => t.enabled)

  function handleContinue() {
    const payload = enabledTargets.map((t) => ({
      name: t.name,
      method: t.method,
      params: t.params,
    }))
    onComplete(payload)
  }

  return (
    <div className="space-y-5">
      <div className="text-xs text-zinc-500">
        Select which targets to generate. Multiple targets will be trained in sequence — one model per target.
      </div>

      {/* Enabled summary */}
      {enabledTargets.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {enabledTargets.map((t) => (
            <div key={t.name} className="px-2 py-1 rounded bg-emerald-500/10 border border-emerald-500/20 text-xs text-emerald-400 font-mono">
              {t.name}
            </div>
          ))}
        </div>
      )}

      {/* Target cards */}
      <div className="space-y-3">
        {targets.map((t) => (
          <div
            key={t.name}
            className={`rounded-xl border transition-colors ${
              t.enabled ? 'border-emerald-500/30 bg-surface' : 'border-surface-border bg-surface/40'
            }`}
          >
            {/* Header */}
            <div
              className="flex items-center justify-between p-4 cursor-pointer"
              onClick={() => toggle(t.name)}
            >
              <div className="flex items-center gap-3">
                <div className={`w-4 h-4 rounded border-2 flex items-center justify-center transition-colors ${t.enabled ? 'bg-emerald-500 border-emerald-500' : 'border-zinc-600'}`}>
                  {t.enabled && <span className="text-white text-xs">✓</span>}
                </div>
                <code className="text-sm text-zinc-200">{t.name}</code>
              </div>
              {methodBadge(t.method)}
            </div>

            {/* Params */}
            {t.enabled && (
              <div className="px-4 pb-4 space-y-3 border-t border-surface-border">
                {/* Name editor */}
                <div className="mt-3">
                  <label className="text-xs text-zinc-500">Column name</label>
                  <Input
                    className="w-full bg-surface-card border border-surface-border rounded px-2 py-1 text-xs font-mono text-zinc-200 focus:outline-none focus:border-brand-500 mt-1"
                    value={t.name}
                    onChange={(e) => updateName(t.name, e.target.value)}
                  />
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  {t.method === 'n_bar' && (
                    <>
                      <div>
                        <label className="text-xs text-zinc-500">Horizon (bars)</label>
                        <Input
                          type="number"
                          className="w-full bg-surface-card border border-surface-border rounded px-2 py-1 text-xs text-zinc-200 focus:outline-none focus:border-brand-500 mt-1"
                          value={t.params.shift as number}
                          onChange={(e) => updateParam(t.name, 'shift', Number(e.target.value))}
                        />
                      </div>
                      <div>
                        <label className="text-xs text-zinc-500">Type</label>
                        <Select
                          className="w-full bg-surface-card border border-surface-border rounded px-2 py-1 text-xs text-zinc-200 focus:outline-none focus:border-brand-500 mt-1"
                          value={t.params.type as string}
                          onChange={(e) => updateParam(t.name, 'type', e.target.value)}
                        >
                          <option value="regression">Regression (return%)</option>
                          <option value="classification">Classification (direction)</option>
                        </Select>
                      </div>
                    </>
                  )}
                  {t.method === 'triple_barrier' && (
                    <>
                      <div>
                        <label className="text-xs text-zinc-500">Take Profit %</label>
                        <Input
                          type="number"
                          step="0.005"
                          className="w-full bg-surface-card border border-surface-border rounded px-2 py-1 text-xs text-zinc-200 focus:outline-none focus:border-brand-500 mt-1"
                          value={t.params.tp as number}
                          onChange={(e) => updateParam(t.name, 'tp', Number(e.target.value))}
                        />
                      </div>
                      <div>
                        <label className="text-xs text-zinc-500">Stop Loss %</label>
                        <Input
                          type="number"
                          step="0.005"
                          className="w-full bg-surface-card border border-surface-border rounded px-2 py-1 text-xs text-zinc-200 focus:outline-none focus:border-brand-500 mt-1"
                          value={t.params.sl as number}
                          onChange={(e) => updateParam(t.name, 'sl', Number(e.target.value))}
                        />
                      </div>
                      <div>
                        <label className="text-xs text-zinc-500">Max Bars</label>
                        <Input
                          type="number"
                          className="w-full bg-surface-card border border-surface-border rounded px-2 py-1 text-xs text-zinc-200 focus:outline-none focus:border-brand-500 mt-1"
                          value={t.params.max_bars as number}
                          onChange={(e) => updateParam(t.name, 'max_bars', Number(e.target.value))}
                        />
                      </div>
                    </>
                  )}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      <Button
        onClick={handleContinue}
        disabled={enabledTargets.length === 0}
        className="w-full"
      >
        Generate Features & Targets ({enabledTargets.length} target{enabledTargets.length !== 1 ? 's' : ''})
      </Button>
    </div>
  )
}

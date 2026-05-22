'use client'

import { useState, useMemo } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

interface ParamSweep {
  min: number
  max: number
  step: number
}

interface IndicatorConfig {
  name: string
  enabled: boolean
  params: Record<string, number>
  params_sweep: Record<string, ParamSweep>
  useSweep: boolean
}

const INDICATOR_DEFAULTS: Omit<IndicatorConfig, 'enabled' | 'useSweep'>[] = [
  {
    name: 'rsi',
    params: { length: 14 },
    params_sweep: { length: { min: 6, max: 30, step: 2 } },
  },
  {
    name: 'ema',
    params: { length: 21 },
    params_sweep: { length: { min: 5, max: 200, step: 5 } },
  },
  {
    name: 'sma',
    params: { length: 50 },
    params_sweep: { length: { min: 10, max: 200, step: 10 } },
  },
  {
    name: 'macd',
    params: { fast: 12, slow: 26, signal: 9 },
    params_sweep: { fast: { min: 8, max: 16, step: 2 }, slow: { min: 20, max: 32, step: 2 } },
  },
  {
    name: 'bbands',
    params: { length: 20, std: 2.0 },
    params_sweep: { length: { min: 10, max: 50, step: 5 }, std: { min: 1.5, max: 3.0, step: 0.5 } },
  },
  {
    name: 'atr',
    params: { length: 14 },
    params_sweep: { length: { min: 7, max: 28, step: 7 } },
  },
  {
    name: 'stoch',
    params: { k: 14, d: 3 },
    params_sweep: { k: { min: 5, max: 21, step: 2 } },
  },
  {
    name: 'adx',
    params: { length: 14 },
    params_sweep: { length: { min: 7, max: 28, step: 7 } },
  },
]

const PRESETS = {
  fast: { label: 'Fast Test', desc: '3 indicators, narrow ranges', enabled: ['rsi', 'ema', 'atr'] },
  research: { label: 'Research Grade', desc: 'All indicators, full sweep', enabled: INDICATOR_DEFAULTS.map(i => i.name) },
}

function countSweepCols(ind: IndicatorConfig): number {
  if (!ind.enabled) return 0
  if (!ind.useSweep) return ind.name === 'macd' ? 3 : ind.name === 'bbands' ? 4 : 1

  const sweepKeys = Object.keys(ind.params_sweep)
  let count = 1
  for (const k of sweepKeys) {
    const s = ind.params_sweep[k]
    const vals = Math.max(1, Math.ceil((s.max - s.min) / s.step) + 1)
    count *= Math.min(vals, 50)
  }
  return ind.name === 'macd' ? count * 3 : ind.name === 'bbands' ? count * 4 : count
}

export function IndicatorsStep({
  onComplete,
}: {
  onComplete: (indicators: object[], lags: number[]) => void
}) {
  const [indicators, setIndicators] = useState<IndicatorConfig[]>(
    INDICATOR_DEFAULTS.map((d) => ({ ...d, enabled: true, useSweep: false }))
  )
  const [lags, setLags] = useState('1,2,3')

  function applyPreset(preset: keyof typeof PRESETS) {
    const p = PRESETS[preset]
    setIndicators((prev) =>
      prev.map((ind) => ({
        ...ind,
        enabled: p.enabled.includes(ind.name),
        useSweep: preset === 'research',
      }))
    )
  }

  function toggleIndicator(name: string) {
    setIndicators((prev) => prev.map((i) => (i.name === name ? { ...i, enabled: !i.enabled } : i)))
  }

  function toggleSweep(name: string) {
    setIndicators((prev) => prev.map((i) => (i.name === name ? { ...i, useSweep: !i.useSweep } : i)))
  }

  function updateSweep(name: string, param: string, field: keyof ParamSweep, val: number) {
    setIndicators((prev) =>
      prev.map((i) =>
        i.name === name
          ? { ...i, params_sweep: { ...i.params_sweep, [param]: { ...i.params_sweep[param], [field]: val } } }
          : i
      )
    )
  }

  function updateParam(name: string, param: string, val: number) {
    setIndicators((prev) =>
      prev.map((i) => (i.name === name ? { ...i, params: { ...i.params, [param]: val } } : i))
    )
  }

  const totalFeatures = useMemo(() => indicators.reduce((sum, i) => sum + countSweepCols(i), 0), [indicators])

  const lagList = lags
    .split(',')
    .map((s) => parseInt(s.trim()))
    .filter((n) => !isNaN(n) && n > 0)

  const totalWithLags = totalFeatures + totalFeatures * lagList.length

  function handleContinue() {
    const payload = indicators
      .filter((i) => i.enabled)
      .map((i) => ({
        name: i.name,
        params: i.useSweep ? {} : i.params,
        params_sweep: i.useSweep ? i.params_sweep : {},
      }))
    onComplete(payload, lagList)
  }

  return (
    <div className="space-y-5">
      {/* Presets */}
      <div className="flex gap-3">
        {(Object.entries(PRESETS) as [keyof typeof PRESETS, typeof PRESETS[keyof typeof PRESETS]][]).map(([key, p]) => (
          <Button
            key={key}
            onClick={() => applyPreset(key)}
            variant="outline"
            size="sm"
            className="h-auto py-1.5"
          >
            <div className="font-medium">{p.label}</div>
            <div className="text-zinc-500">{p.desc}</div>
          </Button>
        ))}
      </div>

      {/* Feature count banner */}
      <div className="flex items-center justify-between rounded-lg bg-brand-500/10 border border-brand-500/20 px-4 py-2.5">
        <span className="text-sm text-zinc-300">Estimated features generated</span>
        <div className="text-right">
          <span className="text-xl font-bold text-brand-400">{totalWithLags.toLocaleString()}</span>
          <span className="text-xs text-zinc-500 ml-1">({totalFeatures} base + {totalFeatures * lagList.length} lags)</span>
        </div>
      </div>

      {/* Indicator cards */}
      <div className="space-y-3">
        {indicators.map((ind) => (
          <div
            key={ind.name}
            className={`rounded-xl border transition-colors ${
              ind.enabled ? 'border-brand-500/30 bg-surface' : 'border-surface-border bg-surface/50'
            }`}
          >
            {/* Header */}
            <div
              className="flex items-center justify-between p-4 cursor-pointer"
              onClick={() => toggleIndicator(ind.name)}
            >
              <div className="flex items-center gap-3">
                <div className={`w-4 h-4 rounded border-2 flex items-center justify-center transition-colors ${ind.enabled ? 'bg-brand-500 border-brand-500' : 'border-zinc-600'}`}>
                  {ind.enabled && <span className="text-white text-xs">✓</span>}
                </div>
                <span className="text-sm font-semibold text-zinc-200 uppercase">{ind.name}</span>
              </div>
              {ind.enabled && (
                <span className="text-xs text-zinc-500">{countSweepCols(ind)} col{countSweepCols(ind) !== 1 ? 's' : ''}</span>
              )}
            </div>

            {/* Params */}
            {ind.enabled && (
              <div className="px-4 pb-4 space-y-3 border-t border-surface-border">
                {/* Sweep toggle */}
                <div className="flex items-center gap-2 mt-3">
                  <Button
                    onClick={() => toggleSweep(ind.name)}
                    variant={ind.useSweep ? 'default' : 'outline'}
                    size="sm"
                    className={`h-7 px-2 text-xs font-medium ${
                      ind.useSweep ? 'bg-brand-500/20 text-brand-400 border border-brand-500/40' : 'bg-surface-border text-zinc-500'
                    }`}
                  >
                    {ind.useSweep ? '⟳ Sweep Range' : '• Fixed Value'}
                  </Button>
                </div>

                {ind.useSweep ? (
                  // Sweep mode
                  <div className="space-y-3">
                    {Object.entries(ind.params_sweep).map(([param, sweep]) => (
                      <div key={param} className="space-y-1">
                        <div className="text-xs text-zinc-400 uppercase">{param}</div>
                        <div className="grid grid-cols-3 gap-2">
                          {(['min', 'max', 'step'] as const).map((field) => (
                            <div key={field}>
                              <label className="text-xs text-zinc-600">{field}</label>
                              <Input
                                type="number"
                                className="h-8 rounded px-2 py-1 text-xs"
                                value={sweep[field]}
                                step={field === 'step' ? 0.5 : 1}
                                onChange={(e) => updateSweep(ind.name, param, field, Number(e.target.value))}
                              />
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  // Fixed mode
                  <div className="grid grid-cols-3 gap-2 mt-2">
                    {Object.entries(ind.params).map(([param, val]) => (
                      <div key={param}>
                        <label className="text-xs text-zinc-500 uppercase">{param}</label>
                        <Input
                          type="number"
                          className="h-8 rounded px-2 py-1 text-xs"
                          value={val}
                          onChange={(e) => updateParam(ind.name, param, Number(e.target.value))}
                        />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Lag features */}
      <div>
        <label className="block text-xs text-zinc-400 mb-1">Lag periods (comma-separated)</label>
        <Input
          className="w-full bg-surface border border-surface-border rounded-lg px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:border-brand-500"
          value={lags}
          onChange={(e) => setLags(e.target.value)}
          placeholder="1, 2, 3"
        />
        <div className="text-xs text-zinc-600 mt-1">Creates lagged versions of all generated features</div>
      </div>

      <Button
        onClick={handleContinue}
        disabled={totalFeatures === 0}
        className="w-full"
      >
        Continue → Configure Targets ({totalWithLags.toLocaleString()} features)
      </Button>
    </div>
  )
}

'use client'

import { useState } from 'react'
import { useAppStore, WizardStep, Pipeline, AIModel, BacktestResult } from '@/store/appStore'
import { generatePipeline, connectTaskWS, TaskProgress } from '@/lib/api'
import { DataSourceStep } from '@/components/wizard/steps/DataSourceStep'
import { IndicatorsStep } from '@/components/wizard/steps/IndicatorsStep'
import { TargetsStep } from '@/components/wizard/steps/TargetsStep'
import { TrainingStep } from '@/components/wizard/steps/TrainingStep'
import { BacktestStep } from '@/components/wizard/steps/BacktestStep'
import { ResultsStep } from '@/components/wizard/steps/ResultsStep'
import { GranularProgress } from '@/components/ui/GranularProgress'
import { toast } from 'sonner'
import { getApiErrorMessage } from '@/lib/api-error'

const STEPS: { id: WizardStep; label: string; short: string }[] = [
  { id: 'data', label: 'Data Source', short: '1' },
  { id: 'indicators', label: 'Indicators', short: '2' },
  { id: 'targets', label: 'Targets', short: '3' },
  { id: 'training', label: 'Train Model', short: '4' },
  { id: 'backtest', label: 'Backtest', short: '5' },
  { id: 'results', label: 'Results', short: '6' },
]

export default function ResearchPage() {
  const {
    currentStep,
    completedSteps,
    wizardDataset,
    wizardDataPreview,
    wizardPipeline,
    wizardModel,
    wizardBacktest,
    wizardEquityCurve,
    setWizardStep,
    completeWizardStep,
    setWizardPipeline,
    setWizardModel,
    setWizardBacktest,
    setTaskProgress,
    taskProgress,
    taskMessage,
    taskStep,
    taskSub,
    taskStatus,
    resetWizard,
  } = useAppStore()

  // Intermediate state for indicators (held between step 2 and step 3)
  const [indicatorsConfig, setIndicatorsConfig] = useState<object[] | null>(null)
  const [lags, setLags] = useState<number[]>([1, 2, 3])
  const [pipelineLoading, setPipelineLoading] = useState(false)
  const [pipelineError, setPipelineError] = useState<string | null>(null)

  function goToStep(step: WizardStep) {
    // Only allow navigation to completed steps or the current step
    const idx = STEPS.findIndex((s) => s.id === step)
    const curIdx = STEPS.findIndex((s) => s.id === currentStep)
    if (idx <= curIdx || completedSteps.includes(step)) {
      setWizardStep(step)
    }
  }

  // Step 1: data fetched / uploaded
  function handleDataComplete() {
    completeWizardStep('data')
    setWizardStep('indicators')
  }

  // Step 2: indicators configured (just advance, store config in local state)
  function handleIndicatorsComplete(indicators: object[], lagList: number[]) {
    setIndicatorsConfig(indicators)
    setLags(lagList)
    completeWizardStep('indicators')
    setWizardStep('targets')
  }

  // Step 3: targets configured — now trigger pipeline generation
  async function handleTargetsComplete(targets: object[]) {
    if (!wizardDataset || !indicatorsConfig) return
    setPipelineLoading(true)
    setPipelineError(null)

    try {
      const res = await generatePipeline({
        dataset_id: wizardDataset.id,
        name: `${wizardDataset.symbol} ${wizardDataset.timeframe} pipeline`,
        indicators: indicatorsConfig,
        lags,
        targets,
      })
      const { task_id } = res.data
      setTaskProgress(task_id, 5, 'Starting pipeline...', 'PROGRESS', 'STEP 1/4 Loading data')

      await new Promise<void>((resolve, reject) => {
        connectTaskWS(task_id, async (data: TaskProgress) => {
          setTaskProgress(data.task_id, data.progress, data.message, data.status, data.step, data.sub as Record<string, unknown>)
          if (data.status === 'SUCCESS' && data.result) {
            const { getPipeline } = await import('@/lib/api')
            const pRes = await getPipeline(data.result.pipeline_id as string)
            setWizardPipeline(pRes.data)
            setPipelineLoading(false)
            toast.success('Feature pipeline generated')
            completeWizardStep('targets')
            setWizardStep('training')
            resolve()
          } else if (data.status === 'FAILURE') {
            const err = data.error || 'Pipeline generation failed'
            setPipelineError(err)
            toast.error(err)
            setPipelineLoading(false)
            reject()
          }
        })
      })
    } catch (e: unknown) {
      setPipelineLoading(false)
      toast.error(getApiErrorMessage(e, 'Pipeline generation failed'))
    }
  }

  // Step 4: model trained
  function handleTrainingComplete(model: object) {
    setWizardModel(model as AIModel)
    completeWizardStep('training')
    setWizardStep('backtest')
  }

  // Step 5: backtest done
  function handleBacktestComplete(backtest: object, curve: { time: string; value: number }[]) {
    setWizardBacktest(backtest as BacktestResult, curve)
    completeWizardStep('backtest')
    setWizardStep('results')
  }

  const stepIdx = STEPS.findIndex((s) => s.id === currentStep)

  return (
    <div className="min-h-screen bg-surface-card">
      {/* Top header */}
      <div className="border-b border-surface-border px-6 py-4 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-zinc-200">Research Wizard</h1>
          <p className="text-xs text-zinc-500 mt-0.5">
            {wizardDataset ? `${wizardDataset.symbol} · ${wizardDataset.timeframe}` : 'Build a complete quant strategy in 6 steps'}
          </p>
        </div>
        <button
          onClick={resetWizard}
          className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
        >
          Reset Wizard
        </button>
      </div>

      <div className="max-w-5xl mx-auto px-4 py-6 flex gap-6">
        {/* Step sidebar */}
        <div className="w-48 shrink-0">
          <div className="space-y-1 sticky top-6">
            {STEPS.map((s, i) => {
              const isDone = completedSteps.includes(s.id)
              const isCurrent = currentStep === s.id
              const isAccessible = isDone || isCurrent || completedSteps.includes(STEPS[i - 1]?.id)

              return (
                <button
                  key={s.id}
                  onClick={() => isAccessible && goToStep(s.id)}
                  disabled={!isAccessible}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-colors ${
                    isCurrent
                      ? 'bg-brand-500/20 border border-brand-500/40 text-brand-300'
                      : isDone
                      ? 'text-emerald-400 hover:bg-surface'
                      : isAccessible
                      ? 'text-zinc-400 hover:bg-surface'
                      : 'text-zinc-700 cursor-default'
                  }`}
                >
                  <div className={`w-6 h-6 rounded-full border flex items-center justify-center text-xs font-bold shrink-0 ${
                    isCurrent ? 'border-brand-500 bg-brand-500/30 text-brand-300'
                    : isDone ? 'border-emerald-500 bg-emerald-500/20 text-emerald-400'
                    : 'border-zinc-700 text-zinc-600'
                  }`}>
                    {isDone ? '✓' : s.short}
                  </div>
                  <span className="text-sm">{s.label}</span>
                </button>
              )
            })}

            {/* Progress indicator */}
            <div className="mt-4 px-3">
              <div className="text-xs text-zinc-600 mb-1">{completedSteps.length}/6 complete</div>
              <div className="h-1.5 bg-surface-border rounded-full overflow-hidden">
                <div
                  className="h-full bg-brand-500 rounded-full transition-all"
                  style={{ width: `${(completedSteps.length / 6) * 100}%` }}
                />
              </div>
            </div>
          </div>
        </div>

        {/* Main content */}
        <div className="flex-1 min-w-0">
          <div className="rounded-2xl border border-surface-border bg-surface p-6">
            {/* Step title */}
            <div className="mb-6 pb-4 border-b border-surface-border">
              <div className="flex items-center gap-2">
                <span className="text-xs text-zinc-500">Step {stepIdx + 1} of {STEPS.length}</span>
                <span className="text-zinc-700">·</span>
                <span className="text-sm font-semibold text-zinc-200">{STEPS[stepIdx]?.label}</span>
              </div>
            </div>

            {/* Pipeline generation progress (shown during step 3→4 transition) */}
            {pipelineLoading && (
              <div className="mb-6">
                <GranularProgress
                  progress={taskProgress}
                  message={taskMessage}
                  step={taskStep}
                  sub={taskSub}
                  status={taskStatus}
                />
              </div>
            )}
            {pipelineError && (
              <div className="mb-4 rounded-lg bg-red-500/10 border border-red-500/30 p-3 text-sm text-red-400">
                {pipelineError}
              </div>
            )}

            {/* Step content */}
            {currentStep === 'data' && (
              <DataSourceStep
                onComplete={handleDataComplete}
              />
            )}

            {currentStep === 'indicators' && wizardDataset && (
              <IndicatorsStep
                onComplete={handleIndicatorsComplete}
              />
            )}

            {currentStep === 'targets' && !pipelineLoading && (
              <TargetsStep
                onComplete={handleTargetsComplete}
              />
            )}

            {currentStep === 'training' && wizardPipeline && (
              <TrainingStep
                pipelineId={wizardPipeline.id}
                featureColumns={wizardPipeline.feature_columns || []}
                onComplete={handleTrainingComplete}
              />
            )}

            {currentStep === 'backtest' && wizardModel && (
              <BacktestStep
                modelId={wizardModel.id}
                onComplete={handleBacktestComplete}
              />
            )}

            {currentStep === 'results' && (
              <ResultsStep />
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

import { create } from 'zustand'
import { persist } from 'zustand/middleware'

// Legacy compat alias — used by old research/page.tsx
export type WizardStep = string

// ---------------------------------------------------------------------------
// Domain types
// ---------------------------------------------------------------------------
export interface Dataset {
  id: string
  symbol: string
  timeframe: string
  row_count: string | null
  source?: string | null
  pipeline_count?: number | null
  date_from?: string | null
  date_to?: string | null
  created_at: string
  s3_raw_path?: string
}

export interface DataPreparation {
  id: string
  dataset_id: string
  pipeline_id: string | null
  name: string | null
  alignment_config: Record<string, unknown>
  cleaning_config: Record<string, unknown>
  missing_value_config: Record<string, unknown>
  normalization_config: Record<string, unknown>
  status: string
  celery_task_id: string | null
  s3_prepared_path: string | null
  quality_before: Record<string, unknown> | null
  quality_after: Record<string, unknown> | null
  error_message: string | null
  created_at: string
  updated_at: string
}

export interface Pipeline {
  id: string
  name: string | null
  status: string
  celery_task_id: string | null
  feature_columns: string[] | null
  indicators_config: Record<string, unknown>[] | null
  targets_config: Record<string, unknown>[] | null
  lags: number[] | null
  dataset_id: string
  s3_processed_path: string | null
  error_message: string | null
  created_at: string
  updated_at: string
}

// LabeledDataset — output of Labeling System page
export interface LabeledDataset {
  id: string
  data_prep_id: string | null
  name: string | null
  targets_config: Record<string, unknown>[] | null
  target_columns: string[] | null
  feature_columns: string[] | null
  s3_labeled_path: string | null
  status: string
  celery_task_id: string | null
  error_message: string | null
  created_at: string
  updated_at: string
}

export interface FeatureSet {
  id: string
  labeled_dataset_id: string | null
  name: string
  selected_columns: string[]
  target_column: string
  analysis_snapshot?: Record<string, unknown> | null
  analysis_config?: Record<string, unknown> | null
  status: string
  celery_task_id?: string | null
  error_message?: string | null
  created_at: string
}

export interface AIModel {
  id: string
  feature_set_id?: string | null
  target_column: string
  model_type: string
  hyperparameters?: Record<string, unknown> | null
  status: string
  selected_features: string[] | null
  feature_importances: Record<string, number> | null
  cv_metrics: Record<string, unknown> | null
  mlflow_run_id: string | null
  error_message: string | null
  created_at: string
}

export interface BacktestResult {
  id: string
  status: string
  metrics: Record<string, number | string | unknown> | null
  s3_equity_curve_path: string | null
  model_id: string
  strategy_config: Record<string, unknown>
  created_at: string
}

// ---------------------------------------------------------------------------
// Task progress
// ---------------------------------------------------------------------------
export interface TaskState {
  activeTaskId: string | null
  taskProgress: number
  taskMessage: string
  taskStatus: string
  taskStep: string
  taskSub: Record<string, unknown>
}

// ---------------------------------------------------------------------------
// Active selection (persisted to localStorage)
// ---------------------------------------------------------------------------
export interface ActiveSelection {
  activeDatasetId: string | null
  activePipelineId: string | null
  activePrepId: string | null
  activeLabeledDatasetId: string | null
  activeFeatureSetId: string | null
  activeModelId: string | null
  activeBacktestId: string | null
}

interface AppState extends TaskState, ActiveSelection {
  setTaskProgress: (taskId: string, progress: number, message: string, status: string, step?: string, sub?: Record<string, unknown>) => void
  clearTask: () => void
  setActiveDataset: (id: string | null) => void
  setActivePipeline: (id: string | null) => void
  setActivePrep: (id: string | null) => void
  setActiveLabeledDataset: (id: string | null) => void
  setActiveFeatureSet: (id: string | null) => void
  setActiveModel: (id: string | null) => void
  setActiveBacktest: (id: string | null) => void
  // Legacy wizard shim
  wizardDataset: Dataset | null
  wizardDataPreview: Record<string, unknown> | null
  wizardPipeline: Pipeline | null
  wizardModel: AIModel | null
  wizardBacktest: BacktestResult | null
  wizardEquityCurve: { time: string; value: number }[]
  currentStep: string
  completedSteps: string[]
  setWizardDataset: (d: Dataset | null, preview?: Record<string, unknown> | null) => void
  setWizardPipeline: (p: Pipeline | null) => void
  setWizardModel: (m: AIModel | null) => void
  setWizardBacktest: (b: BacktestResult | null, curve?: { time: string; value: number }[]) => void
  setWizardStep: (step: string) => void
  completeWizardStep: (step: string) => void
  resetWizard: () => void
}

const defaultTask: TaskState = {
  activeTaskId: null,
  taskProgress: 0,
  taskMessage: '',
  taskStatus: '',
  taskStep: '',
  taskSub: {},
}

const defaultActive: ActiveSelection = {
  activeDatasetId: null,
  activePipelineId: null,
  activePrepId: null,
  activeLabeledDatasetId: null,
  activeFeatureSetId: null,
  activeModelId: null,
  activeBacktestId: null,
}

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      ...defaultTask,
      ...defaultActive,
      setTaskProgress: (activeTaskId, taskProgress, taskMessage, taskStatus, taskStep = '', taskSub = {}) =>
        set({ activeTaskId, taskProgress, taskMessage, taskStatus, taskStep, taskSub }),
      clearTask: () => set({ ...defaultTask }),
      setActiveDataset: (id) => set({ activeDatasetId: id }),
      setActivePipeline: (id) => set({ activePipelineId: id }),
      setActivePrep: (id) => set({ activePrepId: id }),
      setActiveLabeledDataset: (id) => set({ activeLabeledDatasetId: id }),
      setActiveFeatureSet: (id) => set({ activeFeatureSetId: id }),
      setActiveModel: (id) => set({ activeModelId: id }),
      setActiveBacktest: (id) => set({ activeBacktestId: id }),
      // Legacy shim
      wizardDataset: null,
      wizardDataPreview: null,
      wizardPipeline: null,
      wizardModel: null,
      wizardBacktest: null,
      wizardEquityCurve: [],
      currentStep: 'data',
      completedSteps: [],
      setWizardDataset: (d, preview = null) => set({ wizardDataset: d, wizardDataPreview: preview }),
      setWizardPipeline: (p) => set({ wizardPipeline: p }),
      setWizardModel: (m) => set({ wizardModel: m }),
      setWizardBacktest: (b, curve = []) => set({ wizardBacktest: b, wizardEquityCurve: curve }),
      setWizardStep: (step) => set({ currentStep: step }),
      completeWizardStep: (step) =>
        set((s) => ({ completedSteps: s.completedSteps.includes(step) ? s.completedSteps : [...s.completedSteps, step] })),
      resetWizard: () =>
        set({ wizardDataset: null, wizardDataPreview: null, wizardPipeline: null, wizardModel: null,
              wizardBacktest: null, wizardEquityCurve: [], currentStep: 'data', completedSteps: [], ...defaultTask }),
    }),
    {
      name: 'quant-lab-store',
      partialize: (s) => ({
        activeDatasetId: s.activeDatasetId,
        activePipelineId: s.activePipelineId,
        activePrepId: s.activePrepId,
        activeLabeledDatasetId: s.activeLabeledDatasetId,
        activeFeatureSetId: s.activeFeatureSetId,
        activeModelId: s.activeModelId,
        activeBacktestId: s.activeBacktestId,
      }),
    }
  )
)

import axios from 'axios'
import { getApiErrorMessage } from '@/lib/api-error'

const api = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_URL + '/api/v1',
  headers: { 'Content-Type': 'application/json' },
})

api.interceptors.response.use(
  (response) => response,
  (error) => Promise.reject(new Error(getApiErrorMessage(error)))
)

// ---- Datasets ----
export const uploadDataset = (formData: FormData) =>
  api.post('/datasets/upload', formData, { headers: { 'Content-Type': 'multipart/form-data' } })

export const listDatasets = () => api.get('/datasets/')
export const getDataset = (id: string) => api.get(`/datasets/${id}`)
export const previewDataset = (id: string, rows = 200) => api.get(`/datasets/${id}/preview?rows=${rows}`)
export const getDatasetStats = (id: string) => api.get(`/datasets/${id}/stats`)
export const getDatasetChartData = (id: string) => api.get(`/datasets/${id}/chart-data`)
export const getDatasetDownloadUrl = (id: string) => api.get(`/datasets/${id}/download`)
export const deleteDataset = (id: string) => api.delete(`/datasets/${id}`)

// ---- Pipelines (Feature Factory) ----
export const generatePipeline = (payload: object) => api.post('/pipelines/generate', payload)
export const preflightPipeline = (payload: object) => api.post('/pipelines/preflight', payload)
export const listPipelines = () => api.get('/pipelines/')
export const getPipeline = (id: string) => api.get(`/pipelines/${id}`)
export const previewPipeline = (id: string, rows = 200) => api.get(`/pipelines/${id}/preview?rows=${rows}`)
export const deletePipeline = (id: string) => api.delete(`/pipelines/${id}`)
export const downloadPipeline = (id: string) => api.get(`/pipelines/${id}/download`)

// ---- Data Preparation ----
export const prepareData = (payload: object) => api.post('/data-prep/prepare', payload)
export const listDataPreps = () => api.get('/data-prep/')
export const getDataPrep = (id: string) => api.get(`/data-prep/${id}`)
export const previewPreparedData = (id: string, rows = 200) => api.get(`/data-prep/${id}/preview?rows=${rows}`)
export const deleteDataPrep = (id: string) => api.delete(`/data-prep/${id}`)
export const downloadPreparedData = (id: string) => api.get(`/data-prep/${id}/download`)

// ---- Labeled Datasets (Labeling System) ----
export const createLabeledDataset = (payload: object) => api.post('/labeled-datasets/', payload)
export const listLabeledDatasets = () => api.get('/labeled-datasets/')
export const getLabeledDataset = (id: string) => api.get(`/labeled-datasets/${id}`)
export const deleteLabeledDataset = (id: string) => api.delete(`/labeled-datasets/${id}`)
export const previewLabeledDataset = (id: string, rows = 200) => api.get(`/labeled-datasets/${id}/preview?rows=${rows}`)
export const getLabeledTargetStats = (id: string) => api.get(`/labeled-datasets/${id}/target-stats`)
export const downloadLabeledDataset = (id: string) => api.get(`/labeled-datasets/${id}/download`)

// ---- Feature Sets (Feature Selection) ----
export const createFeatureSet = (payload: object) => api.post('/feature-sets/', payload)
export const listFeatureSets = () => api.get('/feature-sets/')
export const getFeatureSet = (id: string) => api.get(`/feature-sets/${id}`)
export const previewFeatureSet = (id: string, rows = 200) => api.get(`/feature-sets/${id}/preview?rows=${rows}`)
export const deleteFeatureSet = (id: string) => api.delete(`/feature-sets/${id}`)
export const suggestFeatureColumns = (payload: object) => api.post('/feature-sets/suggest', payload)

// ---- Models ----
export const trainModel = (payload: object) => api.post('/models/train', payload)
export const listModels = () => api.get('/models/')
export const getModel = (id: string) => api.get(`/models/${id}`)
export const deleteModel = (id: string) => api.delete(`/models/${id}`)

// ---- Backtests ----
export const runBacktest = (payload: object) => api.post('/backtests/run', payload)
export const listBacktests = () => api.get('/backtests/')
export const getBacktest = (id: string) => api.get(`/backtests/${id}`)
export const deleteBacktest = (id: string) => api.delete(`/backtests/${id}`)
export const getEquityCurve = (id: string) => api.get(`/backtests/${id}/equity-curve`)

// ---- Market Data Fetch ----
export const listFetchSources = () => api.get('/fetch/sources')
export const fetchMarketData = (payload: object) => api.post('/fetch/market-data', payload)

// ---- Experiments (Backtest Compare) ----
export const listExperiments = () => api.get('/experiments/')
export const compareExperiments = (ids: string[]) => api.post('/experiments/compare', { experiment_ids: ids })

// ---- Feature Stability (Research Experiments) ----
export const listStabilityExperiments = () => api.get('/stability/')
export const getStabilityExperiment = (id: string) => api.get(`/stability/${id}`)
export const createStabilityExperiment = (payload: object) => api.post('/stability/', payload)

// ---- WebSocket task progress ----
export interface TaskWSHooks {
  onError?: (message: string) => void
  onClose?: (ev: CloseEvent) => void
}

export const getTaskStatus = (taskId: string) => api.get<TaskProgress>(`/ws/task/${taskId}`)

export function connectTaskWS(
  taskId: string,
  onMessage: (data: TaskProgress) => void,
  onDone?: () => void,
  hooks?: TaskWSHooks,
): WebSocket {
  const ws = new WebSocket(`${process.env.NEXT_PUBLIC_WS_URL}/api/v1/ws/task/${taskId}`)
  let terminalReceived = false

  ws.onmessage = (e) => {
    try {
      const data: TaskProgress = JSON.parse(e.data)
      onMessage(data)
      if (data.status === 'SUCCESS' || data.status === 'FAILURE') {
        terminalReceived = true
        ws.close()
        onDone?.()
      }
    } catch {
      hooks?.onError?.('Invalid task stream payload')
    }
  }

  ws.onerror = () => {
    hooks?.onError?.('Task stream connection error')
  }

  ws.onclose = (ev) => {
    if (!terminalReceived && !ev.wasClean) {
      hooks?.onError?.('Task stream disconnected before completion')
    }
    hooks?.onClose?.(ev)
  }

  return ws
}

export interface TaskProgress {
  task_id: string
  status: string
  progress: number
  message: string
  step?: string
  sub?: Record<string, unknown>
  result?: Record<string, unknown>
  error?: string
}

export interface PipelinePreflightReport {
  row_count: number | null
  lag_count: number
  base_feature_columns: number
  total_feature_columns: number
  estimated_bytes: number | null
  column_limit: number
  estimated_bytes_limit: number
  over_columns: boolean
  over_bytes: boolean
  accepted: boolean
  message?: string | null
}

// ---- Hyperparameter Sweeps ----
export const createSweep = (payload: object) => api.post('/sweeps', payload)
export const listSweeps = () => api.get('/sweeps')
export const getSweep = (id: string) => api.get(`/sweeps/${id}`)
export const getSweepJobs = (sweepId: string) => api.get(`/sweeps/${sweepId}/jobs`)
export const addSweepJob = (sweepId: string, payload: object) => api.post(`/sweeps/${sweepId}/jobs`, payload)
export const updateSweepJob = (sweepId: string, jobId: string, updates: object) =>
  api.patch(`/sweeps/${sweepId}/jobs/${jobId}`, updates)

export interface Sweep {
  id: string
  feature_set_id: string
  model_type: string
  param_grid: Record<string, unknown>
  cv_splits: string
  cv_gap: string
  status: string
  total_jobs: string
  completed_jobs: string
  failed_jobs: string
  created_at: string
  updated_at: string
  jobs?: SweepJob[]
}

export interface SweepJob {
  id: string
  sweep_id: string
  model_id: string | null
  hyperparameters: Record<string, unknown>
  cv_metrics: Record<string, number> | null
  status: string
  created_at: string
  updated_at: string
}

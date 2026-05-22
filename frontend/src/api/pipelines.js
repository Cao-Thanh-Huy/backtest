/**
 * API client for Pipelines — re-exports from client.js for modular imports
 */
export {
  listPipelines,
  getPipeline,
  createPipeline,
  updatePipeline,
  deletePipeline,
  publishPipeline,
  triggerPipelineRun,
  getPipelineRuns,
  getRun,
  forceUnlockPipeline,
  resetWatermark,
} from './client.js'

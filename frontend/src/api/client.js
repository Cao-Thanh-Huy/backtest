/**
 * API Client — QuantFlow Studio
 * Giao tiep voi FastAPI Backend.
 * Tu dong gan Bearer token tu localStorage vao moi request.
 */
const BASE_URL = '/api';

/**
 * Returns the stored JWT or null if not authenticated.
 */
function getToken() {
  return localStorage.getItem('de_platform_token') || null;
}

async function request(url, options = {}) {
  const token = getToken();
  const authHeader = token ? { Authorization: `Bearer ${token}` } : {};
  const resp = await fetch(`${BASE_URL}${url}`, {
    headers: { 'Content-Type': 'application/json', ...authHeader, ...options.headers },
    ...options,
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ detail: resp.statusText }));
    const e = new Error(typeof err.detail === 'object' ? (err.detail.message || JSON.stringify(err.detail)) : (err.detail || `HTTP ${resp.status}`));
    e.status = resp.status;
    e.data = err.detail;
    throw e;
  }
  if (resp.status === 204 || resp.status === 205) {
    return null;
  }
  return resp.json();
}

// ── System ───────────────────────
export const checkHealth = () => request('/health');
export const getContainers = () => request('/system/containers');

// ── Data Models — Schemas ───────
export const getSchemas = (branch = 'main') => request(`/models/schemas?branch=${encodeURIComponent(branch)}`);
export const createSchema = (data, branch = 'main') => request(`/models/schemas?branch=${encodeURIComponent(branch)}`, { method: 'POST', body: JSON.stringify(data) });
export const dropSchema = (name, branch = 'main') => request(`/models/schemas/${name}?branch=${encodeURIComponent(branch)}`, { method: 'DELETE' });

// ── Data Models — Tables ────────
export const getTables = (schema, branch = 'main') => request(`/models/tables/${schema}?branch=${encodeURIComponent(branch)}`);
export const createTable = (data, branch = 'main') => request(`/models/tables?branch=${encodeURIComponent(branch)}`, { method: 'POST', body: JSON.stringify(data) });
export const dropTable = (schema, table, branch = 'main') => request(`/models/tables/${schema}/${table}?branch=${encodeURIComponent(branch)}`, { method: 'DELETE' });
export const truncateTable = (schema, table, branch = 'main') => request(`/models/tables/${schema}/${table}/rows?branch=${encodeURIComponent(branch)}`, { method: 'DELETE' });
export const renameTable = (schema, table, data, branch = 'main') => request(`/models/tables/${schema}/${table}/rename?branch=${encodeURIComponent(branch)}`, { method: 'POST', body: JSON.stringify(data) });
export const cloneTable = (schema, table, data, branch = 'main') => request(`/models/tables/${schema}/${table}/clone?branch=${encodeURIComponent(branch)}`, { method: 'POST', body: JSON.stringify(data) });

// ── Data Models — Table Detail ──
export const describeTable = (schema, table, branch = 'main') => request(`/models/tables/${schema}/${table}/columns?branch=${encodeURIComponent(branch)}`);
export const getTableProps = (schema, table, branch = 'main') => request(`/models/tables/${schema}/${table}/properties?branch=${encodeURIComponent(branch)}`);
export const getTableStats = (schema, table, branch = 'main') => request(`/models/tables/${schema}/${table}/stats?branch=${encodeURIComponent(branch)}`);
export const previewTable = (schema, table, limit = 50, snapshotId = null, search = null, branch = 'main') => {
  let url = `/models/tables/${schema}/${table}/preview?limit=${limit}&branch=${encodeURIComponent(branch)}`;
  if (snapshotId) url += `&snapshot_id=${snapshotId}`;
  if (search) url += `&search=${encodeURIComponent(search)}`;
  return request(url);
};
export const getSnapshots = (schema, table, branch = 'main') => request(`/models/tables/${schema}/${table}/snapshots?branch=${encodeURIComponent(branch)}`);
export const alterTable = (schema, table, data, branch = 'main') => request(`/models/tables/${schema}/${table}/alter?branch=${encodeURIComponent(branch)}`, { method: 'POST', body: JSON.stringify(data) });
export const rollbackToSnapshot = (schema, table, snapshot_id, branch = 'main') =>
  request(`/models/tables/${schema}/${table}/rollback?branch=${encodeURIComponent(branch)}`, { method: 'POST', body: JSON.stringify({ snapshot_id }) });

export const optimizeTable = (schema, table, branch = 'main') =>
  request(`/models/tables/${schema}/${table}/optimize`, { method: 'POST', body: JSON.stringify({ branch }) });

export const vacuumTable = (schema, table, retention_threshold = '7d', retain_last = 1, branch = 'main') =>
  request(`/models/tables/${schema}/${table}/vacuum`, { method: 'POST', body: JSON.stringify({ branch, retention_threshold, retain_last }) });

export const insertTableData = (schema, table, data, branch = 'main') => request(`/models/tables/${schema}/${table}/insert?branch=${encodeURIComponent(branch)}`, { method: 'POST', body: JSON.stringify(data) });

// ── Serving Layer ────────────────────────────────────────────────────────────
export const getServingTables = (enabled) => request(`/serving/tables${enabled !== undefined ? `?enabled=${enabled}` : ''}`);
export const getServingTable = (gold_table) => request(`/serving/tables/${gold_table}`);
export const createServingTable = (data) => request(`/serving/tables`, { method: 'POST', body: JSON.stringify(data) });
export const updateServingTable = (gold_table, data) => request(`/serving/tables/${gold_table}`, { method: 'PATCH', body: JSON.stringify(data) });
export const deleteServingTable = (gold_table) => request(`/serving/tables/${gold_table}`, { method: 'DELETE' });
export const triggerServingSync = (gold_table) => request(`/serving/tables/${gold_table}/sync`, { method: 'POST' });
export const getServingTableHistory = (gold_table) => request(`/serving/tables/${gold_table}/history`);
export const confirmServingTablePK = (gold_table, pk) => request(`/serving/pending/${gold_table}/confirm`, { method: 'POST', body: JSON.stringify({ pk_column: pk }) });
export const skipServingTablePK = (gold_table) => request(`/serving/pending/${gold_table}/skip-pk`, { method: 'POST' });
// ── Pipelines ────────────────────────────────────────────────────────────────
export const listPipelines = () => request('/v1/pipelines/');
export const getPipeline = (id) => request(`/v1/pipelines/${id}`);
export const createPipeline = (data) => request('/v1/pipelines/', { method: 'POST', body: JSON.stringify(data) });
export const updatePipeline = (id, data) => request(`/v1/pipelines/${id}`, { method: 'PUT', body: JSON.stringify(data) });
export const deletePipeline = (id) => request(`/v1/pipelines/${id}`, { method: 'DELETE' });
export const publishPipeline = (id, data) => request(`/v1/pipelines/${id}/publish`, { method: 'POST', body: JSON.stringify(data) });
export const clonePipeline = (id, data) => request(`/v1/pipelines/${id}/clone`, { method: 'POST', body: JSON.stringify(data) });
export const togglePipelineEnabled = (id) => request(`/v1/pipelines/${id}/toggle-enabled`, { method: 'POST' });
export const preflightFeaturePipeline = (data) => request('/v1/pipelines/preflight', { method: 'POST', body: JSON.stringify(data) });
export const generateFeaturePipeline = (data) => request('/v1/pipelines/generate', { method: 'POST', body: JSON.stringify(data) });
export const getFeaturePipelinePreview = (id, rows = 200, colOffset = 0, colLimit = 50) => request(`/v1/pipelines/${id}/preview?rows=${rows}&col_offset=${colOffset}&col_limit=${colLimit}`);
export const getFeaturePipelineDownload = (id) => request(`/v1/pipelines/${id}/download`);
export const cancelPipeline = (id) => request(`/v1/pipelines/${id}/cancel`, { method: 'POST' });

export const getPipelineVersions = (id) => request(`/v1/pipelines/${id}/versions`);
export const getVersionSQL = (id, version) => request(`/v1/pipelines/${id}/versions/${version}/sql`);
export const getWapPlan = (id, version, runId = '{{ run_id }}', watermark = '{{ pipeline_watermark }}', startSnapshotId = '', endSnapshotId = '') => {
  const params = new URLSearchParams({ run_id: runId, watermark });
  if (startSnapshotId) params.set('start_snapshot_id', startSnapshotId);
  if (endSnapshotId) params.set('end_snapshot_id', endSnapshotId);
  return request(`/v1/pipelines/${id}/versions/${version}/wap-plan?${params.toString()}`);
};

// Runs
export const triggerPipelineRun = (id, { version, run_mode, start_snapshot_id, end_snapshot_id } = {}) => {
  const params = new URLSearchParams();
  if (version) params.set('version', version);
  if (run_mode) params.set('run_mode', run_mode);
  if (start_snapshot_id) params.set('start_snapshot_id', start_snapshot_id);
  if (end_snapshot_id) params.set('end_snapshot_id', end_snapshot_id);
  const qs = params.toString();
  const url = `/v1/pipelines/${id}/run${qs ? '?' + qs : ''}`;
  return request(url, { method: 'POST' });
};
export const getPipelineRuns = (id) => request(`/v1/pipelines/${id}/runs`);
export const listPipelineRuns = (id, limit = 10) => request(`/v1/pipelines/${id}/runs?limit=${limit}`);
export const getPipelineRunsFromDagster = (id, limit = 30) => request(`/v1/pipelines/${id}/runs?limit=${limit}`);
export const getDagsterRunErrorLog = (dagsterRunId) => request(`/v1/pipelines/dagster-run-log/${dagsterRunId}`);
export const getRun = (runId) => request(`/v1/pipelines/runs/${runId}`);
export const cancelPipelineRun = (runId) => request(`/v1/pipelines/runs/${runId}/cancel`, { method: 'POST' });
export const forceUnlockPipeline = (id) => request(`/v1/pipelines/${id}/unlock`, { method: 'POST' });
export const resetWatermark = (id) => request(`/v1/pipelines/${id}/watermark/reset`, { method: 'POST' });

// Schedule
export const setPipelineSchedule = (id, data) => request(`/v1/pipelines/${id}/schedule`, { method: 'POST', body: JSON.stringify(data) });
export const getPipelineSchedule = (id) => request(`/v1/pipelines/${id}/schedule`);
export const deletePipelineSchedule = (id) => request(`/v1/pipelines/${id}/schedule`, { method: 'DELETE' });

// ── Downstream Triggers (Connector → Pipeline event-driven links) ────────────
// From Connector side: manage which pipelines auto-run after this connector syncs
export const listDownstreamTriggers = (connectorId) => request(`/connectors/${connectorId}/downstream`);
export const addDownstreamTrigger = (connectorId, data) => request(`/connectors/${connectorId}/downstream`, { method: 'POST', body: JSON.stringify(data) });
export const updateDownstreamTrigger = (connectorId, triggerId, data) => request(`/connectors/${connectorId}/downstream/${triggerId}`, { method: 'PATCH', body: JSON.stringify(data) });
export const removeDownstreamTrigger = (connectorId, triggerId) => request(`/connectors/${connectorId}/downstream/${triggerId}`, { method: 'DELETE' });

// From Pipeline side: which connectors trigger this pipeline (reverse lookup)
export const getPipelineTriggerSources = (pipelineId) => request(`/v1/pipelines/${pipelineId}/trigger-sources`);

// Pipeline -> Pipeline (Event-Driven)
export const getPipelineDownstreamTriggers = (pipelineId) => request(`/v1/pipelines/${pipelineId}/downstream`);
export const addPipelineDownstreamTrigger = (pipelineId, data) => request(`/v1/pipelines/${pipelineId}/downstream`, { method: 'POST', body: JSON.stringify(data) });
export const updatePipelineDownstreamTrigger = (pipelineId, triggerId, data) => request(`/v1/pipelines/${pipelineId}/downstream/${triggerId}`, { method: 'PATCH', body: JSON.stringify(data) });
export const removePipelineDownstreamTrigger = (pipelineId, triggerId) => request(`/v1/pipelines/${pipelineId}/downstream/${triggerId}`, { method: 'DELETE' });


// ── Nessie Git ──────────────────
export const listBranches = () => request('/nessie/branches');
export const createBranch = (data) => request('/nessie/branches', { method: 'POST', body: JSON.stringify(data) });
export const deleteBranch = (name) => request(`/nessie/branches/${name}`, { method: 'DELETE' });
export const getBranchLog = (name) => request(`/nessie/branches/${name}/log`);
export const getBranchContents = (name) => request(`/nessie/branches/${name}/contents`);
export const mergeBranches = (data) => request('/nessie/merge', { method: 'POST', body: JSON.stringify(data) });
export const diffBranches = (from, to) => request(`/nessie/diff/${from}/${to}`);
export const listTags = () => request('/nessie/tags');
export const createTag = (data) => request('/nessie/tags', { method: 'POST', body: JSON.stringify(data) });

// ── Query Engine ────────────────
export const executeQuery = (data) => request('/query/execute', { method: 'POST', body: JSON.stringify(data) });
export const listCatalogs = () => request('/query/catalogs');

// ── Storage (MinIO) ─────────────
export const listBuckets = () => request('/storage/buckets');
export const listObjects = (bucket, prefix = '') => request(`/storage/objects/${bucket}?prefix=${encodeURIComponent(prefix)}`);
export const deleteObject = (bucket, objectName) => request(`/storage/objects/${bucket}/${objectName}`, { method: 'DELETE' });

// ── CSV Import ───────────────────────────────────────────────
/** Step 1 — Get presigned PUT URL for direct browser → MinIO upload */
export const csvPresign = (schema, table, data) =>
  request(`/models/tables/${schema}/${table}/csv/presign`, { method: 'POST', body: JSON.stringify(data) });

/** Step 2 — Validate uploaded CSV (header + 5 rows check) */
export const csvValidate = (schema, table, data) =>
  request(`/models/tables/${schema}/${table}/csv/validate`, { method: 'POST', body: JSON.stringify(data) });

/** Step 3 — Ingest staged CSV into Iceberg table */
export const csvIngest = (schema, table, data) =>
  request(`/models/tables/${schema}/${table}/csv/ingest`, { method: 'POST', body: JSON.stringify(data) });

/**
 * Upload a File object directly to a MinIO presigned PUT URL.
 * Returns { ok: bool, etag: str|null }
 * Uses XMLHttpRequest so callers can track upload progress via onProgress(percent).
 */
export function uploadToPresignedUrl(presignedUrl, file, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', presignedUrl, true);
    xhr.setRequestHeader('Content-Type', 'text/csv');
    if (onProgress) {
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
      };
    }
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve({ ok: true, etag: xhr.getResponseHeader('ETag') });
      } else {
        reject(new Error(`Upload failed: HTTP ${xhr.status}`));
      }
    };
    xhr.onerror = () => reject(new Error('Network error during upload'));
    xhr.send(file);
  });
}

export const csvCleanup = (stagingKey) =>
  request('/models/tables/csv/cleanup', { method: 'DELETE', body: JSON.stringify({ staging_key: stagingKey }) });

// ── IAM — Identity & Access Management ────────────────────────────

// Users
export const iamListUsers = () => request('/iam/users');
export const iamGetUser = (userId) => request(`/iam/users/${userId}`);
export const iamCreateUser = (data) => request('/iam/users', { method: 'POST', body: JSON.stringify(data) });
export const iamDeleteUser = (userId) => request(`/iam/users/${userId}`, { method: 'DELETE' });
export const iamToggleUserEnabled = (userId, enabled) => request(`/iam/users/${userId}/enabled`, { method: 'PUT', body: JSON.stringify({ enabled }) });
export const iamUpdateUserRoles = (userId, roleNames) => request(`/iam/users/${userId}/roles`, { method: 'PUT', body: JSON.stringify({ role_names: roleNames }) });
export const iamAssignGroups = (userId, data) => request(`/iam/users/${userId}/groups`, { method: 'PUT', body: JSON.stringify(data) });

// Roles
export const iamListRoles = () => request('/iam/roles');
export const iamCreateRole = (data) => request('/iam/roles', { method: 'POST', body: JSON.stringify(data) });
export const iamDeleteRole = (roleName) => request(`/iam/roles/${encodeURIComponent(roleName)}`, { method: 'DELETE' });
export const iamGetRolePermissions = (roleName) => request(`/iam/roles/${encodeURIComponent(roleName)}/permissions`);
export const iamUpdateRolePerms = (roleName, perms) => request(`/iam/roles/${encodeURIComponent(roleName)}/permissions`, { method: 'PUT', body: JSON.stringify({ permissions: perms }) });
export const iamGetRoleUsers = (roleName) => request(`/iam/roles/${encodeURIComponent(roleName)}/users`);

// Permissions catalog
export const iamListPermissions = () => request('/iam/permissions');

// Groups (compatibility)
export const iamListGroups = () => request('/iam/groups');
export const iamCreateGroup = (name, roleName) => request(`/iam/groups?name=${encodeURIComponent(name)}&role_name=${encodeURIComponent(roleName || '')}`, { method: 'POST' });

// Trino ACL
export const iamGetAcl = () => request('/iam/acl');
export const iamUpdateAcl = (policy) => request('/iam/acl', { method: 'PUT', body: JSON.stringify(policy) });
export const iamSyncTrino = () => request('/iam/acl', { method: 'PUT', body: JSON.stringify({ rules: [] }) });

// Data layer schema metadata
export const iamListSchemas = () => request('/iam/schemas');

// Trino liveness check — poll after ACL sync to know when engine is back
export const iamGetTrinoStatus = () => request('/iam/trino-status');

// Current user resolved permissions (call after auth to know which pages to show)
export const iamGetMe = () => request('/iam/me');

// ── Data Lineage ─────────────────────────────────────────────────────────────
export const lineageSearchNodes = (q = '', type = null, limit = 30) => {
  let url = `/lineage/nodes?q=${encodeURIComponent(q)}&limit=${limit}`;
  if (type) url += `&type=${encodeURIComponent(type)}`;
  return request(url);
};
export const lineageGetNode = (id) => request(`/lineage/nodes/${id}`);
export const lineageGetGraph = (id, direction = 'both', depth = 2) =>
  request(`/lineage/graph/${id}?direction=${direction}&depth=${depth}`);
export const lineageGetAllGraph = () => request('/lineage/graph/all');
export const lineageGetImpact = (id) => request(`/lineage/impact/${id}`);

// ── Market Datasets (Market Intake) ──────────────────────────────────────────
export const listDatasets = () => request('/v1/datasets/');
export const getDataset = (id) => request(`/v1/datasets/${id}`);
export const previewDataset = (id, rows = 200, colOffset = 0, colLimit = 50) => request(`/v1/datasets/${id}/preview?rows=${rows}&col_offset=${colOffset}&col_limit=${colLimit}`);
export const getDatasetStats = (id) => request(`/v1/datasets/${id}/stats`);
export const getDatasetDownloadUrl = (id) => request(`/v1/datasets/${id}/download`);
export const deleteDataset = (id) => request(`/v1/datasets/${id}`, { method: 'DELETE' });
export const fetchMarketData = (payload) => request('/v1/fetch/market-data', { method: 'POST', body: JSON.stringify(payload) });
export const getTaskStatus = (taskId) => request(`/v1/ws/task/${taskId}`);

export function connectTaskWS(taskId, onMessage, onDone, hooks) {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${window.location.host}/api/v1/ws/task/${taskId}`;
  const ws = new WebSocket(wsUrl);
  let terminalReceived = false;

  ws.onmessage = (e) => {
    try {
      const data = JSON.parse(e.data);
      onMessage(data);
      if (data.status === 'SUCCESS' || data.status === 'FAILURE') {
        terminalReceived = true;
        ws.close();
        if (onDone) onDone();
      }
    } catch (err) {
      if (hooks && hooks.onError) hooks.onError('Invalid task stream payload');
    }
  };

  ws.onerror = () => {
    if (hooks && hooks.onError) hooks.onError('Task stream connection error');
  };

  ws.onclose = (ev) => {
    if (!terminalReceived && !ev.wasClean) {
      if (hooks && hooks.onError) hooks.onError('Task stream disconnected before completion');
    }
    if (hooks && hooks.onClose) hooks.onClose(ev);
  };

  return ws;
}

// ── Feature Selection (Page 3) ────────────────────────────────────────────────
export const listLabeledDatasets = () => request('/v1/labeled-datasets/');
export const listFeatureSets = () => request('/v1/feature-sets/');
export const getFeatureSet = (id) => request(`/v1/feature-sets/${id}`);
export const createFeatureSet = (data) => request('/v1/feature-sets/', { method: 'POST', body: JSON.stringify(data) });
export const deleteFeatureSet = (id) => request(`/v1/feature-sets/${id}`, { method: 'DELETE' });
export const previewFeatureSet = (id, rows = 200, colOffset = 0, colLimit = 50) => request(`/v1/feature-sets/${id}/preview?rows=${rows}&col_offset=${colOffset}&col_limit=${colLimit}`);
export const suggestFeatureColumns = (data) => request('/v1/feature-sets/suggest', { method: 'POST', body: JSON.stringify(data) });




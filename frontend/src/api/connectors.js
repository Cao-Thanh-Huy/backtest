/**
 * API client for REST Connector endpoints
 */

const BASE = '/api/connectors'

function getToken() {
  return localStorage.getItem('de_platform_token') || null;
}

async function apiFetch(url, options = {}) {
  const token = getToken();
  const authHeader = token ? { Authorization: `Bearer ${token}` } : {};
  const res = await fetch(url, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...authHeader, ...options.headers }
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function listConnectors(params = {}) {
  const q = new URLSearchParams(params).toString()
  return apiFetch(`${BASE}/?${q}`)
}

export async function getConnector(id) {
  return apiFetch(`${BASE}/${id}`)
}

export async function createConnector(data) {
  return apiFetch(`${BASE}/`, {
    method: 'POST',
    body: JSON.stringify(data),
  })
}

export async function updateConnector(id, data) {
  return apiFetch(`${BASE}/${id}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  })
}

export async function deleteConnector(id) {
  return apiFetch(`${BASE}/${id}`, { method: 'DELETE' })
}

export async function testConnector(config) {
  return apiFetch(`${BASE}/test`, {
    method: 'POST',
    body: JSON.stringify(config),
  })
}

export async function triggerIngest(id) {
  return apiFetch(`${BASE}/${id}/ingest`, { method: 'POST' })
}

export async function forceUnlockConnector(id) {
  return apiFetch(`${BASE}/${id}/unlock`, { method: 'POST' })
}

export async function getConnectorStatus(id) {
  return apiFetch(`${BASE}/${id}/status`)
}

export async function getSampleBaseUrl() {
  return apiFetch(`${BASE}/sample-base-url`)
}

// ── Run History ──────────────────────────────────────────────────────────────

export async function getRunHistory(id, limit = 30) {
  return apiFetch(`${BASE}/${id}/run-history?limit=${limit}`)
}

// ── Downstream Pipeline Triggers ─────────────────────────────────────────────

export async function listDownstream(id) {
  return apiFetch(`${BASE}/${id}/downstream`)
}

export async function addDownstream(id, data) {
  return apiFetch(`${BASE}/${id}/downstream`, {
    method: 'POST',
    body: JSON.stringify(data),
  })
}

export async function updateDownstream(connectorId, triggerId, data) {
  return apiFetch(`${BASE}/${connectorId}/downstream/${triggerId}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  })
}

export async function removeDownstream(connectorId, triggerId) {
  return apiFetch(`${BASE}/${connectorId}/downstream/${triggerId}`, { method: 'DELETE' })
}

// ── Schedule Management ──────────────────────────────────────────────────────

export async function updateSchedule(id, cronExpr) {
  return apiFetch(`${BASE}/${id}`, {
    method: 'PUT',
    body: JSON.stringify({ sync_schedule: cronExpr }),
  })
}

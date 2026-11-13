import apiClient from './apiClient';

export async function listRetries(params = {}) {
  const res = await apiClient.get('/retries', { params });
  return res.data.data;
}

export async function listRecovery(params = {}) {
  const res = await apiClient.get('/recovery', { params });
  return res.data.data;
}

export async function triggerRecovery(executionId) {
  const res = await apiClient.post(`/recovery/${executionId}/retry`);
  return res.data.data;
}

export async function listSimulations() {
  const res = await apiClient.get('/dependencies/simulations');
  return res.data.data;
}

export async function upsertSimulation(dependencyKey, payload) {
  const res = await apiClient.put(`/dependencies/simulations/${dependencyKey}`, payload);
  return res.data.data;
}

export async function listDependencyLogs(params = {}) {
  const res = await apiClient.get('/dependencies/logs', { params });
  return res.data.data;
}

export async function getReliabilitySummary() {
  const res = await apiClient.get('/reliability/summary');
  return res.data.data;
}

import apiClient from './apiClient';

export async function listWorkflows() {
  const res = await apiClient.get('/workflows');
  return res.data.data.workflows;
}

export async function getWorkflow(id) {
  const res = await apiClient.get(`/workflows/${id}`);
  return res.data.data.workflow;
}

export async function createWorkflow(payload) {
  const res = await apiClient.post('/workflows', payload);
  return res.data.data.workflow;
}

export async function updateWorkflow(id, payload) {
  const res = await apiClient.patch(`/workflows/${id}`, payload);
  return res.data.data.workflow;
}

export async function archiveWorkflow(id) {
  const res = await apiClient.post(`/workflows/${id}/archive`);
  return res.data.data.workflow;
}

export async function listVersions(workflowId) {
  const res = await apiClient.get(`/workflows/${workflowId}/versions`);
  return res.data.data.versions;
}

export async function getVersion(workflowId, version) {
  const res = await apiClient.get(`/workflows/${workflowId}/versions/${version}`);
  return res.data.data.version;
}

export async function createVersion(workflowId, cloneFromVersion) {
  const res = await apiClient.post(`/workflows/${workflowId}/versions`, cloneFromVersion ? { cloneFromVersion } : {});
  return res.data.data.version;
}

export async function updateVersion(workflowId, version, payload) {
  const res = await apiClient.patch(`/workflows/${workflowId}/versions/${version}`, payload);
  return res.data.data.version;
}

export async function validateVersion(workflowId, version) {
  const res = await apiClient.post(`/workflows/${workflowId}/versions/${version}/validate`);
  return res.data.data;
}

export async function publishVersion(workflowId, version) {
  const res = await apiClient.post(`/workflows/${workflowId}/versions/${version}/publish`);
  return res.data.data.version;
}

export async function testVersionRules(workflowId, version, context) {
  const res = await apiClient.post(`/workflows/${workflowId}/versions/${version}/rules/test`, { context });
  return res.data.data.result;
}

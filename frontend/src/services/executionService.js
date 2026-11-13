import apiClient from './apiClient';

export async function listExecutions(params = {}) {
  const res = await apiClient.get('/executions', { params });
  return res.data.data;
}

export async function getExecution(id) {
  const res = await apiClient.get(`/executions/${id}`);
  return res.data.data.execution;
}

export async function getExecutionHistory(id) {
  const res = await apiClient.get(`/executions/${id}/history`);
  return res.data.data;
}

export async function getExecutionExplanation(id) {
  const res = await apiClient.get(`/executions/${id}/explanation`);
  return res.data.data;
}

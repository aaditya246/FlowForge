import apiClient from './apiClient';

export async function submitRequest({ workflowId, payload, idempotencyKey }) {
  const res = await apiClient.post('/requests', { workflowId, payload, idempotencyKey });
  return res.data.data;
}

export async function listRequests(params = {}) {
  const res = await apiClient.get('/requests', { params });
  return res.data.data;
}

export async function getRequest(id) {
  const res = await apiClient.get(`/requests/${id}`);
  return res.data.data.request;
}

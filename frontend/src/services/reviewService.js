import apiClient from './apiClient';

export async function listReviews(params = {}) {
  const res = await apiClient.get('/reviews', { params });
  return res.data.data;
}

export async function getReview(id) {
  const res = await apiClient.get(`/reviews/${id}`);
  return res.data.data.review;
}

export async function getStats() {
  const res = await apiClient.get('/reviews/stats');
  return res.data.data;
}

export async function getHistory(id) {
  const res = await apiClient.get(`/reviews/${id}/history`);
  return res.data.data.actions;
}

export async function getInformationHistory(id) {
  const res = await apiClient.get(`/reviews/${id}/information-history`);
  return res.data.data;
}

export async function listReviewers() {
  const res = await apiClient.get('/reviews/reviewers');
  return res.data.data.reviewers;
}

export async function getReviewerWorkload() {
  const res = await apiClient.get('/reviews/reviewers/workload');
  return res.data.data.workload;
}

export async function assignReview(id, reviewerId) {
  const res = await apiClient.post(`/reviews/${id}/assign`, { reviewerId });
  return res.data.data.review;
}

export async function reassignReview(id, reviewerId) {
  const res = await apiClient.put(`/reviews/${id}/reassign`, { reviewerId });
  return res.data.data.review;
}

export async function unassignReview(id) {
  const res = await apiClient.delete(`/reviews/${id}/assign`);
  return res.data.data.review;
}

export async function startReview(id) {
  const res = await apiClient.post(`/reviews/${id}/start`);
  return res.data.data.review;
}

export async function approveReview(id, comment) {
  const res = await apiClient.post(`/reviews/${id}/approve`, { comment });
  return res.data.data;
}

export async function rejectReview(id, comment) {
  const res = await apiClient.post(`/reviews/${id}/reject`, { comment });
  return res.data.data;
}

export async function requestInformation(id, explanation) {
  const res = await apiClient.post(`/reviews/${id}/request-information`, { explanation });
  return res.data.data.review;
}

export async function submitInformation(id, text) {
  const res = await apiClient.post(`/reviews/${id}/submit-information`, { text });
  return res.data.data.review;
}

export async function escalateReview(id, reason) {
  const res = await apiClient.post(`/reviews/${id}/escalate`, { reason });
  return res.data.data.review;
}

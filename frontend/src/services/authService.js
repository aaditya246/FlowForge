import apiClient from './apiClient';

export async function login(email, password) {
  const res = await apiClient.post('/auth/login', { email, password });
  return res.data.data;
}

export async function register(payload) {
  const res = await apiClient.post('/auth/register', payload);
  return res.data.data;
}

export async function getCurrentUser() {
  const res = await apiClient.get('/auth/me');
  return res.data.data.user;
}

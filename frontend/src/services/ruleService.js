import apiClient from './apiClient';

export async function testEvaluate({ rules, context, conflictResolution }) {
  const res = await apiClient.post('/rules/test-evaluate', { rules, context, conflictResolution });
  return res.data.data.result;
}

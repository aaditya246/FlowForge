const request = require('supertest');
const mongoose = require('mongoose');
const app = require('../app');
const idempotencyService = require('../services/idempotencyService');
const IdempotencyRecord = require('../models/IdempotencyRecord');
const Request = require('../models/Request');
const WorkflowExecution = require('../models/WorkflowExecution');

async function registerAndLogin(suffix) {
  const res = await request(app)
    .post('/api/auth/register')
    .send({ name: 'Admin', email: `admin.${suffix}@flowforge.test`, password: 'password123', role: 'admin' });
  return res.body.data.token;
}

function uniqueSlug(prefix = 'wf') {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
}

async function createPublishedWorkflow(token) {
  const wf = await request(app).post('/api/workflows').set('Authorization', `Bearer ${token}`).send({ name: 'WF', slug: uniqueSlug() });
  const wfId = wf.body.data.workflow._id;
  const draft = await request(app).post(`/api/workflows/${wfId}/versions`).set('Authorization', `Bearer ${token}`).send({});
  const v = draft.body.data.version.version;
  const stages = [
    { stageId: 'validate', name: 'Validate', order: 1, type: 'validation', onSuccess: 'evaluate', onFailure: 'REJECTED' },
    { stageId: 'evaluate', name: 'Evaluate', order: 2, type: 'rule_evaluation', ruleGroup: 'main', onSuccess: 'terminal', onFailure: 'terminal' },
    { stageId: 'terminal', name: 'Terminal', order: 3, type: 'terminal' },
  ];
  const rules = [{ ruleId: 'C', name: 'C', group: 'main', condition: { field: 'score', operator: '>=', value: 700 }, onPass: 'APPROVE', onFail: 'REJECT' }];
  const schema = [{ name: 'score', type: 'number', required: true }];
  await request(app)
    .patch(`/api/workflows/${wfId}/versions/${v}`)
    .set('Authorization', `Bearer ${token}`)
    .send({ inputSchema: schema, stages, rules, startStageId: 'validate' });
  await request(app).post(`/api/workflows/${wfId}/versions/${v}/publish`).set('Authorization', `Bearer ${token}`).send();
  return wfId;
}

describe('Idempotency — HTTP API behavior', () => {
  let token;
  let wfId;

  beforeEach(async () => {
    token = await registerAndLogin(`idem-${Date.now()}-${Math.random()}`);
    wfId = await createPublishedWorkflow(token);
  });

  it('1. first submission with a new key creates exactly one execution', async () => {
    const res = await request(app)
      .post('/api/requests')
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', 'k1')
      .send({ workflowId: wfId, payload: { score: 900 } });
    expect(res.status).toBe(201);
    expect(res.body.data.execution).toBeTruthy();
    expect(await WorkflowExecution.countDocuments({ requestId: res.body.data.request._id })).toBe(1);
  });

  it('2. same key and same payload returns the existing result, not a new execution', async () => {
    const r1 = await request(app)
      .post('/api/requests')
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', 'k2')
      .send({ workflowId: wfId, payload: { score: 900 } });
    const r2 = await request(app)
      .post('/api/requests')
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', 'k2')
      .send({ workflowId: wfId, payload: { score: 900 } });

    expect(r2.status).toBe(200);
    expect(r2.body.data.replayed).toBe(true);
    expect(r2.body.data.execution._id).toBe(r1.body.data.execution._id);
    expect(await Request.countDocuments({ idempotencyKey: 'k2' })).toBe(1);
    expect(await WorkflowExecution.countDocuments({ requestId: r1.body.data.request._id })).toBe(1);
  });

  it('3. same key with a different payload returns 409', async () => {
    await request(app)
      .post('/api/requests')
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', 'k3')
      .send({ workflowId: wfId, payload: { score: 900 } });
    const res = await request(app)
      .post('/api/requests')
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', 'k3')
      .send({ workflowId: wfId, payload: { score: 100 } });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CONFLICT');
  });

  it('4. missing idempotency key: each submission is processed independently (documented policy)', async () => {
    const r1 = await request(app).post('/api/requests').set('Authorization', `Bearer ${token}`).send({ workflowId: wfId, payload: { score: 900 } });
    const r2 = await request(app).post('/api/requests').set('Authorization', `Bearer ${token}`).send({ workflowId: wfId, payload: { score: 900 } });
    expect(r1.body.data.execution._id).not.toBe(r2.body.data.execution._id);
    expect(await WorkflowExecution.countDocuments({})).toBe(2);
  });

  it('5. concurrent identical requests with the same key create only one execution', async () => {
    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        request(app)
          .post('/api/requests')
          .set('Authorization', `Bearer ${token}`)
          .set('Idempotency-Key', 'k5')
          .send({ workflowId: wfId, payload: { score: 900 } })
      )
    );
    const executionIds = new Set(results.filter((r) => r.body.data.execution).map((r) => r.body.data.execution._id));
    expect(executionIds.size).toBe(1);
    expect(await Request.countDocuments({ idempotencyKey: 'k5' })).toBe(1);
    expect(await WorkflowExecution.countDocuments({})).toBe(1);
    // every response is either the real result (201) or a documented in-progress/replay signal
    results.forEach((r) => expect([200, 201, 202]).toContain(r.status));
  });

  it('6. different keys create independent executions', async () => {
    const r1 = await request(app).post('/api/requests').set('Authorization', `Bearer ${token}`).set('Idempotency-Key', 'k6a').send({ workflowId: wfId, payload: { score: 900 } });
    const r2 = await request(app).post('/api/requests').set('Authorization', `Bearer ${token}`).set('Idempotency-Key', 'k6b').send({ workflowId: wfId, payload: { score: 900 } });
    expect(r1.body.data.execution._id).not.toBe(r2.body.data.execution._id);
  });

  it('7. idempotency survives a simulated backend restart (fresh require cache, same DB)', async () => {
    const r1 = await request(app)
      .post('/api/requests')
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', 'k7')
      .send({ workflowId: wfId, payload: { score: 900 } });

    // Re-claim against the same persisted IdempotencyRecord as if a fresh process restarted —
    // all state is read straight from Mongo, nothing cached in memory.
    const record = await IdempotencyRecord.findOne({ idempotencyKey: 'k7' });
    expect(record.status).toBe('completed');
    const claim = await idempotencyService.claim(wfId, 'k7', record.payloadHash);
    expect(claim.outcome).toBe('replay');
    expect(String(claim.record.executionId)).toBe(String(r1.body.data.execution._id));
  });

  it('8. a failed submission attempt can safely resume under the same key', async () => {
    const payloadHash = 'deadbeef';
    const claim1 = await idempotencyService.claim(wfId, 'k8', payloadHash);
    expect(claim1.outcome).toBe('claimed');
    await idempotencyService.fail(claim1.record, new Error('simulated crash before completion'));

    const claim2 = await idempotencyService.claim(wfId, 'k8', payloadHash);
    expect(claim2.outcome).toBe('claimed'); // reclaimed — a failed attempt may retry under the same key
    expect(claim2.reclaimed).toBe(true);
  });

  it('9. the unique index on {workflowId, idempotencyKey} prevents duplicate records at the DB level', async () => {
    const wf = new mongoose.Types.ObjectId();
    await IdempotencyRecord.create({ workflowId: wf, idempotencyKey: 'dup', payloadHash: 'h', status: 'processing' });
    await expect(
      IdempotencyRecord.create({ workflowId: wf, idempotencyKey: 'dup', payloadHash: 'h', status: 'processing' })
    ).rejects.toThrow();
  });

  it('a stale ("stuck") processing record can be reclaimed after its lease expires', async () => {
    const claim1 = await idempotencyService.claim(wfId, 'k-stale', 'h');
    // Simulate the owning process having died a while ago.
    // { timestamps: false } is required here — Mongoose's timestamps plugin would
    // otherwise silently overwrite this explicit backdated value with "now".
    await IdempotencyRecord.updateOne(
      { _id: claim1.record._id },
      { $set: { updatedAt: new Date(Date.now() - idempotencyService.LEASE_MS - 1000) } },
      { timestamps: false }
    );

    const claim2 = await idempotencyService.claim(wfId, 'k-stale', 'h');
    expect(claim2.outcome).toBe('claimed');
    expect(claim2.reclaimed).toBe(true);
  });

  it('a non-expired processing record cannot be reclaimed (in-progress)', async () => {
    const claim1 = await idempotencyService.claim(wfId, 'k-live', 'h');
    expect(claim1.outcome).toBe('claimed');
    const claim2 = await idempotencyService.claim(wfId, 'k-live', 'h');
    expect(claim2.outcome).toBe('inProgress');
  });
});

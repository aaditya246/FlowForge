const request = require('supertest');
const mongoose = require('mongoose');
const app = require('../app');
const recoveryService = require('../services/recoveryService');
const retryService = require('../services/retryService');
const WorkflowExecution = require('../models/WorkflowExecution');
const RetryRecord = require('../models/RetryRecord');
const SystemConfiguration = require('../models/SystemConfiguration');

async function registerAndLogin(role, suffix) {
  const res = await request(app)
    .post('/api/auth/register')
    .send({ name: `${role} user`, email: `${role}.${suffix}@flowforge.test`, password: 'password123', role });
  return res.body.data.token;
}

function uniqueSlug(prefix = 'wf') {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
}

async function createDependencyWorkflow(token, { maxAttempts = 2, delayMs = 10 } = {}) {
  const wf = await request(app).post('/api/workflows').set('Authorization', `Bearer ${token}`).send({ name: 'WF', slug: uniqueSlug() });
  const wfId = wf.body.data.workflow._id;
  const draft = await request(app).post(`/api/workflows/${wfId}/versions`).set('Authorization', `Bearer ${token}`).send({});
  const v = draft.body.data.version.version;
  const dependencyKey = `dep-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
  const stages = [
    { stageId: 'validate', name: 'Validate', order: 1, type: 'validation', onSuccess: 'verify', onFailure: 'REJECTED' },
    { stageId: 'verify', name: 'Verify', order: 2, type: 'external_dependency', externalDependencyKey: dependencyKey, retry: { maxAttempts, delayMs }, onSuccess: 'terminal', onFailure: 'terminal' },
    { stageId: 'terminal', name: 'Terminal', order: 3, type: 'terminal' },
  ];
  const schema = [{ name: 'x', type: 'number', required: true }];
  await request(app).patch(`/api/workflows/${wfId}/versions/${v}`).set('Authorization', `Bearer ${token}`).send({ inputSchema: schema, stages, rules: [], startStageId: 'validate' });
  await request(app).post(`/api/workflows/${wfId}/versions/${v}/publish`).set('Authorization', `Bearer ${token}`).send();
  return { wfId, dependencyKey };
}

describe('Concurrency protection', () => {
  let token;

  beforeEach(async () => {
    token = await registerAndLogin('admin', `conc-${Date.now()}-${Math.random()}`);
  });

  it('34. concurrent duplicate submissions (same idempotency key) create exactly one execution', async () => {
    const wf = await request(app).post('/api/workflows').set('Authorization', `Bearer ${token}`).send({ name: 'WF', slug: uniqueSlug() });
    const wfId = wf.body.data.workflow._id;
    const draft = await request(app).post(`/api/workflows/${wfId}/versions`).set('Authorization', `Bearer ${token}`).send({});
    const v = draft.body.data.version.version;
    await request(app)
      .patch(`/api/workflows/${wfId}/versions/${v}`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        inputSchema: [{ name: 'x', type: 'number', required: true }],
        stages: [
          { stageId: 'validate', name: 'V', order: 1, type: 'validation', onSuccess: 'terminal', onFailure: 'REJECTED' },
          { stageId: 'terminal', name: 'T', order: 2, type: 'terminal' },
        ],
        rules: [],
        startStageId: 'validate',
      });
    await request(app).post(`/api/workflows/${wfId}/versions/${v}/publish`).set('Authorization', `Bearer ${token}`).send();

    const results = await Promise.all(
      Array.from({ length: 15 }, () =>
        request(app).post('/api/requests').set('Authorization', `Bearer ${token}`).set('Idempotency-Key', 'conc-key').send({ workflowId: wfId, payload: { x: 1 } })
      )
    );
    const executionIds = new Set(results.filter((r) => r.body.data.execution).map((r) => r.body.data.execution._id));
    expect(executionIds.size).toBe(1);
    expect(await WorkflowExecution.countDocuments({})).toBe(1);
  });

  it('35. concurrent retry workers processing the same RetryRecord: only one actually executes it', async () => {
    const { wfId, dependencyKey } = await createDependencyWorkflow(token, { maxAttempts: 2, delayMs: 10 });
    await SystemConfiguration.create({ key: `externalDependency:${dependencyKey}`, value: { forcedOutcome: 'FAILURE' } });
    const submit = await request(app).post('/api/requests').set('Authorization', `Bearer ${token}`).send({ workflowId: wfId, payload: { x: 1 } });
    const execId = submit.body.data.execution._id;

    await SystemConfiguration.updateOne({ key: `externalDependency:${dependencyKey}` }, { $set: { value: { forcedOutcome: 'SUCCESS' } } });
    await RetryRecord.updateMany({ executionId: execId }, { $set: { scheduledAt: new Date(Date.now() - 1000) } });
    const record = await RetryRecord.findOne({ executionId: execId });

    // Two "workers" racing to claim the exact same due RetryRecord.
    const [claimA, claimB] = await Promise.all([retryService.claimRetry(record._id), retryService.claimRetry(record._id)]);
    const winners = [claimA, claimB].filter(Boolean);
    expect(winners.length).toBe(1);
  });

  it('36. concurrent recovery workers resuming the same stuck execution: only one wins', async () => {
    const { wfId } = await createDependencyWorkflow(token, { maxAttempts: 0 });
    const submit = await request(app).post('/api/requests').set('Authorization', `Bearer ${token}`).send({ workflowId: wfId, payload: { x: 1 } });
    const execId = submit.body.data.execution._id;
    await WorkflowExecution.updateOne({ _id: execId }, { $set: { currentState: 'PROCESSING' } });

    const results = await Promise.all(
      Array.from({ length: 5 }, () => recoveryService.resumeExecution(execId, { expectedState: 'PROCESSING' }))
    );
    const resumed = results.filter((r) => r.outcome === 'resumed');
    expect(resumed.length).toBe(1);
  });

  it('37/38. optimistic concurrency rejects a save from a stale in-memory copy (version conflict)', async () => {
    const { wfId } = await createDependencyWorkflow(token, { maxAttempts: 0 });
    const submit = await request(app).post('/api/requests').set('Authorization', `Bearer ${token}`).send({ workflowId: wfId, payload: { x: 1 } });
    const execId = submit.body.data.execution._id;

    const copyA = await WorkflowExecution.findById(execId);
    const copyB = await WorkflowExecution.findById(execId);

    copyA.finalReason = 'updated by A';
    await copyA.save(); // succeeds, bumps __v

    copyB.finalReason = 'updated by B (stale)';
    await expect(copyB.save()).rejects.toThrow(); // VersionError — B's __v is now stale

    const final = await WorkflowExecution.findById(execId);
    expect(final.finalReason).toBe('updated by A'); // the stale write never applied
  });
});

describe('Security — role restrictions on reliability endpoints', () => {
  let adminToken;
  let reviewerToken;
  let operatorToken;
  let viewerToken;

  beforeEach(async () => {
    const suffix = `${Date.now()}-${Math.random()}`;
    adminToken = await registerAndLogin('admin', suffix);
    reviewerToken = await registerAndLogin('reviewer', suffix);
    operatorToken = await registerAndLogin('operator', suffix);
    viewerToken = await registerAndLogin('viewer', suffix);
  });

  it('39. viewer cannot modify failure simulation settings', async () => {
    const res = await request(app)
      .put('/api/dependencies/simulations/some-dependency')
      .set('Authorization', `Bearer ${viewerToken}`)
      .send({ forcedOutcome: 'FAILURE' });
    expect(res.status).toBe(403);
  });

  it('39. operator cannot modify failure simulation settings either', async () => {
    const res = await request(app)
      .put('/api/dependencies/simulations/some-dependency')
      .set('Authorization', `Bearer ${operatorToken}`)
      .send({ forcedOutcome: 'FAILURE' });
    expect(res.status).toBe(403);
  });

  it('39. admin CAN modify failure simulation settings', async () => {
    const res = await request(app)
      .put('/api/dependencies/simulations/some-dependency')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ forcedOutcome: 'FAILURE' });
    expect(res.status).toBe(200);
  });

  it('40. operator cannot trigger admin recovery actions', async () => {
    const { wfId } = await createDependencyWorkflow(adminToken, { maxAttempts: 0 });
    const submit = await request(app).post('/api/requests').set('Authorization', `Bearer ${adminToken}`).send({ workflowId: wfId, payload: { x: 1 } });
    const execId = submit.body.data.execution._id;

    const res = await request(app).post(`/api/recovery/${execId}/retry`).set('Authorization', `Bearer ${operatorToken}`).send();
    expect(res.status).toBe(403);
  });

  it('40. reviewer can read recovery data but cannot trigger recovery', async () => {
    const { wfId } = await createDependencyWorkflow(adminToken, { maxAttempts: 0 });
    const submit = await request(app).post('/api/requests').set('Authorization', `Bearer ${adminToken}`).send({ workflowId: wfId, payload: { x: 1 } });

    const readRes = await request(app).get('/api/recovery').set('Authorization', `Bearer ${reviewerToken}`);
    expect(readRes.status).toBe(200);

    const triggerRes = await request(app)
      .post(`/api/recovery/${submit.body.data.execution._id}/retry`)
      .set('Authorization', `Bearer ${reviewerToken}`)
      .send();
    expect(triggerRes.status).toBe(403);
  });

  it('41. operator and viewer cannot inspect retry records, recovery data, or dependency logs', async () => {
    for (const token of [operatorToken, viewerToken]) {
      expect((await request(app).get('/api/retries').set('Authorization', `Bearer ${token}`)).status).toBe(403);
      expect((await request(app).get('/api/recovery').set('Authorization', `Bearer ${token}`)).status).toBe(403);
      expect((await request(app).get('/api/dependencies/logs').set('Authorization', `Bearer ${token}`)).status).toBe(403);
      expect((await request(app).get('/api/reliability/summary').set('Authorization', `Bearer ${token}`)).status).toBe(403);
    }
  });

  it('41. unauthenticated requests are rejected on every reliability endpoint', async () => {
    expect((await request(app).get('/api/retries')).status).toBe(401);
    expect((await request(app).get('/api/recovery')).status).toBe(401);
    expect((await request(app).get('/api/dependencies/simulations')).status).toBe(401);
    expect((await request(app).get('/api/reliability/summary')).status).toBe(401);
  });

  it('admin and reviewer CAN inspect retries, recovery, and dependency data', async () => {
    for (const token of [adminToken, reviewerToken]) {
      expect((await request(app).get('/api/retries').set('Authorization', `Bearer ${token}`)).status).toBe(200);
      expect((await request(app).get('/api/recovery').set('Authorization', `Bearer ${token}`)).status).toBe(200);
      expect((await request(app).get('/api/dependencies/logs').set('Authorization', `Bearer ${token}`)).status).toBe(200);
      expect((await request(app).get('/api/reliability/summary').set('Authorization', `Bearer ${token}`)).status).toBe(200);
    }
  });
});

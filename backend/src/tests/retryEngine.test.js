const request = require('supertest');
const app = require('../app');
const retryService = require('../services/retryService');
const recoveryService = require('../services/recoveryService');
const RetryRecord = require('../models/RetryRecord');
const WorkflowExecution = require('../models/WorkflowExecution');
const SystemConfiguration = require('../models/SystemConfiguration');

async function registerAndLogin(suffix) {
  const res = await request(app)
    .post('/api/auth/register')
    .send({ name: 'Admin', email: `admin.${suffix}@flowforge.test`, password: 'password123', role: 'admin' });
  return res.body.data.token;
}

function uniqueSlug(prefix = 'wf') {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
}

async function createDependencyWorkflow(token, { maxAttempts = 3, delayMs = 100, backoff = 'fixed', onFailure = 'terminal' } = {}) {
  const wf = await request(app).post('/api/workflows').set('Authorization', `Bearer ${token}`).send({ name: 'WF', slug: uniqueSlug() });
  const wfId = wf.body.data.workflow._id;
  const draft = await request(app).post(`/api/workflows/${wfId}/versions`).set('Authorization', `Bearer ${token}`).send({});
  const v = draft.body.data.version.version;
  const stages = [
    { stageId: 'validate', name: 'Validate', order: 1, type: 'validation', onSuccess: 'verify', onFailure: 'REJECTED' },
    {
      stageId: 'verify',
      name: 'Verify',
      order: 2,
      type: 'external_dependency',
      externalDependencyKey: `dep-${Date.now()}-${Math.floor(Math.random() * 1e9)}`,
      retry: { maxAttempts, delayMs, backoff },
      onSuccess: 'terminal',
      onFailure,
    },
    { stageId: 'terminal', name: 'Terminal', order: 3, type: 'terminal' },
  ];
  const schema = [{ name: 'x', type: 'number', required: true }];
  await request(app)
    .patch(`/api/workflows/${wfId}/versions/${v}`)
    .set('Authorization', `Bearer ${token}`)
    .send({ inputSchema: schema, stages, rules: [], startStageId: 'validate' });
  await request(app).post(`/api/workflows/${wfId}/versions/${v}/publish`).set('Authorization', `Bearer ${token}`).send();
  return { wfId, dependencyKey: stages[1].externalDependencyKey };
}

describe('Retry engine — policy and backoff math', () => {
  it('10/12. computes fixed delay with no backoff multiplication', () => {
    expect(retryService.computeDelayMs(1, { delayMs: 1000, backoff: 'fixed', maxDelayMs: 30000 })).toBe(1000);
    expect(retryService.computeDelayMs(3, { delayMs: 1000, backoff: 'fixed', maxDelayMs: 30000 })).toBe(1000);
  });

  it('12. computes exponential backoff correctly', () => {
    const cfg = { delayMs: 1000, backoff: 'exponential', backoffMultiplier: 2, maxDelayMs: 30000 };
    expect(retryService.computeDelayMs(1, cfg)).toBe(1000); // 1000 * 2^0
    expect(retryService.computeDelayMs(2, cfg)).toBe(2000); // 1000 * 2^1
    expect(retryService.computeDelayMs(3, cfg)).toBe(4000); // 1000 * 2^2
  });

  it('12. caps exponential backoff at maxDelayMs', () => {
    const cfg = { delayMs: 1000, backoff: 'exponential', backoffMultiplier: 2, maxDelayMs: 3000 };
    expect(retryService.computeDelayMs(5, cfg)).toBe(3000); // would be 16000 uncapped
  });

  it('applies jitter within the expected 50%-100% range', () => {
    const cfg = { delayMs: 1000, backoff: 'fixed', maxDelayMs: 30000, jitter: true };
    for (let i = 0; i < 20; i++) {
      const d = retryService.computeDelayMs(1, cfg);
      expect(d).toBeGreaterThanOrEqual(500);
      expect(d).toBeLessThanOrEqual(1000);
    }
  });
});

describe('Retry engine — end-to-end scheduling and resumption', () => {
  let token;

  beforeEach(async () => {
    token = await registerAndLogin(`retry-${Date.now()}-${Math.random()}`);
  });

  it('10. a retryable dependency failure schedules a retry (RETRY_PENDING)', async () => {
    const { wfId, dependencyKey } = await createDependencyWorkflow(token);
    await SystemConfiguration.create({ key: `externalDependency:${dependencyKey}`, value: { forcedOutcome: 'FAILURE' } });

    const res = await request(app).post('/api/requests').set('Authorization', `Bearer ${token}`).send({ workflowId: wfId, payload: { x: 1 } });
    expect(res.body.data.execution.currentState).toBe('RETRY_PENDING');
    expect(res.body.data.execution.retryCount).toBe(1);

    const records = await RetryRecord.find({ executionId: res.body.data.execution._id });
    expect(records.length).toBe(1);
    expect(records[0].result).toBe('pending');
  });

  it('11. a non-retryable failure (no retry policy configured) is not retried', async () => {
    const { wfId, dependencyKey } = await createDependencyWorkflow(token, { maxAttempts: 0 });
    await SystemConfiguration.create({ key: `externalDependency:${dependencyKey}`, value: { forcedOutcome: 'FAILURE' } });

    const res = await request(app).post('/api/requests').set('Authorization', `Bearer ${token}`).send({ workflowId: wfId, payload: { x: 1 } });
    expect(res.body.data.execution.currentState).not.toBe('RETRY_PENDING');
    expect(await RetryRecord.countDocuments({ executionId: res.body.data.execution._id })).toBe(0);
  });

  it('13. enforces the configured retry limit (no more than maxAttempts retries)', async () => {
    const { wfId, dependencyKey } = await createDependencyWorkflow(token, { maxAttempts: 2, delayMs: 10 });
    await SystemConfiguration.create({ key: `externalDependency:${dependencyKey}`, value: { forcedOutcome: 'FAILURE' } });

    const submit = await request(app).post('/api/requests').set('Authorization', `Bearer ${token}`).send({ workflowId: wfId, payload: { x: 1 } });
    const execId = submit.body.data.execution._id;

    for (let i = 0; i < 3; i++) {
      await RetryRecord.updateMany({ executionId: execId, result: 'pending' }, { $set: { scheduledAt: new Date(Date.now() - 1000) } });
      await recoveryService.runRecoverySweep();
      const exec = await WorkflowExecution.findById(execId);
      if (exec.currentState !== 'RETRY_PENDING') break;
    }

    const exec = await WorkflowExecution.findById(execId);
    expect(exec.retryCount).toBe(2); // never exceeds maxAttempts
    expect(exec.currentState).toBe('COMPLETED');
    const records = await RetryRecord.find({ executionId: execId }).sort({ attemptNumber: 1 });
    expect(records.length).toBe(2);
  });

  it('14. retry succeeds after a transient failure clears', async () => {
    const { wfId, dependencyKey } = await createDependencyWorkflow(token, { maxAttempts: 3, delayMs: 10 });
    await SystemConfiguration.create({ key: `externalDependency:${dependencyKey}`, value: { forcedOutcome: 'FAILURE' } });

    const submit = await request(app).post('/api/requests').set('Authorization', `Bearer ${token}`).send({ workflowId: wfId, payload: { x: 1 } });
    const execId = submit.body.data.execution._id;
    expect((await WorkflowExecution.findById(execId)).currentState).toBe('RETRY_PENDING');

    // The dependency recovers before the retry fires.
    await SystemConfiguration.updateOne({ key: `externalDependency:${dependencyKey}` }, { $set: { value: { forcedOutcome: 'SUCCESS' } } });
    await RetryRecord.updateMany({ executionId: execId }, { $set: { scheduledAt: new Date(Date.now() - 1000) } });
    await recoveryService.runRecoverySweep();

    const exec = await WorkflowExecution.findById(execId);
    expect(exec.currentState).toBe('COMPLETED');
    const records = await RetryRecord.find({ executionId: execId });
    expect(records[0].result).toBe('succeeded');
  });

  it('15/16. retry exhaustion is recorded and the execution reaches the configured failure outcome', async () => {
    const { wfId, dependencyKey } = await createDependencyWorkflow(token, { maxAttempts: 1, delayMs: 10, onFailure: 'REJECTED' });
    await SystemConfiguration.create({ key: `externalDependency:${dependencyKey}`, value: { forcedOutcome: 'FAILURE' } });

    const submit = await request(app).post('/api/requests').set('Authorization', `Bearer ${token}`).send({ workflowId: wfId, payload: { x: 1 } });
    const execId = submit.body.data.execution._id;

    await RetryRecord.updateMany({ executionId: execId }, { $set: { scheduledAt: new Date(Date.now() - 1000) } });
    await recoveryService.runRecoverySweep();

    const exec = await WorkflowExecution.findById(execId);
    expect(exec.currentState).toBe('COMPLETED');
    expect(exec.finalDecision).toBe('REJECT');

    const AuditLog = require('../models/AuditLog');
    const exhaustedAudit = await AuditLog.findOne({ executionId: execId, eventType: 'RETRY_EXHAUSTED' });
    expect(exhaustedAudit).not.toBeNull();
  });

  it('16. retry state transitions are valid (PROCESSING -> RETRY_PENDING -> PROCESSING -> terminal)', async () => {
    const { wfId, dependencyKey } = await createDependencyWorkflow(token, { maxAttempts: 2, delayMs: 10 });
    await SystemConfiguration.create({ key: `externalDependency:${dependencyKey}`, value: { forcedOutcome: 'FAILURE' } });

    const submit = await request(app).post('/api/requests').set('Authorization', `Bearer ${token}`).send({ workflowId: wfId, payload: { x: 1 } });
    const execId = submit.body.data.execution._id;

    await SystemConfiguration.updateOne({ key: `externalDependency:${dependencyKey}` }, { $set: { value: { forcedOutcome: 'SUCCESS' } } });
    await RetryRecord.updateMany({ executionId: execId }, { $set: { scheduledAt: new Date(Date.now() - 1000) } });
    await recoveryService.runRecoverySweep();

    const history = await request(app).get(`/api/executions/${execId}/history`).set('Authorization', `Bearer ${token}`);
    const states = history.body.data.events.map((e) => e.toState);
    expect(states).toEqual(expect.arrayContaining(['RETRY_PENDING', 'PROCESSING', 'COMPLETED']));
  });

  it('17. complete retry history is queryable via GET /api/executions/:id/retries', async () => {
    const { wfId, dependencyKey } = await createDependencyWorkflow(token, { maxAttempts: 2, delayMs: 10 });
    await SystemConfiguration.create({ key: `externalDependency:${dependencyKey}`, value: { forcedOutcome: 'FAILURE' } });

    const submit = await request(app).post('/api/requests').set('Authorization', `Bearer ${token}`).send({ workflowId: wfId, payload: { x: 1 } });
    const execId = submit.body.data.execution._id;

    const res = await request(app).get(`/api/executions/${execId}/retries`).set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.data.retries.length).toBe(1);
    expect(res.body.data.retries[0].attemptNumber).toBe(1);
  });

  it('18. due retries resume after a simulated backend restart (fresh module cache, same DB)', async () => {
    const { wfId, dependencyKey } = await createDependencyWorkflow(token, { maxAttempts: 2, delayMs: 10 });
    await SystemConfiguration.create({ key: `externalDependency:${dependencyKey}`, value: { forcedOutcome: 'FAILURE' } });

    const submit = await request(app).post('/api/requests').set('Authorization', `Bearer ${token}`).send({ workflowId: wfId, payload: { x: 1 } });
    const execId = submit.body.data.execution._id;

    await SystemConfiguration.updateOne({ key: `externalDependency:${dependencyKey}` }, { $set: { value: { forcedOutcome: 'SUCCESS' } } });
    await RetryRecord.updateMany({ executionId: execId }, { $set: { scheduledAt: new Date(Date.now() - 1000) } });

    // Simulate "server restart": fresh require of recoveryService (no in-memory
    // state carried over — everything it needs comes straight from Mongo).
    delete require.cache[require.resolve('../services/recoveryService')];
    const freshRecoveryService = require('../services/recoveryService');
    await freshRecoveryService.runRecoverySweep();

    expect((await WorkflowExecution.findById(execId)).currentState).toBe('COMPLETED');
  });
});

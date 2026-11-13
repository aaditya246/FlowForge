const request = require('supertest');
const mongoose = require('mongoose');
const app = require('../app');
const recoveryService = require('../services/recoveryService');
const WorkflowExecution = require('../models/WorkflowExecution');
const RetryRecord = require('../models/RetryRecord');
const ExternalDependencyLog = require('../models/ExternalDependencyLog');
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

describe('Recovery service', () => {
  let token;

  beforeEach(async () => {
    token = await registerAndLogin(`recov-${Date.now()}-${Math.random()}`);
  });

  it('27. recovers an interrupted execution stuck in PROCESSING', async () => {
    const { wfId } = await createDependencyWorkflow(token, { maxAttempts: 0 });
    const submit = await request(app).post('/api/requests').set('Authorization', `Bearer ${token}`).send({ workflowId: wfId, payload: { x: 1 } });
    const execId = submit.body.data.execution._id;

    // Simulate a crash mid-stage: force the already-terminal execution back into
    // PROCESSING with a stale timestamp, as if the process died before finalizing.
    // { timestamps: false } — otherwise Mongoose would overwrite our deliberately
    // backdated updatedAt with "now" on this very update.
    await WorkflowExecution.updateOne(
      { _id: execId },
      { $set: { currentState: 'PROCESSING', updatedAt: new Date(Date.now() - recoveryService.STUCK_PROCESSING_MS - 1000) } },
      { timestamps: false }
    );

    const interrupted = await recoveryService.findInterruptedExecutions();
    expect(interrupted.some((e) => String(e._id) === String(execId))).toBe(true);

    const sweep = await recoveryService.runRecoverySweep();
    expect(sweep.interruptedExecutionsRecovered).toBeGreaterThanOrEqual(1);

    const after = await WorkflowExecution.findById(execId);
    expect(after.currentState).toBe('COMPLETED');
  });

  it('28. a fresh (non-expired) PROCESSING execution is NOT treated as interrupted', async () => {
    const { wfId } = await createDependencyWorkflow(token, { maxAttempts: 0 });
    const submit = await request(app).post('/api/requests').set('Authorization', `Bearer ${token}`).send({ workflowId: wfId, payload: { x: 1 } });
    await WorkflowExecution.updateOne({ _id: submit.body.data.execution._id }, { $set: { currentState: 'PROCESSING' } });

    const interrupted = await recoveryService.findInterruptedExecutions();
    expect(interrupted.some((e) => String(e._id) === String(submit.body.data.execution._id))).toBe(false);
  });

  it('29. recovers a due retry via the general sweep', async () => {
    const { wfId, dependencyKey } = await createDependencyWorkflow(token, { maxAttempts: 2, delayMs: 10 });
    await SystemConfiguration.create({ key: `externalDependency:${dependencyKey}`, value: { forcedOutcome: 'FAILURE' } });
    const submit = await request(app).post('/api/requests').set('Authorization', `Bearer ${token}`).send({ workflowId: wfId, payload: { x: 1 } });
    const execId = submit.body.data.execution._id;

    await SystemConfiguration.updateOne({ key: `externalDependency:${dependencyKey}` }, { $set: { value: { forcedOutcome: 'SUCCESS' } } });
    await RetryRecord.updateMany({ executionId: execId }, { $set: { scheduledAt: new Date(Date.now() - 1000) } });

    const sweep = await recoveryService.runRecoverySweep();
    expect(sweep.retriesProcessed).toBe(1);
    expect((await WorkflowExecution.findById(execId)).currentState).toBe('COMPLETED');
  });

  it('30/32. reconciles a dependency call left inconclusive by an interrupted process', async () => {
    const executionId = new mongoose.Types.ObjectId();
    const stuckLog = await ExternalDependencyLog.create({
      executionId,
      dependencyKey: 'dep-stuck',
      operationId: 'op-stuck',
      status: 'pending',
    });
    await ExternalDependencyLog.updateOne(
      { _id: stuckLog._id },
      { $set: { updatedAt: new Date(Date.now() - recoveryService.STUCK_PENDING_DEPENDENCY_MS - 1000) } },
      { timestamps: false }
    );

    const reconciled = await recoveryService.reconcilePendingDependencyLogs();
    expect(reconciled.some((l) => String(l._id) === String(stuckLog._id))).toBe(true);

    const after = await ExternalDependencyLog.findById(stuckLog._id);
    expect(after.status).toBe('completed');
    expect(after.success).toBe(false);
    expect(after.simulatedOutcome).toBe('FAILURE');
  });

  it('a fresh pending dependency log is NOT prematurely reconciled', async () => {
    const executionId = new mongoose.Types.ObjectId();
    const freshLog = await ExternalDependencyLog.create({ executionId, dependencyKey: 'dep-fresh', operationId: 'op-fresh', status: 'pending' });
    const reconciled = await recoveryService.reconcilePendingDependencyLogs();
    expect(reconciled.some((l) => String(l._id) === String(freshLog._id))).toBe(false);
  });

  it('31. recovery never repeats an already-completed external operation', async () => {
    const { wfId, dependencyKey } = await createDependencyWorkflow(token, { maxAttempts: 0 });
    await SystemConfiguration.create({ key: `externalDependency:${dependencyKey}`, value: { forcedOutcome: 'SUCCESS' } });
    const submit = await request(app).post('/api/requests').set('Authorization', `Bearer ${token}`).send({ workflowId: wfId, payload: { x: 1 } });
    const execId = submit.body.data.execution._id;

    const logCountBefore = await ExternalDependencyLog.countDocuments({ executionId: execId });
    expect(logCountBefore).toBe(1);

    // Attempt to "recover" an already-COMPLETED execution via the manual admin path —
    // it must be rejected (not eligible), and no new dependency call should occur.
    await expect(recoveryService.resumeExecution(execId, { expectedState: 'PROCESSING' })).resolves.toMatchObject({ outcome: 'already-claimed' });
    expect(await ExternalDependencyLog.countDocuments({ executionId: execId })).toBe(1);
  });

  it('33. the recovery sweep is safe to run multiple times with no duplicate effects', async () => {
    const { wfId, dependencyKey } = await createDependencyWorkflow(token, { maxAttempts: 2, delayMs: 10 });
    await SystemConfiguration.create({ key: `externalDependency:${dependencyKey}`, value: { forcedOutcome: 'SUCCESS' } });
    const submit = await request(app).post('/api/requests').set('Authorization', `Bearer ${token}`).send({ workflowId: wfId, payload: { x: 1 } });
    const execId = submit.body.data.execution._id;

    const sweep1 = await recoveryService.runRecoverySweep();
    const sweep2 = await recoveryService.runRecoverySweep();
    const sweep3 = await recoveryService.runRecoverySweep();

    expect(sweep2.retriesProcessed).toBe(0);
    expect(sweep3.retriesProcessed).toBe(0);
    expect(await ExternalDependencyLog.countDocuments({ executionId: execId })).toBe(1);
  });
});

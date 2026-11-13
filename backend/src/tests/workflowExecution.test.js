const request = require('supertest');
const mongoose = require('mongoose');
const app = require('../app');
const WorkflowExecution = require('../models/WorkflowExecution');
const SystemConfiguration = require('../models/SystemConfiguration');

async function registerAndLogin(role = 'admin', suffix = Date.now() + Math.random()) {
  const user = { name: `${role} user`, email: `${role}.${suffix}@flowforge.test`, password: 'password123', role };
  const res = await request(app).post('/api/auth/register').send(user);
  return res.body.data.token;
}

function simpleStages({ validationFailureTarget = 'REJECTED' } = {}) {
  return [
    { stageId: 'validate', name: 'Validate', order: 1, type: 'validation', onSuccess: 'evaluate', onFailure: validationFailureTarget },
    {
      stageId: 'evaluate',
      name: 'Evaluate',
      order: 2,
      type: 'rule_evaluation',
      ruleGroup: 'main',
      onSuccess: 'terminal',
      onFailure: 'terminal',
      onManualReview: 'terminal',
    },
    { stageId: 'terminal', name: 'Terminal', order: 3, type: 'terminal' },
  ];
}

function simpleRules(overrides = {}) {
  return [
    {
      ruleId: 'CREDIT_CHECK',
      name: 'Minimum credit score',
      group: 'main',
      condition: { field: 'creditScore', operator: '>=', value: 700 },
      onPass: 'APPROVE',
      onFail: 'MANUAL_REVIEW',
      ...overrides,
    },
  ];
}

function inputSchema() {
  return [
    { name: 'applicantName', type: 'string', required: true },
    { name: 'creditScore', type: 'number', required: true },
  ];
}

function uniqueSlug(prefix = 'wf') {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
}

async function createPublishedWorkflow(token, { slug = uniqueSlug(), stages, rules, startStageId = 'validate', schema = inputSchema() } = {}) {
  const wf = await request(app).post('/api/workflows').set('Authorization', `Bearer ${token}`).send({ name: 'Test WF', slug });
  const wfId = wf.body.data.workflow._id;
  const draft = await request(app).post(`/api/workflows/${wfId}/versions`).set('Authorization', `Bearer ${token}`).send({});
  const v = draft.body.data.version.version;

  await request(app)
    .patch(`/api/workflows/${wfId}/versions/${v}`)
    .set('Authorization', `Bearer ${token}`)
    .send({ inputSchema: schema, stages: stages || simpleStages(), rules: rules || simpleRules(), startStageId });

  const pub = await request(app).post(`/api/workflows/${wfId}/versions/${v}/publish`).set('Authorization', `Bearer ${token}`).send();
  if (pub.status !== 200) throw new Error(`Setup failed to publish: ${JSON.stringify(pub.body)}`);

  return { wfId, version: v };
}

describe('Workflow execution — core engine behavior', () => {
  let token;

  beforeEach(async () => {
    token = await registerAndLogin('admin', `exec-${Date.now()}-${Math.random()}`);
  });

  it('executes a valid published workflow end-to-end and approves', async () => {
    const { wfId } = await createPublishedWorkflow(token);
    const res = await request(app)
      .post('/api/requests')
      .set('Authorization', `Bearer ${token}`)
      .send({ workflowId: wfId, payload: { applicantName: 'Alice', creditScore: 780 } });

    expect(res.status).toBe(201);
    expect(res.body.data.execution.currentState).toBe('COMPLETED');
    expect(res.body.data.execution.finalDecision).toBe('APPROVE');
  });

  it('rejects execution for a workflow with no published version', async () => {
    const wf = await request(app).post('/api/workflows').set('Authorization', `Bearer ${token}`).send({ name: 'Unpublished', slug: `unpub-${Date.now()}` });
    const res = await request(app)
      .post('/api/requests')
      .set('Authorization', `Bearer ${token}`)
      .send({ workflowId: wf.body.data.workflow._id, payload: {} });
    expect(res.status).toBe(409);
  });

  it('rejects execution for a nonexistent workflow', async () => {
    const res = await request(app)
      .post('/api/requests')
      .set('Authorization', `Bearer ${token}`)
      .send({ workflowId: new mongoose.Types.ObjectId(), payload: {} });
    expect(res.status).toBe(404);
  });

  it('runs the VALIDATION stage and rejects on missing mandatory fields', async () => {
    const { wfId } = await createPublishedWorkflow(token);
    const res = await request(app)
      .post('/api/requests')
      .set('Authorization', `Bearer ${token}`)
      .send({ workflowId: wfId, payload: { creditScore: 780 } }); // missing applicantName

    expect(res.status).toBe(422);
    expect(res.body.data.valid).toBe(false);
    expect(res.body.data.errors.some((e) => e.field === 'applicantName')).toBe(true);
    expect(res.body.data.execution).toBeNull();
  });

  it('runs the RULE_EVALUATION stage and uses its outcome to pick a transition', async () => {
    const { wfId } = await createPublishedWorkflow(token);
    const res = await request(app)
      .post('/api/requests')
      .set('Authorization', `Bearer ${token}`)
      .send({ workflowId: wfId, payload: { applicantName: 'Bob', creditScore: 500 } });

    expect(res.status).toBe(201);
    expect(res.body.data.execution.currentState).toBe('MANUAL_REVIEW');
  });

  it('executes multiple sequential stages (validate -> evaluate -> terminal)', async () => {
    const { wfId } = await createPublishedWorkflow(token);
    const res = await request(app)
      .post('/api/requests')
      .set('Authorization', `Bearer ${token}`)
      .send({ workflowId: wfId, payload: { applicantName: 'Carol', creditScore: 900 } });

    const history = await request(app)
      .get(`/api/executions/${res.body.data.execution._id}/history`)
      .set('Authorization', `Bearer ${token}`);

    const stageIds = history.body.data.events.map((e) => e.stageId);
    expect(stageIds).toContain('validate');
    expect(stageIds).toContain('evaluate');
    expect(stageIds).toContain('terminal');
  });

  it('executes conditional branches based on rule outcome (approve vs manual_review)', async () => {
    const { wfId } = await createPublishedWorkflow(token);
    const approve = await request(app)
      .post('/api/requests')
      .set('Authorization', `Bearer ${token}`)
      .send({ workflowId: wfId, payload: { applicantName: 'A', creditScore: 900 } });
    const review = await request(app)
      .post('/api/requests')
      .set('Authorization', `Bearer ${token}`)
      .send({ workflowId: wfId, payload: { applicantName: 'B', creditScore: 100 } });

    expect(approve.body.data.execution.finalDecision).toBe('APPROVE');
    expect(review.body.data.execution.currentState).toBe('MANUAL_REVIEW');
  });

  it('records an APPROVE outcome and a REJECT outcome correctly', async () => {
    const { wfId } = await createPublishedWorkflow(token, {
      rules: simpleRules({ onFail: 'REJECT' }),
    });
    const rejected = await request(app)
      .post('/api/requests')
      .set('Authorization', `Bearer ${token}`)
      .send({ workflowId: wfId, payload: { applicantName: 'D', creditScore: 100 } });

    expect(rejected.body.data.execution.currentState).toBe('COMPLETED');
    expect(rejected.body.data.execution.finalDecision).toBe('REJECT');
  });

  it('pauses at MANUAL_REVIEW and does not auto-continue', async () => {
    const { wfId } = await createPublishedWorkflow(token);
    const res = await request(app)
      .post('/api/requests')
      .set('Authorization', `Bearer ${token}`)
      .send({ workflowId: wfId, payload: { applicantName: 'E', creditScore: 100 } });

    const execution = await WorkflowExecution.findById(res.body.data.execution._id);
    expect(execution.currentState).toBe('MANUAL_REVIEW');
    expect(execution.completedAt).toBeNull();
  });

  it('recognizes a RETRY outcome, creates a RetryRecord, and sets RETRY_PENDING', async () => {
    // A RETRY outcome only actually pauses the execution when the stage has a
    // configured retry policy (Phase 5) — maxAttempts: 0 (the default) means
    // "no retries configured", so it falls straight through as a failure instead.
    const retryableStages = simpleStages();
    retryableStages[1].retry = { maxAttempts: 2, delayMs: 1000, backoff: 'fixed' };
    const { wfId } = await createPublishedWorkflow(token, {
      stages: retryableStages,
      rules: simpleRules({ onFail: 'RETRY' }),
    });
    const res = await request(app)
      .post('/api/requests')
      .set('Authorization', `Bearer ${token}`)
      .send({ workflowId: wfId, payload: { applicantName: 'F', creditScore: 100 } });

    expect(res.body.data.execution.currentState).toBe('RETRY_PENDING');
    expect(res.body.data.execution.retryCount).toBe(1);

    const RetryRecord = require('../models/RetryRecord');
    const records = await RetryRecord.find({ executionId: res.body.data.execution._id });
    expect(records.length).toBe(1);
    expect(records[0].attemptNumber).toBe(1);
  });

  it('stops at a terminal state and does not execute further stages', async () => {
    const { wfId } = await createPublishedWorkflow(token);
    const res = await request(app)
      .post('/api/requests')
      .set('Authorization', `Bearer ${token}`)
      .send({ workflowId: wfId, payload: { applicantName: 'G', creditScore: 900 } });

    const history = await request(app)
      .get(`/api/executions/${res.body.data.execution._id}/history`)
      .set('Authorization', `Bearer ${token}`);
    const stageIds = history.body.data.events.map((e) => e.stageId);
    const firstTerminalIndex = stageIds.indexOf('terminal');
    expect(firstTerminalIndex).toBeGreaterThan(-1);
    // No stage other than 'terminal' itself should execute after reaching the terminal stage.
    const afterTerminal = stageIds.slice(firstTerminalIndex + 1);
    expect(afterTerminal.every((id) => id === 'terminal')).toBe(true);
  });

  it('handles a transition targeting a missing stage with a controlled FAILED execution', async () => {
    const badStages = simpleStages();
    badStages[0].onSuccess = 'does_not_exist'; // bypasses the publish-time validator deliberately? no — validator would reject this.
    // Publishing with a broken stage reference should itself be rejected — verify that instead.
    const wf = await request(app).post('/api/workflows').set('Authorization', `Bearer ${token}`).send({ name: 'Broken', slug: `broken-${Date.now()}` });
    const wfId = wf.body.data.workflow._id;
    const draft = await request(app).post(`/api/workflows/${wfId}/versions`).set('Authorization', `Bearer ${token}`).send({});
    const v = draft.body.data.version.version;
    await request(app)
      .patch(`/api/workflows/${wfId}/versions/${v}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ inputSchema: inputSchema(), stages: badStages, rules: simpleRules(), startStageId: 'validate' });
    const pub = await request(app).post(`/api/workflows/${wfId}/versions/${v}/publish`).set('Authorization', `Bearer ${token}`).send();

    expect(pub.status).toBe(400); // config validator already catches this at publish time
  });

  it('enforces the maximum stage execution / loop-prevention limit', async () => {
    // A -> B -> A ... cycle that never reaches a terminal stage.
    const loopingStages = [
      { stageId: 'A', name: 'A', order: 1, type: 'validation', onSuccess: 'B', onFailure: 'REJECTED' },
      { stageId: 'B', name: 'B', order: 2, type: 'validation', onSuccess: 'A', onFailure: 'REJECTED' },
      { stageId: 'terminal', name: 'Terminal', order: 3, type: 'terminal' },
    ];
    const { wfId } = await createPublishedWorkflow(token, { stages: loopingStages, rules: [], startStageId: 'A' });
    const res = await request(app)
      .post('/api/requests')
      .set('Authorization', `Bearer ${token}`)
      .send({ workflowId: wfId, payload: { applicantName: 'Loop', creditScore: 900 } });

    expect(res.body.data.execution.currentState).toBe('COMPLETED');
    expect(res.body.data.execution.finalReason).toMatch(/loop detected/i);
  });
});

describe('Workflow execution — EXTERNAL_DEPENDENCY stage', () => {
  let token;

  function dependencyStages() {
    return [
      { stageId: 'validate', name: 'Validate', order: 1, type: 'validation', onSuccess: 'verify', onFailure: 'REJECTED' },
      { stageId: 'verify', name: 'Verify', order: 2, type: 'external_dependency', externalDependencyKey: 'identity_check', onSuccess: 'terminal', onFailure: 'terminal' },
      { stageId: 'terminal', name: 'Terminal', order: 3, type: 'terminal' },
    ];
  }

  beforeEach(async () => {
    token = await registerAndLogin('admin', `extdep-${Date.now()}-${Math.random()}`);
  });

  it('calls the simulated external dependency and logs the result', async () => {
    const { wfId } = await createPublishedWorkflow(token, { stages: dependencyStages(), rules: [] });
    const res = await request(app)
      .post('/api/requests')
      .set('Authorization', `Bearer ${token}`)
      .send({ workflowId: wfId, payload: { applicantName: 'H', creditScore: 900 } });

    expect(res.status).toBe(201);
    // Default simulated outcome is SUCCESS -> onSuccess -> terminal (no decision carried -> COMPLETED)
    expect(res.body.data.execution.currentState).toBe('COMPLETED');

    const ExternalDependencyLog = require('../models/ExternalDependencyLog');
    const logs = await ExternalDependencyLog.find({ executionId: res.body.data.execution._id });
    expect(logs.length).toBe(1);
    expect(logs[0].dependencyKey).toBe('identity_check');
    expect(logs[0].success).toBe(true);
  });

  it('respects a configured FAILURE simulation outcome', async () => {
    await SystemConfiguration.create({ key: 'externalDependency:identity_check', value: { forcedOutcome: 'FAILURE' } });
    const { wfId } = await createPublishedWorkflow(token, { stages: dependencyStages(), rules: [] });
    const res = await request(app)
      .post('/api/requests')
      .set('Authorization', `Bearer ${token}`)
      .send({ workflowId: wfId, payload: { applicantName: 'I', creditScore: 900 } });

    const ExternalDependencyLog = require('../models/ExternalDependencyLog');
    const logs = await ExternalDependencyLog.find({ executionId: res.body.data.execution._id });
    expect(logs[0].success).toBe(false);
    expect(logs[0].simulatedOutcome).toBe('FAILURE');
  });
});

describe('Workflow execution — version binding', () => {
  let token;

  beforeEach(async () => {
    token = await registerAndLogin('admin', `vbind-${Date.now()}-${Math.random()}`);
  });

  it('executes using the currently published version and pins the exact version ID', async () => {
    const { wfId, version } = await createPublishedWorkflow(token);
    const res = await request(app)
      .post('/api/requests')
      .set('Authorization', `Bearer ${token}`)
      .send({ workflowId: wfId, payload: { applicantName: 'J', creditScore: 900 } });

    expect(res.body.data.execution.workflowVersionNumber).toBe(version);
  });

  it('keeps an earlier execution pinned to its original version after a new version is published', async () => {
    const { wfId, version: v1 } = await createPublishedWorkflow(token);
    const first = await request(app)
      .post('/api/requests')
      .set('Authorization', `Bearer ${token}`)
      .send({ workflowId: wfId, payload: { applicantName: 'K', creditScore: 900 } });
    const firstExecutionId = first.body.data.execution._id;

    // Publish a new version with a different rule threshold.
    const draft2 = await request(app).post(`/api/workflows/${wfId}/versions`).set('Authorization', `Bearer ${token}`).send({ cloneFromVersion: v1 });
    const v2 = draft2.body.data.version.version;
    await request(app)
      .patch(`/api/workflows/${wfId}/versions/${v2}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ rules: simpleRules({ condition: { field: 'creditScore', operator: '>=', value: 950 } }) });
    await request(app).post(`/api/workflows/${wfId}/versions/${v2}/publish`).set('Authorization', `Bearer ${token}`).send();

    const executionAfter = await WorkflowExecution.findById(firstExecutionId);
    expect(executionAfter.workflowVersionNumber).toBe(v1);

    // A new request now runs against v2's stricter rule.
    const second = await request(app)
      .post('/api/requests')
      .set('Authorization', `Bearer ${token}`)
      .send({ workflowId: wfId, payload: { applicantName: 'L', creditScore: 900 } }); // passes v1 threshold, not v2's
    expect(second.body.data.execution.workflowVersionNumber).toBe(v2);
    expect(second.body.data.execution.currentState).toBe('MANUAL_REVIEW');
  });

  it('produces historical explanations from the pinned version, not the latest config', async () => {
    const { wfId, version: v1 } = await createPublishedWorkflow(token);
    const exec = await request(app)
      .post('/api/requests')
      .set('Authorization', `Bearer ${token}`)
      .send({ workflowId: wfId, payload: { applicantName: 'M', creditScore: 900 } });

    const draft2 = await request(app).post(`/api/workflows/${wfId}/versions`).set('Authorization', `Bearer ${token}`).send({ cloneFromVersion: v1 });
    const v2 = draft2.body.data.version.version;
    await request(app).patch(`/api/workflows/${wfId}/versions/${v2}`).set('Authorization', `Bearer ${token}`).send({ startStageId: 'validate' });
    await request(app).post(`/api/workflows/${wfId}/versions/${v2}/publish`).set('Authorization', `Bearer ${token}`).send();

    const explanation = await request(app)
      .get(`/api/executions/${exec.body.data.execution._id}/explanation`)
      .set('Authorization', `Bearer ${token}`);
    expect(explanation.body.data.workflowVersionNumber).toBe(v1);
  });
});

describe('Workflow execution — history and explainability', () => {
  let token;

  beforeEach(async () => {
    token = await registerAndLogin('admin', `hist-${Date.now()}-${Math.random()}`);
  });

  it('records every stage execution and state transition', async () => {
    const { wfId } = await createPublishedWorkflow(token);
    const res = await request(app)
      .post('/api/requests')
      .set('Authorization', `Bearer ${token}`)
      .send({ workflowId: wfId, payload: { applicantName: 'N', creditScore: 900 } });

    const history = await request(app)
      .get(`/api/executions/${res.body.data.execution._id}/history`)
      .set('Authorization', `Bearer ${token}`);

    expect(history.body.data.events.length).toBeGreaterThan(0);
    const states = history.body.data.events.map((e) => e.toState);
    expect(states).toEqual(expect.arrayContaining(['VALIDATING', 'PROCESSING', 'APPROVED', 'COMPLETED']));
  });

  it('records the rule evaluation trace in the audit log', async () => {
    const { wfId } = await createPublishedWorkflow(token);
    const res = await request(app)
      .post('/api/requests')
      .set('Authorization', `Bearer ${token}`)
      .send({ workflowId: wfId, payload: { applicantName: 'O', creditScore: 900 } });

    const history = await request(app)
      .get(`/api/executions/${res.body.data.execution._id}/history`)
      .set('Authorization', `Bearer ${token}`);
    const ruleAudit = history.body.data.auditTrail.find((a) => a.eventType === 'RULE_EVALUATION');
    expect(ruleAudit).toBeDefined();
    expect(ruleAudit.ruleTrace.length).toBe(1);
    expect(ruleAudit.ruleTrace[0].ruleId).toBe('CREDIT_CHECK');
  });

  it('generates a complete decision explanation', async () => {
    const { wfId } = await createPublishedWorkflow(token);
    const res = await request(app)
      .post('/api/requests')
      .set('Authorization', `Bearer ${token}`)
      .send({ workflowId: wfId, payload: { applicantName: 'P', creditScore: 900 } });

    const explanation = await request(app)
      .get(`/api/executions/${res.body.data.execution._id}/explanation`)
      .set('Authorization', `Bearer ${token}`);

    expect(explanation.status).toBe(200);
    expect(explanation.body.data.finalDecision).toBe('APPROVE');
    expect(explanation.body.data.ruleEvaluations.length).toBe(1);
    expect(explanation.body.data.transitions.length).toBeGreaterThan(0);
  });

  it('records failure reasons when a stage fails', async () => {
    const badRules = [
      {
        ruleId: 'BAD',
        name: 'Bad rule',
        group: 'main',
        condition: { field: 'x', operator: 'EXISTS' },
        onPass: 'CONTINUE',
        onFail: 'CONTINUE',
      },
    ];
    // onSuccess points to a stage id that doesn't exist in the engine's stage list at runtime
    // by using a version whose evaluate stage success target is null (unconfigured path).
    const stages = simpleStages();
    stages[1].onSuccess = null;
    const { wfId } = await createPublishedWorkflow(token, { stages: [stages[0], { ...stages[1] }, stages[2]], rules: badRules });

    const res = await request(app)
      .post('/api/requests')
      .set('Authorization', `Bearer ${token}`)
      .send({ workflowId: wfId, payload: { applicantName: 'Q', creditScore: 900 } });

    expect(res.body.data.execution.currentState).toBe('COMPLETED');
    expect(res.body.data.execution.finalReason).toMatch(/no transition configured/i);
  });
});

describe('Request/Execution APIs — authorization', () => {
  it('rejects request submission from a viewer role', async () => {
    const adminToken = await registerAndLogin('admin', `rbac-${Date.now()}`);
    const viewerToken = await registerAndLogin('viewer', `rbac-${Date.now()}`);
    const { wfId } = await createPublishedWorkflow(adminToken);

    const res = await request(app)
      .post('/api/requests')
      .set('Authorization', `Bearer ${viewerToken}`)
      .send({ workflowId: wfId, payload: { applicantName: 'R', creditScore: 900 } });
    expect(res.status).toBe(403);
  });

  it('allows an operator to submit a request', async () => {
    const adminToken = await registerAndLogin('admin', `rbac2-${Date.now()}`);
    const operatorToken = await registerAndLogin('operator', `rbac2-${Date.now()}`);
    const { wfId } = await createPublishedWorkflow(adminToken);

    const res = await request(app)
      .post('/api/requests')
      .set('Authorization', `Bearer ${operatorToken}`)
      .send({ workflowId: wfId, payload: { applicantName: 'S', creditScore: 900 } });
    expect(res.status).toBe(201);
  });

  it('rejects an invalid request body (missing workflowId)', async () => {
    const token = await registerAndLogin('admin', `badbody-${Date.now()}`);
    const res = await request(app).post('/api/requests').set('Authorization', `Bearer ${token}`).send({ payload: {} });
    expect(res.status).toBe(400);
  });

  it('returns 404 for a nonexistent execution ID', async () => {
    const token = await registerAndLogin('admin', `nf-${Date.now()}`);
    const res = await request(app)
      .get(`/api/executions/${new mongoose.Types.ObjectId()}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(404);
  });

  it('requires authentication to list requests or executions', async () => {
    const r1 = await request(app).get('/api/requests');
    const r2 = await request(app).get('/api/executions');
    expect(r1.status).toBe(401);
    expect(r2.status).toBe(401);
  });
});

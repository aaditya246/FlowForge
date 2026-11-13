const request = require('supertest');
const app = require('../app');
const ManualReview = require('../models/ManualReview');
const WorkflowExecution = require('../models/WorkflowExecution');
const reviewService = require('../services/reviewService');

async function registerAndLogin(role, suffix) {
  const res = await request(app)
    .post('/api/auth/register')
    .send({ name: `${role} user`, email: `${role}.${suffix}@flowforge.test`, password: 'password123', role });
  return { token: res.body.data.token, user: res.body.data.user };
}

function uniqueSlug(prefix = 'wf') {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
}

async function createWorkflowAndPause(adminToken) {
  const wf = await request(app).post('/api/workflows').set('Authorization', `Bearer ${adminToken}`).send({ name: 'WF', slug: uniqueSlug() });
  const wfId = wf.body.data.workflow._id;
  const draft = await request(app).post(`/api/workflows/${wfId}/versions`).set('Authorization', `Bearer ${adminToken}`).send({});
  const v = draft.body.data.version.version;
  const stages = [
    { stageId: 'validate', name: 'Validate', order: 1, type: 'validation', onSuccess: 'evaluate', onFailure: 'REJECTED' },
    { stageId: 'evaluate', name: 'Evaluate', order: 2, type: 'rule_evaluation', ruleGroup: 'main', onSuccess: 'APPROVED', onFailure: 'REJECTED' },
    { stageId: 'terminal', name: 'Terminal', order: 3, type: 'terminal' },
  ];
  const rules = [{ ruleId: 'C', name: 'C', group: 'main', condition: { field: 'score', operator: '>=', value: 700 }, onPass: 'APPROVE', onFail: 'MANUAL_REVIEW' }];
  const schema = [{ name: 'score', type: 'number', required: true }];
  await request(app).patch(`/api/workflows/${wfId}/versions/${v}`).set('Authorization', `Bearer ${adminToken}`).send({ inputSchema: schema, stages, rules, startStageId: 'validate' });
  await request(app).post(`/api/workflows/${wfId}/versions/${v}/publish`).set('Authorization', `Bearer ${adminToken}`).send();
  const submitRes = await request(app).post('/api/requests').set('Authorization', `Bearer ${adminToken}`).send({ workflowId: wfId, payload: { score: 100 } });
  return submitRes.body.data.execution;
}

describe('Review — concurrency and reliability', () => {
  let admin;
  let reviewerA;
  let reviewerB;

  beforeEach(async () => {
    const suffix = `${Date.now()}-${Math.random()}`;
    admin = await registerAndLogin('admin', suffix);
    reviewerA = await registerAndLogin('reviewer', `a-${suffix}`);
    reviewerB = await registerAndLogin('reviewer', `b-${suffix}`);
  });

  it('34. two simultaneous decision attempts on the same review: exactly one succeeds', async () => {
    const execution = await createWorkflowAndPause(admin.token);
    const review = await ManualReview.findOne({ executionId: execution._id });
    await request(app).post(`/api/reviews/${review._id}/assign`).set('Authorization', `Bearer ${admin.token}`).send({ reviewerId: reviewerA.user.id });

    const [approveRes, rejectRes] = await Promise.all([
      request(app).post(`/api/reviews/${review._id}/approve`).set('Authorization', `Bearer ${reviewerA.token}`).send({ comment: 'approve attempt' }),
      request(app).post(`/api/reviews/${review._id}/reject`).set('Authorization', `Bearer ${reviewerA.token}`).send({ comment: 'reject attempt' }),
    ]);

    const statuses = [approveRes.status, rejectRes.status].sort();
    expect(statuses).toEqual([200, 409]);

    // No duplicate workflow resumption: the engine only ever ran once.
    const finalExec = await WorkflowExecution.findById(execution._id);
    expect(finalExec.currentState).toBe('COMPLETED');
  });

  it('34b. 10 concurrent identical approval attempts: exactly one succeeds', async () => {
    const execution = await createWorkflowAndPause(admin.token);
    const review = await ManualReview.findOne({ executionId: execution._id });
    await request(app).post(`/api/reviews/${review._id}/assign`).set('Authorization', `Bearer ${admin.token}`).send({ reviewerId: reviewerA.user.id });

    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        request(app).post(`/api/reviews/${review._id}/approve`).set('Authorization', `Bearer ${reviewerA.token}`).send({ comment: 'concurrent approve' })
      )
    );
    const successCount = results.filter((r) => r.status === 200).length;
    const conflictCount = results.filter((r) => r.status === 409).length;
    expect(successCount).toBe(1);
    expect(conflictCount).toBe(9);
  });

  it('35. concurrent assignment changes are handled safely (last write wins, no corruption)', async () => {
    const execution = await createWorkflowAndPause(admin.token);
    const review = await ManualReview.findOne({ executionId: execution._id });

    const [resA, resB] = await Promise.all([
      request(app).post(`/api/reviews/${review._id}/assign`).set('Authorization', `Bearer ${admin.token}`).send({ reviewerId: reviewerA.user.id }),
      request(app).post(`/api/reviews/${review._id}/assign`).set('Authorization', `Bearer ${admin.token}`).send({ reviewerId: reviewerB.user.id }),
    ]);
    expect(resA.status).toBe(200);
    expect(resB.status).toBe(200);

    const finalReview = await ManualReview.findById(review._id);
    expect([reviewerA.user.id, reviewerB.user.id]).toContain(String(finalReview.assignedReviewerId));
    expect(finalReview.status).toBe('ASSIGNED');
  });

  it('36. duplicate review decision submissions never create duplicate ReviewAction records for the same decision', async () => {
    const execution = await createWorkflowAndPause(admin.token);
    const review = await ManualReview.findOne({ executionId: execution._id });
    await request(app).post(`/api/reviews/${review._id}/assign`).set('Authorization', `Bearer ${admin.token}`).send({ reviewerId: reviewerA.user.id });

    await Promise.all(
      Array.from({ length: 5 }, () =>
        request(app).post(`/api/reviews/${review._id}/approve`).set('Authorization', `Bearer ${reviewerA.token}`).send({ comment: 'dup' })
      )
    );

    const ReviewAction = require('../models/ReviewAction');
    const approvedActions = await ReviewAction.countDocuments({ reviewId: review._id, actionType: 'APPROVED' });
    expect(approvedActions).toBe(1);
  });

  it('37. workflow resumption via a review decision is idempotent at the engine level (cannot double-advance a COMPLETED execution)', async () => {
    const execution = await createWorkflowAndPause(admin.token);
    const review = await ManualReview.findOne({ executionId: execution._id });
    await request(app).post(`/api/reviews/${review._id}/assign`).set('Authorization', `Bearer ${admin.token}`).send({ reviewerId: reviewerA.user.id });
    await request(app).post(`/api/reviews/${review._id}/approve`).set('Authorization', `Bearer ${reviewerA.token}`).send({ comment: 'ok' });

    const workflowEngine = require('../services/workflowEngine');
    const WorkflowVersion = require('../models/WorkflowVersion');
    const completedExec = await WorkflowExecution.findById(execution._id);
    const version = await WorkflowVersion.findById(completedExec.workflowVersionId);
    await expect(workflowEngine.advance(completedExec, version, {}, 'APPROVE')).rejects.toThrow();
  });

  it('38. an interrupted review decision can be safely recovered without double-resuming', async () => {
    const execution = await createWorkflowAndPause(admin.token);
    const review = await ManualReview.findOne({ executionId: execution._id });
    await request(app).post(`/api/reviews/${review._id}/assign`).set('Authorization', `Bearer ${admin.token}`).send({ reviewerId: reviewerA.user.id });
    await request(app).post(`/api/reviews/${review._id}/approve`).set('Authorization', `Bearer ${reviewerA.token}`).send({ comment: 'ok' });

    // Even if a recovery sweep runs after the decision has already fully resumed
    // the execution, it must not find it as "interrupted" and must not touch it again.
    const recoveryService = require('../services/recoveryService');
    const sweepResult = await recoveryService.runRecoverySweep();
    const finalExec = await WorkflowExecution.findById(execution._id);
    expect(finalExec.currentState).toBe('COMPLETED');
    expect(finalExec.finalDecision).toBe('APPROVE');
  });
});

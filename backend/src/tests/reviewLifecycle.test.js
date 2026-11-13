const request = require('supertest');
const app = require('../app');
const ManualReview = require('../models/ManualReview');
const ReviewAction = require('../models/ReviewAction');

async function registerAndLogin(role, suffix) {
  const res = await request(app)
    .post('/api/auth/register')
    .send({ name: `${role} user`, email: `${role}.${suffix}@flowforge.test`, password: 'password123', role });
  return { token: res.body.data.token, user: res.body.data.user };
}

function uniqueSlug(prefix = 'wf') {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
}

async function createManualReviewWorkflow(token, { onManualReviewTarget = 'terminal' } = {}) {
  const wf = await request(app).post('/api/workflows').set('Authorization', `Bearer ${token}`).send({ name: 'WF', slug: uniqueSlug() });
  const wfId = wf.body.data.workflow._id;
  const draft = await request(app).post(`/api/workflows/${wfId}/versions`).set('Authorization', `Bearer ${token}`).send({});
  const v = draft.body.data.version.version;
  const stages = [
    { stageId: 'validate', name: 'Validate', order: 1, type: 'validation', onSuccess: 'evaluate', onFailure: 'REJECTED' },
    {
      stageId: 'evaluate',
      name: 'Evaluate',
      order: 2,
      type: 'rule_evaluation',
      ruleGroup: 'main',
      onSuccess: 'APPROVED',
      onFailure: 'REJECTED',
      onManualReview: onManualReviewTarget,
      reviewSlaMs: 3600000,
    },
    { stageId: 'terminal', name: 'Terminal', order: 3, type: 'terminal' },
  ];
  const rules = [
    { ruleId: 'C', name: 'Credit check', group: 'main', condition: { field: 'score', operator: '>=', value: 700 }, onPass: 'APPROVE', onFail: 'MANUAL_REVIEW' },
  ];
  const schema = [{ name: 'score', type: 'number', required: true }];
  await request(app)
    .patch(`/api/workflows/${wfId}/versions/${v}`)
    .set('Authorization', `Bearer ${token}`)
    .send({ inputSchema: schema, stages, rules, startStageId: 'validate' });
  await request(app).post(`/api/workflows/${wfId}/versions/${v}/publish`).set('Authorization', `Bearer ${token}`).send();
  return wfId;
}

async function submitForReview(token, wfId) {
  const res = await request(app).post('/api/requests').set('Authorization', `Bearer ${token}`).send({ workflowId: wfId, payload: { score: 100 } });
  return res.body.data;
}

describe('Review lifecycle', () => {
  let admin;
  let reviewer;

  beforeEach(async () => {
    const suffix = `${Date.now()}-${Math.random()}`;
    admin = await registerAndLogin('admin', suffix);
    reviewer = await registerAndLogin('reviewer', suffix);
  });

  it('1. manual review creates a review record', async () => {
    const wfId = await createManualReviewWorkflow(admin.token);
    const { execution } = await submitForReview(admin.token, wfId);
    const review = await ManualReview.findOne({ executionId: execution._id });
    expect(review).not.toBeNull();
    expect(review.status).toBe('PENDING');
  });

  it('2. the review appears in the pending queue', async () => {
    const wfId = await createManualReviewWorkflow(admin.token);
    await submitForReview(admin.token, wfId);
    const res = await request(app).get('/api/reviews').set('Authorization', `Bearer ${admin.token}`).query({ status: 'PENDING' });
    expect(res.body.data.items.length).toBeGreaterThanOrEqual(1);
  });

  it('3. admin assigns a reviewer', async () => {
    const wfId = await createManualReviewWorkflow(admin.token);
    const { execution } = await submitForReview(admin.token, wfId);
    const review = await ManualReview.findOne({ executionId: execution._id });

    const res = await request(app)
      .post(`/api/reviews/${review._id}/assign`)
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ reviewerId: reviewer.user.id });
    expect(res.status).toBe(200);
    expect(res.body.data.review.status).toBe('ASSIGNED');
    expect(res.body.data.review.assignedReviewerId).toBe(reviewer.user.id);
  });

  it('4. reviewer starts the review', async () => {
    const wfId = await createManualReviewWorkflow(admin.token);
    const { execution } = await submitForReview(admin.token, wfId);
    const review = await ManualReview.findOne({ executionId: execution._id });
    await request(app).post(`/api/reviews/${review._id}/assign`).set('Authorization', `Bearer ${admin.token}`).send({ reviewerId: reviewer.user.id });

    const res = await request(app).post(`/api/reviews/${review._id}/start`).set('Authorization', `Bearer ${reviewer.token}`);
    expect(res.status).toBe(200);
    expect(res.body.data.review.status).toBe('IN_REVIEW');
    expect(res.body.data.review.startedAt).toBeTruthy();
  });

  it('5. reviewer approves', async () => {
    const wfId = await createManualReviewWorkflow(admin.token);
    const { execution } = await submitForReview(admin.token, wfId);
    const review = await ManualReview.findOne({ executionId: execution._id });
    await request(app).post(`/api/reviews/${review._id}/assign`).set('Authorization', `Bearer ${admin.token}`).send({ reviewerId: reviewer.user.id });
    await request(app).post(`/api/reviews/${review._id}/start`).set('Authorization', `Bearer ${reviewer.token}`);

    const res = await request(app)
      .post(`/api/reviews/${review._id}/approve`)
      .set('Authorization', `Bearer ${reviewer.token}`)
      .send({ comment: 'Approved after manual inspection' });
    expect(res.status).toBe(200);
    expect(res.body.data.review.status).toBe('APPROVED');
    expect(res.body.data.execution.finalDecision).toBe('APPROVE');
  });

  it('6. reviewer rejects', async () => {
    const wfId = await createManualReviewWorkflow(admin.token);
    const { execution } = await submitForReview(admin.token, wfId);
    const review = await ManualReview.findOne({ executionId: execution._id });
    await request(app).post(`/api/reviews/${review._id}/assign`).set('Authorization', `Bearer ${admin.token}`).send({ reviewerId: reviewer.user.id });

    const res = await request(app)
      .post(`/api/reviews/${review._id}/reject`)
      .set('Authorization', `Bearer ${reviewer.token}`)
      .send({ comment: 'Insufficient information to approve' });
    expect(res.status).toBe(200);
    expect(res.body.data.review.status).toBe('REJECTED');
    expect(res.body.data.execution.finalDecision).toBe('REJECT');
  });

  it('7. reviewer requests more information', async () => {
    const wfId = await createManualReviewWorkflow(admin.token);
    const { execution } = await submitForReview(admin.token, wfId);
    const review = await ManualReview.findOne({ executionId: execution._id });
    await request(app).post(`/api/reviews/${review._id}/assign`).set('Authorization', `Bearer ${admin.token}`).send({ reviewerId: reviewer.user.id });

    const res = await request(app)
      .post(`/api/reviews/${review._id}/request-information`)
      .set('Authorization', `Bearer ${reviewer.token}`)
      .send({ explanation: 'Please provide proof of income' });
    expect(res.status).toBe(200);
    expect(res.body.data.review.status).toBe('MORE_INFORMATION_REQUIRED');

    // execution must remain paused
    const WorkflowExecution = require('../models/WorkflowExecution');
    const exec = await WorkflowExecution.findById(execution._id);
    expect(exec.currentState).toBe('MANUAL_REVIEW');
  });

  it('8. operator submits additional information', async () => {
    const suffix = `${Date.now()}-${Math.random()}`;
    const operator = await registerAndLogin('operator', suffix);
    const wfId = await createManualReviewWorkflow(admin.token);
    const { execution } = await submitForReview(admin.token, wfId);
    const review = await ManualReview.findOne({ executionId: execution._id });
    await request(app).post(`/api/reviews/${review._id}/assign`).set('Authorization', `Bearer ${admin.token}`).send({ reviewerId: reviewer.user.id });
    await request(app).post(`/api/reviews/${review._id}/request-information`).set('Authorization', `Bearer ${reviewer.token}`).send({ explanation: 'Need proof of income' });

    const res = await request(app)
      .post(`/api/reviews/${review._id}/submit-information`)
      .set('Authorization', `Bearer ${operator.token}`)
      .send({ text: 'Attached payslip for the last 3 months' });
    expect(res.status).toBe(200);
    expect(res.body.data.review.status).toBe('ASSIGNED');
    expect(res.body.data.review.submittedInformation.length).toBe(1);
  });

  it('9. reviewer resumes review after information is submitted and decides', async () => {
    const suffix = `${Date.now()}-${Math.random()}`;
    const operator = await registerAndLogin('operator', suffix);
    const wfId = await createManualReviewWorkflow(admin.token);
    const { execution } = await submitForReview(admin.token, wfId);
    const review = await ManualReview.findOne({ executionId: execution._id });
    await request(app).post(`/api/reviews/${review._id}/assign`).set('Authorization', `Bearer ${admin.token}`).send({ reviewerId: reviewer.user.id });
    await request(app).post(`/api/reviews/${review._id}/request-information`).set('Authorization', `Bearer ${reviewer.token}`).send({ explanation: 'Need proof' });
    await request(app).post(`/api/reviews/${review._id}/submit-information`).set('Authorization', `Bearer ${operator.token}`).send({ text: 'Here it is' });

    const startRes = await request(app).post(`/api/reviews/${review._id}/start`).set('Authorization', `Bearer ${reviewer.token}`);
    expect(startRes.status).toBe(200);

    const approveRes = await request(app).post(`/api/reviews/${review._id}/approve`).set('Authorization', `Bearer ${reviewer.token}`).send({ comment: 'Now approved' });
    expect(approveRes.body.data.review.status).toBe('APPROVED');
  });

  it('10. reviewer escalates the review', async () => {
    const wfId = await createManualReviewWorkflow(admin.token);
    const { execution } = await submitForReview(admin.token, wfId);
    const review = await ManualReview.findOne({ executionId: execution._id });
    await request(app).post(`/api/reviews/${review._id}/assign`).set('Authorization', `Bearer ${admin.token}`).send({ reviewerId: reviewer.user.id });

    const res = await request(app)
      .post(`/api/reviews/${review._id}/escalate`)
      .set('Authorization', `Bearer ${reviewer.token}`)
      .send({ reason: 'Requires senior approval — amount exceeds my authority' });
    expect(res.status).toBe(200);
    expect(res.body.data.review.status).toBe('ESCALATED');
  });

  it('11. a completed review cannot be decided again', async () => {
    const wfId = await createManualReviewWorkflow(admin.token);
    const { execution } = await submitForReview(admin.token, wfId);
    const review = await ManualReview.findOne({ executionId: execution._id });
    await request(app).post(`/api/reviews/${review._id}/assign`).set('Authorization', `Bearer ${admin.token}`).send({ reviewerId: reviewer.user.id });
    await request(app).post(`/api/reviews/${review._id}/approve`).set('Authorization', `Bearer ${reviewer.token}`).send({ comment: 'First decision' });

    const res = await request(app).post(`/api/reviews/${review._id}/reject`).set('Authorization', `Bearer ${reviewer.token}`).send({ comment: 'Second decision' });
    expect(res.status).toBe(409);
  });

  it('39/40. all actions create audit records and the history is complete and append-only', async () => {
    const wfId = await createManualReviewWorkflow(admin.token);
    const { execution } = await submitForReview(admin.token, wfId);
    const review = await ManualReview.findOne({ executionId: execution._id });
    await request(app).post(`/api/reviews/${review._id}/assign`).set('Authorization', `Bearer ${admin.token}`).send({ reviewerId: reviewer.user.id });
    await request(app).post(`/api/reviews/${review._id}/start`).set('Authorization', `Bearer ${reviewer.token}`);
    await request(app).post(`/api/reviews/${review._id}/approve`).set('Authorization', `Bearer ${reviewer.token}`).send({ comment: 'Final approval' });

    const actions = await ReviewAction.find({ reviewId: review._id }).sort({ createdAt: 1 });
    const actionTypes = actions.map((a) => a.actionType);
    expect(actionTypes).toEqual(['CREATED', 'ASSIGNED', 'STARTED', 'APPROVED']);

    // Append-only: direct mutation of a historical record is never performed by
    // the service layer — verify no action documents were updated after creation.
    actions.forEach((a) => expect(a.updatedAt).toBeUndefined());

    const historyRes = await request(app).get(`/api/reviews/${review._id}/history`).set('Authorization', `Bearer ${admin.token}`);
    expect(historyRes.body.data.actions.length).toBe(4);
  });
});

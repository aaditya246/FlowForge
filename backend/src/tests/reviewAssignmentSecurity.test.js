const request = require('supertest');
const app = require('../app');
const ManualReview = require('../models/ManualReview');

async function registerAndLogin(role, suffix, overrides = {}) {
  const res = await request(app)
    .post('/api/auth/register')
    .send({ name: `${role} user`, email: `${role}.${suffix}@flowforge.test`, password: 'password123', role, ...overrides });
  return { token: res.body.data.token, user: res.body.data.user };
}

function uniqueSlug(prefix = 'wf') {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
}

async function createWorkflowAndReview(adminToken) {
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
  const review = await ManualReview.findOne({ executionId: submitRes.body.data.execution._id });
  return review;
}

describe('Review — assignment, reassignment, and permissions', () => {
  let admin;
  let reviewerA;
  let reviewerB;
  let operator;
  let viewer;

  beforeEach(async () => {
    const suffix = `${Date.now()}-${Math.random()}`;
    admin = await registerAndLogin('admin', suffix);
    reviewerA = await registerAndLogin('reviewer', `a-${suffix}`);
    reviewerB = await registerAndLogin('reviewer', `b-${suffix}`);
    operator = await registerAndLogin('operator', suffix);
    viewer = await registerAndLogin('viewer', suffix);
  });

  it('20. admin assigns a reviewer', async () => {
    const review = await createWorkflowAndReview(admin.token);
    const res = await request(app).post(`/api/reviews/${review._id}/assign`).set('Authorization', `Bearer ${admin.token}`).send({ reviewerId: reviewerA.user.id });
    expect(res.status).toBe(200);
    expect(res.body.data.review.assignedReviewerId).toBe(reviewerA.user.id);
  });

  it('21. admin reassigns to a different reviewer', async () => {
    const review = await createWorkflowAndReview(admin.token);
    await request(app).post(`/api/reviews/${review._id}/assign`).set('Authorization', `Bearer ${admin.token}`).send({ reviewerId: reviewerA.user.id });
    const res = await request(app).put(`/api/reviews/${review._id}/reassign`).set('Authorization', `Bearer ${admin.token}`).send({ reviewerId: reviewerB.user.id });
    expect(res.status).toBe(200);
    expect(res.body.data.review.assignedReviewerId).toBe(reviewerB.user.id);
  });

  it('22. an inactive reviewer cannot be assigned', async () => {
    const inactiveReviewer = await registerAndLogin('reviewer', `inactive-${Date.now()}`);
    const User = require('../models/User');
    await User.updateOne({ _id: inactiveReviewer.user.id }, { $set: { isActive: false } });

    const review = await createWorkflowAndReview(admin.token);
    const res = await request(app)
      .post(`/api/reviews/${review._id}/assign`)
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ reviewerId: inactiveReviewer.user.id });
    expect(res.status).toBe(400);
  });

  it('a non-reviewer role cannot be assigned as a reviewer', async () => {
    const review = await createWorkflowAndReview(admin.token);
    const res = await request(app).post(`/api/reviews/${review._id}/assign`).set('Authorization', `Bearer ${admin.token}`).send({ reviewerId: operator.user.id });
    expect(res.status).toBe(400);
  });

  it('23. a reviewer can access and act on their own assigned review', async () => {
    const review = await createWorkflowAndReview(admin.token);
    await request(app).post(`/api/reviews/${review._id}/assign`).set('Authorization', `Bearer ${admin.token}`).send({ reviewerId: reviewerA.user.id });
    const res = await request(app).post(`/api/reviews/${review._id}/start`).set('Authorization', `Bearer ${reviewerA.token}`);
    expect(res.status).toBe(200);
  });

  it("24. a reviewer cannot act on another reviewer's assigned review", async () => {
    const review = await createWorkflowAndReview(admin.token);
    await request(app).post(`/api/reviews/${review._id}/assign`).set('Authorization', `Bearer ${admin.token}`).send({ reviewerId: reviewerA.user.id });

    const res = await request(app)
      .post(`/api/reviews/${review._id}/approve`)
      .set('Authorization', `Bearer ${reviewerB.token}`)
      .send({ comment: 'Trying to approve someone else\'s review' });
    expect(res.status).toBe(403);
  });

  it('25. an operator cannot approve or reject a review', async () => {
    const review = await createWorkflowAndReview(admin.token);
    await request(app).post(`/api/reviews/${review._id}/assign`).set('Authorization', `Bearer ${admin.token}`).send({ reviewerId: reviewerA.user.id });

    const approveRes = await request(app).post(`/api/reviews/${review._id}/approve`).set('Authorization', `Bearer ${operator.token}`).send({ comment: 'x' });
    const rejectRes = await request(app).post(`/api/reviews/${review._id}/reject`).set('Authorization', `Bearer ${operator.token}`).send({ comment: 'x' });
    expect(approveRes.status).toBe(403);
    expect(rejectRes.status).toBe(403);
  });

  it('26. a viewer cannot modify reviews in any way', async () => {
    const review = await createWorkflowAndReview(admin.token);
    expect((await request(app).post(`/api/reviews/${review._id}/assign`).set('Authorization', `Bearer ${viewer.token}`).send({ reviewerId: reviewerA.user.id })).status).toBe(403);
    expect((await request(app).post(`/api/reviews/${review._id}/approve`).set('Authorization', `Bearer ${viewer.token}`).send({ comment: 'x' })).status).toBe(403);
    expect((await request(app).post(`/api/reviews/${review._id}/escalate`).set('Authorization', `Bearer ${viewer.token}`).send({ reason: 'x' })).status).toBe(403);
  });

  it('a viewer CAN read review data (read-only access)', async () => {
    const review = await createWorkflowAndReview(admin.token);
    const res = await request(app).get(`/api/reviews/${review._id}`).set('Authorization', `Bearer ${viewer.token}`);
    expect(res.status).toBe(200);
  });

  it('only admin can unassign a review', async () => {
    const review = await createWorkflowAndReview(admin.token);
    await request(app).post(`/api/reviews/${review._id}/assign`).set('Authorization', `Bearer ${admin.token}`).send({ reviewerId: reviewerA.user.id });
    const forbidden = await request(app).delete(`/api/reviews/${review._id}/assign`).set('Authorization', `Bearer ${reviewerA.token}`);
    expect(forbidden.status).toBe(403);
    const allowed = await request(app).delete(`/api/reviews/${review._id}/assign`).set('Authorization', `Bearer ${admin.token}`);
    expect(allowed.status).toBe(200);
    expect(allowed.body.data.review.status).toBe('PENDING');
  });

  it('completed reviews cannot be reassigned', async () => {
    const review = await createWorkflowAndReview(admin.token);
    await request(app).post(`/api/reviews/${review._id}/assign`).set('Authorization', `Bearer ${admin.token}`).send({ reviewerId: reviewerA.user.id });
    await request(app).post(`/api/reviews/${review._id}/approve`).set('Authorization', `Bearer ${reviewerA.token}`).send({ comment: 'ok' });

    const res = await request(app).put(`/api/reviews/${review._id}/reassign`).set('Authorization', `Bearer ${admin.token}`).send({ reviewerId: reviewerB.user.id });
    expect(res.status).toBe(409);
  });

  it("a reviewer's queue view only shows their own assignments plus unassigned reviews", async () => {
    const reviewOne = await createWorkflowAndReview(admin.token);
    const reviewTwo = await createWorkflowAndReview(admin.token);
    await request(app).post(`/api/reviews/${reviewOne._id}/assign`).set('Authorization', `Bearer ${admin.token}`).send({ reviewerId: reviewerA.user.id });
    await request(app).post(`/api/reviews/${reviewTwo._id}/assign`).set('Authorization', `Bearer ${admin.token}`).send({ reviewerId: reviewerB.user.id });

    const res = await request(app).get('/api/reviews').set('Authorization', `Bearer ${reviewerA.token}`);
    const ids = res.body.data.items.map((r) => r._id);
    expect(ids).toContain(String(reviewOne._id));
    expect(ids).not.toContain(String(reviewTwo._id));
  });
});

const request = require('supertest');
const app = require('../app');
const ManualReview = require('../models/ManualReview');
const Notification = require('../models/Notification');
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

async function createWorkflow(adminToken, { reviewSlaMs = 3600000 } = {}) {
  const wf = await request(app).post('/api/workflows').set('Authorization', `Bearer ${adminToken}`).send({ name: 'WF', slug: uniqueSlug() });
  const wfId = wf.body.data.workflow._id;
  const draft = await request(app).post(`/api/workflows/${wfId}/versions`).set('Authorization', `Bearer ${adminToken}`).send({});
  const v = draft.body.data.version.version;
  const stages = [
    { stageId: 'validate', name: 'Validate', order: 1, type: 'validation', onSuccess: 'evaluate', onFailure: 'REJECTED' },
    { stageId: 'evaluate', name: 'Evaluate', order: 2, type: 'rule_evaluation', ruleGroup: 'main', onSuccess: 'APPROVED', onFailure: 'REJECTED', reviewSlaMs },
    { stageId: 'terminal', name: 'Terminal', order: 3, type: 'terminal' },
  ];
  const rules = [{ ruleId: 'C', name: 'C', group: 'main', condition: { field: 'score', operator: '>=', value: 700 }, onPass: 'APPROVE', onFail: 'MANUAL_REVIEW' }];
  const schema = [{ name: 'score', type: 'number', required: true }];
  await request(app).patch(`/api/workflows/${wfId}/versions/${v}`).set('Authorization', `Bearer ${adminToken}`).send({ inputSchema: schema, stages, rules, startStageId: 'validate' });
  await request(app).post(`/api/workflows/${wfId}/versions/${v}/publish`).set('Authorization', `Bearer ${adminToken}`).send();
  return wfId;
}

async function submit(token, wfId) {
  const res = await request(app).post('/api/requests').set('Authorization', `Bearer ${token}`).send({ workflowId: wfId, payload: { score: 100 } });
  return res.body.data;
}

describe('Review — deadlines and escalation', () => {
  let admin;
  let reviewer;

  beforeEach(async () => {
    const suffix = `${Date.now()}-${Math.random()}`;
    admin = await registerAndLogin('admin', suffix);
    reviewer = await registerAndLogin('reviewer', suffix);
  });

  it('27. a review deadline is calculated from the stage-configured SLA', async () => {
    const wfId = await createWorkflow(admin.token, { reviewSlaMs: 60 * 60 * 1000 }); // 1 hour
    const { execution } = await submit(admin.token, wfId);
    const review = await ManualReview.findOne({ executionId: execution._id });

    const expectedMs = review.createdAt.getTime() + 60 * 60 * 1000;
    expect(Math.abs(review.dueAt.getTime() - expectedMs)).toBeLessThan(5000);
  });

  it('a review with no configured SLA falls back to the documented default', async () => {
    const wf = await request(app).post('/api/workflows').set('Authorization', `Bearer ${admin.token}`).send({ name: 'WF', slug: uniqueSlug() });
    const wfId = wf.body.data.workflow._id;
    const draft = await request(app).post(`/api/workflows/${wfId}/versions`).set('Authorization', `Bearer ${admin.token}`).send({});
    const v = draft.body.data.version.version;
    const stages = [
      { stageId: 'validate', name: 'Validate', order: 1, type: 'validation', onSuccess: 'evaluate', onFailure: 'REJECTED' },
      { stageId: 'evaluate', name: 'Evaluate', order: 2, type: 'rule_evaluation', ruleGroup: 'main', onSuccess: 'APPROVED', onFailure: 'REJECTED' },
      { stageId: 'terminal', name: 'Terminal', order: 3, type: 'terminal' },
    ];
    const rules = [{ ruleId: 'C', name: 'C', group: 'main', condition: { field: 'score', operator: '>=', value: 700 }, onPass: 'APPROVE', onFail: 'MANUAL_REVIEW' }];
    await request(app)
      .patch(`/api/workflows/${wfId}/versions/${v}`)
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ inputSchema: [{ name: 'score', type: 'number', required: true }], stages, rules, startStageId: 'validate' });
    await request(app).post(`/api/workflows/${wfId}/versions/${v}/publish`).set('Authorization', `Bearer ${admin.token}`).send();
    const { execution } = await submit(admin.token, wfId);
    const review = await ManualReview.findOne({ executionId: execution._id });
    expect(review.slaMs).toBe(reviewService.DEFAULT_SLA_MS);
  });

  it('28. overdue reviews are detected', async () => {
    const wfId = await createWorkflow(admin.token);
    const { execution } = await submit(admin.token, wfId);
    const review = await ManualReview.findOne({ executionId: execution._id });
    await ManualReview.updateOne({ _id: review._id }, { $set: { dueAt: new Date(Date.now() - 1000) } });

    const overdue = await reviewService.findOverdueReviews();
    expect(overdue.some((r) => String(r._id) === String(review._id))).toBe(true);

    const res = await request(app).get('/api/reviews').set('Authorization', `Bearer ${admin.token}`).query({ overdueOnly: true });
    expect(res.body.data.items.some((r) => r._id === String(review._id))).toBe(true);
  });

  it('29. the escalation sweep escalates overdue reviews and respects the configured threshold', async () => {
    const wfId = await createWorkflow(admin.token);
    const { execution } = await submit(admin.token, wfId);
    const review = await ManualReview.findOne({ executionId: execution._id });
    await ManualReview.updateOne({ _id: review._id }, { $set: { dueAt: new Date(Date.now() - 1000) } });

    const result = await reviewService.runEscalationSweep();
    expect(result.escalatedCount).toBeGreaterThanOrEqual(1);

    const after = await ManualReview.findById(review._id);
    expect(after.status).toBe('ESCALATED');
    expect(after.escalationReason).toBeTruthy();
  });

  it('a review not yet past its deadline is NOT escalated', async () => {
    const wfId = await createWorkflow(admin.token, { reviewSlaMs: 60 * 60 * 1000 });
    const { execution } = await submit(admin.token, wfId);
    const review = await ManualReview.findOne({ executionId: execution._id });

    await reviewService.runEscalationSweep();
    const after = await ManualReview.findById(review._id);
    expect(after.status).toBe('PENDING');
  });

  it('30. assigning a review generates a notification for the reviewer', async () => {
    const wfId = await createWorkflow(admin.token);
    const { execution } = await submit(admin.token, wfId);
    const review = await ManualReview.findOne({ executionId: execution._id });
    await request(app).post(`/api/reviews/${review._id}/assign`).set('Authorization', `Bearer ${admin.token}`).send({ reviewerId: reviewer.user.id });

    const notifications = await Notification.find({ userId: reviewer.user.id, type: 'REVIEW_ASSIGNED' });
    expect(notifications.length).toBe(1);
  });

  it('31. submitting additional information generates a notification for the assigned reviewer', async () => {
    const operator = await registerAndLogin('operator', `${Date.now()}-${Math.random()}`);
    const wfId = await createWorkflow(admin.token);
    const { execution } = await submit(admin.token, wfId);
    const review = await ManualReview.findOne({ executionId: execution._id });
    await request(app).post(`/api/reviews/${review._id}/assign`).set('Authorization', `Bearer ${admin.token}`).send({ reviewerId: reviewer.user.id });
    await request(app).post(`/api/reviews/${review._id}/request-information`).set('Authorization', `Bearer ${reviewer.token}`).send({ explanation: 'need docs' });
    await request(app).post(`/api/reviews/${review._id}/submit-information`).set('Authorization', `Bearer ${operator.token}`).send({ text: 'here' });

    const notifications = await Notification.find({ userId: reviewer.user.id, type: 'INFORMATION_SUBMITTED' });
    expect(notifications.length).toBe(1);
  });

  it('32. a decision generates a notification for the original submitter', async () => {
    const wfId = await createWorkflow(admin.token);
    const { execution, request: req } = await submit(admin.token, wfId);
    const review = await ManualReview.findOne({ executionId: execution._id });
    await request(app).post(`/api/reviews/${review._id}/assign`).set('Authorization', `Bearer ${admin.token}`).send({ reviewerId: reviewer.user.id });
    await request(app).post(`/api/reviews/${review._id}/approve`).set('Authorization', `Bearer ${reviewer.token}`).send({ comment: 'ok' });

    const notifications = await Notification.find({ userId: req.submittedBy, type: 'REVIEW_APPROVED' });
    expect(notifications.length).toBe(1);
  });

  it('33. notifications can be marked as read individually and all at once', async () => {
    const wfId = await createWorkflow(admin.token);
    const { execution } = await submit(admin.token, wfId);
    const review = await ManualReview.findOne({ executionId: execution._id });
    await request(app).post(`/api/reviews/${review._id}/assign`).set('Authorization', `Bearer ${admin.token}`).send({ reviewerId: reviewer.user.id });

    const listRes = await request(app).get('/api/notifications').set('Authorization', `Bearer ${reviewer.token}`);
    expect(listRes.body.data.items.length).toBeGreaterThanOrEqual(1);
    const notificationId = listRes.body.data.items[0]._id;

    const unreadBefore = await request(app).get('/api/notifications/unread-count').set('Authorization', `Bearer ${reviewer.token}`);
    expect(unreadBefore.body.data.count).toBeGreaterThanOrEqual(1);

    const readRes = await request(app).patch(`/api/notifications/${notificationId}/read`).set('Authorization', `Bearer ${reviewer.token}`);
    expect(readRes.status).toBe(200);
    expect(readRes.body.data.notification.read).toBe(true);

    const markAllRes = await request(app).patch('/api/notifications/read-all').set('Authorization', `Bearer ${reviewer.token}`);
    expect(markAllRes.status).toBe(200);

    const unreadAfter = await request(app).get('/api/notifications/unread-count').set('Authorization', `Bearer ${reviewer.token}`);
    expect(unreadAfter.body.data.count).toBe(0);
  });

  it('a user cannot mark another user\'s notification as read', async () => {
    const wfId = await createWorkflow(admin.token);
    const { execution } = await submit(admin.token, wfId);
    const review = await ManualReview.findOne({ executionId: execution._id });
    await request(app).post(`/api/reviews/${review._id}/assign`).set('Authorization', `Bearer ${admin.token}`).send({ reviewerId: reviewer.user.id });

    const notification = await Notification.findOne({ userId: reviewer.user.id });
    const res = await request(app).patch(`/api/notifications/${notification._id}/read`).set('Authorization', `Bearer ${admin.token}`);
    expect(res.status).toBe(404);
  });
});

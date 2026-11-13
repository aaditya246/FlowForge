const request = require('supertest');
const app = require('../app');

async function registerAndLogin(role, suffix) {
  const user = {
    name: `${role} user`,
    email: `${role}.${suffix}@flowforge.test`,
    password: 'password123',
    role,
  };
  const res = await request(app).post('/api/auth/register').send(user);
  return res.body.data.token;
}

function validStage() {
  return [
    { stageId: 'validate', name: 'Validate', order: 1, type: 'validation', onSuccess: 'evaluate', onFailure: 'REJECTED' },
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

function validRules() {
  return [
    {
      ruleId: 'CREDIT_CHECK',
      name: 'Minimum credit score',
      group: 'main',
      condition: { field: 'creditScore', operator: '>=', value: 700 },
      onPass: 'APPROVE',
      onFail: 'REJECT',
    },
  ];
}

async function createWorkflow(adminToken, slug = 'loan-approval') {
  const res = await request(app)
    .post('/api/workflows')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ name: 'Loan Approval', slug, description: 'test' });
  return res.body.data.workflow;
}

describe('Workflow versioning', () => {
  let adminToken;
  let operatorToken;
  let viewerToken;

  beforeEach(async () => {
    adminToken = await registerAndLogin('admin', Date.now() + '-a');
    operatorToken = await registerAndLogin('operator', Date.now() + '-o');
    viewerToken = await registerAndLogin('viewer', Date.now() + '-v');
  });

  it('creates a workflow', async () => {
    const workflow = await createWorkflow(adminToken);
    expect(workflow.slug).toBe('loan-approval');
    expect(workflow.status).toBe('active');
  });

  it('creates a draft version', async () => {
    const workflow = await createWorkflow(adminToken);
    const res = await request(app)
      .post(`/api/workflows/${workflow._id}/versions`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({});
    expect(res.status).toBe(201);
    expect(res.body.data.version.version).toBe(1);
    expect(res.body.data.version.status).toBe('draft');
  });

  it('updates a draft version with stages and rules', async () => {
    const workflow = await createWorkflow(adminToken);
    const draftRes = await request(app)
      .post(`/api/workflows/${workflow._id}/versions`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({});
    const version = draftRes.body.data.version.version;

    const res = await request(app)
      .patch(`/api/workflows/${workflow._id}/versions/${version}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ stages: validStage(), rules: validRules(), startStageId: 'validate' });

    expect(res.status).toBe(200);
    expect(res.body.data.version.stages).toHaveLength(3);
    expect(res.body.data.version.rules).toHaveLength(1);
  });

  it('publishes a valid version', async () => {
    const workflow = await createWorkflow(adminToken);
    const draftRes = await request(app)
      .post(`/api/workflows/${workflow._id}/versions`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({});
    const version = draftRes.body.data.version.version;

    await request(app)
      .patch(`/api/workflows/${workflow._id}/versions/${version}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ stages: validStage(), rules: validRules(), startStageId: 'validate' });

    const publishRes = await request(app)
      .post(`/api/workflows/${workflow._id}/versions/${version}/publish`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send();

    expect(publishRes.status).toBe(200);
    expect(publishRes.body.data.version.status).toBe('published');
    expect(publishRes.body.data.version.publishedAt).toBeTruthy();
  });

  it('rejects publishing an invalid configuration', async () => {
    const workflow = await createWorkflow(adminToken);
    const draftRes = await request(app)
      .post(`/api/workflows/${workflow._id}/versions`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({});
    const version = draftRes.body.data.version.version;

    // No stages, no startStageId -> invalid
    const publishRes = await request(app)
      .post(`/api/workflows/${workflow._id}/versions/${version}/publish`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send();

    expect(publishRes.status).toBe(400);
    expect(publishRes.body.error.details.length).toBeGreaterThan(0);
  });

  it('validate endpoint reports errors without publishing', async () => {
    const workflow = await createWorkflow(adminToken);
    const draftRes = await request(app)
      .post(`/api/workflows/${workflow._id}/versions`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({});
    const version = draftRes.body.data.version.version;

    const res = await request(app)
      .post(`/api/workflows/${workflow._id}/versions/${version}/validate`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send();

    expect(res.status).toBe(200);
    expect(res.body.data.valid).toBe(false);
    expect(res.body.data.errors.length).toBeGreaterThan(0);
  });

  it('prevents editing a published version', async () => {
    const workflow = await createWorkflow(adminToken);
    const draftRes = await request(app)
      .post(`/api/workflows/${workflow._id}/versions`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({});
    const version = draftRes.body.data.version.version;

    await request(app)
      .patch(`/api/workflows/${workflow._id}/versions/${version}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ stages: validStage(), rules: validRules(), startStageId: 'validate' });

    await request(app)
      .post(`/api/workflows/${workflow._id}/versions/${version}/publish`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send();

    const editRes = await request(app)
      .patch(`/api/workflows/${workflow._id}/versions/${version}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ startStageId: 'validate' });

    expect(editRes.status).toBe(409);
  });

  it('a new draft version does not alter the published version', async () => {
    const workflow = await createWorkflow(adminToken);
    const draftRes = await request(app)
      .post(`/api/workflows/${workflow._id}/versions`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({});
    const v1 = draftRes.body.data.version.version;

    await request(app)
      .patch(`/api/workflows/${workflow._id}/versions/${v1}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ stages: validStage(), rules: validRules(), startStageId: 'validate' });

    await request(app)
      .post(`/api/workflows/${workflow._id}/versions/${v1}/publish`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send();

    const v2Res = await request(app)
      .post(`/api/workflows/${workflow._id}/versions`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ cloneFromVersion: v1 });
    const v2 = v2Res.body.data.version.version;

    const newRules = [{ ...validRules()[0], condition: { field: 'creditScore', operator: '>=', value: 600 } }];
    await request(app)
      .patch(`/api/workflows/${workflow._id}/versions/${v2}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ rules: newRules });

    const v1AfterRes = await request(app)
      .get(`/api/workflows/${workflow._id}/versions/${v1}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(v1AfterRes.body.data.version.rules[0].condition.value).toBe(700);
  });

  it('version history lists both versions in descending order', async () => {
    const workflow = await createWorkflow(adminToken);
    await request(app)
      .post(`/api/workflows/${workflow._id}/versions`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({});
    await request(app)
      .post(`/api/workflows/${workflow._id}/versions`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({});

    const historyRes = await request(app)
      .get(`/api/workflows/${workflow._id}/versions`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(historyRes.body.data.versions.map((v) => v.version)).toEqual([2, 1]);
  });

  it('enforces RBAC: non-admin cannot create a workflow', async () => {
    const res = await request(app)
      .post('/api/workflows')
      .set('Authorization', `Bearer ${operatorToken}`)
      .send({ name: 'X', slug: 'x-workflow' });
    expect(res.status).toBe(403);
  });

  it('enforces RBAC: viewer can read workflows but not publish versions', async () => {
    const workflow = await createWorkflow(adminToken);
    const readRes = await request(app)
      .get(`/api/workflows/${workflow._id}`)
      .set('Authorization', `Bearer ${viewerToken}`);
    expect(readRes.status).toBe(200);

    const draftRes = await request(app)
      .post(`/api/workflows/${workflow._id}/versions`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({});
    const version = draftRes.body.data.version.version;

    const publishRes = await request(app)
      .post(`/api/workflows/${workflow._id}/versions/${version}/publish`)
      .set('Authorization', `Bearer ${viewerToken}`)
      .send();
    expect(publishRes.status).toBe(403);
  });
});

describe('Rule testing endpoint', () => {
  it('evaluates an ad-hoc rule set against sample input', async () => {
    const token = await registerAndLogin('admin', Date.now() + '-rule');
    const res = await request(app)
      .post('/api/rules/test-evaluate')
      .set('Authorization', `Bearer ${token}`)
      .send({ rules: validRules(), context: { creditScore: 780 } });

    expect(res.status).toBe(200);
    expect(res.body.data.result.outcome).toBe('APPROVE');
    expect(res.body.data.result.rulesEvaluated).toHaveLength(1);
  });

  it('returns a 400 with details for an invalid rule structure', async () => {
    const token = await registerAndLogin('admin', Date.now() + '-rule2');
    const res = await request(app)
      .post('/api/rules/test-evaluate')
      .set('Authorization', `Bearer ${token}`)
      .send({ rules: [{ ruleId: 'bad' }] });

    expect(res.status).toBe(400);
  });
});

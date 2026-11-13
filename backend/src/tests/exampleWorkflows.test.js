const fs = require('fs');
const path = require('path');
const request = require('supertest');
const app = require('../app');

async function registerAndLogin(suffix) {
  const res = await request(app)
    .post('/api/auth/register')
    .send({ name: 'Admin', email: `admin.${suffix}@flowforge.test`, password: 'password123', role: 'admin' });
  return res.body.data.token;
}

function loadExample(filename) {
  const config = JSON.parse(fs.readFileSync(path.join(__dirname, '../../../examples', filename), 'utf8'));
  delete config._comment;
  return config;
}

async function setUpWorkflow(token, slug, config) {
  const wf = await request(app).post('/api/workflows').set('Authorization', `Bearer ${token}`).send({ name: slug, slug });
  const wfId = wf.body.data.workflow._id;
  const draft = await request(app).post(`/api/workflows/${wfId}/versions`).set('Authorization', `Bearer ${token}`).send({});
  const v = draft.body.data.version.version;
  const upd = await request(app).patch(`/api/workflows/${wfId}/versions/${v}`).set('Authorization', `Bearer ${token}`).send(config);
  if (upd.status !== 200) throw new Error(`Setup PATCH failed: ${JSON.stringify(upd.body)}`);
  const pub = await request(app).post(`/api/workflows/${wfId}/versions/${v}/publish`).set('Authorization', `Bearer ${token}`).send();
  if (pub.status !== 200) throw new Error(`Setup publish failed: ${JSON.stringify(pub.body)}`);
  return wfId;
}

describe('End-to-end — Scenario A: Loan Approval example (examples/loan-approval-workflow.json)', () => {
  let token;
  let wfId;

  // Re-created before every test: the shared test setup wipes all collections
  // in a global afterEach, so fixtures cannot be shared via beforeAll here.
  beforeEach(async () => {
    token = await registerAndLogin(`loan-${Date.now()}-${Math.random()}`);
    wfId = await setUpWorkflow(token, `loan-e2e-${Date.now()}-${Math.floor(Math.random() * 1e9)}`, loadExample('loan-approval-workflow.json'));
  });

  it('approves a valid high-credit application', async () => {
    const res = await request(app)
      .post('/api/requests')
      .set('Authorization', `Bearer ${token}`)
      .send({
        workflowId: wfId,
        payload: { applicantName: 'Alice', monthlySalary: 60000, creditScore: 780, loanAmount: 200000, employmentStatus: 'salaried' },
      });
    expect(res.status).toBe(201);
    expect(res.body.data.execution.currentState).toBe('COMPLETED');
    expect(res.body.data.execution.finalDecision).toBe('APPROVE');
  });

  it('rejects a low-credit-score application', async () => {
    const res = await request(app)
      .post('/api/requests')
      .set('Authorization', `Bearer ${token}`)
      .send({
        workflowId: wfId,
        payload: { applicantName: 'Bob', monthlySalary: 60000, creditScore: 500, loanAmount: 200000, employmentStatus: 'salaried' },
      });
    expect(res.body.data.execution.finalDecision).toBe('REJECT');
  });

  it('routes a borderline application to manual review', async () => {
    const res = await request(app)
      .post('/api/requests')
      .set('Authorization', `Bearer ${token}`)
      .send({
        workflowId: wfId,
        payload: { applicantName: 'Carol', monthlySalary: 40000, creditScore: 650, loanAmount: 200000, employmentStatus: 'self_employed' },
      });
    expect(res.body.data.execution.currentState).toBe('MANUAL_REVIEW');
  });

  it('rejects submission with missing mandatory fields before execution starts', async () => {
    const res = await request(app)
      .post('/api/requests')
      .set('Authorization', `Bearer ${token}`)
      .send({ workflowId: wfId, payload: { monthlySalary: 60000, creditScore: 780 } });
    expect(res.status).toBe(422);
    expect(res.body.data.execution).toBeNull();
  });
});

describe('End-to-end — Scenario B: Insurance Claim example (examples/insurance-claim-workflow.json)', () => {
  let token;
  let wfId;

  beforeEach(async () => {
    token = await registerAndLogin(`claim-${Date.now()}-${Math.random()}`);
    wfId = await setUpWorkflow(token, `claim-e2e-${Date.now()}-${Math.floor(Math.random() * 1e9)}`, loadExample('insurance-claim-workflow.json'));
  });

  it('approves a low-value valid claim', async () => {
    const res = await request(app)
      .post('/api/requests')
      .set('Authorization', `Bearer ${token}`)
      .send({
        workflowId: wfId,
        payload: { policyNumber: 'P1', claimAmount: 5000, policyValid: true, documentsSubmitted: ['proof_of_loss'], priorClaimsThisYear: 0 },
      });
    expect(res.body.data.execution.finalDecision).toBe('APPROVE');
  });

  it('rejects a claim against an invalid policy', async () => {
    const res = await request(app)
      .post('/api/requests')
      .set('Authorization', `Bearer ${token}`)
      .send({
        workflowId: wfId,
        payload: { policyNumber: 'P2', claimAmount: 5000, policyValid: false, documentsSubmitted: ['proof_of_loss'], priorClaimsThisYear: 0 },
      });
    expect(res.body.data.execution.finalDecision).toBe('REJECT');
  });

  it('routes a high-value claim to manual review', async () => {
    const res = await request(app)
      .post('/api/requests')
      .set('Authorization', `Bearer ${token}`)
      .send({
        workflowId: wfId,
        payload: { policyNumber: 'P3', claimAmount: 50000, policyValid: true, documentsSubmitted: ['proof_of_loss'], priorClaimsThisYear: 0 },
      });
    expect(res.body.data.execution.currentState).toBe('MANUAL_REVIEW');
  });

  it('rejects an invalid claim submission (missing mandatory fields)', async () => {
    const res = await request(app)
      .post('/api/requests')
      .set('Authorization', `Bearer ${token}`)
      .send({ workflowId: wfId, payload: { claimAmount: 5000, policyValid: true } });
    expect(res.status).toBe(422);
  });
});

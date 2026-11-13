const jwt = require('jsonwebtoken');
const request = require('supertest');
const app = require('../app');
const { jwtSecret } = require('../config/env');

async function registerAndLogin(role = 'admin', suffix = Date.now()) {
  const user = {
    name: `${role} user`,
    email: `${role}.${suffix}@flowforge.test`,
    password: 'password123',
    role,
  };
  const res = await request(app).post('/api/auth/register').send(user);
  return res.body.data.token;
}

describe('Auth edge cases', () => {
  it('rejects a request with no Authorization header', async () => {
    const res = await request(app).get('/api/auth/me');
    expect(res.status).toBe(401);
  });

  it('rejects a malformed Authorization header (no Bearer scheme)', async () => {
    const res = await request(app).get('/api/auth/me').set('Authorization', 'Token abc123');
    expect(res.status).toBe(401);
  });

  it('rejects a syntactically invalid JWT', async () => {
    const res = await request(app).get('/api/auth/me').set('Authorization', 'Bearer not.a.valid.jwt');
    expect(res.status).toBe(401);
  });

  it('rejects an expired JWT', async () => {
    const token = jwt.sign({ sub: '507f1f77bcf86cd799439011', role: 'admin' }, jwtSecret, { expiresIn: -10 });
    const res = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(401);
  });

  it('rejects a token with a malformed ObjectId as "sub" with 401, not a raw CastError 400', async () => {
    const token = jwt.sign({ sub: 'not-a-valid-objectid', role: 'admin' }, jwtSecret);
    const res = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(401);
  });

  it('rejects a token for a user that no longer exists', async () => {
    const token = jwt.sign({ sub: '507f1f77bcf86cd799439011', role: 'admin' }, jwtSecret);
    const res = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(401);
  });

  it('rejects registration with missing required fields', async () => {
    const res = await request(app).post('/api/auth/register').send({ email: 'x@y.com' });
    expect(res.status).toBe(400);
    expect(res.body.error.details.length).toBeGreaterThan(0);
  });

  it('rejects registration with an invalid email format', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ name: 'Test', email: 'not-an-email', password: 'password123' });
    expect(res.status).toBe(400);
  });

  it('rejects login for a non-existent email', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'nobody@flowforge.test', password: 'password123' });
    expect(res.status).toBe(401);
  });

  it('returns 400 (not 500) for a malformed JSON request body', async () => {
    const server = app.listen(0);
    const port = server.address().port;
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{ this is not json',
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error.code).toBe('BAD_REQUEST');
    } finally {
      server.close();
    }
  });

  it('returns 400 (not 500) for an invalid ObjectId in a route parameter', async () => {
    const token = await registerAndLogin('admin', 'objid');
    const res = await request(app).get('/api/workflows/not-an-id').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(400);
  });

  it('returns 404 for a well-formed but non-existent ObjectId', async () => {
    const mongoose = require('mongoose');
    const token = await registerAndLogin('admin', 'nf');
    const res = await request(app)
      .get(`/api/workflows/${new mongoose.Types.ObjectId()}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(404);
  });
});

describe('RBAC — all four roles against workflow write operations', () => {
  const roles = ['admin', 'reviewer', 'operator', 'viewer'];
  let tokens = {};
  let workflowId;

  beforeEach(async () => {
    for (const role of roles) {
      tokens[role] = await registerAndLogin(role, `${role}-${Date.now()}-${Math.random()}`);
    }
    const res = await request(app)
      .post('/api/workflows')
      .set('Authorization', `Bearer ${tokens.admin}`)
      .send({ name: 'RBAC Test', slug: `rbac-${Date.now()}` });
    workflowId = res.body.data.workflow._id;
  });

  it('only admin can create a workflow', async () => {
    for (const role of ['reviewer', 'operator', 'viewer']) {
      const res = await request(app)
        .post('/api/workflows')
        .set('Authorization', `Bearer ${tokens[role]}`)
        .send({ name: 'X', slug: `x-${role}-${Date.now()}` });
      expect(res.status).toBe(403);
    }
  });

  it('all roles can read workflows', async () => {
    for (const role of roles) {
      const res = await request(app).get('/api/workflows').set('Authorization', `Bearer ${tokens[role]}`);
      expect(res.status).toBe(200);
    }
  });

  it('only admin can create a draft version', async () => {
    for (const role of ['reviewer', 'operator', 'viewer']) {
      const res = await request(app)
        .post(`/api/workflows/${workflowId}/versions`)
        .set('Authorization', `Bearer ${tokens[role]}`)
        .send({});
      expect(res.status).toBe(403);
    }
    const adminRes = await request(app)
      .post(`/api/workflows/${workflowId}/versions`)
      .set('Authorization', `Bearer ${tokens.admin}`)
      .send({});
    expect(adminRes.status).toBe(201);
  });

  it('admin and reviewer can test rules, operator and viewer cannot', async () => {
    const payload = {
      rules: [
        {
          ruleId: 'R1',
          name: 'test',
          condition: { field: 'x', operator: 'EXISTS' },
          onPass: 'APPROVE',
          onFail: 'REJECT',
        },
      ],
      context: { x: 1 },
    };
    const adminRes = await request(app)
      .post('/api/rules/test-evaluate')
      .set('Authorization', `Bearer ${tokens.admin}`)
      .send(payload);
    expect(adminRes.status).toBe(200);

    const reviewerRes = await request(app)
      .post('/api/rules/test-evaluate')
      .set('Authorization', `Bearer ${tokens.reviewer}`)
      .send(payload);
    expect(reviewerRes.status).toBe(200);

    for (const role of ['operator', 'viewer']) {
      const res = await request(app)
        .post('/api/rules/test-evaluate')
        .set('Authorization', `Bearer ${tokens[role]}`)
        .send(payload);
      expect(res.status).toBe(403);
    }
  });
});

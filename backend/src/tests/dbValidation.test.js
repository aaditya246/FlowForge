const mongoose = require('mongoose');
const request = require('supertest');
const app = require('../app');
const WorkflowDefinition = require('../models/WorkflowDefinition');
const User = require('../models/User');

async function registerAndLogin(role = 'admin', suffix = Date.now()) {
  const user = { name: `${role} user`, email: `${role}.${suffix}@flowforge.test`, password: 'password123', role };
  const res = await request(app).post('/api/auth/register').send(user);
  return res.body.data.token;
}

describe('Database-level validation and persistence', () => {
  it('rejects creating a User document missing required fields', async () => {
    await expect(User.create({ name: 'No Email' })).rejects.toThrow();
  });

  it('enforces the unique index on User.email at the database level', async () => {
    await User.create({ name: 'A', email: 'dup@x.com', passwordHash: 'hash', role: 'admin' });
    await expect(User.create({ name: 'B', email: 'dup@x.com', passwordHash: 'hash', role: 'admin' })).rejects.toThrow();
  });

  it('rejects duplicate workflow slugs via the API (409)', async () => {
    const token = await registerAndLogin('admin', 'slugdup');
    const slug = `dup-slug-${Date.now()}`;
    const first = await request(app)
      .post('/api/workflows')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'First', slug });
    expect(first.status).toBe(201);

    const second = await request(app)
      .post('/api/workflows')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Second', slug });
    expect(second.status).toBe(409);
  });

  it('persists a workflow and is retrievable by its generated _id', async () => {
    const token = await registerAndLogin('admin', 'persist');
    const created = await request(app)
      .post('/api/workflows')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Persisted', slug: `persisted-${Date.now()}` });

    const fetched = await WorkflowDefinition.findById(created.body.data.workflow._id);
    expect(fetched).not.toBeNull();
    expect(fetched.name).toBe('Persisted');
  });

  it('rejects an invalid slug format at the API validation layer', async () => {
    const token = await registerAndLogin('admin', 'badslug');
    const res = await request(app)
      .post('/api/workflows')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Bad Slug', slug: 'Not A Valid Slug!' });
    expect(res.status).toBe(400);
  });

  it('MongoDB connection is healthy (readyState === 1)', () => {
    expect(mongoose.connection.readyState).toBe(1);
  });
});

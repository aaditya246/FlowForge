const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

let mongod;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  // Mongoose builds indexes (e.g. unique constraints) asynchronously in the
  // background after connect — without waiting here, the very first writes in
  // a test file can race ahead of index creation and intermittently miss
  // uniqueness enforcement. Loading all models here (once per test file) and
  // waiting on their index builds makes that deterministic.
  require('../models');
  await Promise.all(Object.values(mongoose.connection.models).map((model) => model.init()));
}, 120000);

afterEach(async () => {
  const collections = mongoose.connection.collections;
  await Promise.all(Object.values(collections).map((c) => c.deleteMany({})));
});

afterAll(async () => {
  await mongoose.disconnect();
  if (mongod) await mongod.stop();
});

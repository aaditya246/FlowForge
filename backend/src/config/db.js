const mongoose = require('mongoose');
const { mongoUri } = require('./env');

let isConnected = false;

async function connectDB() {
  if (isConnected) return mongoose.connection;

  mongoose.set('strictQuery', true);

  await mongoose.connect(mongoUri);
  isConnected = true;

  mongoose.connection.on('disconnected', () => {
    isConnected = false;
  });

  return mongoose.connection;
}

async function disconnectDB() {
  await mongoose.disconnect();
  isConnected = false;
}

module.exports = { connectDB, disconnectDB };

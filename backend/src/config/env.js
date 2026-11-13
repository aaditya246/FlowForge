require('dotenv').config();

module.exports = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: Number(process.env.PORT) || 5000,
  mongoUri: process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/flowforge',
  jwtSecret: process.env.JWT_SECRET || 'dev_secret_change_me',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '1d',
  // Comma-separated list of allowed frontend origins. Vite's dev server picks
  // 5173 by default but increments (5174, 5175, ...) if that port is already
  // taken by a leftover dev server — accepting a small fixed range here avoids
  // every API call silently failing with a CORS error just because the last
  // restart landed on a different port than CLIENT_ORIGIN was set to.
  clientOrigins: (process.env.CLIENT_ORIGIN || 'http://localhost:5173,http://localhost:5174,http://localhost:5175')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),
};

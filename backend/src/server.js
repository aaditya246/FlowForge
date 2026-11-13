const app = require('./app');
const { connectDB } = require('./config/db');
const { port } = require('./config/env');
const { startScheduler } = require('./jobs/retryScheduler');

async function main() {
  await connectDB();
  // eslint-disable-next-line no-console
  console.log('Connected to MongoDB');

  startScheduler();
  // eslint-disable-next-line no-console
  console.log('Retry/recovery scheduler started');

  app.listen(port, () => {
    // eslint-disable-next-line no-console
    console.log(`FlowForge backend listening on port ${port}`);
  });
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Failed to start server:', err);
  process.exit(1);
});

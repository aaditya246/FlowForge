const express = require('express');
const authRoutes = require('./authRoutes');
const workflowRoutes = require('./workflowRoutes');
const ruleRoutes = require('./ruleRoutes');
const requestRoutes = require('./requestRoutes');
const executionRoutes = require('./executionRoutes');
const retryRoutes = require('./retryRoutes');
const recoveryRoutes = require('./recoveryRoutes');
const dependencyRoutes = require('./dependencyRoutes');
const reliabilityRoutes = require('./reliabilityRoutes');
const reviewRoutes = require('./reviewRoutes');
const notificationRoutes = require('./notificationRoutes');

const router = express.Router();

router.get('/health', (req, res) => {
  res.status(200).json({ success: true, data: { status: 'ok', timestamp: new Date().toISOString() } });
});

router.use('/auth', authRoutes);
router.use('/workflows', workflowRoutes);
router.use('/rules', ruleRoutes);
router.use('/requests', requestRoutes);
router.use('/executions', executionRoutes);
router.use('/retries', retryRoutes);
router.use('/recovery', recoveryRoutes);
router.use('/dependencies', dependencyRoutes);
router.use('/reliability', reliabilityRoutes);
router.use('/reviews', reviewRoutes);
router.use('/notifications', notificationRoutes);

module.exports = router;

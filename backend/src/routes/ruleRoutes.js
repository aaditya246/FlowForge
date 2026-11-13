const express = require('express');
const ruleController = require('../controllers/ruleController');
const validate = require('../middleware/validate');
const { authenticate, authorize } = require('../middleware/auth');
const { testRulesSchema } = require('../validators/workflowVersionValidators');

const router = express.Router();

router.use(authenticate);

router.post('/test-evaluate', authorize('admin', 'reviewer'), validate(testRulesSchema), ruleController.testEvaluate);

module.exports = router;

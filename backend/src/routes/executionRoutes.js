const express = require('express');
const executionController = require('../controllers/executionController');
const retryController = require('../controllers/retryController');
const validate = require('../middleware/validate');
const { authenticate, authorize } = require('../middleware/auth');
const { listQuerySchema } = require('../validators/executionValidators');

const router = express.Router();

router.use(authenticate);

router.get('/', validate(listQuerySchema, 'query'), executionController.listExecutions);
router.get('/:id', executionController.getExecution);
router.get('/:id/status', executionController.getExecutionStatus);
router.get('/:id/history', executionController.getExecutionHistory);
router.get('/:id/explanation', executionController.getExecutionExplanation);
router.get('/:id/retries', authorize('admin', 'reviewer'), retryController.listRetriesForExecution);

module.exports = router;

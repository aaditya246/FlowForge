const express = require('express');
const retryController = require('../controllers/retryController');
const validate = require('../middleware/validate');
const { authenticate, authorize } = require('../middleware/auth');
const { listRetriesQuerySchema } = require('../validators/reliabilityValidators');

const router = express.Router();

router.use(authenticate, authorize('admin', 'reviewer'));

router.get('/', validate(listRetriesQuerySchema, 'query'), retryController.listRetries);
router.get('/:id', retryController.getRetry);

module.exports = router;

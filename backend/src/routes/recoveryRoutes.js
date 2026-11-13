const express = require('express');
const recoveryController = require('../controllers/recoveryController');
const validate = require('../middleware/validate');
const { authenticate, authorize } = require('../middleware/auth');
const { listRecoveryQuerySchema } = require('../validators/reliabilityValidators');

const router = express.Router();

router.use(authenticate, authorize('admin', 'reviewer'));

router.get('/', validate(listRecoveryQuerySchema, 'query'), recoveryController.listRecovery);
router.get('/:id', recoveryController.getRecoveryItem);
router.post('/:id/retry', authorize('admin'), recoveryController.triggerRecovery);

module.exports = router;

const express = require('express');
const requestController = require('../controllers/requestController');
const validate = require('../middleware/validate');
const { authenticate, authorize } = require('../middleware/auth');
const { submitRequestSchema, listQuerySchema } = require('../validators/executionValidators');

const router = express.Router();

router.use(authenticate);

router.post('/', authorize('admin', 'operator'), validate(submitRequestSchema), requestController.submitRequest);
router.get('/', validate(listQuerySchema, 'query'), requestController.listRequests);
router.get('/:id', requestController.getRequest);

module.exports = router;

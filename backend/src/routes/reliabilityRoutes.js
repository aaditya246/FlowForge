const express = require('express');
const reliabilityController = require('../controllers/reliabilityController');
const { authenticate, authorize } = require('../middleware/auth');

const router = express.Router();

router.use(authenticate, authorize('admin', 'reviewer'));

router.get('/summary', reliabilityController.getSummary);

module.exports = router;

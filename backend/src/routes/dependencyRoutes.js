const express = require('express');
const dependencyController = require('../controllers/dependencyController');
const validate = require('../middleware/validate');
const { authenticate, authorize } = require('../middleware/auth');
const { upsertSimulationSchema, listDependencyLogsQuerySchema } = require('../validators/reliabilityValidators');

const router = express.Router();

router.use(authenticate, authorize('admin', 'reviewer'));

router.get('/simulations', dependencyController.listSimulations);
router.put('/simulations/:id', authorize('admin'), validate(upsertSimulationSchema), dependencyController.upsertSimulation);
router.get('/logs', validate(listDependencyLogsQuerySchema, 'query'), dependencyController.listDependencyLogs);

module.exports = router;

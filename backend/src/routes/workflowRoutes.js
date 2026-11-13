const express = require('express');
const workflowController = require('../controllers/workflowController');
const workflowVersionRoutes = require('./workflowVersionRoutes');
const validate = require('../middleware/validate');
const { authenticate, authorize } = require('../middleware/auth');
const { createWorkflowSchema, updateWorkflowSchema } = require('../validators/workflowValidators');

const router = express.Router();

router.use(authenticate);

router.get('/', workflowController.listWorkflows);
router.get('/:id', workflowController.getWorkflow);
router.post('/', authorize('admin'), validate(createWorkflowSchema), workflowController.createWorkflow);
router.patch('/:id', authorize('admin'), validate(updateWorkflowSchema), workflowController.updateWorkflow);
router.post('/:id/archive', authorize('admin'), workflowController.archiveWorkflow);

router.use('/:workflowId/versions', workflowVersionRoutes);

module.exports = router;

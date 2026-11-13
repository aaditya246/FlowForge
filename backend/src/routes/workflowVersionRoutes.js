const express = require('express');
const workflowVersionController = require('../controllers/workflowVersionController');
const validate = require('../middleware/validate');
const { authorize } = require('../middleware/auth');
const {
  createVersionSchema,
  updateVersionSchema,
  testContextSchema,
} = require('../validators/workflowVersionValidators');

// mergeParams lets this router read :workflowId from the parent mount point.
const router = express.Router({ mergeParams: true });

router.get('/', workflowVersionController.listVersions);
router.get('/:version', workflowVersionController.getVersion);

router.post('/', authorize('admin'), validate(createVersionSchema), workflowVersionController.createVersion);
router.patch('/:version', authorize('admin'), validate(updateVersionSchema), workflowVersionController.updateVersion);
router.post('/:version/validate', authorize('admin'), workflowVersionController.validateVersion);
router.post('/:version/publish', authorize('admin'), workflowVersionController.publishVersion);
router.post(
  '/:version/rules/test',
  authorize('admin', 'reviewer'),
  validate(testContextSchema),
  workflowVersionController.testVersionRules
);

module.exports = router;

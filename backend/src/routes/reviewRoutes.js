const express = require('express');
const reviewController = require('../controllers/reviewController');
const validate = require('../middleware/validate');
const { authenticate, authorize } = require('../middleware/auth');
const {
  listReviewsQuerySchema,
  assignSchema,
  decisionSchema,
  infoRequestSchema,
  infoSubmitSchema,
  escalateSchema,
} = require('../validators/reviewValidators');

const router = express.Router();

router.use(authenticate);

// Static paths first — must come before the generic '/:id' routes below.
router.get('/stats', authorize('admin', 'reviewer'), reviewController.getStats);
router.get('/reviewers', authorize('admin'), reviewController.listReviewers);
router.get('/reviewers/workload', authorize('admin'), reviewController.reviewerWorkload);

router.get('/', validate(listReviewsQuerySchema, 'query'), reviewController.listReviews);
router.get('/:id', reviewController.getReview);
router.get('/:id/history', reviewController.getHistory);
router.get('/:id/information-history', reviewController.informationHistory);

router.post('/:id/assign', authorize('admin'), validate(assignSchema), reviewController.assign);
router.put('/:id/reassign', authorize('admin'), validate(assignSchema), reviewController.reassign);
router.delete('/:id/assign', authorize('admin'), reviewController.unassign);

router.post('/:id/start', authorize('admin', 'reviewer'), reviewController.start);
router.post('/:id/approve', authorize('admin', 'reviewer'), validate(decisionSchema), reviewController.approve);
router.post('/:id/reject', authorize('admin', 'reviewer'), validate(decisionSchema), reviewController.reject);
router.post('/:id/request-information', authorize('admin', 'reviewer'), validate(infoRequestSchema), reviewController.requestInformation);
router.post('/:id/submit-information', authorize('admin', 'operator'), validate(infoSubmitSchema), reviewController.submitInformation);
router.post('/:id/escalate', authorize('admin', 'reviewer'), validate(escalateSchema), reviewController.escalate);

module.exports = router;

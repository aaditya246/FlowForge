const reviewService = require('../services/reviewService');
const ReviewAction = require('../models/ReviewAction');
const { sendSuccess } = require('../utils/ApiResponse');

async function listReviews(req, res) {
  const result = await reviewService.listReviews({ ...req.query, requestingUser: req.user });
  sendSuccess(res, 200, result);
}

async function getReview(req, res) {
  const review = await reviewService.getReviewOr404(req.params.id);
  sendSuccess(res, 200, { review });
}

async function getStats(req, res) {
  const stats = await reviewService.getReviewStats();
  sendSuccess(res, 200, stats);
}

async function getHistory(req, res) {
  await reviewService.getReviewOr404(req.params.id);
  const actions = await ReviewAction.find({ reviewId: req.params.id }).sort({ createdAt: 1 }).lean();
  sendSuccess(res, 200, { actions });
}

async function assign(req, res) {
  const review = await reviewService.assignReview(req.params.id, req.body.reviewerId, req.user);
  sendSuccess(res, 200, { review });
}

async function reassign(req, res) {
  const review = await reviewService.assignReview(req.params.id, req.body.reviewerId, req.user);
  sendSuccess(res, 200, { review });
}

async function unassign(req, res) {
  const review = await reviewService.unassignReview(req.params.id, req.user);
  sendSuccess(res, 200, { review });
}

async function start(req, res) {
  const review = await reviewService.startReview(req.params.id, req.user);
  sendSuccess(res, 200, { review });
}

async function approve(req, res) {
  const result = await reviewService.approveReview(req.params.id, req.user, req.body);
  sendSuccess(res, 200, result);
}

async function reject(req, res) {
  const result = await reviewService.rejectReview(req.params.id, req.user, req.body);
  sendSuccess(res, 200, result);
}

async function requestInformation(req, res) {
  const review = await reviewService.requestMoreInformation(req.params.id, req.user, req.body);
  sendSuccess(res, 200, { review });
}

async function submitInformation(req, res) {
  const review = await reviewService.submitInformation(req.params.id, req.user, req.body);
  sendSuccess(res, 200, { review });
}

async function informationHistory(req, res) {
  const history = await reviewService.getInformationHistory(req.params.id);
  sendSuccess(res, 200, history);
}

async function escalate(req, res) {
  const review = await reviewService.escalateReview(req.params.id, req.user, req.body);
  sendSuccess(res, 200, { review });
}

async function listReviewers(req, res) {
  const reviewers = await reviewService.listReviewers();
  sendSuccess(res, 200, { reviewers });
}

async function reviewerWorkload(req, res) {
  const workload = await reviewService.getReviewerWorkload();
  sendSuccess(res, 200, { workload });
}

module.exports = {
  listReviews,
  getReview,
  getStats,
  getHistory,
  assign,
  reassign,
  unassign,
  start,
  approve,
  reject,
  requestInformation,
  submitInformation,
  informationHistory,
  escalate,
  listReviewers,
  reviewerWorkload,
};

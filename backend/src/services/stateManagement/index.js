const ApiError = require('../../utils/ApiError');

// Explicit allow-list of valid state transitions. See architecture doc, section 6.
const ALLOWED_TRANSITIONS = {
  PENDING: ['VALIDATING'],
  VALIDATING: ['PROCESSING', 'REJECTED'],
  // COMPLETED is reachable directly from PROCESSING for workflows whose terminal
  // stage carries no APPROVE/REJECT decision (e.g. a pure verification pipeline).
  PROCESSING: ['APPROVED', 'REJECTED', 'MANUAL_REVIEW', 'RETRY_PENDING', 'FAILED', 'COMPLETED'],
  // PROCESSING is the Phase 6 resume path: a reviewer decision re-enters the
  // paused stage's own onSuccess/onFailure transition via workflowEngine, so
  // execution genuinely continues processing rather than jumping straight to
  // a terminal state. Direct APPROVED/REJECTED remain valid for any caller
  // that finalizes without going through the engine's resume loop.
  MANUAL_REVIEW: ['APPROVED', 'REJECTED', 'PROCESSING'],
  RETRY_PENDING: ['PROCESSING', 'FAILED'],
  APPROVED: ['COMPLETED'],
  REJECTED: ['COMPLETED'],
  FAILED: ['COMPLETED'],
  COMPLETED: [],
};

function assertValidTransition(fromState, toState) {
  const allowed = ALLOWED_TRANSITIONS[fromState] || [];
  if (!allowed.includes(toState)) {
    throw ApiError.badRequest(`Invalid state transition: ${fromState} -> ${toState}`);
  }
}

module.exports = { ALLOWED_TRANSITIONS, assertValidTransition };

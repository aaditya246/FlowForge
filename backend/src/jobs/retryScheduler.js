/**
 * Durable retry/recovery/review-escalation poller. All scheduling state lives
 * in MongoDB (RetryRecord, WorkflowExecution, ExternalDependencyLog,
 * ManualReview) — this interval just periodically asks "what's due?" via
 * recoveryService.runRecoverySweep() and (Phase 6) reviewService.runEscalationSweep().
 * A backend restart loses nothing: the next tick finds the same due work.
 *
 * Only started from server.js (real runtime), never during tests — tests call
 * these sweep functions directly for deterministic, immediate results instead
 * of waiting on a real interval.
 */
const recoveryService = require('../services/recoveryService');
const reviewService = require('../services/reviewService');

const POLL_INTERVAL_MS = Number(process.env.RECOVERY_POLL_INTERVAL_MS) || 5000;

let timer = null;

function startScheduler() {
  if (timer) return timer;
  timer = setInterval(async () => {
    try {
      await recoveryService.runRecoverySweep();
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('Recovery sweep failed:', err);
    }
    try {
      await reviewService.runEscalationSweep();
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('Review escalation sweep failed:', err);
    }
  }, POLL_INTERVAL_MS);
  timer.unref?.(); // never keep the process alive on its own
  return timer;
}

function stopScheduler() {
  if (timer) clearInterval(timer);
  timer = null;
}

module.exports = { startScheduler, stopScheduler, POLL_INTERVAL_MS };

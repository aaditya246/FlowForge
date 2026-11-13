/**
 * Mock external dependency adapter (identity/credit/document verification, etc.).
 *
 * Simulates SUCCESS, FAILURE, TIMEOUT, INTERMITTENT_FAILURE, SLOW_RESPONSE outcomes,
 * configurable per dependencyKey via SystemConfiguration. Dev-only simulation — no real
 * network calls — but the *reliability mechanics* around it are real:
 *
 * - Outbox-style checkpoint: when an `operationId` is supplied, a 'pending'
 *   ExternalDependencyLog row is written BEFORE the call is "made", then updated to its
 *   final outcome after. If a completed log already exists for that operationId, the
 *   call is skipped and the stored result is replayed — this is the mechanism that
 *   prevents a retry/recovery pass from repeating an already-succeeded side effect.
 *   A genuinely new retry attempt gets a *new* operationId (see workflowEngine), so it
 *   is still free to actually call again.
 * - Deterministic timeout detection: if the simulated latency exceeds `timeoutMs`, the
 *   outcome is forced to TIMEOUT regardless of the configured outcome, matching real
 *   "the call technically completed but too late to matter" semantics without any real
 *   wall-clock waiting in tests.
 * - Error categorization: FAILURE/INTERMITTENT_FAILURE/TIMEOUT are categorized as
 *   'transient' (retryable); nothing here is ever categorized 'permanent' because a
 *   simulated dependency has no notion of a permanent business error — permanent
 *   failures belong to rule/validation outcomes, not dependency calls.
 */
const SystemConfiguration = require('../../models/SystemConfiguration');
const ExternalDependencyLog = require('../../models/ExternalDependencyLog');

const VALID_OUTCOMES = ['SUCCESS', 'FAILURE', 'TIMEOUT', 'INTERMITTENT_FAILURE', 'SLOW_RESPONSE'];
const RETRYABLE_OUTCOMES = new Set(['FAILURE', 'TIMEOUT', 'INTERMITTENT_FAILURE']);

const SIMULATED_LATENCY_MS = {
  SUCCESS: 15,
  FAILURE: 15,
  INTERMITTENT_FAILURE: 15,
  TIMEOUT: 8000, // deliberately exceeds the typical 5000ms stage timeoutMs
  SLOW_RESPONSE: 1200,
};

async function getSimulationConfig(dependencyKey) {
  const config = await SystemConfiguration.findOne({ key: `externalDependency:${dependencyKey}` }).lean();
  return config?.value || null;
}

function resolveOutcome(simConfig, forcedOutcome) {
  if (forcedOutcome && VALID_OUTCOMES.includes(forcedOutcome)) return forcedOutcome;

  const configured = simConfig?.forcedOutcome;
  if (configured === 'INTERMITTENT_FAILURE') {
    // Genuinely intermittent: fails roughly half the time rather than deterministically.
    const probability = typeof simConfig?.failureProbability === 'number' ? simConfig.failureProbability : 0.5;
    return Math.random() < probability ? 'FAILURE' : 'SUCCESS';
  }
  if (configured && VALID_OUTCOMES.includes(configured)) return configured;
  return 'SUCCESS';
}

function categorize(outcome) {
  if (!RETRYABLE_OUTCOMES.has(outcome)) return null;
  return 'transient';
}

/**
 * @param {string} dependencyKey
 * @param {Object} requestPayload
 * @param {Object} [options]
 * @param {string} [options.executionId]
 * @param {string} [options.operationId] - stable per-attempt id; enables outbox dedup
 * @param {string} [options.forcedOutcome] - overrides SystemConfiguration (tests/admin)
 * @param {number} [options.timeoutMs=5000]
 * @returns {Promise<{ success: boolean, outcome: string, response: Object, latencyMs: number, retryable: boolean, errorCategory: string|null, replayed?: boolean }>}
 */
async function call(dependencyKey, requestPayload, options = {}) {
  const { executionId = null, operationId = null, forcedOutcome = null, timeoutMs = 5000 } = options;

  if (executionId && operationId) {
    const existing = await ExternalDependencyLog.findOne({ executionId, operationId });
    if (existing && existing.status === 'completed') {
      return {
        success: existing.success,
        outcome: existing.simulatedOutcome,
        response: existing.responsePayload,
        latencyMs: existing.latencyMs,
        retryable: RETRYABLE_OUTCOMES.has(existing.simulatedOutcome),
        errorCategory: existing.errorCategory,
        replayed: true,
      };
    }
  }

  let pendingLog = null;
  if (executionId && operationId) {
    // Checkpoint: record intent to call BEFORE simulating, so a crash between this
    // write and the completion write is detectable by recoveryService as inconclusive
    // (never silently treated as either success or failure).
    pendingLog = await ExternalDependencyLog.create({
      executionId,
      dependencyKey,
      operationId,
      status: 'pending',
      requestPayload,
    });
  }

  const simConfig = await getSimulationConfig(dependencyKey);
  let outcome = resolveOutcome(simConfig, forcedOutcome);
  let latencyMs = typeof simConfig?.delayMs === 'number' ? simConfig.delayMs : SIMULATED_LATENCY_MS[outcome];

  // Deterministic timeout: if the simulated latency would exceed the stage's
  // configured timeout, the call is treated as TIMEOUT regardless of its nominal outcome.
  if (latencyMs > timeoutMs) {
    outcome = 'TIMEOUT';
  }

  const success = outcome === 'SUCCESS' || outcome === 'SLOW_RESPONSE';
  const response = success
    ? { verified: true, dependencyKey, outcome }
    : { verified: false, dependencyKey, outcome, error: `Simulated ${outcome}` };
  const errorCategory = categorize(outcome);

  if (pendingLog) {
    await ExternalDependencyLog.findByIdAndUpdate(pendingLog._id, {
      $set: {
        status: 'completed',
        simulatedOutcome: outcome,
        responsePayload: response,
        latencyMs,
        success,
        errorCategory,
      },
    });
  } else if (executionId) {
    await ExternalDependencyLog.create({
      executionId,
      dependencyKey,
      status: 'completed',
      requestPayload,
      simulatedOutcome: outcome,
      responsePayload: response,
      latencyMs,
      success,
      errorCategory,
    });
  }

  return { success, outcome, response, latencyMs, retryable: RETRYABLE_OUTCOMES.has(outcome), errorCategory };
}

module.exports = { call, VALID_OUTCOMES, RETRYABLE_OUTCOMES };

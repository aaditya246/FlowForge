/**
 * Workflow Execution Engine — generic, state-driven interpreter of a
 * WorkflowVersion's stages/transitions. One instance of this engine serves
 * every business use case (loan approval, claims, onboarding, ...); nothing
 * here is specific to a single workflow — all behavior is read out of the
 * WorkflowVersion document passed in.
 *
 * Adaptation note (Phase 4): the original stage-type set from Phase 3
 * (validation | rule_evaluation | external_dependency | manual_review | terminal)
 * is kept as-is rather than adding new Mongoose enum values. "Approval" outcomes
 * and "retry" outcomes are handled as *rule outcomes* within a rule_evaluation
 * stage (APPROVE/REJECT/MANUAL_REVIEW/RETRY/CONTINUE/FAIL), which already
 * carries a decision + reason + full trace — this avoids schema churn while
 * covering the same functional requirements.
 *
 * Phase 6 addition: `advance(execution, workflowVersion, payload, manualDecision)`
 * — a 4th, optional parameter. When an execution is paused at MANUAL_REVIEW and a
 * reviewer decides APPROVE/REJECT (see services/reviewService), advance() applies
 * that decision via the SAME paused stage's existing onSuccess/onFailure
 * transition it would have used for a direct rule APPROVE/REJECT outcome — no
 * new config, no hardcoded stage IDs.
 */
const WorkflowExecution = require('../../models/WorkflowExecution');
const ExecutionEvent = require('../../models/ExecutionEvent');
const ApiError = require('../../utils/ApiError');
const auditService = require('../auditService');
const ruleEngine = require('../ruleEngine');
const externalDependency = require('../externalDependency');
const retryService = require('../retryService');
const { assertValidTransition } = require('../stateManagement');

const TERMINAL_KEYWORDS = ['APPROVED', 'REJECTED', 'MANUAL_REVIEW', 'FAILED', 'COMPLETED'];

// Safety limits — see README "Execution Limits" section. Generous defaults; a
// well-formed workflow will never get close to these in normal operation.
const MAX_STAGE_EXECUTIONS = 50;
const MAX_SAME_STAGE_REVISITS = 10;

/**
 * Creates and persists the initial WorkflowExecution for a validated request,
 * pinned permanently to the exact WorkflowVersion document passed in.
 */
async function start(request, workflowVersion, userId = null) {
  const execution = await WorkflowExecution.create({
    requestId: request._id,
    workflowId: workflowVersion.workflowId,
    workflowVersionId: workflowVersion._id,
    workflowVersionNumber: workflowVersion.version,
    currentState: 'PENDING',
    currentStageId: workflowVersion.startStageId,
  });

  await auditService.record({
    executionId: execution._id,
    requestId: request._id,
    workflowId: workflowVersion.workflowId,
    workflowVersionNumber: workflowVersion.version,
    eventType: 'WORKFLOW_INITIALIZED',
    actor: userId ? String(userId) : 'system',
    decisionReason: `Execution started on stage '${workflowVersion.startStageId}' using workflow version ${workflowVersion.version}`,
    dataRef: `request:${request._id}`,
  });

  return execution;
}

function findStage(workflowVersion, stageId) {
  return (workflowVersion.stages || []).find((s) => s.stageId === stageId) || null;
}

async function transitionState(execution, toState, { stageId = undefined, actor = 'system', reason = '' } = {}) {
  const fromState = execution.currentState;
  if (fromState !== toState) {
    assertValidTransition(fromState, toState);
  }
  execution.currentState = toState;
  if (stageId !== undefined) execution.currentStageId = stageId;

  await ExecutionEvent.create({ executionId: execution._id, fromState, toState, stageId: execution.currentStageId, actor, reason });
  await auditService.record({
    executionId: execution._id,
    requestId: execution.requestId,
    workflowId: execution.workflowId,
    workflowVersionNumber: execution.workflowVersionNumber,
    eventType: 'STAGE_TRANSITION',
    actor,
    decisionReason: reason || `${fromState} -> ${toState}`,
  });
}

async function finalize(execution, { state, decision = null, reason, actor = 'system' }) {
  await transitionState(execution, state, { stageId: execution.currentStageId, actor, reason });
  execution.finalDecision = decision;
  execution.finalReason = reason;
  await execution.save();

  if (['APPROVED', 'REJECTED', 'FAILED'].includes(state)) {
    await transitionState(execution, 'COMPLETED', { stageId: execution.currentStageId, actor, reason: `Execution completed as ${state}` });
    execution.completedAt = new Date();
    await execution.save();
  } else if (state === 'COMPLETED') {
    execution.completedAt = new Date();
    await execution.save();
  }

  await auditService.record({
    executionId: execution._id,
    requestId: execution.requestId,
    workflowId: execution.workflowId,
    workflowVersionNumber: execution.workflowVersionNumber,
    eventType: 'EXECUTION_COMPLETED',
    actor,
    decisionReason: reason,
  });

  return execution;
}

async function executeValidationStage(stage, payload, workflowVersion) {
  const { validateInput } = require('./validateInput');
  const errors = validateInput(workflowVersion.inputSchema, payload);
  return errors.length === 0
    ? { outcome: 'SUCCESS', detail: null }
    : { outcome: 'FAILURE', detail: errors };
}

async function executeRuleEvaluationStage(stage, workflowVersion, payload, execution) {
  const groupRules = (workflowVersion.rules || []).filter((r) => (r.group || 'default') === (stage.ruleGroup || 'default'));

  let result;
  try {
    result = ruleEngine.evaluate(groupRules, payload, { conflictResolution: workflowVersion.conflictResolution });
  } catch (err) {
    return { outcome: 'FAIL', detail: { error: err.message, details: err.details } };
  }

  await auditService.record({
    executionId: execution._id,
    requestId: execution.requestId,
    workflowId: execution.workflowId,
    workflowVersionNumber: execution.workflowVersionNumber,
    eventType: 'RULE_EVALUATION',
    actor: 'system',
    ruleTrace: result.rulesEvaluated,
    decisionReason: `Stage '${stage.stageId}' rule evaluation outcome: ${result.outcome}` + (result.decidingRuleId ? ` (rule ${result.decidingRuleId})` : ''),
  });

  return { outcome: result.outcome, detail: result };
}

async function executeExternalDependencyStage(stage, payload, execution) {
  // Stable per-attempt operation id: the SAME id across a pause/resume that didn't
  // bump retryCount (so a recovery replay reuses the already-completed log instead
  // of repeating the side effect), but a NEW id once retryCount actually increments
  // for a genuine new retry attempt (so that attempt is free to really call again).
  const operationId = `${execution._id}:${stage.stageId}:attempt${execution.retryCount}`;

  await auditService.record({
    executionId: execution._id,
    requestId: execution.requestId,
    workflowId: execution.workflowId,
    workflowVersionNumber: execution.workflowVersionNumber,
    eventType: 'EXTERNAL_DEPENDENCY_CALL',
    actor: 'system',
    decisionReason: `Calling external dependency '${stage.externalDependencyKey}' (operation ${operationId})`,
  });

  const result = await externalDependency.call(stage.externalDependencyKey, payload, {
    executionId: execution._id,
    operationId,
    timeoutMs: stage.timeoutMs,
  });

  await auditService.record({
    executionId: execution._id,
    requestId: execution.requestId,
    workflowId: execution.workflowId,
    workflowVersionNumber: execution.workflowVersionNumber,
    eventType: result.outcome === 'TIMEOUT' ? 'DEPENDENCY_TIMEOUT' : result.success ? 'EXTERNAL_DEPENDENCY_RESPONSE' : 'DEPENDENCY_FAILURE',
    actor: 'system',
    decisionReason:
      `External dependency '${stage.externalDependencyKey}' returned ${result.outcome}` +
      (result.replayed ? ' (replayed from an earlier completed call — not re-executed)' : ''),
    errorInfo: result.success ? null : { outcome: result.outcome, category: result.errorCategory },
  });

  if (result.success) {
    return { outcome: 'SUCCESS', detail: result };
  }

  // Retryable (and a retry policy is actually configured) -> ask for a retry;
  // otherwise fail straight through to the stage's configured onFailure path,
  // preserving exact Phase 4 behavior when no retry policy is set.
  const hasRetryPolicy = (stage.retry?.maxAttempts || 0) > 0;
  if (result.retryable && hasRetryPolicy) {
    return { outcome: 'RETRY', detail: result };
  }
  return { outcome: 'FAILURE', detail: result };
}

/**
 * Runs the stage loop synchronously from the execution's current stage until it
 * reaches a terminal state, pauses (MANUAL_REVIEW / RETRY_PENDING), or hits a
 * safety limit. Persists every state/stage change via ExecutionEvent + AuditLog.
 */
async function advance(execution, workflowVersion, payload, manualDecision) {
  if (['COMPLETED'].includes(execution.currentState)) {
    throw ApiError.conflict(`Execution ${execution._id} is already COMPLETED and cannot be advanced`);
  }

  // Intake validation already ran before the execution was created; this
  // transitions the lifecycle through VALIDATING -> PROCESSING to begin stage execution.
  if (execution.currentState === 'PENDING') {
    await transitionState(execution, 'VALIDATING', { stageId: execution.currentStageId, reason: 'Input schema validated at intake' });
    await transitionState(execution, 'PROCESSING', { stageId: execution.currentStageId, reason: 'Beginning stage execution' });
  }

  // Resuming a due retry (called by recoveryService): pick back up on the same
  // stage that requested the retry.
  if (execution.currentState === 'RETRY_PENDING') {
    await auditService.record({
      executionId: execution._id,
      requestId: execution.requestId,
      workflowId: execution.workflowId,
      workflowVersionNumber: execution.workflowVersionNumber,
      eventType: 'RETRY_STARTED',
      actor: 'system',
      decisionReason: `Resuming execution for retry attempt ${execution.retryCount} at stage '${execution.currentStageId}'`,
    });
    await transitionState(execution, 'PROCESSING', { stageId: execution.currentStageId, reason: `Resumed for retry attempt ${execution.retryCount}` });
  }

  // Resuming after a reviewer's APPROVE/REJECT decision (called by reviewService):
  // apply the decision via the SAME stage's existing onSuccess/onFailure transition
  // it would have used had the rule outcome been APPROVE/REJECT directly — no
  // hardcoded stage IDs, fully driven by the paused stage's own configuration.
  if (execution.currentState === 'MANUAL_REVIEW') {
    if (manualDecision !== 'APPROVE' && manualDecision !== 'REJECT') {
      throw ApiError.conflict('Cannot resume a MANUAL_REVIEW execution without a valid decision (APPROVE or REJECT)');
    }

    const pausedStage = findStage(workflowVersion, execution.currentStageId);
    if (!pausedStage) {
      return finalize(execution, { state: 'FAILED', reason: `Stage '${execution.currentStageId}' is not defined in this workflow version` });
    }

    await auditService.record({
      executionId: execution._id,
      requestId: execution.requestId,
      workflowId: execution.workflowId,
      workflowVersionNumber: execution.workflowVersionNumber,
      eventType: 'WORKFLOW_RESUMED',
      actor: 'system',
      decisionReason: `Resuming execution after manual review decision: ${manualDecision}`,
    });

    const target = manualDecision === 'APPROVE' ? pausedStage.onSuccess : pausedStage.onFailure;
    await transitionState(execution, 'PROCESSING', {
      stageId: execution.currentStageId,
      reason: `Resumed after manual review decision: ${manualDecision}`,
    });

    if (target === null || target === undefined) {
      return finalize(execution, {
        state: 'FAILED',
        reason: `No transition configured for manual review decision '${manualDecision}' at stage '${execution.currentStageId}'`,
      });
    }

    if (TERMINAL_KEYWORDS.includes(target)) {
      if (target === 'APPROVED') {
        return finalize(execution, { state: 'APPROVED', decision: 'APPROVE', reason: `Manual review approved at stage '${execution.currentStageId}'` });
      }
      if (target === 'REJECTED') {
        return finalize(execution, { state: 'REJECTED', decision: 'REJECT', reason: `Manual review rejected at stage '${execution.currentStageId}'` });
      }
      if (target === 'FAILED') {
        return finalize(execution, { state: 'FAILED', reason: `Manual review routed to FAILED at stage '${execution.currentStageId}'` });
      }
      if (target === 'COMPLETED') {
        return finalize(execution, { state: 'COMPLETED', reason: `Manual review routed to COMPLETED at stage '${execution.currentStageId}'` });
      }
      if (target === 'MANUAL_REVIEW') {
        await transitionState(execution, 'MANUAL_REVIEW', { stageId: execution.currentStageId, reason: 'Routed back to manual review' });
        await execution.save();
        return execution;
      }
    }

    const nextStage = findStage(workflowVersion, target);
    if (!nextStage) {
      return finalize(execution, { state: 'FAILED', reason: `Transition from '${execution.currentStageId}' targets undefined stage '${target}'` });
    }

    execution.pendingDecision = manualDecision;
    execution.currentStageId = target;
    await execution.save();
  }

  const stageVisitCounts = new Map();
  let stageExecutions = 0;
  // Carries APPROVE/REJECT forward into a shared 'terminal' stage. Re-seeded from
  // the persisted execution.pendingDecision on resume, so it survives a
  // MANUAL_REVIEW/RETRY_PENDING pause occurring between the decision being made
  // and the terminal stage actually being reached.
  let pendingDecision = execution.pendingDecision || null;

  while (execution.currentState === 'PROCESSING') {
    stageExecutions += 1;
    if (stageExecutions > MAX_STAGE_EXECUTIONS) {
      return finalize(execution, {
        state: 'FAILED',
        reason: `Execution exceeded the maximum of ${MAX_STAGE_EXECUTIONS} stage executions (possible misconfiguration)`,
      });
    }

    const stageId = execution.currentStageId;
    const visits = (stageVisitCounts.get(stageId) || 0) + 1;
    stageVisitCounts.set(stageId, visits);
    if (visits > MAX_SAME_STAGE_REVISITS) {
      return finalize(execution, {
        state: 'FAILED',
        reason: `Execution loop detected: stage '${stageId}' was revisited ${visits} times`,
      });
    }

    const stage = findStage(workflowVersion, stageId);
    if (!stage) {
      return finalize(execution, { state: 'FAILED', reason: `Stage '${stageId}' is not defined in this workflow version` });
    }

    // Record stage entry even when the execution *state* doesn't change (most
    // intra-PROCESSING stage-to-stage moves) — every stage execution must be traceable.
    await ExecutionEvent.create({
      executionId: execution._id,
      fromState: execution.currentState,
      toState: execution.currentState,
      stageId,
      actor: 'system',
      reason: `Entered stage '${stageId}' (${stage.type}), execution #${stageExecutions}`,
    });

    let stepResult;
    try {
      if (stage.type === 'validation') {
        stepResult = await executeValidationStage(stage, payload, workflowVersion);
      } else if (stage.type === 'rule_evaluation') {
        stepResult = await executeRuleEvaluationStage(stage, workflowVersion, payload, execution);
      } else if (stage.type === 'external_dependency') {
        stepResult = await executeExternalDependencyStage(stage, payload, execution);
      } else if (stage.type === 'manual_review') {
        stepResult = { outcome: 'MANUAL_REVIEW', detail: null };
      } else if (stage.type === 'terminal') {
        const decision = pendingDecision;
        return finalize(execution, {
          state: decision === 'APPROVE' ? 'APPROVED' : decision === 'REJECT' ? 'REJECTED' : 'COMPLETED',
          decision,
          reason: decision ? `Reached terminal stage '${stageId}' with decision ${decision}` : `Reached terminal stage '${stageId}'`,
        });
      } else {
        stepResult = { outcome: 'FAIL', detail: { error: `Unsupported stage type '${stage.type}'` } };
      }
    } catch (err) {
      await auditService.record({
        executionId: execution._id,
        requestId: execution.requestId,
        workflowId: execution.workflowId,
        workflowVersionNumber: execution.workflowVersionNumber,
        eventType: 'FAILURE',
        actor: 'system',
        errorInfo: { message: err.message },
        decisionReason: `Unexpected error executing stage '${stageId}'`,
      });
      return finalize(execution, { state: 'FAILED', reason: `Unexpected error in stage '${stageId}': ${err.message}` });
    }

    let { outcome, detail } = stepResult;

    // --- Resolve outcome -> next step --------------------------------------
    if (outcome === 'MANUAL_REVIEW') {
      await auditService.record({
        executionId: execution._id,
        requestId: execution.requestId,
        workflowId: execution.workflowId,
        workflowVersionNumber: execution.workflowVersionNumber,
        eventType: 'MANUAL_REVIEW_ROUTED',
        actor: 'system',
        decisionReason: `Stage '${stageId}' routed execution to manual review`,
      });
      await transitionState(execution, 'MANUAL_REVIEW', { stageId, reason: `Paused for manual review at stage '${stageId}'` });
      await execution.save();
      return execution;
    }

    if (outcome === 'RETRY') {
      const retryRecord = await retryService.scheduleRetry(execution, stage, {
        reason: `Stage '${stageId}' returned RETRY`,
        originalError: detail?.response?.error || detail?.error || null,
      });

      if (retryRecord) {
        // scheduleRetry already transitioned to RETRY_PENDING and saved.
        return execution;
      }

      // Retry limit exhausted (or no retry policy configured for a rule-level
      // RETRY outcome) — record exhaustion and fall through to the stage's
      // configured failure path, same as any other failed outcome.
      await auditService.record({
        executionId: execution._id,
        requestId: execution.requestId,
        workflowId: execution.workflowId,
        workflowVersionNumber: execution.workflowVersionNumber,
        eventType: 'RETRY_EXHAUSTED',
        actor: 'system',
        decisionReason: `Stage '${stageId}': retry attempts exhausted (${execution.retryCount}/${stage.retry?.maxAttempts || 0})`,
      });

      // Route through the stage's normal failure transition, same as any other
      // failed outcome, now that retries have been exhausted.
      outcome = 'FAILURE';
    }

    if (outcome === 'FAIL') {
      return finalize(execution, {
        state: 'FAILED',
        reason: `Stage '${stageId}' failed: ${detail?.error || 'unknown error'}`,
      });
    }

    // Determine which configured transition applies, and the next decision carried forward.
    let target;
    if (outcome === 'SUCCESS' || outcome === 'CONTINUE' || outcome === 'APPROVE') {
      target = stage.onSuccess;
      if (outcome === 'APPROVE') pendingDecision = 'APPROVE';
    } else if (outcome === 'FAILURE' || outcome === 'REJECT') {
      target = stage.onFailure;
      if (outcome === 'REJECT') pendingDecision = 'REJECT';
    } else {
      target = null;
    }

    if (pendingDecision && execution.pendingDecision !== pendingDecision) {
      execution.pendingDecision = pendingDecision;
      await execution.save();
    }

    if (target === null || target === undefined) {
      return finalize(execution, {
        state: 'FAILED',
        reason: `No transition configured for outcome '${outcome}' at stage '${stageId}'`,
      });
    }

    if (TERMINAL_KEYWORDS.includes(target)) {
      if (target === 'APPROVED') {
        return finalize(execution, { state: 'APPROVED', decision: 'APPROVE', reason: `Stage '${stageId}' routed directly to APPROVED` });
      }
      if (target === 'REJECTED') {
        return finalize(execution, { state: 'REJECTED', decision: 'REJECT', reason: `Stage '${stageId}' routed directly to REJECTED` });
      }
      if (target === 'FAILED') {
        return finalize(execution, { state: 'FAILED', reason: `Stage '${stageId}' routed directly to FAILED` });
      }
      if (target === 'COMPLETED') {
        return finalize(execution, { state: 'COMPLETED', reason: `Stage '${stageId}' routed directly to COMPLETED` });
      }
      if (target === 'MANUAL_REVIEW') {
        await transitionState(execution, 'MANUAL_REVIEW', { stageId, reason: `Stage '${stageId}' routed directly to manual review` });
        await execution.save();
        return execution;
      }
    }

    const nextStage = findStage(workflowVersion, target);
    if (!nextStage) {
      return finalize(execution, { state: 'FAILED', reason: `Transition from '${stageId}' targets undefined stage '${target}'` });
    }

    execution.currentStageId = target;
    await execution.save();
  }

  return execution;
}

module.exports = { start, advance, MAX_STAGE_EXECUTIONS, MAX_SAME_STAGE_REVISITS };

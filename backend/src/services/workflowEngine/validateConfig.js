const { validateRuleSet } = require('../ruleEngine/conditionValidator');

const TERMINAL_KEYWORDS = ['APPROVED', 'REJECTED', 'MANUAL_REVIEW', 'FAILED', 'COMPLETED', null];

/**
 * Validates a WorkflowVersion configuration (stages + rules + wiring) before it
 * can be published. Pure function — takes a plain object shaped like a
 * WorkflowVersion document and returns an array of error strings (empty = valid).
 */
function validateWorkflowConfig(version) {
  const errors = [];

  if (!version || typeof version !== 'object') {
    return ['version: must be an object'];
  }

  const stages = Array.isArray(version.stages) ? version.stages : [];
  const rules = Array.isArray(version.rules) ? version.rules : [];

  if (stages.length === 0) {
    errors.push('stages: workflow must define at least one stage');
  }

  // Unique stage IDs
  const stageIds = new Set();
  stages.forEach((stage, idx) => {
    if (!stage.stageId) {
      errors.push(`stages[${idx}]: missing stageId`);
      return;
    }
    if (stageIds.has(stage.stageId)) {
      errors.push(`stages[${idx}]: duplicate stageId '${stage.stageId}'`);
    }
    stageIds.add(stage.stageId);
  });

  // Valid stage definitions + transitions
  const validTypes = ['validation', 'rule_evaluation', 'external_dependency', 'manual_review', 'terminal'];
  stages.forEach((stage, idx) => {
    if (!validTypes.includes(stage.type)) {
      errors.push(`stages[${idx}] (${stage.stageId}): invalid type '${stage.type}'`);
    }

    ['onSuccess', 'onFailure', 'onManualReview'].forEach((field) => {
      const target = stage[field];
      if (target === undefined || target === null) return;
      if (!stageIds.has(target) && !TERMINAL_KEYWORDS.includes(target)) {
        errors.push(`stages[${idx}] (${stage.stageId}).${field}: references unknown stage '${target}'`);
      }
    });

    if (stage.retry) {
      if (typeof stage.retry.maxAttempts === 'number' && stage.retry.maxAttempts < 0) {
        errors.push(`stages[${idx}] (${stage.stageId}).retry.maxAttempts: must be >= 0`);
      }
      if (typeof stage.retry.delayMs === 'number' && stage.retry.delayMs < 0) {
        errors.push(`stages[${idx}] (${stage.stageId}).retry.delayMs: must be >= 0`);
      }
    }

    if (stage.type === 'rule_evaluation' && stage.ruleGroup) {
      const groupHasRules = rules.some((r) => (r.group || 'default') === stage.ruleGroup);
      if (!groupHasRules) {
        errors.push(`stages[${idx}] (${stage.stageId}): ruleGroup '${stage.ruleGroup}' has no matching rules`);
      }
    }
  });

  // Valid start stage
  if (!version.startStageId) {
    errors.push('startStageId: is required');
  } else if (!stageIds.has(version.startStageId)) {
    errors.push(`startStageId: '${version.startStageId}' is not a defined stage`);
  }

  // At least one terminal stage
  if (stages.length > 0 && !stages.some((s) => s.type === 'terminal')) {
    errors.push('stages: workflow must define at least one terminal stage');
  }

  // Valid rules
  errors.push(...validateRuleSet(rules));

  return errors;
}

module.exports = { validateWorkflowConfig };

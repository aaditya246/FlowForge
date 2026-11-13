/**
 * Rule Engine — pure, framework-independent module.
 *
 * Takes a declarative rule set (JSON AST, no eval/new Function) and an
 * evaluation context, and returns a structured, fully explainable result.
 * Independent of Express, Mongoose documents, or any single business use case —
 * callers pass plain rule objects (e.g. from a WorkflowVersion.rules array)
 * and a plain context object.
 */
const RuleEngineError = require('./RuleEngineError');
const { validateRuleSet } = require('./conditionValidator');
const { evaluateCondition } = require('./conditionEvaluator');

const CONFLICT_STRATEGIES = ['priority', 'first_match', 'all_must_pass'];

/**
 * @param {Array<Object>} rules - rule definitions (ruleId, name, priority, enabled, condition, onPass, onFail)
 * @param {Object} context - evaluation context (e.g. the validated request payload)
 * @param {Object} [options]
 * @param {'priority'|'first_match'|'all_must_pass'} [options.conflictResolution='priority']
 * @returns {Object} structured, explainable evaluation result
 */
function evaluate(rules, context, options = {}) {
  const conflictResolution = options.conflictResolution || 'priority';

  if (!CONFLICT_STRATEGIES.includes(conflictResolution)) {
    throw new RuleEngineError(`Unknown conflict resolution strategy: ${conflictResolution}`);
  }

  const validationErrors = validateRuleSet(rules || []);
  if (validationErrors.length > 0) {
    throw new RuleEngineError('Invalid rule set', validationErrors);
  }

  const evalContext = context || {};
  const allRules = rules || [];

  const disabledRules = allRules
    .filter((r) => r.enabled === false)
    .map((r) => ({ ruleId: r.ruleId, ruleName: r.name, reason: 'disabled' }));

  // Stable sort (Array#sort is stable since Node 12+): higher priority evaluates first.
  const enabledRules = allRules
    .filter((r) => r.enabled !== false)
    .slice()
    .sort((a, b) => (b.priority || 0) - (a.priority || 0));

  const rulesEvaluated = [];
  let outcome = 'CONTINUE';
  let decidingRuleId = null;

  for (const rule of enabledRules) {
    const { passed, trace } = evaluateCondition(rule.condition, evalContext);
    const action = passed ? rule.onPass || 'CONTINUE' : rule.onFail || 'CONTINUE';

    rulesEvaluated.push({
      ruleId: rule.ruleId,
      ruleName: rule.name,
      priority: rule.priority || 0,
      group: rule.group || 'default',
      passed,
      action,
      trace,
    });

    if (conflictResolution === 'first_match') {
      outcome = action;
      decidingRuleId = rule.ruleId;
      break;
    }

    if (conflictResolution === 'all_must_pass') {
      if (!passed) {
        outcome = action;
        decidingRuleId = rule.ruleId;
        break;
      }
      continue;
    }

    // 'priority' (default): first rule producing a terminal action decides the outcome.
    if (action !== 'CONTINUE') {
      outcome = action;
      decidingRuleId = rule.ruleId;
      break;
    }
  }

  if (conflictResolution === 'all_must_pass' && decidingRuleId === null && rulesEvaluated.length > 0) {
    outcome = 'APPROVE';
  }

  const evaluatedIds = new Set(rulesEvaluated.map((r) => r.ruleId));
  const skippedRules = enabledRules
    .filter((r) => !evaluatedIds.has(r.ruleId))
    .map((r) => ({ ruleId: r.ruleId, ruleName: r.name, reason: 'not reached (short-circuited)' }));

  return {
    outcome,
    decidingRuleId,
    conflictResolution,
    rulesEvaluated,
    passedRuleIds: rulesEvaluated.filter((r) => r.passed).map((r) => r.ruleId),
    failedRuleIds: rulesEvaluated.filter((r) => !r.passed).map((r) => r.ruleId),
    skippedRules: [...skippedRules, ...disabledRules],
    evaluatedAt: new Date().toISOString(),
  };
}

/**
 * Validates a rule set's structure without evaluating it. Returns an array of
 * human-readable error strings (empty = valid).
 */
function validateRules(rules) {
  return validateRuleSet(rules || []);
}

module.exports = { evaluate, validateRules, CONFLICT_STRATEGIES, RuleEngineError };

const { normalizeOperator, isKnownOperator, NO_VALUE_OPERATORS } = require('./operators');

const LOGICAL_KEYS = ['and', 'or', 'not'];

/**
 * Recursively validates a condition AST node. Returns an array of error strings
 * (empty = valid). Never throws — callers decide what to do with the errors.
 */
function validateCondition(node, path = 'condition') {
  const errors = [];

  if (node === null || typeof node !== 'object' || Array.isArray(node)) {
    errors.push(`${path}: must be an object`);
    return errors;
  }

  const presentLogicalKeys = LOGICAL_KEYS.filter((k) => k in node);

  if (presentLogicalKeys.length > 1) {
    errors.push(`${path}: only one of 'and' | 'or' | 'not' is allowed per node`);
    return errors;
  }

  if (presentLogicalKeys.length === 1) {
    const key = presentLogicalKeys[0];

    if (key === 'not') {
      if (typeof node.not !== 'object' || node.not === null || Array.isArray(node.not)) {
        errors.push(`${path}.not: must be a single condition object`);
      } else {
        errors.push(...validateCondition(node.not, `${path}.not`));
      }
      return errors;
    }

    // and / or
    if (!Array.isArray(node[key]) || node[key].length === 0) {
      errors.push(`${path}.${key}: must be a non-empty array of conditions`);
      return errors;
    }
    node[key].forEach((child, idx) => {
      errors.push(...validateCondition(child, `${path}.${key}[${idx}]`));
    });
    return errors;
  }

  // Leaf condition
  if (typeof node.field !== 'string' || node.field.trim() === '') {
    errors.push(`${path}: leaf condition requires a non-empty string 'field'`);
  }

  if (node.operator === undefined || node.operator === null) {
    errors.push(`${path}: leaf condition requires an 'operator'`);
  } else if (!isKnownOperator(node.operator)) {
    errors.push(`${path}: unsupported operator '${node.operator}'`);
  } else {
    const normalized = normalizeOperator(node.operator);
    if (!NO_VALUE_OPERATORS.has(normalized) && !('value' in node)) {
      errors.push(`${path}: operator '${node.operator}' requires a 'value'`);
    }
    if ((normalized === 'IN' || normalized === 'NOT_IN') && !Array.isArray(node.value)) {
      errors.push(`${path}: operator '${node.operator}' requires 'value' to be an array`);
    }
  }

  return errors;
}

/**
 * Validates a full rule definition (shape only, not evaluation).
 */
function validateRuleDefinition(rule, path = 'rule') {
  const errors = [];

  if (!rule || typeof rule !== 'object') {
    return [`${path}: must be an object`];
  }
  if (typeof rule.ruleId !== 'string' || rule.ruleId.trim() === '') {
    errors.push(`${path}.ruleId: required non-empty string`);
  }
  if (typeof rule.name !== 'string' || rule.name.trim() === '') {
    errors.push(`${path}.name: required non-empty string`);
  }
  if (rule.condition === undefined) {
    errors.push(`${path}.condition: is required`);
  } else {
    errors.push(...validateCondition(rule.condition, `${path}.condition`));
  }

  const validActions = ['CONTINUE', 'APPROVE', 'REJECT', 'MANUAL_REVIEW', 'RETRY', 'FAIL'];
  if (rule.onPass && !validActions.includes(rule.onPass)) {
    errors.push(`${path}.onPass: invalid action '${rule.onPass}'`);
  }
  if (rule.onFail && !validActions.includes(rule.onFail)) {
    errors.push(`${path}.onFail: invalid action '${rule.onFail}'`);
  }

  return errors;
}

/**
 * Validates an array of rule definitions, including duplicate ruleId detection.
 */
function validateRuleSet(rules) {
  const errors = [];

  if (!Array.isArray(rules)) {
    return ['rules: must be an array'];
  }

  const seenIds = new Set();
  rules.forEach((rule, idx) => {
    errors.push(...validateRuleDefinition(rule, `rules[${idx}]`));
    if (rule && typeof rule.ruleId === 'string') {
      if (seenIds.has(rule.ruleId)) {
        errors.push(`rules[${idx}].ruleId: duplicate ruleId '${rule.ruleId}'`);
      }
      seenIds.add(rule.ruleId);
    }
  });

  return errors;
}

module.exports = { validateCondition, validateRuleDefinition, validateRuleSet };

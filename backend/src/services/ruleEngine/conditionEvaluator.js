const { getFieldValue } = require('./fieldAccess');
const { normalizeOperator, applyOperator, NO_VALUE_OPERATORS } = require('./operators');

/**
 * Recursively evaluates a validated condition AST node against a context object.
 * Returns { passed, trace } where trace is a fully explainable, serializable tree.
 * Pure function — no side effects, no eval.
 */
function evaluateCondition(node, context) {
  if ('and' in node) {
    const childResults = node.and.map((child) => evaluateCondition(child, context));
    const passed = childResults.every((r) => r.passed);
    return { passed, trace: { type: 'AND', passed, children: childResults.map((r) => r.trace) } };
  }

  if ('or' in node) {
    const childResults = node.or.map((child) => evaluateCondition(child, context));
    const passed = childResults.some((r) => r.passed);
    return { passed, trace: { type: 'OR', passed, children: childResults.map((r) => r.trace) } };
  }

  if ('not' in node) {
    const child = evaluateCondition(node.not, context);
    return { passed: !child.passed, trace: { type: 'NOT', passed: !child.passed, children: [child.trace] } };
  }

  // Leaf condition
  const operator = normalizeOperator(node.operator);
  const actualValue = getFieldValue(context, node.field);
  const expectedValue = NO_VALUE_OPERATORS.has(operator) ? undefined : node.value;

  let passed;
  let reason;
  try {
    passed = applyOperator(operator, actualValue, expectedValue);
    reason = passed
      ? `${node.field} ${operator} ${JSON.stringify(expectedValue)} — satisfied (actual: ${JSON.stringify(actualValue)})`
      : `${node.field} ${operator} ${JSON.stringify(expectedValue)} — not satisfied (actual: ${JSON.stringify(actualValue)})`;
  } catch (err) {
    passed = false;
    reason = `Evaluation error: ${err.message}`;
  }

  return {
    passed,
    trace: {
      type: 'LEAF',
      field: node.field,
      operator,
      expectedValue,
      actualValue,
      passed,
      reason,
    },
  };
}

module.exports = { evaluateCondition };

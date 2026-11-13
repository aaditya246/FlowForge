// Whitelisted, pure comparison functions. No eval/new Function anywhere.
// Each operator receives (actual, expected) and returns a boolean.
// Operators that don't need a numeric/comparable type degrade safely (return false)
// instead of throwing, so a bad/missing field never crashes an evaluation.

function isComparable(a, b) {
  return a !== undefined && a !== null && b !== undefined && b !== null;
}

const OPERATORS = {
  '==': (a, b) => a === b,
  EQ: (a, b) => a === b,
  '!=': (a, b) => a !== b,
  NEQ: (a, b) => a !== b,
  '>': (a, b) => isComparable(a, b) && a > b,
  GT: (a, b) => isComparable(a, b) && a > b,
  '<': (a, b) => isComparable(a, b) && a < b,
  LT: (a, b) => isComparable(a, b) && a < b,
  '>=': (a, b) => isComparable(a, b) && a >= b,
  GTE: (a, b) => isComparable(a, b) && a >= b,
  '<=': (a, b) => isComparable(a, b) && a <= b,
  LTE: (a, b) => isComparable(a, b) && a <= b,
  IN: (a, b) => Array.isArray(b) && b.includes(a),
  NOT_IN: (a, b) => Array.isArray(b) && !b.includes(a),
  CONTAINS: (a, b) => {
    if (Array.isArray(a)) return a.includes(b);
    if (typeof a === 'string' && typeof b === 'string') return a.includes(b);
    return false;
  },
  EXISTS: (a) => a !== undefined && a !== null && a !== '',
  NOT_EXISTS: (a) => a === undefined || a === null || a === '',
  MANDATORY: (a) => a !== undefined && a !== null && a !== '',
};

const OPERATOR_NAMES = Object.keys(OPERATORS);

const NO_VALUE_OPERATORS = new Set(['EXISTS', 'NOT_EXISTS', 'MANDATORY']);

function normalizeOperator(op) {
  return typeof op === 'string' ? op.trim().toUpperCase() : op;
}

function isKnownOperator(op) {
  const normalized = normalizeOperator(op);
  return Object.prototype.hasOwnProperty.call(OPERATORS, normalized) || OPERATORS[op] !== undefined;
}

function applyOperator(op, actual, expected) {
  const fn = OPERATORS[op] || OPERATORS[normalizeOperator(op)];
  if (!fn) {
    throw new Error(`Unsupported operator: ${op}`);
  }
  return fn(actual, expected);
}

module.exports = { OPERATORS, OPERATOR_NAMES, NO_VALUE_OPERATORS, normalizeOperator, isKnownOperator, applyOperator };

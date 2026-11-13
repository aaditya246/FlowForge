// Resolves dot-notation field paths ("borrower.income") against a plain object context.
// Never uses eval/Function; pure property traversal.
function getFieldValue(context, path) {
  if (!path || typeof path !== 'string') return undefined;
  return path.split('.').reduce((acc, key) => {
    if (acc === null || acc === undefined) return undefined;
    return acc[key];
  }, context);
}

module.exports = { getFieldValue };

// Validates a raw request payload against a WorkflowVersion's dynamic inputSchema
// (see models/WorkflowVersion.js fieldSchema). Pure function, no side effects.

function typeMatches(type, value) {
  switch (type) {
    case 'string':
      return typeof value === 'string';
    case 'number':
      return typeof value === 'number' && !Number.isNaN(value);
    case 'boolean':
      return typeof value === 'boolean';
    case 'array':
      return Array.isArray(value);
    case 'date':
      return typeof value === 'string' || value instanceof Date ? !Number.isNaN(Date.parse(value)) : false;
    default:
      return true;
  }
}

/**
 * @param {Array<Object>} inputSchema - field definitions (name, type, required, enum, min, max)
 * @param {Object} payload - the raw request payload
 * @returns {Array<{field: string, message: string}>} validation errors (empty = valid)
 */
function validateInput(inputSchema, payload) {
  const errors = [];
  const fields = Array.isArray(inputSchema) ? inputSchema : [];
  const data = payload && typeof payload === 'object' ? payload : {};

  fields.forEach((field) => {
    const value = data[field.name];
    const isMissing = value === undefined || value === null || value === '';

    if (field.required && isMissing) {
      errors.push({ field: field.name, message: `'${field.name}' is required` });
      return;
    }
    if (isMissing) return; // optional and absent — nothing further to check

    if (!typeMatches(field.type, value)) {
      errors.push({ field: field.name, message: `'${field.name}' must be of type ${field.type}` });
      return;
    }

    if (Array.isArray(field.enum) && field.enum.length > 0 && !field.enum.includes(value)) {
      errors.push({ field: field.name, message: `'${field.name}' must be one of: ${field.enum.join(', ')}` });
    }

    if (field.type === 'number') {
      if (typeof field.min === 'number' && value < field.min) {
        errors.push({ field: field.name, message: `'${field.name}' must be >= ${field.min}` });
      }
      if (typeof field.max === 'number' && value > field.max) {
        errors.push({ field: field.name, message: `'${field.name}' must be <= ${field.max}` });
      }
    }
  });

  return errors;
}

module.exports = { validateInput };

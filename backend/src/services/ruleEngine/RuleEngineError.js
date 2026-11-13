class RuleEngineError extends Error {
  constructor(message, details = []) {
    super(message);
    this.name = 'RuleEngineError';
    this.details = details;
  }
}

module.exports = RuleEngineError;

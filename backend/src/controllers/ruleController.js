const ruleEngine = require('../services/ruleEngine');
const { sendSuccess } = require('../utils/ApiResponse');
const ApiError = require('../utils/ApiError');

async function testEvaluate(req, res) {
  const { rules, context, conflictResolution } = req.body;

  let result;
  try {
    result = ruleEngine.evaluate(rules, context, { conflictResolution });
  } catch (err) {
    if (err instanceof ruleEngine.RuleEngineError) {
      throw ApiError.badRequest(err.message, err.details);
    }
    throw err;
  }

  sendSuccess(res, 200, { result });
}

module.exports = { testEvaluate };

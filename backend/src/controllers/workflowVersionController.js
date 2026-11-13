const workflowVersionService = require('../services/workflowVersionService');
const ruleEngine = require('../services/ruleEngine');
const { sendSuccess } = require('../utils/ApiResponse');
const ApiError = require('../utils/ApiError');

async function listVersions(req, res) {
  const versions = await workflowVersionService.listVersions(req.params.workflowId);
  sendSuccess(res, 200, { versions });
}

async function getVersion(req, res) {
  const version = await workflowVersionService.getVersionOr404(req.params.workflowId, req.params.version);
  sendSuccess(res, 200, { version });
}

async function createVersion(req, res) {
  const draft = await workflowVersionService.createDraftVersion(req.params.workflowId, {
    cloneFromVersion: req.body.cloneFromVersion,
    userId: req.user._id,
  });
  sendSuccess(res, 201, { version: draft });
}

async function updateVersion(req, res) {
  const version = await workflowVersionService.updateDraftVersion(
    req.params.workflowId,
    req.params.version,
    req.body,
    req.user._id
  );
  sendSuccess(res, 200, { version });
}

async function validateVersion(req, res) {
  const version = await workflowVersionService.getVersionOr404(req.params.workflowId, req.params.version);
  const errors = workflowVersionService.validateVersionConfig(version.toObject());
  sendSuccess(res, 200, { valid: errors.length === 0, errors });
}

async function publishVersion(req, res) {
  const version = await workflowVersionService.publishVersion(req.params.workflowId, req.params.version, req.user._id);
  sendSuccess(res, 200, { version });
}

async function testVersionRules(req, res) {
  const version = await workflowVersionService.getVersionOr404(req.params.workflowId, req.params.version);
  const context = req.body.context || {};

  let result;
  try {
    result = ruleEngine.evaluate(version.rules, context, { conflictResolution: version.conflictResolution });
  } catch (err) {
    if (err instanceof ruleEngine.RuleEngineError) {
      throw ApiError.badRequest(err.message, err.details);
    }
    throw err;
  }

  sendSuccess(res, 200, { result });
}

module.exports = {
  listVersions,
  getVersion,
  createVersion,
  updateVersion,
  validateVersion,
  publishVersion,
  testVersionRules,
};

const SystemConfiguration = require('../models/SystemConfiguration');
const ExternalDependencyLog = require('../models/ExternalDependencyLog');
const { VALID_OUTCOMES } = require('../services/externalDependency');
const { sendSuccess } = require('../utils/ApiResponse');

const KEY_PREFIX = 'externalDependency:';

async function listSimulations(req, res) {
  const configs = await SystemConfiguration.find({ key: { $regex: `^${KEY_PREFIX}` } }).lean();
  const simulations = configs.map((c) => ({
    dependencyKey: c.key.slice(KEY_PREFIX.length),
    ...c.value,
    updatedAt: c.updatedAt,
  }));
  sendSuccess(res, 200, { simulations, validOutcomes: VALID_OUTCOMES });
}

/**
 * Upserts the simulation config for one dependency. Admin-only (enforced by
 * route middleware) — never reachable by non-admin roles.
 */
async function upsertSimulation(req, res) {
  const dependencyKey = req.params.id;
  const { forcedOutcome, delayMs, failureProbability } = req.body;

  const value = {};
  if (forcedOutcome !== undefined) value.forcedOutcome = forcedOutcome;
  if (delayMs !== undefined) value.delayMs = delayMs;
  if (failureProbability !== undefined) value.failureProbability = failureProbability;

  const config = await SystemConfiguration.findOneAndUpdate(
    { key: `${KEY_PREFIX}${dependencyKey}` },
    { $set: { value, updatedBy: req.user._id } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  sendSuccess(res, 200, { dependencyKey, ...config.value, updatedAt: config.updatedAt });
}

async function listDependencyLogs(req, res) {
  const { page = 1, limit = 20, dependencyKey, executionId } = req.query;
  const filter = {};
  if (dependencyKey) filter.dependencyKey = dependencyKey;
  if (executionId) filter.executionId = executionId;

  const skip = (page - 1) * limit;
  const [items, total] = await Promise.all([
    ExternalDependencyLog.find(filter).sort({ createdAt: -1 }).skip(skip).limit(Number(limit)).lean(),
    ExternalDependencyLog.countDocuments(filter),
  ]);

  sendSuccess(res, 200, { items, total, page: Number(page), limit: Number(limit) });
}

module.exports = { listSimulations, upsertSimulation, listDependencyLogs };

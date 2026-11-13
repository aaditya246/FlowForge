const WorkflowDefinition = require('../../models/WorkflowDefinition');
const WorkflowVersion = require('../../models/WorkflowVersion');
const ApiError = require('../../utils/ApiError');
const auditService = require('../auditService');
const { validateWorkflowConfig } = require('../workflowEngine/validateConfig');

async function getWorkflowOr404(workflowId) {
  const workflow = await WorkflowDefinition.findById(workflowId);
  if (!workflow) throw ApiError.notFound('Workflow not found');
  return workflow;
}

async function getVersionOr404(workflowId, versionNumber) {
  const version = await WorkflowVersion.findOne({ workflowId, version: Number(versionNumber) });
  if (!version) throw ApiError.notFound(`Workflow version ${versionNumber} not found`);
  return version;
}

async function listVersions(workflowId) {
  await getWorkflowOr404(workflowId);
  return WorkflowVersion.find({ workflowId }).sort({ version: -1 }).lean();
}

/**
 * Creates a new draft version. If `cloneFromVersion` is given, copies its
 * stages/rules/inputSchema as a starting point (used when editing a published
 * version — per the versioning requirement, published versions are immutable
 * so edits always happen on a fresh draft).
 */
async function createDraftVersion(workflowId, { cloneFromVersion, overrides = {}, userId }) {
  const workflow = await getWorkflowOr404(workflowId);

  const latest = await WorkflowVersion.findOne({ workflowId }).sort({ version: -1 }).lean();
  const nextVersionNumber = latest ? latest.version + 1 : 1;

  let base = { inputSchema: [], stages: [], rules: [], startStageId: null, conflictResolution: 'priority' };

  if (cloneFromVersion) {
    const source = await getVersionOr404(workflowId, cloneFromVersion);
    base = {
      inputSchema: source.inputSchema,
      stages: source.stages,
      rules: source.rules,
      startStageId: source.startStageId,
      conflictResolution: source.conflictResolution,
    };
  }

  const draft = await WorkflowVersion.create({
    workflowId: workflow._id,
    version: nextVersionNumber,
    status: 'draft',
    ...base,
    ...overrides,
    createdBy: userId,
  });

  await auditService.record({
    workflowId: workflow._id,
    workflowVersionNumber: draft.version,
    eventType: 'CONFIG_CHANGE',
    actor: String(userId),
    decisionReason: `Draft version ${draft.version} created${cloneFromVersion ? ` (cloned from v${cloneFromVersion})` : ''}`,
  });

  return draft;
}

/**
 * Updates a draft version's content. Published/deprecated versions are
 * immutable — attempting to edit one throws a conflict error.
 */
async function updateDraftVersion(workflowId, versionNumber, updates, userId) {
  const version = await getVersionOr404(workflowId, versionNumber);

  if (version.status !== 'draft') {
    throw ApiError.conflict(
      `Version ${versionNumber} is ${version.status} and cannot be edited. Create a new draft version instead.`
    );
  }

  const editableFields = ['inputSchema', 'stages', 'rules', 'startStageId', 'conflictResolution'];
  editableFields.forEach((field) => {
    if (updates[field] !== undefined) {
      version[field] = updates[field];
    }
  });
  version.updatedBy = userId;

  await version.save();

  await auditService.record({
    workflowId: version.workflowId,
    workflowVersionNumber: version.version,
    eventType: 'CONFIG_CHANGE',
    actor: String(userId),
    decisionReason: `Draft version ${version.version} updated`,
  });

  return version;
}

function validateVersionConfig(version) {
  return validateWorkflowConfig(version);
}

/**
 * Publishes a draft version: validates it, marks it published, deprecates the
 * previously published version (if any), and points the WorkflowDefinition at
 * the new published version number. In-progress executions keep referencing
 * their original WorkflowVersion document (by _id), so this never alters
 * already-running behavior.
 */
async function publishVersion(workflowId, versionNumber, userId) {
  const workflow = await getWorkflowOr404(workflowId);
  const version = await getVersionOr404(workflowId, versionNumber);

  if (version.status !== 'draft') {
    throw ApiError.conflict(`Version ${versionNumber} is already ${version.status}`);
  }

  const errors = validateWorkflowConfig(version.toObject());
  if (errors.length > 0) {
    throw ApiError.badRequest('Workflow configuration is invalid and cannot be published', errors);
  }

  if (workflow.currentPublishedVersion) {
    await WorkflowVersion.updateOne(
      { workflowId, version: workflow.currentPublishedVersion, status: 'published' },
      { $set: { status: 'deprecated' } }
    );
  }

  version.status = 'published';
  version.publishedAt = new Date();
  version.publishedBy = userId;
  await version.save();

  workflow.currentPublishedVersion = version.version;
  await workflow.save();

  await auditService.record({
    workflowId: workflow._id,
    workflowVersionNumber: version.version,
    eventType: 'CONFIG_CHANGE',
    actor: String(userId),
    decisionReason: `Version ${version.version} published`,
  });

  return version;
}

module.exports = {
  getWorkflowOr404,
  getVersionOr404,
  listVersions,
  createDraftVersion,
  updateDraftVersion,
  validateVersionConfig,
  publishVersion,
};

const WorkflowDefinition = require('../models/WorkflowDefinition');
const ApiError = require('../utils/ApiError');
const { sendSuccess } = require('../utils/ApiResponse');

async function createWorkflow(req, res) {
  const workflow = await WorkflowDefinition.create({
    ...req.body,
    createdBy: req.user._id,
  });
  sendSuccess(res, 201, { workflow });
}

async function listWorkflows(req, res) {
  const workflows = await WorkflowDefinition.find().sort({ createdAt: -1 }).lean();
  sendSuccess(res, 200, { workflows });
}

async function getWorkflow(req, res) {
  const workflow = await WorkflowDefinition.findById(req.params.id).lean();
  if (!workflow) throw ApiError.notFound('Workflow not found');
  sendSuccess(res, 200, { workflow });
}

async function updateWorkflow(req, res) {
  const workflow = await WorkflowDefinition.findByIdAndUpdate(req.params.id, req.body, {
    new: true,
    runValidators: true,
  });
  if (!workflow) throw ApiError.notFound('Workflow not found');
  sendSuccess(res, 200, { workflow });
}

async function archiveWorkflow(req, res) {
  const workflow = await WorkflowDefinition.findByIdAndUpdate(
    req.params.id,
    { status: 'archived' },
    { new: true }
  );
  if (!workflow) throw ApiError.notFound('Workflow not found');
  sendSuccess(res, 200, { workflow });
}

module.exports = { createWorkflow, listWorkflows, getWorkflow, updateWorkflow, archiveWorkflow };

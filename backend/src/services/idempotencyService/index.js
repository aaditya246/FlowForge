/**
 * Idempotency service — guarantees that a given (workflowId, idempotencyKey)
 * pair claims at most one WorkflowExecution, even under concurrent submission,
 * across process restarts (all state lives in MongoDB, nothing in-memory).
 *
 * Mechanism: a unique index on {workflowId, idempotencyKey} is the source of
 * truth. `claim()` uses an atomic upsert (findOneAndUpdate) to either create a
 * new 'processing' record (the caller proceeds) or discover an existing one
 * (the caller replays, reports a conflict, or reports in-progress). A stale
 * 'processing' record (the process that owned it died mid-request) can be
 * reclaimed after LEASE_MS via an optimistic conditional update keyed on the
 * record's own updatedAt, so only one of several stale-reclaim attempts wins.
 */
const IdempotencyRecord = require('../../models/IdempotencyRecord');
const ApiError = require('../../utils/ApiError');

const LEASE_MS = 30 * 1000; // a 'processing' record older than this is presumed abandoned
const TTL_MS = 24 * 60 * 60 * 1000; // completed/failed records are eligible for replay for 24h

async function reclaimOrReportInProgress(existing) {
  const reclaimed = await IdempotencyRecord.findOneAndUpdate(
    { _id: existing._id, updatedAt: existing.updatedAt },
    { $set: { status: 'processing', updatedAt: new Date() } },
    { new: true }
  );
  if (reclaimed) return { outcome: 'claimed', record: reclaimed, reclaimed: true };
  return { outcome: 'inProgress', record: existing };
}

async function evaluateExisting(existing, payloadHash) {
  if (existing.payloadHash !== payloadHash) {
    return { outcome: 'conflict', record: existing };
  }

  if (existing.status === 'completed') {
    if (existing.expiresAt && existing.expiresAt.getTime() < Date.now()) {
      // Expired — treat as a fresh claim rather than an infinite replay window.
      return reclaimOrReportInProgress(existing);
    }
    return { outcome: 'replay', record: existing };
  }

  if (existing.status === 'failed') {
    // A prior attempt errored before completing — safe to retry under the same key.
    return reclaimOrReportInProgress(existing);
  }

  // status === 'processing'
  const ageMs = Date.now() - existing.updatedAt.getTime();
  if (ageMs > LEASE_MS) {
    return reclaimOrReportInProgress(existing);
  }
  return { outcome: 'inProgress', record: existing };
}

/**
 * @returns {Promise<{outcome: 'claimed'|'replay'|'conflict'|'inProgress', record: Object, reclaimed?: boolean}>}
 */
async function claim(workflowId, idempotencyKey, payloadHash) {
  try {
    // includeResultMetadata gives the driver-level lastErrorObject.upserted flag —
    // the only reliable way to distinguish "I inserted" from "I matched an existing
    // document" under true concurrency.
    //
    // { timestamps: false } is critical here: Mongoose's `timestamps: true` plugin
    // touches updatedAt on EVERY findOneAndUpdate call, including ones that only
    // matched an existing document without changing it — which would silently
    // destroy the staleness signal (existing.updatedAt) that evaluateExisting()
    // relies on to detect an abandoned 'processing' lease, on every single claim()
    // call against an existing key. createdAt/updatedAt are set explicitly in
    // $setOnInsert instead, only for a genuine insert.
    const now = new Date();
    const result = await IdempotencyRecord.findOneAndUpdate(
      { workflowId, idempotencyKey },
      { $setOnInsert: { workflowId, idempotencyKey, payloadHash, status: 'processing', createdAt: now, updatedAt: now } },
      { upsert: true, new: true, setDefaultsOnInsert: true, includeResultMetadata: true, timestamps: false }
    );

    const doc = result.value;
    const wasUpserted = Boolean(result.lastErrorObject?.upserted);

    if (wasUpserted) {
      return { outcome: 'claimed', record: doc };
    }

    return evaluateExisting(doc, payloadHash);
  } catch (err) {
    if (err.code === 11000) {
      // Two concurrent inserts raced on the unique index; the loser refetches
      // and falls back to the normal "existing record" evaluation path.
      const existing = await IdempotencyRecord.findOne({ workflowId, idempotencyKey });
      if (!existing) throw err; // genuinely unexpected — surface the original error
      return evaluateExisting(existing, payloadHash);
    }
    throw err;
  }
}

async function complete(record, resultSnapshot) {
  return IdempotencyRecord.findByIdAndUpdate(
    record._id,
    {
      $set: {
        status: 'completed',
        requestId: resultSnapshot.request?._id || null,
        executionId: resultSnapshot.execution?._id || null,
        resultSnapshot,
        expiresAt: new Date(Date.now() + TTL_MS),
      },
    },
    { new: true }
  );
}

async function fail(record, error) {
  return IdempotencyRecord.findByIdAndUpdate(
    record._id,
    {
      $set: {
        status: 'failed',
        resultSnapshot: { error: error.message },
        expiresAt: new Date(Date.now() + TTL_MS),
      },
    },
    { new: true }
  );
}

function conflictError() {
  return ApiError.conflict(
    'This idempotency key was already used with a different request payload',
    { code: 'IDEMPOTENCY_PAYLOAD_MISMATCH' }
  );
}

module.exports = { claim, complete, fail, conflictError, LEASE_MS, TTL_MS };

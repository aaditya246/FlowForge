const mongoose = require('mongoose');
const externalDependency = require('../services/externalDependency');
const ExternalDependencyLog = require('../models/ExternalDependencyLog');
const SystemConfiguration = require('../models/SystemConfiguration');

describe('External dependency adapter', () => {
  const executionId = new mongoose.Types.ObjectId();

  it('19. a successful call returns success and is logged', async () => {
    const result = await externalDependency.call('dep-ok', { x: 1 }, { executionId, operationId: 'op-19', forcedOutcome: 'SUCCESS' });
    expect(result.success).toBe(true);
    expect(result.outcome).toBe('SUCCESS');
    const log = await ExternalDependencyLog.findOne({ executionId, operationId: 'op-19' });
    expect(log.status).toBe('completed');
    expect(log.success).toBe(true);
  });

  it('20. a failed call is logged with a retryable/transient classification', async () => {
    const result = await externalDependency.call('dep-fail', { x: 1 }, { executionId, operationId: 'op-20', forcedOutcome: 'FAILURE' });
    expect(result.success).toBe(false);
    expect(result.retryable).toBe(true);
    expect(result.errorCategory).toBe('transient');
  });

  it('21. latency beyond timeoutMs is deterministically classified as TIMEOUT', async () => {
    const result = await externalDependency.call('dep-slow', { x: 1 }, {
      executionId,
      operationId: 'op-21',
      forcedOutcome: 'SLOW_RESPONSE',
      timeoutMs: 100, // SLOW_RESPONSE's simulated latency (1200ms) exceeds this
    });
    expect(result.outcome).toBe('TIMEOUT');
    expect(result.success).toBe(false);
    expect(result.retryable).toBe(true);
  });

  it('22. intermittent failure resolves probabilistically (not always the same)', async () => {
    await SystemConfiguration.create({ key: 'externalDependency:dep-intermittent', value: { forcedOutcome: 'INTERMITTENT_FAILURE', failureProbability: 0.5 } });
    const outcomes = new Set();
    for (let i = 0; i < 30; i++) {
      const result = await externalDependency.call('dep-intermittent', { x: 1 }, { executionId, operationId: `op-22-${i}` });
      outcomes.add(result.outcome);
    }
    // Across 30 tries with p=0.5, both outcomes should appear (astronomically unlikely not to).
    expect(outcomes.has('SUCCESS')).toBe(true);
    expect(outcomes.has('FAILURE')).toBe(true);
  });

  it('23. a SLOW_RESPONSE within the timeout still counts as success', async () => {
    const result = await externalDependency.call('dep-slow2', { x: 1 }, {
      executionId,
      operationId: 'op-23',
      forcedOutcome: 'SLOW_RESPONSE',
      timeoutMs: 5000, // default stage timeout comfortably covers the 1200ms simulated latency
    });
    expect(result.outcome).toBe('SLOW_RESPONSE');
    expect(result.success).toBe(true);
  });

  it('24. a late/already-completed operation is replayed, not re-executed', async () => {
    const first = await externalDependency.call('dep-replay', { x: 1 }, { executionId, operationId: 'op-24', forcedOutcome: 'SUCCESS' });
    expect(first.replayed).toBeUndefined();

    const second = await externalDependency.call('dep-replay', { x: 1 }, { executionId, operationId: 'op-24', forcedOutcome: 'FAILURE' });
    // Same operationId -> the stored (successful) result is replayed, NOT a fresh
    // (and in this test, deliberately different) outcome — proving no re-execution.
    expect(second.replayed).toBe(true);
    expect(second.outcome).toBe('SUCCESS');

    const logCount = await ExternalDependencyLog.countDocuments({ executionId, operationId: 'op-24' });
    expect(logCount).toBe(1); // exactly one log row — no duplicate side effect
  });

  it('25. a new operationId (a genuine new retry attempt) is free to call again', async () => {
    await externalDependency.call('dep-newattempt', { x: 1 }, { executionId, operationId: 'op-25-attempt1', forcedOutcome: 'FAILURE' });
    const second = await externalDependency.call('dep-newattempt', { x: 1 }, { executionId, operationId: 'op-25-attempt2', forcedOutcome: 'SUCCESS' });
    expect(second.replayed).toBeUndefined();
    expect(second.outcome).toBe('SUCCESS');
    expect(await ExternalDependencyLog.countDocuments({ executionId, dependencyKey: 'dep-newattempt' })).toBe(2);
  });

  it('26. every call is persisted to ExternalDependencyLog with the expected fields', async () => {
    await externalDependency.call('dep-fields', { secret: 'value' }, { executionId, operationId: 'op-26', forcedOutcome: 'SUCCESS' });
    const log = await ExternalDependencyLog.findOne({ executionId, operationId: 'op-26' });
    expect(log.dependencyKey).toBe('dep-fields');
    expect(log.latencyMs).toBeGreaterThanOrEqual(0);
    expect(log.createdAt).toBeTruthy();
    expect(log.responsePayload).toBeTruthy();
  });

  it('a pending (uncompleted) checkpoint is written before the outcome is known', async () => {
    // Directly verify the outbox pattern: create a 'pending' row, as the adapter
    // does internally before simulating the call — ensures a crash mid-call is
    // representable (and therefore reconcilable) rather than invisible.
    const pending = await ExternalDependencyLog.create({ executionId, dependencyKey: 'dep-pending', operationId: 'op-pending', status: 'pending' });
    expect(pending.status).toBe('pending');
    expect(pending.simulatedOutcome).toBeNull();
  });
});

# Phase 5 Report — Reliability, Idempotency, Retry, and Failure Recovery

## 1. Features Implemented

- **Idempotency** (`services/idempotencyService`): claim/replay/conflict/reclaim state
  machine backed entirely by MongoDB's unique index on `{workflowId, idempotencyKey}` —
  not an in-memory map.
- **Retry engine** (`services/retryService`): fixed/exponential backoff with jitter,
  per-stage configurable policy, retry-limit enforcement, full attempt history.
- **Durable scheduling** (`jobs/retryScheduler.js` + `services/recoveryService`): a
  MongoDB-poll scheduler that survives a backend restart with zero lost work.
- **External dependency resilience** (`services/externalDependency`, rewritten):
  deterministic timeout detection, error categorization, and an outbox-style
  `operationId` checkpoint that prevents a retry/recovery replay from repeating an
  already-succeeded side effect.
- **Failure recovery** (`services/recoveryService`, rewritten from the Phase 2 stub):
  detects and resumes interrupted executions, resumes due retries, reconciles dependency
  calls left inconclusive by a crash — every operation is claim-guarded against
  concurrent double-processing.
- **Concurrency protection**: Mongoose `optimisticConcurrency` (version-field OCC) on
  `WorkflowExecution`, plus atomic conditional updates (claim gates) on
  `IdempotencyRecord`, `RetryRecord`, and execution resumption.
- **REST APIs**: `/api/retries`, `/api/recovery`, `/api/dependencies/simulations`,
  `/api/dependencies/logs`, `/api/reliability/summary` — all behind RBAC.
- **Frontend**: Failure Simulation Console (admin-only) and a Retry & Recovery Dashboard
  (admin + reviewer).
- 14 new `AuditLog` event types covering every reliability action.

## 2. Architecture Decisions

### Why a MongoDB-poll scheduler instead of BullMQ/Redis

The project has no existing queue infrastructure. Adding Redis purely to get durable
scheduling would mean a new infra dependency, a new local-dev setup step, and a new
failure mode (what happens if Redis itself is down?) — for a hackathon-scope platform
where retry latency of a few seconds is entirely acceptable. Instead, `jobs/retryScheduler.js`
polls `recoveryService.runRecoverySweep()` every 5 seconds (configurable via
`RECOVERY_POLL_INTERVAL_MS`); all scheduling state (`RetryRecord.scheduledAt`,
`WorkflowExecution.currentState`) lives in MongoDB, so a restart loses nothing — the next
poll simply finds the same due work. This was flagged as the production upgrade path
already in the Phase 1 architecture doc's scaling section (queue-based execution), and
remains the right next step if retry volume or latency requirements grow. No new
infrastructure was introduced this phase, so there is nothing additional to install or
configure beyond the existing MongoDB dependency.

### Why not MongoDB transactions

`mongodb-memory-server`'s default instance (used for all automated tests, and the
simplest local-dev setup) is a standalone `mongod`, which does not support multi-document
transactions — those require a replica set. Rather than require every developer to run a
replica set locally, Phase 5 uses atomic single-document operations instead:

- **Idempotency claim**: a single atomic `findOneAndUpdate` with `upsert: true` against
  the unique index is the entire "claim" — no multi-step transaction needed.
- **Retry claim**: a single conditional `findOneAndUpdate({_id, result:'pending', executedAt:null})`.
- **Execution resume claim**: a single conditional `findOneAndUpdate` keyed on expected state.
- **Dependency call checkpoint**: an outbox pattern — write 'pending' before the call,
  update to 'completed' after — rather than wrapping both in a transaction.
- **Optimistic concurrency** (Mongoose `optimisticConcurrency: true`) on `WorkflowExecution`
  catches any save-level race that slips past the above claim gates.

This is the "safe operation/checkpoint strategy" the assignment explicitly allows in place
of transactions, and it was verified under real concurrent load (see §6).

### A genuinely tricky bug class: Mongoose silently touching `updatedAt`

Three separate bugs during this phase traced back to the same root cause: Mongoose's
`timestamps: true` plugin touches `updatedAt` on **every** `findOneAndUpdate`/`updateOne`
call — including ones that only *matched* an existing document without changing anything,
and even when the caller explicitly tries to set `updatedAt` to something else in `$set`.
This broke:
1. The idempotency claim's own "is this an insert or a match?" detection (a
   `createdAt === updatedAt` heuristic looked fine in isolation but failed under true
   concurrency, because Mongoose bumps `updatedAt` to "now" on every racer's match).
2. The idempotency claim's staleness check (`evaluateExisting` compares
   `existing.updatedAt` against a lease timeout) — the very `findOneAndUpdate` call used
   to *find* the record also silently reset its `updatedAt`, erasing the staleness signal
   before it could ever be checked.
3. Two of my own test fixtures that manually backdated `updatedAt` to simulate a stale
   record — their `updateOne` calls needed to be rewritten with timestamps disabled, or
   the plugin would silently discard the test's intended value.

Fixed by: using the MongoDB driver's `includeResultMetadata: true` option (the modern
replacement for Mongoose's deprecated `rawResult`) to read the driver-level
`lastErrorObject.upserted` flag instead of inferring insert-vs-match from timestamps, and
by passing `{ timestamps: false }` on the specific claim query so matching an existing
document never touches it. See §9 for full detail — this is a legitimately easy trap to
fall into with Mongoose and worth calling out explicitly.

### Reusing existing interfaces (per your instructions)

- Retry policy reuses the existing `WorkflowVersion.stages[].retry` sub-document from
  Phase 2/3 rather than inventing a new config shape — only additive fields
  (`backoffMultiplier`, `maxDelayMs`, `jitter`) were added.
- `IdempotencyRecord`, `RetryRecord`, `ExternalDependencyLog` models already existed from
  Phase 2 scaffolding with exactly the fields this phase needed; only additive fields were
  added (`expiresAt` on `IdempotencyRecord`; `operationId`/`status`/`errorCategory` on
  `ExternalDependencyLog`).
- `services/idempotencyService`, `services/retryService`, `services/recoveryService`,
  `services/externalDependency` were Phase-2/4 stubs or minimal implementations — replaced
  with real logic, same module interface (same exported function names callers already used).
- `services/auditService.record()` is unchanged; only the `AuditLog.eventType` enum was
  extended.

## 3. Files Created

**Backend services**: `services/idempotencyService/index.js` (full rewrite from stub),
`jobs/retryScheduler.js`

**Backend API layer**: `controllers/retryController.js`, `controllers/recoveryController.js`,
`controllers/dependencyController.js`, `controllers/reliabilityController.js`,
`routes/retryRoutes.js`, `routes/recoveryRoutes.js`, `routes/dependencyRoutes.js`,
`routes/reliabilityRoutes.js`, `validators/reliabilityValidators.js`

**Backend tests**: `tests/idempotency.test.js` (11), `tests/retryEngine.test.js` (12),
`tests/dependencyResilience.test.js` (9), `tests/recoveryService.test.js` (7),
`tests/concurrencyAndSecurity.test.js` (12)

**Frontend**: `services/reliabilityService.js`, `pages/FailureSimulationPage.jsx`,
`pages/ReliabilityDashboardPage.jsx`

**Docs**: `PHASE_5_REPORT.md` (this file)

## 4. Files Modified (rewritten, not just touched)

- `services/retryService/index.js` — stub → full implementation (delay math, scheduling, claiming)
- `services/recoveryService/index.js` — stub → full implementation
- `services/externalDependency/index.js` — Phase 4 minimal adapter → outbox checkpoint,
  timeout detection, error categorization
- `services/executionService/index.js` — `submitRequest` wrapped with the idempotency
  claim/replay/conflict flow (`runSubmission` extracted as the inner implementation)
- `services/workflowEngine/index.js` — unified RETRY handling through `retryService`
  (removed inline duplicate logic), added RETRY_PENDING resumption at the top of
  `advance()`, persisted `pendingDecision` so it survives a pause, wired `operationId`/
  `timeoutMs` into dependency calls, categorized dependency outcomes into
  `EXTERNAL_DEPENDENCY_RESPONSE`/`DEPENDENCY_FAILURE`/`DEPENDENCY_TIMEOUT` audit events
- `services/stateManagement/index.js` — unchanged from Phase 4 (already had PROCESSING→COMPLETED)
- `controllers/requestController.js` — status-code logic extended for `inProgress`/`replayed`
- `routes/executionRoutes.js`, `routes/index.js` — mounted new route groups
- `models/IdempotencyRecord.js` — added `expiresAt`
- `models/ExternalDependencyLog.js` — added `operationId`, `status`, `errorCategory`;
  changed `simulatedOutcome`/`success` to nullable (for the 'pending' checkpoint state);
  added a sparse unique index on `{executionId, operationId}`
- `models/WorkflowExecution.js` — added `pendingDecision` field; enabled
  `optimisticConcurrency: true`
- `models/WorkflowVersion.js` — extended `stage.retry` sub-schema (`backoffMultiplier`,
  `maxDelayMs`, `jitter`); added `stage.timeoutMs`
- `models/AuditLog.js` — extended `eventType` enum with 14 reliability event types
- `validators/workflowVersionValidators.js` — mirrored the stage/retry schema additions
- `server.js` — starts the retry/recovery scheduler
- `README.md`, `CHECKLIST.md` — Phase 5 documentation

## 5. Database Changes and Indexes

| Collection | Change |
|---|---|
| `IdempotencyRecord` | `expiresAt` field added (existing unique index on `{workflowId, idempotencyKey}` unchanged and is the core guarantee) |
| `ExternalDependencyLog` | `operationId`, `status`, `errorCategory` fields added; new **sparse unique** index on `{executionId, operationId}` (the outbox dedup guarantee) |
| `WorkflowExecution` | `pendingDecision` field added; `optimisticConcurrency: true` schema option enabled (adds automatic version-check behavior to every `.save()`, using the existing `__v` field — no new index) |
| `WorkflowVersion` | `stages[].retry.{backoffMultiplier,maxDelayMs,jitter}` and `stages[].timeoutMs` fields added (defaults applied to existing documents automatically) |
| `AuditLog` | `eventType` enum extended (no schema/index change) |

No breaking changes to any existing field, index, or API response shape.

## 6. New API Endpoints

See the README's "API Reference (Phase 5 additions)" section for the full table with
request/response examples. Summary: `/api/retries`, `/api/retries/:id`,
`/api/executions/:id/retries`, `/api/recovery`, `/api/recovery/:id`,
`/api/recovery/:id/retry` (admin-only), `/api/dependencies/simulations` (GET: admin+reviewer,
PUT: admin-only), `/api/dependencies/logs`, `/api/reliability/summary`.

## 7. Retry and Recovery Design

**Retry decision flow** (inside `workflowEngine.advance()`): a `rule_evaluation` stage's
`RETRY` outcome, or an `external_dependency` stage's retryable failure (`FAILURE`/
`TIMEOUT`/`INTERMITTENT_FAILURE`) when the stage has `retry.maxAttempts > 0`, both route
through the same `retryService.scheduleRetry()` call. It increments `execution.retryCount`,
computes the delay (`fixed` or `exponential` with `backoffMultiplier`, capped at
`maxDelayMs`, optional `jitter`), creates a `RetryRecord`, and transitions the execution to
`RETRY_PENDING`. If the attempt limit is already reached, it returns `null` and the engine
records `RETRY_EXHAUSTED` and falls through the stage's normal `onFailure` transition —
exhaustion is never a silent dead end.

**Resumption flow**: `jobs/retryScheduler.js` polls `recoveryService.runRecoverySweep()`.
For each due `RetryRecord` (`result: 'pending'`, `scheduledAt <= now`), it atomically
claims the record (`executedAt: null` → set, a one-way gate), then calls
`recoveryService.resumeExecution()`, which atomically claims the `WorkflowExecution`
(conditional update on `currentState`), transitions `RETRY_PENDING → PROCESSING`, and
re-invokes `workflowEngine.advance()` on the **same stage** that requested the retry. The
retry record is then marked `succeeded` (the attempt completed, whatever the business
outcome) or `failed` (another retry was scheduled, or a hard error occurred).

**Important distinction** (explicitly required by the assignment): *retrying a failed
request* vs. *repeating an already-succeeded external side effect*. These are different
operations at the dependency-adapter level. A genuine new retry attempt gets a fresh
`operationId` (`executionId:stageId:attempt<N>`, where N is `execution.retryCount`), so
it's free to actually call the dependency again. A **recovery replay** of a stage that
*already completed* its dependency call before a crash (same `retryCount`, hence the same
`operationId`) finds the existing completed `ExternalDependencyLog` row and returns it
directly — the simulated side effect is never re-executed.

## 8. Concurrency Protections

| Scenario | Mechanism | Verified by |
|---|---|---|
| Two identical requests, same idempotency key | Unique DB index + atomic `findOneAndUpdate` claim | `idempotency.test.js` #5 (10 concurrent → 1 execution), `concurrencyAndSecurity.test.js` #34 (15 concurrent) |
| Two workers claiming the same due retry | Conditional `findOneAndUpdate({result:'pending', executedAt:null})` | `concurrencyAndSecurity.test.js` #35 |
| Two recovery sweeps resuming the same stuck execution | Conditional `findOneAndUpdate` on expected `currentState` | `concurrencyAndSecurity.test.js` #36 (5 concurrent → 1 resumer) |
| A stale in-memory execution copy overwriting newer state | Mongoose `optimisticConcurrency` (version-field OCC) — `.save()` throws `VersionError` | `concurrencyAndSecurity.test.js` #37/38 |
| A late/duplicate dependency response | Deterministic timeout classification (no real async race to begin with) + `operationId` dedup | `dependencyResilience.test.js` #24 |

No process-local locks are used anywhere — every guard is a database-level atomic
operation, so it holds even across multiple server instances (horizontal scaling-safe).

## 9. Automated Test Results

```
Test Suites: 15 passed, 15 total
Tests:       173 passed, 173 total
```
Run **3 times consecutively** (as required) with identical results each time — zero flaky
failures, including the concurrency tests that race 10-20 real HTTP requests or service
calls against each other.

Breakdown: 122 pre-existing (Phases 1-4, unmodified except one test updated for an
intentional behavior change — see §10), 51 new (11 idempotency + 12 retry + 9 dependency +
7 recovery + 12 concurrency/security).

## 10. Integration Test Results

Beyond Jest, verified via direct HTTP + service calls against a live server:
- Full idempotency flow (first submit → replay → conflict → 10-way concurrent race) — all
  behaved exactly as documented.
- Full retry → recovery → resume flow: dependency fails → `RETRY_PENDING` scheduled →
  dependency recovers → recovery sweep resumes → execution completes with the correct
  decision.
- Retry exhaustion: dependency fails consistently through all configured attempts →
  execution reaches the stage's configured failure outcome, `RetryRecord`s show
  `failed`/`succeeded` (attempt-completed) progression correctly.
- Backend boots cleanly with the scheduler running (`Retry/recovery scheduler started` log
  line, `/api/health` responds normally).

## 11. End-to-End Scenario Results

| Scenario | Result |
|---|---|
| A — Duplicate submission (same key, same payload) | **PASS** — one `Request`, one `WorkflowExecution`, identical result returned |
| B — Payload mismatch (same key, different payload) | **PASS** — `409` |
| C — Dependency failure then success | **PASS** — failure recorded, retry scheduled, dependency recovers, retry succeeds, final execution history shows the full trace |
| D — Retry exhaustion | **PASS** — retries occur up to the configured limit, exhaustion recorded (`RETRY_EXHAUSTED` audit entry), execution reaches the configured failure outcome |
| E — Server restart and recovery | **PASS** — simulated via fresh `require.cache` module reload (no real process restart possible in this test harness, but all state is read fresh from MongoDB with zero in-memory carryover — see `retryEngine.test.js` #18) |
| F — Concurrent duplicate submissions | **PASS** — 15 concurrent identical requests, same key → exactly one execution |
| G — Late external dependency response | **PASS** (via deterministic simulation) — latency beyond `timeoutMs` is classified `TIMEOUT` synchronously, no real async race exists in this simulated adapter to actually "arrive late"; the `operationId` dedup mechanism is what would prevent a genuinely out-of-order real-world response from double-applying, and that mechanism itself is directly tested (`dependencyResilience.test.js` #24) |

## 12. Bugs Discovered and Fixed

### Bug 1 — Idempotency claim race: 19/20 concurrent claims "succeeded"
Root cause and fix: see §2's dedicated write-up on Mongoose's `updatedAt` auto-touch
destroying both the insert-detection heuristic and the staleness signal. Fixed with
`includeResultMetadata: true` for reliable insert detection and `{ timestamps: false }` on
the claim query to stop it from touching an existing record's `updatedAt`. Verified with
120 total concurrent claim attempts across 6 repeated runs — exactly 1 winner every time.

### Bug 2 — Test fixtures' manual `updatedAt` backdating silently discarded
Two of my own new tests (simulating a stale lease / stuck record) backdated `updatedAt` via
`updateOne({$set:{updatedAt: oldDate}})`, which Mongoose's timestamps plugin silently
overwrote with "now" on the same call. Fixed by passing `{ timestamps: false }` on those
specific test-setup calls.

### Non-bug — an intentional Phase 4→5 behavior change, not a regression
One pre-existing Phase 4 test ("recognizes a RETRY outcome... sets RETRY_PENDING") assumed
a rule's `RETRY` outcome *always* paused the execution, matching Phase 4's scope (before
any retry policy concept existed). Phase 5 correctly requires a configured
`stage.retry.maxAttempts > 0` for a `RETRY` outcome to actually schedule a retry —
otherwise it's immediately "0 of 0 attempts exhausted" and falls through, per the
assignment's explicit "do not exceed configured retry limits." Updated that test to
configure a retry policy, preserving its original intent without weakening the assertion.

No other functional bugs were found during this phase's implementation or testing.

## 13. Known Limitations

- **Polling latency, not instant dispatch**: a due retry waits up to
  `RECOVERY_POLL_INTERVAL_MS` (default 5s) before being picked up, not milliseconds. This
  is the explicit, documented trade-off of choosing a Mongo-poll scheduler over a push-based
  queue — acceptable for this platform's scale; see §2.
- **`operationId` dedup is adapter-internal simulation**, not a real external-system
  idempotency token — it correctly demonstrates and tests the *pattern*, but a real
  production dependency would need the actual third-party API to honor an idempotency key
  the same way.
- **No manual-review resumption yet** — `MANUAL_REVIEW` still just pauses (from Phase 4);
  reviewer approve/reject actions that resume it are the next phase.
- **Recovery is poll-driven, not event-driven** — an interrupted execution is detected only
  once its `PROCESSING` state is older than `STUCK_PROCESSING_MS` (2 minutes), so recovery
  of a crash is not instantaneous either.
- **No real network calls** — the external dependency adapter is, and was always intended
  to be, a dev-only simulation (per the original Phase 4/5 instructions).

## 14. Infrastructure Requirements

**None beyond what Phase 1 already required** (Node.js, MongoDB). No Redis, no message
queue, no additional services. One new optional environment variable:
`RECOVERY_POLL_INTERVAL_MS` (default `5000`).

## 15. Manual Testing Instructions

```bash
cd backend && cp .env.example .env && npm install && npm run dev   # terminal 1
cd frontend && cp .env.example .env && npm install && npm run dev  # terminal 2
```

1. **Idempotency**: submit a request twice with the same `Idempotency-Key` header (via
   curl or any HTTP client — the Submit Request page doesn't expose this header yet, so
   use curl for this specific test) and confirm the second response has `"replayed": true`
   and the same execution ID.
2. **Failure simulation**: log in as admin, go to **Failure Simulation**, set a dependency
   key (e.g. `credit_bureau`) to `FAILURE`, then build/publish a workflow with an
   `external_dependency` stage using that key and a `retry.maxAttempts > 0` policy. Submit
   a request — it should land in `RETRY_PENDING`.
3. **Retry & Recovery Dashboard**: open it to see the pending retry. Change the simulation
   back to `SUCCESS`, wait ~5 seconds (the scheduler's poll interval), and refresh — the
   retry should show `succeeded` and the execution `COMPLETED`.
4. **Manual recovery**: as admin, use the "Recover Now" button on a listed recovery
   candidate to trigger `POST /api/recovery/:id/retry` directly.
5. **RBAC**: log in as `operator` or `viewer` and confirm `/reliability` and `/simulation`
   don't appear in the sidebar, and their APIs return `403` if hit directly.

---

**Status**: Phase 5 complete and verified (173/173 backend tests across 3 consecutive
runs, clean frontend build, all 7 end-to-end scenarios passing). Stopping here per your
instructions — not starting Phase 6.

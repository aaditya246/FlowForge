# Requirement Checklist

Status legend: ✅ done · 🚧 scaffolded (interface only) · ⬜ pending

## Phase 2 — Backend Foundation (this phase)

- ✅ Project structure (frontend + backend, modular monolith)
- ✅ React + Vite + Tailwind frontend scaffold
- ✅ Express + MongoDB + Mongoose backend scaffold
- ✅ `.env.example` for both apps
- ✅ Frontend ↔ backend API wiring (Axios client, CORS)
- ✅ Centralized error handling (`ApiError`, `errorHandler` middleware)
- ✅ JWT authentication + role-based authorization
- ✅ All 12 MongoDB models (see README)
- ✅ Joi input validation middleware
- ✅ REST API structure (`/api/auth/*`, `/api/workflows/*`, `/api/health`)
- ✅ Backend test suite passing (6/6, in-memory MongoDB)
- ✅ Backend boots and serves requests end-to-end (verified)
- ✅ Frontend builds and dev server serves content (verified)

## Phase 3 — Configuration & Rule Engine (done)

- ✅ WorkflowVersion CRUD (draft create/update/publish, version inspection, history)
- ✅ Rule engine: mandatory/threshold/logical/conditional/multi-step evaluation, safe AST (no eval)
- ✅ Rule priority + conflict resolution (`priority`, `first_match`, `all_must_pass`)
- ✅ Configuration validation before publish (stages, transitions, start/terminal stages, rule refs)
- ✅ Immutable published versions; editing requires a new draft
- ✅ In-progress executions unaffected by new publishes (pinned by `workflowVersionId`, verified by test)
- ✅ Rule testing APIs (ad-hoc and per-version) + frontend Rule Tester / draft editor pages
- ✅ RBAC enforced on all new endpoints (admin write, admin+reviewer rule testing, any-role read)
- ✅ Dynamic input schema *enforcement* at request intake (`services/workflowEngine/validateInput.js`, enforced in Phase 4)

## Testing & Quality Audit (completed before Phase 4)

See `TESTING_REPORT.md` for full detail.

- ✅ 87/87 backend tests passing (46 new tests added during this audit: auth edge cases,
  RBAC for all 4 roles, DB-level validation, rule engine edge cases, workflow config
  validation edge cases)
- ✅ 2 real bugs found and fixed: malformed JSON returning 500 instead of 400; forged
  token `sub` returning a leaky 400 CastError instead of 401 (both have regression tests)
- ✅ Removed 1 unused dependency (`uuid`)
- ✅ Security review of rule engine: confirmed no `eval`/`new Function`, whitelisted
  operators only, safe recursive validation, prototype-pollution-safe field access
- ✅ Frontend production build verified clean (0 errors, 2182 modules); served and
  smoke-tested via `vite preview`; CORS verified end-to-end with real HTTP requests
  from the frontend's origin
- ✅ All 5 end-to-end scenarios (A–E) verified via live HTTP calls, including a scripted
  "application restart" (full DB disconnect/reconnect + re-login) proving data persistence
- ⬜ Live browser click-through — no browser automation tool available in this
  environment; mitigated via build verification + full API-level exercising of every
  page's calls (see `TESTING_REPORT.md` §5)

## Phase 4 — Workflow Execution & State Management (done)

See `PHASE_4_REPORT.md` for full detail.

- ✅ Generic workflow execution engine (`services/workflowEngine`: `start` + `advance`) —
  same engine executes both example workflows with zero business-specific code
- ✅ State transition allow-list enforced centrally (`services/stateManagement`), extended
  to allow a neutral `PROCESSING -> COMPLETED` path for decision-less terminal stages
- ✅ Stage execution: `validation`, `rule_evaluation` (with APPROVE/REJECT/MANUAL_REVIEW/
  RETRY/CONTINUE/FAIL outcomes — covers the spec's "approval" and "retry" stage concepts
  as rule outcomes, documented adaptation in README), `external_dependency` (real simulated
  adapter, replaces the Phase 2 stub), `manual_review` (pauses), `terminal` (finalizes)
- ✅ Execution event history: every stage entry + every state change recorded as an
  `ExecutionEvent`; every decision/rule-evaluation/transition recorded as an `AuditLog`
- ✅ Configurable stage transitions resolved from `WorkflowVersion` config (success/failure/
  rule-outcome/manual-review/terminal-keyword), with a controlled `FAILED` execution (not a
  crash) when a transition target is unconfigured at run time
- ✅ Loop prevention: max 50 stage executions, max 10 revisits of the same stage per run
- ✅ Version binding: execution pinned to the exact `WorkflowVersion._id`; publishing a new
  version never changes an in-flight or completed execution's behavior (verified by test)
- ✅ Decision explanation API reads only from the pinned version + that execution's own
  audit trail — historical explanations never depend on the workflow's current config
- ✅ Request/Execution REST APIs behind existing RBAC (admin+operator submit; all roles read)
- ✅ Frontend: dynamic request-submission form, request history, execution detail + timeline

## Phase 5 — Reliability Engineering (done)

See `PHASE_5_REPORT.md` for full detail.

- ✅ Idempotency: full implementation (`services/idempotencyService`) — DB-unique-index
  backed claim/replay/conflict/reclaim state machine, concurrency-safe (verified: 1 winner
  out of 10-20 concurrent identical claims, repeatedly), survives backend restart
- ✅ Retry service: per-stage policy (reused `stage.retry` config, extended with
  `backoffMultiplier`/`maxDelayMs`/`jitter`), fixed + exponential backoff with jitter,
  retry-limit enforcement, exhaustion handling, full RetryRecord history
- ✅ Durable scheduling: MongoDB-poll scheduler (`jobs/retryScheduler.js`) — no Redis/BullMQ
  added; all state in Mongo, restart-safe (documented rationale in `PHASE_5_REPORT.md`)
- ✅ External dependency resilience: deterministic timeout detection, error categorization,
  outbox-style `operationId` checkpoint preventing duplicate side effects on replay
- ✅ Recovery service: fully implemented — interrupted-execution detection (stale
  PROCESSING lease), due-retry resumption, inconclusive-dependency-log reconciliation, all
  claim-guarded against concurrent double-processing
- ✅ Concurrency protection: Mongoose `optimisticConcurrency` (OCC) on `WorkflowExecution`;
  atomic claim gates on `IdempotencyRecord`, `RetryRecord`, and execution resumption
- ✅ Audit service: extended with 14 new reliability event types, all reliability actions
  traced (idempotency replay/conflict, retry scheduled/started/exhausted, dependency
  timeout/failure, recovery started/completed/failed, concurrency conflict)
- ✅ Failure Simulation Console (admin-only) + Retry & Recovery Dashboard (admin+reviewer)

## Phase 6 — Frontend (partial)

- ✅ Auth pages, protected routing, dashboard shell
- ✅ Workflow list/create, version history, draft editor (JSON-based), publish/validate actions
- ✅ Rule testing UI (ad-hoc tester + per-version tester)
- ⬜ Visual workflow builder (explicitly deferred per Phase 3 scope)
- ✅ Request submission forms (dynamic per workflow schema, no hardcoded per-workflow forms)
- ✅ Request detail / audit timeline view (`ExecutionDetailPage`)
- ⬜ Manual review queue (reviewer approve/reject actions — next phase)
- ✅ Failure simulation console (`FailureSimulationPage`, admin-only)
- ✅ Retry & Recovery dashboard (`ReliabilityDashboardPage`, admin+reviewer)
- ⬜ Analytics dashboard with real data

## Phase 7 — Testing

- ✅ Happy path (auth) + health check
- ✅ Rule engine: operators, logical composition, nesting, priority, conflict resolution, disabled rules, invalid structure, missing fields, unsupported operators, no-eval safety (32 tests across Phase 3 + audit)
- ✅ Workflow versioning: create/update/publish, invalid-config rejection, immutability, version isolation, version history, RBAC (13 tests)
- ✅ Workflow execution engine: all stage types, state machine, transitions, loop prevention, version binding, history/explainability, RBAC (27 tests)
- ✅ Both example workflows end-to-end (approve/reject/manual-review/invalid-input, 8 tests)
- ✅ Idempotency: claim/replay/conflict/reclaim/concurrency/restart-durability (11 tests)
- ✅ Retry engine: backoff math, scheduling, limits, exhaustion, state transitions, restart-durability (12 tests)
- ✅ Dependency resilience: success/failure/timeout/intermittent/slow/replay/dedup (9 tests)
- ✅ Recovery service: interrupted executions, due retries, reconciliation, no-duplicate-side-effects, idempotent re-runs (7 tests)
- ✅ Concurrency: duplicate submissions, concurrent retry/recovery workers, OCC version conflicts (4 tests)
- ✅ Security: viewer/operator restrictions on simulation config and recovery triggers, unauthenticated rejection on all reliability endpoints (8 tests)
- **173/173 total, run 3× consecutively with zero flaky failures**

## Phase 8 — Documentation

- ✅ README (setup instructions)
- ⬜ `ARCHITECTURE.md` (detailed, beyond the Phase 1 chat summary)
- ⬜ Decision explanation examples
- ⬜ Seed data + demo scripts

# FlowForge — Resilient Configurable Workflow Decision Platform

A generic, config-driven workflow decision platform: intake → rule evaluation → staged
execution → state tracking → audit trail, built to survive failure and requirement
changes without code rewrites. See `ARCHITECTURE.md` (added in a later phase) for the
full design.

## Tech Stack

- **Backend**: Node.js, Express, MongoDB (Mongoose), JWT auth, Joi validation, Jest + Supertest
- **Frontend**: React 19 + Vite 5, Tailwind CSS, Axios, React Router, Recharts, Lucide icons

## Project Structure

```
backend/
  src/
    config/        env + DB connection
    controllers/    thin HTTP handlers
    models/         Mongoose schemas (12 collections)
    routes/
    middleware/     auth, validation, error handling, idempotency key extraction
    validators/     Joi schemas
    services/       all business logic (rule engine, workflow engine, audit, etc.)
    tests/
frontend/
  src/
    pages/, layouts/, components/, context/, services/
```

## Prerequisites

- Node.js 18+ (20.15 used in development)
- MongoDB running locally (`mongodb://127.0.0.1:27017`) or a connection string to Atlas

## Setup

### Backend

```bash
cd backend
cp .env.example .env     # edit MONGO_URI / JWT_SECRET as needed
npm install
npm run dev               # starts on http://localhost:5000
```

Run tests (spins up an in-memory MongoDB automatically, no setup needed):

```bash
npm test
```

### Frontend

```bash
cd frontend
cp .env.example .env
npm install
npm run dev               # starts on http://localhost:5173
```

## Demo Credentials

No seed data yet (added in a later phase). Create the first user via:

```bash
curl -X POST http://localhost:5000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"name":"Admin","email":"admin@example.com","password":"password123","role":"admin"}'
```

Use the returned token as `Authorization: Bearer <token>` for subsequent requests, or log
in through the frontend at `/login`.

## API Reference (Phase 3 additions)

All endpoints below require `Authorization: Bearer <token>` except `/auth/register` and `/auth/login`.

| Method | Path | Role | Description |
|---|---|---|---|
| POST | `/api/workflows` | admin | Create a workflow definition |
| GET | `/api/workflows` | any | List workflows |
| GET | `/api/workflows/:id` | any | Get workflow details |
| PATCH | `/api/workflows/:id` | admin | Update workflow metadata |
| POST | `/api/workflows/:id/archive` | admin | Archive a workflow |
| GET | `/api/workflows/:id/versions` | any | List version history (newest first) |
| GET | `/api/workflows/:id/versions/:version` | any | Get one version |
| POST | `/api/workflows/:id/versions` | admin | Create a new draft (`{cloneFromVersion?}`) |
| PATCH | `/api/workflows/:id/versions/:version` | admin | Update a **draft** version's stages/rules/startStageId/conflictResolution |
| POST | `/api/workflows/:id/versions/:version/validate` | admin | Validate config, returns `{valid, errors[]}` without publishing |
| POST | `/api/workflows/:id/versions/:version/publish` | admin | Validate + publish; deprecates the previous published version |
| POST | `/api/workflows/:id/versions/:version/rules/test` | admin, reviewer | Evaluate the version's saved rules against `{context}` |
| POST | `/api/rules/test-evaluate` | admin, reviewer | Evaluate an ad-hoc `{rules, context, conflictResolution}` without saving anything |

### Rule condition AST

A leaf condition: `{ "field": "creditScore", "operator": ">=", "value": 750 }`.
Logical composition: `{ "and": [...] }`, `{ "or": [...] }`, `{ "not": {...} }` (recursive).
Supported operators: `==`/`EQ`, `!=`/`NEQ`, `>`, `<`, `>=`, `<=`, `IN`, `NOT_IN`, `CONTAINS`, `EXISTS`, `NOT_EXISTS`, `MANDATORY`.
Never evaluated with `eval`/`new Function` — it's pure data interpreted by `backend/src/services/ruleEngine`.

### Versioning model

- A `WorkflowVersion` starts as `draft`, can be edited freely.
- `publish` validates the config and flips it to `published` (immutable from then on); the previously published version becomes `deprecated`.
- A `WorkflowExecution` (Phase 4) pins to a specific `WorkflowVersion._id`, so publishing a new version never changes the behavior of requests already in flight.
- To edit a published workflow, create a new draft (optionally cloned from the latest version via `cloneFromVersion`), edit it, then publish it as the next version number.

See `examples/loan-approval-workflow.json` and `examples/insurance-claim-workflow.json` for full configuration examples — both run on the same generic engine.

## API Reference (Phase 4 additions)

| Method | Path | Role | Description |
|---|---|---|---|
| POST | `/api/requests` | admin, operator | Submit a request to a workflow's published version and run it through the execution engine |
| GET | `/api/requests` | any | List requests (`?page&limit&workflowId&status`) |
| GET | `/api/requests/:id` | any | Get a single request |
| GET | `/api/executions` | any | List executions (`?page&limit&workflowId&currentState`) |
| GET | `/api/executions/:id` | any | Get an execution document |
| GET | `/api/executions/:id/status` | any | Lightweight current-state poll |
| GET | `/api/executions/:id/history` | any | Full `{events, auditTrail}` timeline |
| GET | `/api/executions/:id/explanation` | any | Decision explanation: version used, rule traces, transitions, failures |

### Example: submit a request

```bash
curl -X POST http://localhost:5000/api/requests \
  -H "Authorization: Bearer <token>" -H "Content-Type: application/json" \
  -d '{"workflowId":"<id>","payload":{"applicantName":"Alice","creditScore":780,...}}'
```

Response (`201` if input was valid, `422` if it failed the workflow's input schema):

```json
{
  "success": true,
  "data": {
    "request": { "_id": "...", "status": "accepted", ... },
    "execution": { "_id": "...", "currentState": "COMPLETED", "finalDecision": "APPROVE", ... },
    "valid": true,
    "errors": []
  }
}
```

### Execution lifecycle

```
PENDING -> VALIDATING -> PROCESSING -> { APPROVED | REJECTED | FAILED | COMPLETED | MANUAL_REVIEW | RETRY_PENDING }
APPROVED/REJECTED/FAILED -> COMPLETED
MANUAL_REVIEW -> (Phase 5: reviewer decision) -> APPROVED | REJECTED
RETRY_PENDING -> (Phase 5: retry worker) -> PROCESSING | FAILED
```
Enforced centrally by `services/stateManagement` — every transition is validated against
an explicit allow-list and recorded as an `ExecutionEvent`.

### Stage types and how they're executed

| Type | Behavior |
|---|---|
| `validation` | Re-checks the version's `inputSchema` (required/type/enum/min/max); `onSuccess`/`onFailure` |
| `rule_evaluation` | Runs `ruleEngine.evaluate()` on the stage's `ruleGroup`; outcome (`CONTINUE`/`APPROVE`/`REJECT`/`MANUAL_REVIEW`/`RETRY`/`FAIL`) picks the transition |
| `external_dependency` | Calls the simulated adapter (`services/externalDependency`), logs to `ExternalDependencyLog`; `onSuccess`/`onFailure` |
| `manual_review` | Always pauses the execution (`MANUAL_REVIEW` state); resuming it is Phase 5 |
| `terminal` | Finalizes the execution using the decision carried from the last rule evaluation (or neutral `COMPLETED` if none) |

**Adaptation note**: the original Phase 4 spec listed `APPROVAL` and `RETRY` as separate
stage types. To avoid schema churn on the Phase 3 `WorkflowVersion.stages` enum, both are
handled as **rule outcomes** inside a `rule_evaluation` stage instead (a rule's `onPass`/
`onFail` can already be `APPROVE`, `REJECT`, or `RETRY`) — functionally equivalent, no new
Mongoose enum values needed.

### Transitions

A stage's `onSuccess`/`onFailure`/`onManualReview` can point to another `stageId`, or
directly to a terminal keyword (`APPROVED`, `REJECTED`, `MANUAL_REVIEW`, `FAILED`,
`COMPLETED`) to skip a generic terminal stage. If a transition target is `null`/missing at
*execution* time, the engine fails the execution with a controlled, auditable error rather
than crashing — this is intentionally stricter than draft-time validation, which allows
`null` as a placeholder while a workflow is still being authored.

### Execution limits (loop prevention)

Hardcoded sane defaults in `services/workflowEngine/index.js` (not yet admin-configurable —
documented as a Phase 5 follow-up): max **50** stage executions per run, max **10** visits
to the same stage. Either limit being exceeded ends the execution in `FAILED` with a
descriptive `finalReason`, never an infinite loop or a crash.

### Explainability

`GET /api/executions/:id/explanation` and `/history` read only from (a) the execution's
pinned `WorkflowVersion` document (immutable once published) and (b) that execution's own
`AuditLog`/`ExecutionEvent` records — so an explanation generated a year from now, after
the workflow has been edited many times, still reflects exactly what ran at submission
time.

## API Reference (Phase 5 additions)

| Method | Path | Role | Description |
|---|---|---|---|
| POST | `/api/requests` | admin, operator | (extended) now accepts `Idempotency-Key` header — see Idempotency below |
| GET | `/api/retries` | admin, reviewer | List retry records (`?page&limit&executionId&result`) |
| GET | `/api/retries/:id` | admin, reviewer | Get a single retry record |
| GET | `/api/executions/:id/retries` | admin, reviewer | Retry history for one execution |
| GET | `/api/recovery` | admin, reviewer | List recovery candidates (interrupted executions + due retries) |
| GET | `/api/recovery/:id` | admin, reviewer | Inspect one execution's recovery-relevant state |
| POST | `/api/recovery/:id/retry` | **admin only** | Manually trigger recovery for one execution |
| GET | `/api/dependencies/simulations` | admin, reviewer | List configured dependency simulation behaviors |
| PUT | `/api/dependencies/simulations/:id` | **admin only** | Set a dependency's simulated outcome/delay/failure probability |
| GET | `/api/dependencies/logs` | admin, reviewer | List `ExternalDependencyLog` rows (`?page&limit&dependencyKey&executionId`) |
| GET | `/api/reliability/summary` | admin, reviewer | Aggregate counts: pending/exhausted retries, interrupted executions, recent dependency failures |

### Idempotency

```bash
curl -X POST http://localhost:5000/api/requests \
  -H "Authorization: Bearer <token>" -H "Content-Type: application/json" \
  -H "Idempotency-Key: loan-application-12345" \
  -d '{"workflowId":"<id>","payload":{...}}'
```

| Scenario | Response |
|---|---|
| New key | `201`, real result, `valid: true/false` |
| Same key, same payload | `200`, `replayed: true`, the original execution |
| Same key, different payload | `409 Conflict` |
| Same key, still processing (concurrent) | `202`, `{inProgress: true}` |
| No key provided | Processed fresh every time — no dedup guarantee (documented policy, unchanged from Phase 4) |

Scope: `{workflowId, idempotencyKey}` (unique DB index on `IdempotencyRecord`). A
`processing` record older than 30s, or a `failed` record, can be reclaimed under the same
key — see `PHASE_5_REPORT.md` for the full state machine.

### Failure simulation

```bash
curl -X PUT http://localhost:5000/api/dependencies/simulations/credit_bureau \
  -H "Authorization: Bearer <admin-token>" -H "Content-Type: application/json" \
  -d '{"forcedOutcome":"FAILURE"}'
```

Valid `forcedOutcome` values: `SUCCESS`, `FAILURE`, `TIMEOUT`, `INTERMITTENT_FAILURE`,
`SLOW_RESPONSE`. Optional `delayMs` (artificial latency) and `failureProbability` (0-1, for
`INTERMITTENT_FAILURE`).

### Environment variables (new)

| Variable | Default | Description |
|---|---|---|
| `RECOVERY_POLL_INTERVAL_MS` | `5000` | How often the retry/recovery scheduler polls MongoDB for due work |

No new infrastructure (Redis, message queues) was introduced — see `PHASE_5_REPORT.md` for
why a MongoDB-backed poller was chosen instead of BullMQ/Redis for this project's scale.

## What's implemented (Phase 2)

- Project scaffolding for both frontend and backend
- MongoDB models for all 12 collections (users, workflow definitions/versions, requests,
  executions, execution events, audit logs, idempotency records, review actions, external
  dependency logs, retry records, system configuration)
- JWT authentication + role-based authorization middleware (`admin`, `reviewer`,
  `operator`, `viewer`)
- Centralized error handling with consistent API error envelope
- Joi-based request validation middleware
- Basic Workflow CRUD REST endpoints
- Rule engine, workflow engine, idempotency, retry, external dependency, and recovery
  services scaffolded with their public interfaces (implemented in Phases 3-5)
- Tailwind-based frontend shell: login page, protected dashboard layout, auth context
- Backend test suite (auth + health) passing against an in-memory MongoDB

## What's implemented (Phase 3)

- Dynamic rule engine (`services/ruleEngine`): safe AST interpreter (no `eval`), mandatory/
  equality/threshold/IN/CONTAINS/EXISTS operators, AND/OR/NOT with arbitrary nesting,
  priority ordering, and three conflict-resolution strategies (`priority`, `first_match`,
  `all_must_pass`). Every evaluation returns a fully explainable trace.
- Workflow configuration validator (`services/workflowEngine/validateConfig.js`): checks
  unique stage IDs, valid stage types, valid transition targets, valid start/terminal
  stages, and rule-group references before a version can publish.
- Workflow version service: draft creation (optionally cloned), draft editing, publish
  with validation, immutability of published/deprecated versions, full version history.
- REST APIs for workflow/version CRUD, publishing, validation, and rule testing (both
  ad-hoc and against a saved version), all behind existing RBAC middleware.
- Frontend: functional (non-visual-builder) pages for listing/creating workflows,
  viewing version history, editing a draft's stages/rules as JSON, validating/publishing,
  and a standalone Rule Tester page.
- 41 backend tests passing (22 rule engine, 13 workflow versioning/RBAC, 6 Phase 2).

## What's implemented (Phase 4)

- Generic workflow execution engine (`services/workflowEngine`): runs a request through a
  published `WorkflowVersion`'s stages until it pauses or reaches a terminal state. The
  **same** engine executes both example workflows (loan approval, insurance claim) with
  zero business-specific code.
- `services/executionService`: orchestrates intake validation, Request/WorkflowExecution
  creation, and the execution run; also serves history/explanation reads.
- Real `services/externalDependency` adapter (SUCCESS by default, configurable via
  `SystemConfiguration` for failure-simulation testing) — dev-only, no retry/backoff yet.
- `services/workflowEngine/validateInput.js`: validates a request payload against the
  version's `inputSchema` before an execution is ever created.
- REST APIs for request submission and execution read access (see API table above).
- Frontend: dynamic request-submission form (built from the workflow's `inputSchema`,
  no hardcoded per-workflow forms), request history list, and an execution detail page
  with a merged event+audit timeline and rule-evaluation trace.
- 65 new backend tests (27 execution-engine unit/integration tests, 8 example-workflow
  end-to-end tests covering both loan approval and insurance claim; existing 2 isolation/
  index fixes applied to the shared test setup). 122/122 total passing.

## What's implemented (Phase 5)

Full reliability layer — see `PHASE_5_REPORT.md` for the complete design writeup.

- **Idempotency** (`services/idempotencyService`): send an `Idempotency-Key` header on
  `POST /api/requests`. Same key + same payload → replays the stored result. Same key +
  different payload → `409`. Concurrent identical submissions → exactly one execution is
  ever created (DB-level unique index + atomic claim, not an in-memory map). Survives a
  backend restart — all state is in MongoDB.
- **Retry engine** (`services/retryService`): per-stage retry policy (reuses the existing
  `stage.retry` config: `maxAttempts`, `delayMs`, `backoff`, `backoffMultiplier`,
  `maxDelayMs`, `jitter`). A `RETRY` rule outcome or a retryable dependency failure now
  schedules a real, durable retry instead of just pausing forever.
- **Durable scheduling**: a MongoDB-poll scheduler (`jobs/retryScheduler.js`, 5s interval,
  configurable via `RECOVERY_POLL_INTERVAL_MS`) — **not** BullMQ/Redis (see
  `PHASE_5_REPORT.md` for why). All scheduling state lives in Mongo; a restart loses
  nothing.
- **External dependency resilience** (`services/externalDependency`): deterministic
  timeout detection, error categorization, and an outbox-style checkpoint (`operationId`)
  that prevents a retry/recovery replay from repeating an already-succeeded side effect.
- **Failure recovery** (`services/recoveryService`): finds and resumes executions stuck in
  `PROCESSING` (crashed mid-stage), resumes due retries, and reconciles dependency calls
  left inconclusive by an interrupted process — all claim-guarded so concurrent
  resume/recovery attempts never double-process the same work.
- **Concurrency protection**: Mongoose `optimisticConcurrency` (version-field OCC) on
  `WorkflowExecution` — a stale in-memory copy's `.save()` throws instead of silently
  overwriting newer state.
- **Failure Simulation Console** (admin-only) and a **Retry & Recovery Dashboard**
  (admin + reviewer) in the frontend.
- 51 new backend tests (idempotency, retry policy/backoff math, dependency resilience,
  recovery, concurrency, RBAC). **173/173 total passing**, run 3× consecutively with zero
  flakiness.

## What's pending

See `CHECKLIST.md` for the full requirement-by-requirement tracker. Headline items for
Phase 6 onward:

- Manual review queue UI + reviewer actions (approve/reject, resuming a `MANUAL_REVIEW`
  execution) — the pause/preserve-context mechanics already exist from Phase 4
- Admin-configurable execution limits (currently hardcoded defaults)
- Audit log growth/archival management
- Analytics dashboard with real aggregated data

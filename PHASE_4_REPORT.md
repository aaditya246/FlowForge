# Phase 4 Report — Generic Workflow Execution Engine

## 1. Features Implemented

- A generic, stage-interpreting **workflow execution engine** (`backend/src/services/workflowEngine/index.js`)
  that runs a request through a published `WorkflowVersion`'s stages until it pauses
  (`MANUAL_REVIEW`, `RETRY_PENDING`) or reaches a terminal state (`APPROVED`/`REJECTED`/
  `FAILED`/`COMPLETED`). The **same** engine executes both example workflows — nothing in
  the engine knows about "loan" or "insurance" concepts.
- **Input schema enforcement** at intake (`services/workflowEngine/validateInput.js`):
  required/type/enum/min/max checks against the version's `inputSchema`, run before a
  `WorkflowExecution` is ever created.
- **Request/Execution orchestration service** (`services/executionService`): submits a
  request, validates it, creates `Request` + `WorkflowExecution` records, runs the engine,
  and serves list/get/history/explanation reads.
- A **real external-dependency adapter** (`services/externalDependency`) replacing the
  Phase 2 stub: simulates `SUCCESS` by default, or whatever outcome is configured per
  `dependencyKey` in `SystemConfiguration`, and logs every call to `ExternalDependencyLog`.
- **5 stage types executed**: `validation`, `rule_evaluation`, `external_dependency`,
  `manual_review`, `terminal` (see §2 for the "approval"/"retry" adaptation).
- **Execution safety**: max-stage-execution and max-same-stage-revisit limits prevent
  infinite loops; unknown/missing transition targets produce a controlled `FAILED`
  execution with a descriptive reason, never a crash or a hang.
- **Full history/explainability**: every stage entry and every state change is an
  `ExecutionEvent`; every decision-relevant action (rule evaluation, external call,
  manual-review routing, retry, failure, completion) is an `AuditLog` entry.
- **REST APIs**: `POST /api/requests`, `GET /api/requests`, `GET /api/requests/:id`,
  `GET /api/executions`, `GET /api/executions/:id`, `.../status`, `.../history`,
  `.../explanation` — all behind existing JWT auth + RBAC middleware.
- **Frontend**: a request-submission page whose form is generated entirely from the
  selected workflow's `inputSchema` (one page for every workflow, not one form per
  business type), a paginated request-history list, and an execution-details page with a
  merged event+audit timeline and rule-evaluation trace.

## 2. Architecture and Important Design Decisions

### Stage-type adaptation (documented deviation from the literal spec)

The Phase 4 instructions listed 7 conceptual stage categories, including `APPROVAL` and
`RETRY` as distinct types. The Phase 3 `WorkflowVersion.stages` schema (and its Mongoose
enum) only has 5 types: `validation | rule_evaluation | external_dependency | manual_review
| terminal`. Rather than churn that schema (and the Phase 3 config validator and its tests)
mid-project, I kept the 5 existing types and handle "approval" and "retry" as **rule
outcomes** inside a `rule_evaluation` stage — a rule's `onPass`/`onFail` can already be
`APPROVE`, `REJECT`, `MANUAL_REVIEW`, `RETRY`, `CONTINUE`, or `FAIL`, each carrying a
reason and a full evaluation trace. This is functionally equivalent to a dedicated
`APPROVAL`/`RETRY` stage type and was the explicitly preferred path per your instruction:
*"If an existing interface differs from your assumptions, adapt the implementation to the
actual codebase."*

### Terminal-stage decision carrying

The two example workflows (written in Phase 3, before any engine existed) route every rule
outcome — `APPROVE`, `REJECT`, and `MANUAL_REVIEW` — to the **same** generic `terminal`
stage ID. A bare `terminal` stage carries no inherent decision by itself, so the engine
tracks a `pendingDecision` variable through a single `advance()` run: when a
`rule_evaluation` stage yields `APPROVE`/`REJECT`, that decision is carried forward and
applied when the generic `terminal` stage is actually reached (mapping to `APPROVED` or
`REJECTED`; no decision defaults to a neutral `COMPLETED`). A transition can also target a
terminal **keyword** directly (e.g. `"onFailure": "REJECTED"`) to skip the generic stage
entirely — both patterns are supported and tested.

### State machine extension

The Phase 1/3 state-transition table (`services/stateManagement`) didn't allow
`PROCESSING -> COMPLETED` directly — only via `APPROVED`/`REJECTED`/`FAILED`. A workflow
whose terminal stage carries no decision (e.g. a pure verification pipeline) needs exactly
that transition. I added `COMPLETED` to `PROCESSING`'s allowed targets (see Bug 2 in §9)
rather than forcing every workflow to produce an artificial APPROVE/REJECT.

### Idempotency and retry — explicitly out of scope here

Per your instructions ("do not implement the complete retry and recovery system reserved
for Phase 5"), the engine *recognizes* a `RETRY` outcome (creates a `RetryRecord`,
transitions to `RETRY_PENDING`) and *stores* an `idempotencyKey` on `Request`, but there is
no scheduler, backoff, or dedup-on-replay yet. Those are Phase 5.

## 3. Files Created

**Backend services**
- `services/workflowEngine/index.js` — rewritten from the Phase 2 stub into the real engine
- `services/workflowEngine/validateInput.js` — intake schema validator
- `services/executionService/index.js` — orchestration layer
- `services/externalDependency/index.js` — rewritten from stub into a real simulated adapter

**Backend API layer**
- `controllers/requestController.js`, `controllers/executionController.js`
- `routes/requestRoutes.js`, `routes/executionRoutes.js`
- `validators/executionValidators.js`

**Backend tests**
- `tests/workflowExecution.test.js` (27 tests)
- `tests/exampleWorkflows.test.js` (8 tests, both example workflows end-to-end)

**Frontend**
- `services/requestService.js`, `services/executionService.js`
- `pages/RequestSubmissionPage.jsx`, `pages/RequestHistoryPage.jsx`, `pages/ExecutionDetailPage.jsx`

**Docs**
- `PHASE_4_REPORT.md` (this file)

## 4. Files Modified

- `services/stateManagement/index.js` — added `PROCESSING -> COMPLETED` (bug fix, §9)
- `routes/index.js` — mounted `/api/requests`, `/api/executions`
- `tests/setup.js` — wait for index builds before each test file runs (bug fix, §9)
- `frontend/src/App.jsx`, `frontend/src/layouts/DashboardLayout.jsx` — new routes/nav
- `README.md`, `CHECKLIST.md` — Phase 4 documentation

## 5. Database Changes

No schema/model changes. Every model this phase needed (`Request`, `WorkflowExecution`,
`ExecutionEvent`, `AuditLog`, `RetryRecord`, `ExternalDependencyLog`) already existed from
Phase 2 — Phase 4 is the first phase to actually *write* to most of them.

## 6. Automated Test Results

```
Test Suites: 10 passed, 10 total
Tests:       122 passed, 122 total
```
Ran 3 times consecutively to rule out flakiness (all 122/122). Broken down:
- 27 new workflow-execution tests (all required scenarios from your test plan: valid
  execution, unpublished/invalid workflow rejection, each stage type, sequential stages,
  conditional branches, approve/reject outcomes, manual-review pause, retry recognition,
  terminal stop, missing-stage handling, invalid-transition handling, loop prevention,
  version binding × 3, history/explainability × 4, API/RBAC × 5)
- 8 new example-workflow end-to-end tests (4 per workflow: approve, reject, manual review,
  invalid input) — both run on the identical engine
- All 87 pre-existing Phase 1–3 tests still pass unmodified (two were fixed — see §9 — but
  none were weakened or removed)

## 7. Integration Test Results

Beyond Jest, I exercised the real HTTP API directly (live server, in-memory MongoDB) for:
- Both example workflow JSON files loaded via the actual `PATCH`/`publish` API, then
  submitted with 4 payload variants each — confirmed the generic engine handles real
  business configuration with zero engine-level business logic.
- A full version-binding check: submit against v1, publish v2 with a stricter rule, verify
  the first execution still shows `workflowVersionNumber: 1` and a *new* submission uses v2.
- Backend boot + MongoDB connectivity + `/api/health` verified against a real server process.

## 8. End-to-End Scenario Results

| Scenario | Result |
|---|---|
| A1 — Loan: valid high-credit application approved | PASS |
| A2 — Loan: low-credit application rejected | PASS |
| A3 — Loan: borderline application → manual review | PASS |
| A4 — Loan: missing mandatory fields rejected at intake | PASS |
| B1 — Claim: valid low-value claim approved | PASS |
| B2 — Claim: invalid-policy claim rejected | PASS |
| B3 — Claim: high-value claim → manual review | PASS |
| B4 — Claim: missing mandatory fields rejected at intake | PASS |

All 8 are now permanent regression tests (`tests/exampleWorkflows.test.js`), not just
one-off manual checks.

## 9. Bugs Discovered and Fixed

### Bug 1 — Stage-to-stage movement within `PROCESSING` was never recorded
- **Root cause**: `ExecutionEvent`s were only written inside `transitionState()`, which I
  only called on actual *state* changes. Most of a workflow's life is spent moving
  stage-to-stage while the state stays `PROCESSING` the whole time, so those moves were
  invisible in the history — e.g. a 3-stage workflow's timeline showed `validate` twice and
  `terminal` twice, but never `evaluate`.
- **Fix**: log a stage-entry `ExecutionEvent` (with `fromState === toState`) at the top of
  every loop iteration, independent of whether the state actually changes.
- **Found by**: the new `workflowExecution.test.js` "executes multiple sequential stages" test.

### Bug 2 — `PROCESSING -> COMPLETED` was not an allowed state transition
- **Root cause**: a terminal stage reached with no carried APPROVE/REJECT decision (a
  legitimate case — e.g. a pure verification pipeline with no approve/reject semantics)
  needs to finalize directly to `COMPLETED`, but the Phase 3 state-transition table only
  allowed `COMPLETED` via `APPROVED`/`REJECTED`/`FAILED`. This surfaced as every
  `external_dependency`-only test workflow failing its very first submission with
  `400 Invalid state transition: PROCESSING -> COMPLETED`.
- **Fix**: added `COMPLETED` to `PROCESSING`'s allowed targets in `services/stateManagement`.
- **Found by**: manual API testing of an `external_dependency`-stage workflow, confirmed by
  the new `workflowExecution.test.js` external-dependency suite.

### Bug 3 (test infrastructure) — Mongoose index-build race causing an intermittent false failure
- **Root cause**: `mongoose.connect()` resolves before background index builds (e.g. the
  `User.email` unique index) necessarily finish; a test file whose very first write races
  ahead of that can intermittently pass even with a real duplicate. This was a latent issue
  in the Phase 3 test setup, not something Phase 4 introduced, but it surfaced during this
  phase's larger, slower test run.
- **Fix**: `tests/setup.js` now calls `Model.init()` on every registered model and awaits it
  before any test runs, making index availability deterministic.
- **Verified**: full suite run 3 times consecutively with zero flakiness afterward.

### Non-bug — a brittle test assertion of my own (not a defect)
One of my own new tests asserted an exact array index for where the `terminal` stage event
would land; adding Bug 1's fix shifted that index. Rewrote the assertion to check the
actual invariant ("nothing executes after reaching terminal") instead of a magic number.

No other functional bugs were found. Every other tested path (approve, reject, manual
review, retry recognition, external dependency success/failure, loop prevention, version
binding, RBAC) passed on first implementation.

## 10. Known Limitations

- **Execution limits are hardcoded**, not yet admin-configurable through
  `SystemConfiguration` (documented in README; straightforward Phase 5 follow-up).
- **No automatic retry execution**: a `RETRY` outcome pauses the execution and records
  intent (`RetryRecord`, `RETRY_PENDING` state) but nothing resumes it automatically yet.
- **No manual-review resolution**: `MANUAL_REVIEW` correctly pauses and preserves context,
  but there is no reviewer-facing API/UI yet to approve/reject and resume — that's Phase 5's
  `ReviewAction` integration.
- **No idempotency enforcement**: the key is stored on `Request` but duplicate submissions
  with the same key are not yet deduplicated.
- **External dependency simulation has no admin UI** yet (only via directly writing a
  `SystemConfiguration` document) — the "Failure Simulation Console" is Phase 5 scope.
- **Live browser click-through was not performed** — no browser-automation tool is
  available in this environment. Mitigated the same way as the Phase 3 testing audit: the
  production build compiles with zero errors, and every page's actual API calls were
  exercised directly against a live backend.

## 11. Deferred to Phase 5 (per your explicit instructions)

Durable idempotency/dedup, retry scheduling + exponential backoff, dependency-failure
recovery, partial-save recovery, manual review queue + reviewer actions, failure-simulation
admin console, execution-limit configurability.

## 12. Manual Testing Instructions

```bash
# Terminal 1
cd backend && cp .env.example .env && npm install && npm run dev

# Terminal 2
cd frontend && cp .env.example .env && npm install && npm run dev
```

1. Open `http://localhost:5173`, register an admin user via `POST /api/auth/register`
   (no UI for this yet) or use the login page once a user exists.
2. Go to **Workflows → New Workflow**, create one, then **New Draft**.
3. Open the draft, paste the `stages`/`rules`/`inputSchema` from
   `examples/loan-approval-workflow.json` (or write your own), **Validate**, then **Publish**.
4. Go to **Submit Request** — the form is generated from the workflow's `inputSchema`.
   Submit a few different payloads to see APPROVE / REJECT / MANUAL_REVIEW outcomes.
5. Go to **Requests** to see the history list, click into any row for the full execution
   timeline (stage-by-stage events, rule evaluation trace, final decision).
6. To see version binding in action: publish a second, stricter version of the same
   workflow, then look at an execution from before that publish — it still shows the
   original version number and produces the same explanation it always did.

---

**Status**: Phase 4 complete and verified (122/122 backend tests, clean frontend build,
both example workflows passing end-to-end on the generic engine). Stopping here per your
instructions — not starting Phase 5.

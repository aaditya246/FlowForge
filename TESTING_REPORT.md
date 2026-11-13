# FlowForge — Testing & Quality Audit Report

Covers Phase 1 (architecture), Phase 2 (backend/frontend foundation), and Phase 3
(dynamic rule engine + workflow versioning). Performed before starting Phase 4.

## 1. Project Overview

FlowForge is a generic, configuration-driven workflow decision platform. As of Phase 3:
request/rule/workflow **data model** is complete, the **rule engine** and **workflow
versioning** are fully implemented and tested, and the **workflow execution engine**
(actually running a request through stages) is not yet built — that's Phase 4.

## 2. Testing Environment

- Node.js v20.15.0, npm 10.7.0, Windows 11
- MongoDB: in-memory (`mongodb-memory-server`) for automated tests; verified separately
  against a long-lived in-memory instance for the "application restart" scenario
- Backend: Jest 30 + Supertest 7
- Frontend: Vite 5.4.21 production build + `vite preview`
- No browser automation tool is available in this environment (see §6 for how frontend
  UI interaction was verified instead of clicked through)

## 3. Features Tested

Authentication, RBAC (all 4 roles), MongoDB models/indexes/validation, workflow CRUD,
workflow versioning (draft/publish/clone/history), rule engine (all operators, logical
composition, priority, conflict resolution), REST API error handling, CORS, frontend
build/routing, and 5 end-to-end scenarios (A–E from the test plan).

## 4. Backend Test Results (automated)

```
Test Suites: 8 passed, 8 total
Tests:       87 passed, 87 total
```

| Suite | Tests | Status |
|---|---|---|
| `health.test.js` | 1 | PASS |
| `auth.test.js` | 5 | PASS |
| `authEdgeCases.test.js` *(new)* | 16 | PASS |
| `dbValidation.test.js` *(new)* | 6 | PASS |
| `ruleEngine.test.js` | 22 | PASS |
| `ruleEngineEdgeCases.test.js` *(new)* | 10 | PASS |
| `workflowConfigValidation.test.js` *(new)* | 13 | PASS |
| `workflowVersioning.test.js` | 14 | PASS |

33 new tests were added during this audit specifically to close gaps called out in the
test plan (JWT edge cases, RBAC for all 4 roles — not just admin/viewer, DB-level
constraint testing, malformed JSON, invalid ObjectIds, workflow config edge cases,
rule engine edge cases). None of the pre-existing tests were weakened or removed.

## 5. Frontend Test Results

| Check | Result |
|---|---|
| `npm run build` | PASS — 2182 modules, no errors, 352KB JS / 13KB CSS (gzip 112KB/3KB) |
| `vite preview` serves `index.html` | PASS (200) |
| Built JS asset loads without 404 | PASS (200) |
| Dev server boots and serves content | PASS (verified HTTP 200 on `/`) |
| Frontend ↔ backend CORS (real `fetch` from `localhost:5173` origin) | PASS — preflight `204`, actual request `201`, correct `Access-Control-Allow-Origin` |
| `console.log` / debug leftovers in source | None found |
| Hardcoded URLs outside env config | None (one documented fallback default in `apiClient.js`, overridden by `VITE_API_BASE_URL`) |

**Limitation — manual UI click-through**: this environment has no browser-automation
tool attached, so I could not literally click through Login → Workflows → Draft Editor →
Publish in a real browser and watch the console. What I verified instead: (1) the
production build compiles every page/component with zero errors — this catches the vast
majority of import/syntax/JSX bugs; (2) every page's API calls were exercised directly
against a live backend (see §7, Scenario A/B/C/D) proving the service layer and response
shapes the components consume are correct; (3) static review of each page's state/error
handling (see §9). Genuine browser-rendering bugs (CSS layout issues, a click handler
wired to the wrong element, etc.) are **NOT TESTED** and should be manually verified by
you running `npm run dev` in both folders and clicking through.

## 6. API Integration Test Results

All endpoints were exercised with real HTTP requests (Supertest + raw `fetch` against a
live listening server), not just service-level calls. Verified for each: status code,
response envelope shape (`{success, data}` / `{success:false, error:{code,message,details}}`),
and the resulting DB state.

| Area | Verified |
|---|---|
| Auth | register, login, `/me`, missing fields, invalid email, wrong password, duplicate email, malformed/expired/forged JWT |
| Workflows | create, list, get, update, archive, duplicate slug (409), invalid slug format (400), invalid ObjectId (400), nonexistent ObjectId (404) |
| Versions | create draft, clone, update draft, validate, publish, reject invalid publish, block edits to published version, version history ordering, non-numeric/negative version param handling |
| Rules | ad-hoc test-evaluate, per-version test, invalid rule structure (400) |
| RBAC | all 4 roles tested against write endpoints (not just admin vs. viewer) |
| Malformed input | malformed JSON body, missing Content-Type edge cases |

## 7. Security Review — Rule Engine

Read the complete rule engine source (`backend/src/services/ruleEngine/*`) line by line:

- **No `eval()` or `new Function()`** anywhere in the codebase (`grep -rn "eval(\|new Function("` → 0 matches).
- Operators are a fixed whitelist object (`operators.js`); unknown operator strings throw
  a caught, structured error — never reach a code path that could execute them.
- Field access (`fieldAccess.js`) is pure `.`-path property traversal, not `JSONPath`/`vm`/etc.
- Added and verified a prototype-pollution regression test: a condition referencing
  `__proto__.polluted` safely reads `undefined` (read-only traversal) and does not touch
  `Object.prototype`.
- Condition structure is validated recursively (`conditionValidator.js`) **before**
  evaluation; malformed structures throw a caught `RuleEngineError` with details rather
  than crashing or silently misbehaving.
- Explainability requirement verified: every evaluation result includes per-rule
  `passed`/`action`/`trace` (and nested `trace.children` for AND/OR/NOT), plus
  `passedRuleIds`, `failedRuleIds`, and `skippedRules` (both short-circuited and disabled
  rules, each with a `reason`).

## 8. End-to-End Scenario Results

| Scenario | Result |
|---|---|
| A — Admin creates and publishes a workflow | **PASS** (full flow executed via live HTTP calls: create → draft → add stages/rules → validate → publish → verify in history) |
| B — Rule evaluation (mandatory + threshold, valid/invalid JSON, trace, outcome) | **PASS** (covered by `ruleEngine.test.js` + `ruleEngineEdgeCases.test.js`; invalid JSON in the frontend editor is caught by a `try/catch` around `JSON.parse` before any API call — verified by code review) |
| C — Version immutability (v1 published, v2 drafted/edited/published, both retained) | **PASS** (`workflowVersioning.test.js`: "a new draft version does not alter the published version" + "version history lists both versions") |
| D — Unauthorized access (viewer blocked from create/edit/publish) | **PASS** (`authEdgeCases.test.js` RBAC suite + `workflowVersioning.test.js` RBAC tests) |
| E — Application restart (create+publish, full process/connection teardown, reconnect, re-login, data intact) | **PASS** — scripted: disconnected Mongoose, cleared the Node `require` cache, reconnected to the same database, logged in again, and confirmed the workflow and its published version were unchanged |

## 9. Bugs Discovered, Root Causes, and Fixes

### Bug 1 — Malformed JSON request body returned `500` instead of `400`
- **Root cause**: `errorHandler.js` had no case for Express/body-parser's
  `entity.parse.failed` error type, so it fell through to the generic `ApiError.internal()`
  500 branch.
- **Fix**: added an explicit `error.type === 'entity.parse.failed'` check mapping to
  `ApiError.badRequest('Malformed JSON in request body')`.
- **Regression test**: `authEdgeCases.test.js` → "returns 400 (not 500) for a malformed
  JSON request body".
- **File**: `backend/src/middleware/errorHandler.js`

### Bug 2 — A forged/invalid `sub` claim in a JWT returned a leaky `400 CastError` instead of `401`
- **Root cause**: `authenticate` middleware called `User.findById(payload.sub)` directly;
  if `sub` wasn't a valid MongoDB ObjectId, Mongoose threw a `CastError` that the generic
  error handler mapped to `400 "Invalid value for _id"` — the wrong status code for an
  auth failure, and it leaked the internal field name.
- **Fix**: wrapped the lookup in `try/catch` and normalized any lookup failure to
  `401 Unauthorized`.
- **Regression test**: `authEdgeCases.test.js` → "rejects a token with a malformed
  ObjectId as 'sub' with 401, not a raw CastError 400".
- **File**: `backend/src/middleware/auth.js`

### Non-bug — unused `uuid` dependency
- Flagged during the dependency audit (`uuid` was installed in Phase 2, never imported —
  Mongo ObjectIds serve as request IDs instead). Removed with `npm uninstall uuid`;
  re-ran the full suite afterward (87/87 still pass) to confirm nothing depended on it.
- **File**: `backend/package.json`

No other functional bugs were found. Every other tested scenario (auth, RBAC, workflow
CRUD, versioning, rule engine, validation, CORS, restart-persistence) passed on first
or second inspection without needing a code change.

## 10. Known Limitations / Not Yet Implemented (unchanged from Phase 3 scope)

These are not bugs — they're Phase 4/5/6 work per the original plan:

- No workflow **execution** engine yet (`services/workflowEngine/{advance,start}` are
  intentional stubs) — so there is no way yet to submit a business request and have it
  flow through stages to a final decision.
- Idempotency, retry, external-dependency simulation, and recovery services are
  interface-only stubs (by design — see Phase 1 architecture doc).
- No manual review queue, request submission UI, audit timeline UI, or analytics
  dashboard with real data yet.
- `recharts` is installed (per the required tech stack) but not yet used — reserved for
  the Phase 6 analytics dashboard.
- Dev-dependency `npm audit` reports 20 moderate/low advisories, all transitive through
  `mongodb-memory-server`'s `jest`/`glob`/`deepmerge` chain (test tooling only, not
  shipped to production). Fixing them requires downgrading Jest to 25.x, which is a much
  larger breaking change than is warranted for a dev-only advisory — left as-is and
  documented here rather than risking the test suite.

## 11. Remaining Gaps Against the Original Hackathon Problem Statement

| Requirement | Status |
|---|---|
| Input intake + schema validation | PARTIAL — schema is stored/editable per workflow version; intake-time enforcement lands with Phase 4's execution engine |
| Rules evaluation (mandatory/threshold/branching/multi-step) | DONE |
| Workflow execution (success/reject/retry/manual-review stages) | NOT YET — Phase 4 |
| State management + full history | NOT YET — models exist (`WorkflowExecution`, `ExecutionEvent`), engine doesn't write to them yet |
| Auditability / explainable decisions | PARTIAL — rule-level explainability is DONE; execution-level audit trail is Phase 4/5 |
| Failure handling (dependency, partial-save, duplicate, retry, idempotency) | NOT YET — Phase 5 |
| Configurability without code rewrites | DONE (demonstrated: workflows/rules are pure JSON, validated, versioned) |

## Status Legend Summary (per feature)

- **PASS**: Auth, RBAC (all 4 roles), workflow CRUD, workflow versioning, rule engine
  (all operators + logical composition + conflict resolution), config validation, CORS,
  restart persistence, frontend build.
- **PARTIAL**: Input schema enforcement, audit trail (rule-level done, execution-level pending).
- **NOT TESTED**: Live browser click-through (no browser tool in this environment — see §5).
- **FAIL**: None remaining — both bugs found were fixed and verified (§9).

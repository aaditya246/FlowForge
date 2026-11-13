<h4>🌐 Live Preview</h4>

<a href="https://flow-forge-beryl-six.vercel.app/">
    <img src="https://img.shields.io/badge/-User%20Panel-success?style=for-the-badge">
</a>



# FlowForge — Configurable Workflow Decision Platform

FlowForge lets you define a business process (a loan approval, an insurance claim, an
onboarding flow — anything) as **configuration**, not code. You describe the stages, the
rules, and the transitions between them once; after that, every request runs through the
same generic engine, gets evaluated against your rules, and ends up approved, rejected, or
routed to a human reviewer — with a complete, explainable trail of exactly why.

## The problem it solves

Most businesses run the same shape of process over and over — an application gets
submitted, checked against a set of rules, and approved, rejected, or sent to a human —
whether that's a loan, an insurance claim, a vendor onboarding, or a document review. The
usual way teams build this is one-off: each process gets its own hardcoded logic, its own
ad-hoc error handling, and its own audit trail (or none at all). That makes every rule
change a code deployment, every new process a rewrite, and every "why was this rejected?"
question a dig through logs.

FlowForge solves this by separating the **engine** (which never changes) from the
**configuration** (which is just data): one generic workflow executor runs any process
you describe in JSON. On top of that, it solves the operational problems that hand-rolled
versions of this usually get wrong or skip entirely:

- **Changing a rule shouldn't mean shipping code.** Rules and workflow stages are
  configuration, versioned and validated before they go live.
- **A request should never be processed twice by accident.** Idempotency keys make
  retried submissions safe.
- **A flaky dependency shouldn't fail the whole request.** Transient failures are retried
  automatically with backoff instead of hard-failing.
- **A crash shouldn't lose or duplicate work.** Interrupted executions are recovered
  safely, picking up where they left off rather than re-running completed steps.
- **"Why did this happen?" should have a real answer.** Every rule evaluation, state
  change, retry, and human decision is recorded, so any outcome is fully explainable
  after the fact — not just logged, but reconstructable.
- **Not every decision should be automatic.** Borderline cases route to a human reviewer
  and the workflow picks back up exactly where it paused once they decide.

## What it does

- **Configurable workflows** — define stages (validate input, evaluate rules, call an
  external check, pause for manual review, finish) and how they connect, as JSON. No code
  changes needed to add a new workflow or tweak a rule.
- **Rule engine** — mandatory-field checks, thresholds, `AND`/`OR`/`NOT` logic, priority
  ordering, and conflict resolution, evaluated safely (no `eval`, no arbitrary code).
- **Versioning** — publish a workflow version and it's locked in; editing always creates a
  new draft. Requests that already ran keep using the exact version they started with,
  even after you publish changes.
- **Manual review** — a rule can route a request to a human. The workflow pauses, waits
  for a reviewer's decision, and resumes automatically once approved or rejected.
- **Reliability** — duplicate request protection (idempotency keys), automatic retries
  with backoff for transient failures, and recovery of work interrupted by a crash or
  restart — all without losing data or double-running anything.
- **Full audit trail** — every rule evaluation, state change, retry, and decision is
  recorded. You can always answer "why did this request get this outcome?"
- **Role-based access** — admin (full control), reviewer (handles manual reviews),
  operator (submits requests), viewer (read-only).

## Tech stack

| Layer | Technology |
|---|---|
| Backend | Node.js, Express, MongoDB (Mongoose), JWT auth, Joi validation |
| Frontend | React, Vite, Tailwind CSS, Axios, React Router |
| Testing | Jest, Supertest, mongodb-memory-server |

## Running it locally

**Prerequisites**: Node.js 18+, and either a local MongoDB (`mongodb://127.0.0.1:27017`)
or a connection string to MongoDB Atlas.

```bash
# Backend
cd backend
cp .env.example .env      # set MONGO_URI / JWT_SECRET as needed
npm install
npm run dev                 # http://localhost:5000

# Frontend (separate terminal)
cd frontend
cp .env.example .env
npm install
npm run dev                 # http://localhost:5173
```

Run the backend test suite (spins up an in-memory MongoDB automatically):

```bash
cd backend && npm test
```

## How to use it

### 1. Create an account

No seed users exist by default. Register through the frontend's **Create account** link
on the login page, or directly via the API:

```bash
curl -X POST http://localhost:5000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"name":"Admin","email":"admin@example.com","password":"password123","role":"admin"}'
```

Public self-registration always gets the `operator` role. To get an `admin`, `reviewer`,
or `viewer` account, pass `"role"` explicitly when calling `/api/auth/register` yourself
(there's no self-service way to grant yourself admin from the UI — that's intentional).

### 2. Build and publish a workflow (admin)

1. Go to **Workflows → New Workflow**, give it a name and slug.
2. Open it and click **New Draft**.
3. Define the input schema, stages, and rules as JSON in the draft editor. See
   `examples/loan-approval-workflow.json` and `examples/insurance-claim-workflow.json`
   for two complete, working examples — one approves/rejects/escalates a loan
   application, the other does the same for an insurance claim, both on the identical
   engine.
4. Click **Validate** to check the configuration, then **Publish**.

### 3. Submit a request (operator or admin)

Go to **Submit Request**, pick a published workflow — the form is generated automatically
from that workflow's input schema — fill it in, and submit. The request runs through the
engine immediately and you'll see the outcome: approved, rejected, or sent to manual
review.

### 4. Review the result

- **Requests** lists every submission with its current status.
- Click into any one for the full **execution timeline**: every stage it passed through,
  every rule that was evaluated and why it passed or failed, and the final decision.
- **Manual Review** (currently API-only — see below) shows requests paused for a human
  decision.

### 5. Reliability tools (admin / reviewer)

- **Failure Simulation** — force a workflow's external-dependency stage to succeed, fail,
  time out, or respond slowly, then submit a test request to see retries and recovery in
  action.
- **Reliability** — a dashboard of pending/exhausted retries and executions that needed
  recovery after an interruption.

## Project structure

```
backend/src/
  config/        env + DB connection
  controllers/   thin HTTP handlers
  models/        Mongoose schemas
  routes/        Express routers
  middleware/    auth, validation, error handling
  validators/    Joi schemas
  services/      all business logic — rule engine, workflow engine, idempotency,
                 retry, recovery, review, notifications, audit
  jobs/          background scheduler (retry/recovery/escalation polling)
  tests/
frontend/src/
  pages/         one file per screen
  layouts/       dashboard shell (sidebar + topbar)
  components/    shared UI pieces
  context/       auth state
  services/      API client wrappers
```

## API reference

All endpoints require `Authorization: Bearer <token>` except `/auth/register` and
`/auth/login`.

### Auth
| Method | Path | Description |
|---|---|---|
| POST | `/api/auth/register` | Create an account |
| POST | `/api/auth/login` | Get a JWT |
| GET | `/api/auth/me` | Current user |

### Workflows & versions (admin writes, any role reads)
| Method | Path | Description |
|---|---|---|
| POST / GET | `/api/workflows` | Create / list workflows |
| GET / PATCH | `/api/workflows/:id` | Get / update a workflow |
| POST | `/api/workflows/:id/archive` | Archive a workflow |
| POST / GET | `/api/workflows/:id/versions` | Create a draft / list version history |
| GET / PATCH | `/api/workflows/:id/versions/:version` | Get / edit a draft version |
| POST | `/api/workflows/:id/versions/:version/validate` | Check config without publishing |
| POST | `/api/workflows/:id/versions/:version/publish` | Lock in a version |
| POST | `/api/workflows/:id/versions/:version/rules/test` | Dry-run the saved rules |

### Rules
| Method | Path | Description |
|---|---|---|
| POST | `/api/rules/test-evaluate` | Evaluate an ad-hoc rule set against sample input |

### Requests & executions
| Method | Path | Description |
|---|---|---|
| POST | `/api/requests` | Submit a request (optional `Idempotency-Key` header) |
| GET | `/api/requests` / `/api/requests/:id` | List / get requests |
| GET | `/api/executions` / `/api/executions/:id` | List / get executions |
| GET | `/api/executions/:id/history` | Full event + audit timeline |
| GET | `/api/executions/:id/explanation` | Rule traces and decision reasoning |
| GET | `/api/executions/:id/retries` | Retry attempts for this execution |

### Reliability (admin / reviewer)
| Method | Path | Description |
|---|---|---|
| GET | `/api/retries`, `/api/recovery` | Retry and recovery activity |
| POST | `/api/recovery/:id/retry` | Manually trigger recovery (admin only) |
| GET / PUT | `/api/dependencies/simulations` | View / set simulated failure behavior (PUT is admin only) |
| GET | `/api/dependencies/logs` | Simulated dependency call history |
| GET | `/api/reliability/summary` | Dashboard counts |

### Manual review (API-ready; no frontend queue page yet)
| Method | Path | Description |
|---|---|---|
| GET | `/api/reviews`, `/api/reviews/stats` | Review queue and counts |
| POST | `/api/reviews/:id/assign` | Assign a reviewer (admin) |
| POST | `/api/reviews/:id/approve`, `/reject` | Reviewer decision — resumes the workflow |
| POST | `/api/reviews/:id/request-information` | Ask the submitter for more info |
| POST | `/api/reviews/:id/escalate` | Escalate to an admin |

### Notifications
| Method | Path | Description |
|---|---|---|
| GET | `/api/notifications`, `/unread-count` | List / count your notifications |
| PATCH | `/api/notifications/:id/read`, `/read-all` | Mark as read |

### Idempotency

Send an `Idempotency-Key` header on `POST /api/requests` to make retrying a submission
safe:

| Scenario | Response |
|---|---|
| New key | `201`, real result |
| Same key, same payload | `200`, `replayed: true`, the original result |
| Same key, different payload | `409 Conflict` |
| Same key, still processing | `202`, `{inProgress: true}` |
| No key | Processed fresh every time — no dedup |

## Rule configuration format

```json
{ "field": "creditScore", "operator": ">=", "value": 750 }
```

Compose with `{ "and": [...] }`, `{ "or": [...] }`, `{ "not": {...} }` (nest freely).
Operators: `==`, `!=`, `>`, `<`, `>=`, `<=`, `IN`, `NOT_IN`, `CONTAINS`, `EXISTS`,
`NOT_EXISTS`, `MANDATORY`.

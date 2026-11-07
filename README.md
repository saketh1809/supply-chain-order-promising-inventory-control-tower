# Supply Chain Order Promising & Inventory Control Tower

An enterprise planning application for supply-chain planners and customer-support teams. It promises
shipment dates from real stock and inbound supply, allocates inventory to orders with a deterministic
engine, flags fulfillment risk, and lets planners take corrective action. Every change is audited.
AI helps planners understand and propose changes, but never applies them without approval.

- **Backend:** NestJS (TypeScript), Prisma, MySQL 8, REST under `/api/v1`, Swagger at `/api/docs`
- **Frontend:** React, TypeScript, Redux Toolkit + RTK Query, Tailwind CSS, shadcn-style components, Recharts,
  TanStack Table, React Router, React Hook Form + Zod, Framer Motion, Lucide icons
- **Tests:** Jest unit tests (allocation engine, ATP, exception rules) and Supertest integration tests against a real MySQL database
- **Deploy:** Docker images for frontend (nginx) and backend, plus MySQL, orchestrated with Docker Compose

> The allocation algorithm is specified in [`docs/ALLOCATION_ALGORITHM.md`](docs/ALLOCATION_ALGORITHM.md).

---

## 1. Features

### Core (implemented and verified)

| Area | What works |
|---|---|
| **Overview (control tower)** | Six KPI cards with comparison and trend, plus sections A–E: fulfillment (on-time vs late, orders by status), inventory health by location and low-stock SKUs, incoming supply timeline with delayed and canceled receipts, fulfillment risk, and recent activity. All values come from the API. Loading, empty and error states. |
| **Orders** | Create (draft or confirmed) with an expected-fulfillment **preview** that persists nothing. Server-side filters (status, priority, exception type, requested and promised ranges, warehouse), search, and sorts (risk, promised date, oldest, priority, backorder, requested). Edit with optimistic versioning; add/remove/change lines; change priority and warehouse preferences. Confirm, cancel (releases allocations), ship (full or split). |
| **Order detail** | Header, per-line allocation and backorder, planner actions per line, fulfillment summary (earliest possible shipment, expected completion, backorder units), supply dependencies with delay badges, shipments, **interactive timeline** filterable by SKU and warehouse with ATP impact on each event, and a "Why this promise?" explanation. |
| **Inventory** | SKU × location matrix with on-hand, allocated, available, incoming, ATP and status. Filters and sorts. **Adjustment workflow:** choose SKU and warehouse, enter a signed quantity and a mandatory reason, **preview** before/after (on-hand, available, ATP, affected lines), then confirm. Detail page with a 30-day ATP projection, allocations, incoming receipts and movement ledger. |
| **Supply & receipts** | Receipts with PLANNED / IN_TRANSIT / RECEIVED / CANCELED. Create, edit (quantity, arrival with mandatory reason, warehouse), mark in transit, **receive** (idempotent), **cancel** (with reason). Detail page shows dependent order allocations and the audit history. |
| **Locations** | Create, edit, activate/deactivate. Detail: inventory by SKU, incoming receipts, active orders assigned. |
| **Products (SKUs)** | Create, edit (SKU code is immutable), search, filters and sorts, **safe delete** (refused when any history references the SKU). Detail: stock by location, ATP chart, related orders, movement history. |
| **Exceptions queue** | Five exception types with severity and recommended action. Search, filters, risk-first sort, Open/Resolved tabs. Detail drawer with current allocations, history, and planner actions: **expedite receipt** (with impact preview), **reassign location** (compares every warehouse), **override promise** (requires justification; calculated date preserved), **split shipment**, and **resolve** (with a note). |
| **Planner actions** | Each is previewed where it changes a promise, requires a reason, recalculates allocations, and writes an audit record. |
| **Audit & activity** | Append-only audit log with filters for user, entity type, action and date range, and CSV export of the current page. Database triggers block UPDATE and DELETE. |
| **Settings** | Workspace (company, timezone, default safety stock), acting-user switcher, users, recalculation of all allocations, API docs link. |
| **Global UI** | Collapsible sidebar with live exception count, workspace selector, user menu, global search (⌘K), notifications, date, light/dark/system theme, breadcrumbs, toasts, responsive layout. |

### AI features (implemented; see §8)

| Feature | Status |
|---|---|
| **A. Planner note → structured proposal** (parse, identify entities with confidence, validate, simulate, before/after, approve or reject) | Implemented. The rule-based parser runs with no key. An LLM parser is wired behind the same validation. |
| **B. Customer communication draft** (generate, edit, regenerate, copy, save as sent-message record) | Implemented. Email is **not** sent, per the specification. |
| **C. Exception summary** (what happened, current plan, next best actions, impact) | Implemented. Advisory only. |
| **D. Shortage insights (stretch)** | Implemented as **deterministic** analysis: projected shortage date, cover days, pull-forward receipt, rebalancing and reprioritization suggestions. The narrative is not LLM-generated. |
| AI interaction log | Implemented. Input, structured output, provider and model, and every decision are stored. |

### Stretch / not implemented

- Real authentication and role-based access control (the demo uses an `x-user-id` header; see §20).
- Multi-tenant workspaces. The "workspace" selector shows the single workspace.
- Email delivery of customer updates.
- A live-LLM end-to-end test. The OpenAI-compatible and Anthropic provider code is present but was **not exercised against a real API** (no key was available). See §19.

---

## 2. Architecture

```mermaid
flowchart LR
  subgraph Browser
    UI[React SPA<br/>RTK Query · Redux · Recharts]
  end
  subgraph Docker Compose
    NG[nginx :8080<br/>static SPA + /api proxy]
    API[NestJS API :3000<br/>/api/v1 · Swagger]
    subgraph Backend modules
      ENG[Allocation engine<br/>pure function]
      SVC[Allocation service<br/>locks · diff · exceptions]
      AIS[AI service<br/>validator · simulator · approvals]
      LLM[LLM providers<br/>openai · anthropic · heuristic]
    end
    DB[(MySQL 8<br/>Prisma · triggers · CHECK)]
  end
  UI -->|HTTP JSON| NG --> API
  API --> SVC --> ENG
  API --> AIS --> SVC
  AIS --> LLM
  SVC --> DB
  API --> DB
```

**Key design rules**

1. **Business logic lives in services, not components.** The allocation engine is a pure function
   (`allocation-engine.ts`) with no database or clock access. The React layer only renders and calls the API.
2. **One write path per fact.** On-hand changes go through `InventoryLedgerService` (a locked, append-only row).
   Allocation changes go through `AllocationService.recalculate` (diff-based). Derived fields are never edited by hand.
3. **Every mutation is transactional and audited.** Audit rows are written in the same transaction as the change.
4. **The AI never writes.** It produces text or JSON. The output is validated against the database, simulated,
   and only applied by the same services a human planner calls.

### Backend module layout

```
backend/src
  allocation/   engine (pure), ATP math, exception rules, allocation service, query service, controller
  receipts/     inbound receipts: create, edit, in transit, receive (idempotent), cancel
  inventory/    ledger service (single writer of on-hand), inventory matrix, adjustment preview/post
  orders/       orders: create, preview, edit, confirm, cancel, ship, timeline, communications
  planner/      expedite receipt, reassign location, override promise, split shipment
  exceptions/   reconciliation (create, refresh, auto-resolve), list/detail, manual resolution
  ai/           LLM providers, planner-note parser and validator, AI service (approval workflow)
  skus/ locations/ customers/ dashboard/ settings/ audit/
  common/       Prisma wrapper (transactions and retries), actor guard, envelope and error filters, sequences
```

### Frontend layout

```
frontend/src
  app/          store, RTK Query API (every endpoint), typed hooks
  features/ui/  UI slice: theme, sidebar, acting user, toasts (persisted preferences only)
  lib/          DTO types, Zod schemas, URL-synced filter hook, formatters
  components/   ui (buttons, dialogs, tables, states), layout (shell, sidebar, topbar), common, planner, orders,
                inventory, supply, master forms
  pages/        overview, orders, inventory, supply, locations, products, exceptions, ai, audit, settings
```

---

## 3. Tech stack

| Layer | Technology |
|---|---|
| UI | React 18, TypeScript 5, Vite 5, Tailwind CSS 3, shadcn-style components (hand-written to shadcn conventions; the shadcn CLI was not used), Lucide React, Recharts 2, TanStack Table 8, React Router 6, React Hook Form 7 + Zod 3, Framer Motion 11 |
| State | Redux Toolkit 2 (UI slice) and RTK Query (server state, cache tags) |
| API | NestJS 10, class-validator / class-transformer, `@nestjs/swagger`, global exception filter with a stable error envelope |
| Data | MySQL 8.0, Prisma 5.22, migrations (including triggers and CHECK constraints) |
| AI | Provider interface with OpenAI-compatible, Anthropic and deterministic heuristic implementations; Zod validation of model output |
| Tests | Jest 29 (unit), Supertest + Jest (integration), Playwright (browser flows, script in `scripts/`) |
| Ops | Docker, Docker Compose, nginx 1.27, `tini` as PID 1 in the backend image |

---

## 4. Folder structure

```
supply-chain-control-tower/
├── README.md
├── docker-compose.yml        # db + backend + frontend
├── .env.example              # copy to .env
├── docs/
│   └── ALLOCATION_ALGORITHM.md   # normative algorithm, invariants and assumptions
├── scripts/
│   ├── demo-scenarios.mjs    # runs the five specification scenarios against the API and asserts outcomes
│   └── browser-flows.mjs     # end-to-end UI flows in headless Chromium
├── backend/
│   ├── Dockerfile · docker-entrypoint.sh · .env.example
│   ├── prisma/
│   │   ├── schema.prisma
│   │   ├── migrations/       # init · exception ranks · integrity constraints and immutability triggers
│   │   └── seed.ts           # demo data through the real services
│   ├── src/                  # see §2
│   └── test/integration/     # Supertest suites + DB global setup
└── frontend/
    ├── Dockerfile · nginx.conf
    └── src/                  # see §2
```

---

## 5. Local setup (without Docker)

Prerequisites: Node.js 22, npm 10, MySQL 8.0.

**1. Database.** Create a database and a user. Prisma needs the shadow-database privilege for development migrations.

```bash
mysql -uroot -p <<'SQL'
CREATE DATABASE IF NOT EXISTS sct CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
CREATE DATABASE IF NOT EXISTS sct_test CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
CREATE USER IF NOT EXISTS 'sct'@'%' IDENTIFIED BY 'sct_password';
GRANT ALL PRIVILEGES ON *.* TO 'sct'@'%';
FLUSH PRIVILEGES;
SQL
```

**2. Backend.**

```bash
cd backend
cp .env.example .env            # adjust DATABASE_URL if needed
npm ci
npx prisma migrate deploy       # apply migrations
npm run seed                    # demo data (no-op when data exists)
npm run start:dev               # http://localhost:3000/api/v1 · docs at /api/docs
```

**3. Frontend.**

```bash
cd frontend
npm ci
npm run dev                     # http://localhost:5173 (proxies /api to :3000)
```

Open http://localhost:5173. The acting user defaults to **Dana Ortiz (planner)**. Switch it from the sidebar.

---

## 6. Environment variables

| Variable | Where | Default | Purpose |
|---|---|---|---|
| `DATABASE_URL` | backend | `mysql://sct:sct_password@localhost:3306/sct` | Prisma connection string |
| `TEST_DATABASE_URL` | backend tests | `…/sct_test` | Dedicated database for integration tests (it is truncated) |
| `PORT` | backend | `3000` | HTTP port |
| `CORS_ORIGIN` | backend | `http://localhost:5173` | Allowed browser origin |
| `SEED_ON_START` | backend (Docker) | `true` | Seed demo data at container start when the database is empty |
| `LLM_PROVIDER` | backend | `heuristic` | `heuristic` (offline, deterministic), `openai` (any OpenAI-compatible endpoint) or `anthropic` |
| `LLM_API_KEY` | backend | *(empty)* | Provider key. Read only from the environment; never hardcoded. Without it, the provider falls back to `heuristic`. |
| `LLM_MODEL` | backend | `gpt-4.1-mini` / `claude-haiku-5-5` | Model id |
| `LLM_BASE_URL` | backend | `https://api.openai.com/v1` | OpenAI-compatible base URL |
| `MYSQL_ROOT_PASSWORD`, `MYSQL_PASSWORD` | Compose | `root_password`, `sct_password` | Database credentials for the Compose stack |
| `VITE_API_PROXY` | frontend dev | `http://localhost:3000` | Dev-server proxy target |

---

## 7. Docker setup

```bash
cp .env.example .env            # optional: change passwords, LLM settings
docker compose up --build
```

- UI: http://localhost:8080
- API through nginx: http://localhost:8080/api/v1 · Swagger: http://localhost:8080/api/docs
- The backend container applies migrations on start and seeds demo data when `SEED_ON_START=true`.
- Services: `db` (MySQL 8.0 with a health check), `backend` (waits for a healthy database), `frontend` (nginx serving the built SPA and proxying `/api/`).

To rebuild demo data: `docker compose exec backend npx ts-node --transpile-only prisma/seed.ts --reset`.

> **Verification note:** the Compose file validates (`docker compose config`). The three images were **not built in
> the development sandbox** because it has no Docker daemon. The backend was verified as a compiled `dist/main.js`
> with the same entrypoint. Run `docker compose up --build` once to confirm the images on your machine.

---

## 8. Database migrations and seed

- `prisma/migrations/20261106191133_init` creates the schema.
- `…_exception_ranks` adds severity and priority sort ranks to `Exception`.
- `…_integrity_constraints` adds CHECK constraints (`onHand >= 0`, positive quantities) and the immutability triggers
  for `AuditLog` and `InventoryAdjustment`.

Commands: `npx prisma migrate deploy` (production), `npx prisma migrate dev --name <change>` (development).
Seeding: `npm run seed` seeds only an empty database. `npm run seed -- --reset` truncates every application table first.
The seed runs through the **real services** (adjustments, receipts, orders, shipments), so the audit trail and
allocations are genuine.

**Seeded data:** 3 warehouses (NJ, CA, TX), 12 SKUs, 8 customers, 3 users, 6 receipts (one received, one canceled,
one delayed, three open), and 26 orders covering fully and partially allocated, backordered, draft, canceled,
partially shipped and fully shipped cases.

---

## 9. Demo scenarios

Run on a freshly seeded database (`npm run seed -- --reset`). The script asserts business outcomes:

```bash
node scripts/demo-scenarios.mjs     # set API_BASE to point elsewhere
```

| # | Scenario | Seeded state and what to look at |
|---|---|---|
| 1 | **HIGH vs LOW competing for limited stock** | SKU-MON-27 at CA: A111 (HIGH, 12) is fully allocated; A110 (LOW, 15) is short 5 and carries a BACKORDER exception. |
| 2 | **10 requested, 6 available** | A104 (HIGH, 10 keyboards): 6 allocated, 4 backordered. Create PO-41 (4 units, NJ, arriving in 2 days) → allocation completes automatically. Receive PO-41 → on-hand rises once; a second receive is reported `idempotent: true`. |
| 3 | **Delay an inbound receipt** | PO-22 (power adapters, NJ) feeds A101. Change its arrival by 5 days with a reason (Receipts → PO-22 → Change arrival, or `PATCH /receipts/:id`). A101's promise moves; DELAYED_INBOUND and PROMISE_DATE_AT_RISK appear. |
| 4 | **Cancel an inbound receipt** | PO-27 (SSD, CA, 50 units) feeds A108 (HIGH, 40). Cancel it with a reason. A108 is backordered 30; CANCELED_INBOUND_DEPENDENCY and HIGH_PRIORITY_INSUFFICIENT_STOCK appear in the queue. |
| 5 | **Cancel an order and free supply** | A126 (LOW, 8 docks) is short 6. Cancel A120 (LOW, 10 docks, reason required). Its released units cover A126 in the same recalculation. |

The seeded `A124` is already canceled, and `A125` is fully shipped, so the cancellation history is visible too.

---

## 10. API documentation

- Interactive OpenAPI (Swagger UI): `http://localhost:3000/api/docs` (or `/api/docs` through nginx). The JSON is at `/api/docs-json`.
- Base path: `/api/v1`. Identify the acting user with the `x-user-id` header (defaults to user 1).
- Responses: `{ "success": true, "data": …, "meta"?: { page, pageSize, total, totalPages } }`.
  Errors: `{ "success": false, "error": { "code": "…", "message": "…", "details"?: … } }`.
  Validation failures return `400 VALIDATION_ERROR` with `details.issues`.
- Action endpoints (confirm, cancel, ship, receive, resolve, approve, previews, recalculation) return `200`;
  creations return `201`.

| Group | Endpoints |
|---|---|
| SKUs | `GET /skus` · `POST /skus` · `GET /skus/:id` · `PATCH /skus/:id` · `DELETE /skus/:id` |
| Locations | `GET /locations` · `POST /locations` · `GET /locations/:id` · `PATCH /locations/:id` |
| Customers | `GET /customers` · `PATCH /customers/:id/preferred-location` |
| Inventory | `GET /inventory` · `GET /inventory/:id` · `POST /inventory/adjustments/preview` · `POST /inventory/adjustments` |
| Receipts | `GET /receipts` · `POST /receipts` · `GET /receipts/:id` · `PATCH /receipts/:id` · `POST /receipts/:id/in-transit` · `POST /receipts/:id/receive` · `POST /receipts/:id/cancel` |
| Orders | `GET /orders` · `POST /orders` · `POST /orders/preview` · `GET /orders/:id` · `PATCH /orders/:id` · `POST /orders/:id/confirm` · `POST /orders/:id/cancel` · `POST /orders/:id/ship` · `GET /orders/:id/timeline` · `GET·POST /orders/:id/communications` |
| Allocation | `POST /allocations/recalculate` · `GET /allocations` · `GET /atp?skuId=&locationId=` |
| Exceptions | `GET /exceptions` · `GET /exceptions/:id` · `POST /exceptions/:id/resolve` |
| Planner | `POST /planner/expedite-receipt(/preview)` · `POST /planner/reassign-location(/preview)` · `POST /planner/override-promise` · `POST /planner/split-shipment` |
| AI | `POST /ai/planner-note` · `POST /ai/planner-note/:id/approve` · `POST /ai/planner-note/:id/reject` · `POST /ai/customer-communication` · `POST /ai/exception-summary` · `GET /ai/shortage-insights` · `GET /ai/interactions` |
| Audit | `GET /audit-logs` |
| Dashboard | `GET /dashboard/summary` · `GET /dashboard/inventory-health` · `GET /dashboard/fulfillment-trends` |
| Settings & search | `GET·PATCH /settings` · `GET /users` · `GET /search?q=` |

---

## 11. ATP calculation

For every SKU and location:

```
ATP = on-hand + eligible inbound − allocated demand
```

- **Eligible inbound** = receipts with status `PLANNED` or `IN_TRANSIT`. Received receipts are already in on-hand; canceled receipts never count.
- **Allocated demand** = `ACTIVE` allocation rows (from both on-hand and inbound sources).
- **Available** (physical view) = on-hand − allocated from on-hand.
- **Time-phased ATP** (`projectAtp`, 30-day horizon): `ATP(d) = on-hand + Σ inbound arriving ≤ d − Σ allocated demand due ≤ d`. A negative value marks a projected shortage on that day.

The inventory and SKU screens display these values, and every order preview and planner preview uses the same engine.

---

## 12. Allocation algorithm (summary)

Full specification: [`docs/ALLOCATION_ALGORITHM.md`](docs/ALLOCATION_ALGORITHM.md).

1. Build a pool of supply sources: on-hand per location (available today) and eligible receipts (available on arrival, or today if overdue).
2. Order demand by **priority → order creation time → order number → line number**.
3. For each line in that order, consume pool entries in order (preferred location first, then earliest availability) until its open quantity is met. The rest is backordered.
4. Promise date: latest allocated availability day for a full allocation; for any backorder, add the SKU lead-time estimate; no lead time means unpromisable.
5. Persist by **diff** (see §14), then reconcile exceptions and order aggregates.

The engine is deterministic: input order does not matter, and repeated runs give identical results (unit-tested).

---

## 13. Tie-breaking rules

When multiple orders compete for the same units:

1. Priority: HIGH, then MED, then LOW.
2. Earlier order creation timestamp.
3. Lexicographic order number (final deterministic tie-breaker).

Within the supply pool: earliest availability, then on-hand before inbound on the same day, then location code, receipt number and source key.

A newer HIGH order can take units from an older LOW order. The LOW line is reduced and the change is audited (`ALLOCATION_RECALCULATED`).

---

## 14. Idempotency implementation

| Operation | Mechanism |
|---|---|
| **Receiving a receipt** | 1) Under a SKU lock, a conditional `UPDATE … WHERE status IN (PLANNED, IN_TRANSIT)` flips the status. Only one caller sees a row count of 1. 2) The inventory posting uses the ledger key `RECEIPT:<id>`, which is `UNIQUE` in MySQL, so a second posting is impossible even if code is bypassed. 3) A repeat call returns the existing receipt with `idempotent: true` and changes nothing. |
| **Recalculation** | Allocations are reconciled by `activeKey` (`lineId|source|location|receipt`) against the desired set. Unchanged rows are left alone, so re-running produces no writes (tested: `changedLines: 0`). |
| **Exceptions** | One OPEN exception per `openKey` (`lineId|type|reference`), enforced by a UNIQUE index. Recalculation updates or auto-resolves; it never duplicates. |
| **Shipments** | Ledger keys `SHIPMENT:<shipmentId>:<shipmentLineId>:<locationId>` are unique. Shipments are immutable records. |
| **Sequence numbers** | `Sequence` rows are incremented under a row lock in the same transaction (ADJ-, SHP-, EXC- numbers). |

---

## 15. Concurrency handling

- **SKU locks:** every mutation that can change allocation first runs `SELECT … FOR UPDATE` on the affected SKU rows, in ascending id order. Concurrent writers for the same SKU are serialized; different SKUs proceed in parallel. There is no deadlock between SKU sets.
- **Isolation:** transactions run at READ COMMITTED, so each statement reads the latest committed data after the locks are held.
- **Optimistic versions:** orders, receipts, SKUs and locations have a `version`. Stale edits get `409 VERSION_CONFLICT`. Order mutations also lock the order row with `FOR UPDATE`.
- **Retries:** deadlocks and write conflicts (`P2034`) are retried up to four times with backoff, then reported as `409 CONCURRENT_UPDATE`.
- **Database backstops:** unique keys (`activeKey`, `openKey`, `referenceKey`, `orderNumber`), `CHECK (onHand >= 0)`, and append-only triggers.
- **Customer creation:** find-or-create uses a single `INSERT … ON DUPLICATE KEY UPDATE`, so simultaneous orders for a new customer cannot collide.
- **AI approvals:** the plan fingerprint (SHA-256 of canonical JSON over the affected lines, receipts, balances and actions) is checked before applying; a changed plan returns `409 PROPOSAL_STALE`.

Tested: 8 parallel order creations for 5 units → exactly 5 allocated; 6 parallel receive calls → exactly one inventory posting; the AI approval after a plan change is refused.

---

## 16. Exception generation logic

Evaluated for every active (confirmed or fulfilling, open-quantity) line after each recalculation. Rules are pure
(`exception-rules.ts`) and unit-tested. Reconciliation then creates, refreshes or auto-resolves (see the algorithm doc §11).

| Type | Raised when | Severity |
|---|---|---|
| `BACKORDER` | Backordered quantity > 0 | HIGH priority → CRITICAL; MED → HIGH; LOW → MEDIUM (+1 if unpromisable) |
| `HIGH_PRIORITY_INSUFFICIENT_STOCK` | HIGH priority and backordered > 0 | CRITICAL |
| `PROMISE_DATE_AT_RISK` | Effective promise after requested date, or no promise | By days late (HIGH priority ≥3 days → CRITICAL) |
| `DELAYED_INBOUND` | Allocation depends on a receipt that moved past its original arrival | ≥5 days → HIGH, else MEDIUM |
| `CANCELED_INBOUND_DEPENDENCY` | A receipt is canceled while lines depend on it (event-driven) | By priority; closed only by a planner |

Auto-resolving types close themselves when their condition clears (`EXCEPTION_AUTO_RESOLVED`). `CANCELED_INBOUND_DEPENDENCY` is closed only manually.

---

## 17. Planner actions

| Action | Preview | What it does | Guard rails |
|---|---|---|---|
| **Expedite receipt** | Yes: impacted lines and promise before/after | Moves the arrival earlier and recalculates | Must move earlier, not before today, reason required |
| **Reassign location** | Yes: every active warehouse compared (on-hand, inbound, allocated, backorder, earliest ship, promise) | Sets the line's preferred warehouse and recalculates | Target must be active |
| **Override promise** | Calculated date shown beside the input | Sets a manual promise; the calculated date is kept | Justification ≥10 characters; flagged as a manual override everywhere |
| **Split shipment** | Ship quantities are capped by what is on hand | Ships part of a line, keeps the remainder allocated or backordered | Only on-hand allocations ship; reason required |

Every planner action writes an audit record with the previous and new values, the user and the reason.

---

## 18. AI features and prompts

All AI calls go through `AiService` and the `LlmProvider` interface. The model output is parsed with Zod. Nothing is written by the model.

**Providers.** `heuristic` (default, no key) uses deterministic rules and exact catalog matching. `openai` calls any OpenAI-compatible
`/chat/completions` endpoint with JSON mode. `anthropic` calls the Messages API. If a key is missing, the provider falls back to `heuristic`.
If a live call fails or returns invalid JSON, the rule-based path is used and the response says so (`parserUsed: heuristic-fallback`).

**Planner note prompt (system, abbreviated).** *"You convert a supply-chain planner's note into proposed structured changes. Only use receiptNumber, orderNumber and locationCode values that appear in the provided catalog, copied exactly. Action types: DELAY_RECEIPT, EXPEDITE_RECEIPT, REASSIGN_LOCATION, SPLIT_SHIPMENT. Use deltaDays for relative changes. Do not decide anything yourself: this is a proposal for a human to approve. Respond with JSON: {summary, actions[{type, receiptNumber, orderNumber, locationCode, deltaDays, newArrival, confidence (0–1), evidence}]}."*
The user message contains the note and a catalog of open receipts, active orders and active locations, so identifiers resolve exactly.

**Customer communication prompt.** *"You draft professional customer shipping updates… Use only the facts provided. Never invent dates, quantities or warehouses. Respond with JSON: {subject, body}, under 180 words."* The facts are computed from the database: shippable now, backordered, warehouses, promised date, next update (two days out), open risks and options (partial shipment, alternate warehouse with stock).

**Exception summary prompt.** *"You explain supply-chain fulfillment exceptions to planners. Use only the facts provided. Advisory only; never claim an action has been taken. Respond with JSON: {whatHappened, currentPlan, nextBestActions[{action, impact}], impact}."* Facts include the current allocations and simulated option impacts computed by the engine.

**Heuristic behaviour.** The rule-based parser splits the note into sentences. It matches receipts, orders and locations **only against catalog entries** (exact tokens, then normalized), recognizes delay, expedite, move and partial-shipment language, and carries the most recent order forward for sentences like "The customer wants partial ASAP". The example note produces DELAY_RECEIPT (PO-22, +5 days), REASSIGN_LOCATION (A104 → NJ) and SPLIT_SHIPMENT (A104).

---

## 19. AI approval and audit workflow

```
note ──► parse (LLM or rules) ──► validate against DB rules ──► simulate (same engine, no writes)
                                                    │
                                                    ▼
                     AIInteraction(PROPOSED) + audit AI_SUGGESTION_CREATED   (nothing applied)
                                                    │
                  planner reviews confidence, validation, evidence, before/after
                         │                                   │
              approve (selected valid actions)          reject (reason required)
                         │                                   │
   fingerprint unchanged? ── no ──► STALE + 409          REJECTED + audit
                         │ yes
   apply each action via normal services (audited, recalculated)
                         │
   APPROVED or PARTIALLY_APPLIED + audit AI_PROPOSAL_APPROVED (with per-action results)
```

Every interaction stores its input text, the structured output, provider and model, status, decision and reason.
The AI log is visible under **AI assistant → Interaction log**.

**Limitations.** Approval applies actions one after another, each in its own transaction, so a failure part-way leaves the
earlier actions applied. The result is reported as `PARTIALLY_APPLIED` with per-action status. Making the whole approval atomic is a future improvement.

**Live LLM status.** The OpenAI-compatible and Anthropic clients follow their documented request shapes and are guarded by
timeouts and fallbacks. They were **not run against a live endpoint**, because no key was available. Only the heuristic path is tested.

---

## 20. Testing

```bash
cd backend
npm test                                  # unit tests (34): engine, ATP, exception rules
export TEST_DATABASE_URL="mysql://sct:sct_password@localhost:3306/sct_test"
npm run test:integration                  # 42 integration tests against MySQL (runs migrations, truncates test DB)
```

**Unit (Jest):** ATP, priority order, creation-time and order-number tie-breaks, no double allocation, partial allocation (6 of 10),
backorder and promise calculation, lead-time estimates, overdue receipts, preferred location behaviour, location selection,
determinism under reordering, conservation invariants, exception rules, time-phased ATP.

**Integration (Supertest):**
- *Receipts:* receive once (+1 ledger row); repeated and concurrent receives (+once); received receipts leave ATP; cancel removes supply and opens dependency exceptions; receiving a canceled-then-received receipt is refused; delay with reason moves promises; reason is enforced.
- *Orders:* draft vs confirm; partial 6-of-10 then completion; priority competition; 8 concurrent creations for 5 units; edit without duplicate allocations; stale-version rejection; cancel releases supply to a waiting order; split-shipment guards; repeatable recalculation; duplicate-number and unknown-SKU errors; preview persists nothing.
- *Exceptions, planner, AI:* generate and resolve an exception (with history); expedite preview then apply; expedite guard; reassign preview and apply; override requires justification and keeps the calculated date; split shipment; AI proposal (validated, not persisted), approval applies and audits, stale approval refused, rejection final, unknown identifiers rejected; customer draft saved as sent; exception summary is advisory.
- *Inventory and audit:* adjustment preview is read-only; reason is mandatory; negative stock refused; duplicate SKU and in-use delete refused; **audit and ledger rows cannot be updated or deleted** (database triggers).

**Other checks run during development:**
- `scripts/demo-scenarios.mjs`: all five scenarios pass on a fresh seed.
- `scripts/browser-flows.mjs`: headless Chromium runs of order creation with preview, AI customer update, exception explanation and resolution, AI proposal approval, inventory adjustment, and expedite preview. No console or page errors.
- Route smoke test: all 12 pages render with no console errors.
- The compiled backend serves the API and 49 OpenAPI paths.

---

## 21. Design trade-offs

- **Full recalculation per SKU, with diff persistence.** Simpler to reason about than incremental updates, and always consistent with the data. The cost grows with SKU size, which is fine for hundreds of open lines per SKU. Partitioning by SKU is the next step.
- **Preferred location is a hard priority.** This follows the specification literally ("allocate from the preferred location if specified"). It can make a promise later than an alternative would, so the reassign preview exists to make that visible. A softer rule ("prefer only when it is no later") is a one-line change, but it would contradict the written spec.
- **Day granularity.** Promises are calendar dates. Hour-level cut-offs and carrier calendars are not modelled.
- **Backorder promises use the SKU lead time** as a planning estimate, not a supplier commitment.
- **Order-level and line-level denormalization.** `Order.promisedShipDate`, `riskLevel`, `backorderedQty` and rank columns are derived and refreshed by the engine, so list pages can filter and sort in SQL without joins.
- **Append-only audit and ledger enforced by triggers**, not only by application code. This blocks even direct database edits by a privileged user who is not also dropping triggers.
- **Heuristic AI first.** It runs offline, is deterministic and fully testable, and exposes the same proposal and approval flow an LLM would use. The LLM is an improvement, not a dependency.
- **Inventory matrix pagination is in memory.** The SKU × location matrix is small, so the inventory endpoint computes the full matrix and pages it. Orders, receipts, exceptions, SKUs, locations and audit logs paginate in SQL.
- **The Overview "previous period" comparison** is reconstructed from immutable timestamps (order confirm/ship/cancel times, ledger rows, receipt times). Metrics without a history (orders at risk, backorder units) show no comparison rather than a fabricated one.
- **Demo identity, not authentication.** A header keeps every action attributable without building sign-in. This is not safe for production (see §22).

---

## 22. Future improvements

1. **Authentication and authorization:** OIDC sign-in, roles (planner, support, admin) enforced in guards, and per-action permissions (for example, override promise requires a planner role).
2. **Atomic AI approvals** in one transaction, with a compensating audit trail for partial failures.
3. **Multi-workspace (tenant) isolation** by adding `workspaceId` to every aggregate and to the unique keys.
4. **Partitioned, incremental recalculation** for very large SKU sets, and a background job queue for long recalculations.
5. **Live LLM validation:** contract tests against recorded provider responses, and an evaluation set of planner notes with expected proposals.
6. **Email / messaging integration** for customer updates, with templating and opt-out.
7. **Supplier integration:** EDI or API feeds for receipts and ASN updates, replacing manual delays.
8. **Forecast-driven shortage insights** using demand history instead of open orders only.
9. **Observability:** OpenTelemetry tracing across the allocation path, metrics for recalculation time and queue depth.
10. **Frontend:** component tests (Vitest and Testing Library), visual regression, and i18n.

---

## Verification status

| Check | Result |
|---|---|
| Backend type-check (`tsc --noEmit`) | Passes |
| Backend unit tests (`npm test`) | 34 / 34 pass |
| Backend integration tests (`npm run test:integration`, MySQL 8.0.46) | 42 / 42 pass |
| Demo scenarios (`scripts/demo-scenarios.mjs`) | All checks pass on a fresh seed |
| Frontend type-check and production build | Pass (initial bundle 134 KB gzipped; routes code-split) |
| Browser smoke test (12 routes) and flows (6) | Pass, zero console errors |
| Docker images built and run | **Not run** in this environment (no Docker daemon). `docker compose config` validates. |
| Live LLM provider calls | **Not run** (no API key). Heuristic provider only. |

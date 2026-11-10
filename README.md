# Supply Chain Order Promising & Inventory Control Tower

A web application for supply-chain planners and customer-support teams. It tells you when an order can really ship, shows where stock is, tracks what is on its way from suppliers, and flags orders that are in trouble so a planner can fix them. Every change is recorded.

**Live demo:** https://supply-chain-order-promising-inventory-bsvh.onrender.com
The demo runs on a free plan, so it goes to sleep when nobody uses it. The first page can take about a minute to show data. Wait and refresh once if you see "The API is not responding".

**Contents**
1. [What the application does](#1-what-the-application-does)
2. [Setup](#2-setup)
3. [Architecture overview](#3-architecture-overview)
4. [Database schema and migrations](#4-database-schema-and-migrations)
5. [Allocation, ATP and promise rules](#5-allocation-atp-and-promise-rules)
6. [AI features: prompts, safety and audit](#6-ai-features-prompts-safety-and-audit)
7. [Trade-offs and next steps](#7-trade-offs-and-next-steps)

---

## 1. What the application does

It answers one question for every customer order: **"When can we actually ship this, and is that date safe?"**

To do that it keeps track of three things:

- **Stock you have** in each warehouse (on-hand).
- **Stock that is coming** from suppliers (inbound receipts).
- **Demand from customers** (orders).

A calculation engine matches demand to supply. It decides which units go to which order and works out a promised ship date. Whenever something changes (a delivery slips, someone adjusts stock, an order is edited), it recalculates everything that is affected. If a promise is late or stock is short, the app raises an **exception** so a planner can deal with it.

### Core concepts

| Term | Meaning |
|---|---|
| **SKU** | A product you sell, for example `SKU-KB-MECH` (a mechanical keyboard). |
| **Location** | A warehouse (NJ, CA, TX). Stock is held per SKU per location. |
| **On-hand** | Units physically in a warehouse right now. |
| **Inbound receipt** | A purchase order on its way, such as `PO-22`. It adds stock when it arrives. Statuses: Planned, In transit, Received, Canceled. |
| **Order** | A customer request made of one or more lines (a SKU and a quantity). |
| **Allocation** | A reservation: "these 6 units, from this source, belong to this order line." |
| **Backorder** | Units that were requested but that no known supply can cover yet. |
| **ATP (Available-to-Promise)** | What you can still promise to new orders: on-hand + eligible inbound − already allocated. |
| **Lead time** | How many days a SKU takes to replenish. It is used to estimate a date for units that have no supply yet. |
| **Safety stock** | A minimum level for a SKU. When ATP is at or below it, the SKU is flagged "Low stock". |

### The Orders screen, column by column

| Column | What it means |
|---|---|
| **Order** | The unique order number, such as A104. |
| **Customer** | Who ordered. A customer is created automatically the first time an order uses the name. |
| **Priority** | High, Medium or Low. It decides who gets scarce stock first. |
| **Created** | When the order was entered. It is a tie-breaker when allocating. |
| **Requested** | The ship date the customer asked for. It can be empty. |
| **Promised** | The date the system calculates it can ship. It turns red when it is later than the requested date. |
| **Status** | The order's life stage (see below). |
| **Allocation** | How much of the order is covered by stock (see below). |
| **Risk** | Overall health: On track, At risk or Critical. |
| **Backordered** | Units with no supply. Red when above 0. |
| **Confirm / Open** | Confirm turns a Draft into a real order. Open shows the details. |

**Worked example: order A104.** It is a High-priority order from Stark Industries for 10 keyboards, requested for Nov 14. Only 6 keyboards exist, so **6 are allocated and 4 are backordered**. The 4 missing units have no supply, so the system estimates a date from the keyboard's 25-day lead time: today plus 25 days. If today is Nov 9, that gives **Dec 4**. Dec 4 is later than Nov 14, so the promise shows in red, and because it is a High-priority order with a shortage, the risk is **Critical**. The "20 days late" label on the order page is the gap between the promised date and the requested date. It is not a comparison with today.

### Statuses

**Order status**

| Status | Meaning |
|---|---|
| Draft | Saved, but not active. It **does not reserve stock**. |
| Confirmed | Active. It reserves stock, so other orders cannot take those units. |
| Fulfilling | Partly shipped. |
| Shipped | Fully shipped. |
| Canceled | Closed. Its reserved units go back to the pool for other orders. |

**Allocation status**

| Status | Meaning |
|---|---|
| Fully allocated | Every unit is covered by stock or by an inbound receipt. |
| Partially allocated | Some units are covered and some are backordered. |
| Backordered | No units are covered. |
| Unallocated | Draft orders. Nothing is reserved. |

**Risk**

| Risk | Meaning |
|---|---|
| On track | No open problems. |
| At risk | There is an open exception, such as a late promise or a backorder. |
| Critical | An open exception is Critical, for example a High-priority order with a shortage. |

Example: order A116 is **At risk** even though it is fully allocated, because part of its stock comes from a delayed delivery, so its promise (Nov 13) is later than the requested date (Nov 11).

### The other screens

**Overview (control tower).** Six cards show the state of the business:

| Card | Meaning |
|---|---|
| Total active orders | Confirmed or fulfilling orders. |
| Orders at risk | Orders with an open exception. |
| Available inventory | On-hand minus what is already reserved. |
| Backordered units | Units with no committed supply. |
| Incoming receipts | Open supplier deliveries. |
| On-time promise rate | Share of shipped units that left on or before their promise, over the last 30 days. |

Below the cards are charts for shipping performance, stock by warehouse, upcoming arrivals, orders that need attention, and recent activity. All of it comes from the database.

**Inventory.** One row per SKU and warehouse:

| Column | Meaning |
|---|---|
| On hand | Physical units. |
| Allocated | Units reserved from on-hand stock. |
| Available | On-hand minus allocated. |
| Incoming | Units on open receipts. |
| ATP | On-hand plus incoming minus all allocations. A negative number means a projected shortage. |
| Status | Healthy, Low stock, Shortage, Incoming only, or Out of stock. |

You can **adjust inventory** from here: pick a SKU and warehouse, enter an increase or decrease, give a reason (required), look at the preview, then confirm. The app never overwrites old numbers. Each adjustment is a new line in a ledger, so you can always see how stock got to its current value.

**Supply & Receipts.** The On-hand tab edits stock. The Receipts tab manages supplier deliveries:

- **Receive** books the units into stock. This can only happen once per receipt. Repeating it changes nothing.
- **Change arrival** moves the expected date. A reason is required. A later date delays the orders that depend on it.
- **Cancel** removes the supply. Orders that relied on it lose those units and get a "Canceled inbound dependency" exception.

**Locations.** Warehouses, with their stock, incoming receipts and the active orders assigned to them. You can also set a preferred warehouse per customer in Settings.

**Products (SKUs).** The catalog: code, name, unit of measure, lead time and safety stock. A SKU can only be deleted when nothing refers to it. If it has stock history, receipts or orders, the delete is refused.

**Exceptions queue.** The planner's to-do list, sorted by risk:

| Type | Raised when |
|---|---|
| Backorder | Units have no supply. |
| High-priority insufficient stock | A High-priority line is short. |
| Promise date at risk | The promise is later than the requested date. |
| Delayed inbound | A receipt that an order depends on slipped. |
| Canceled inbound dependency | A receipt that an order depended on was canceled. |

Open an exception to see its history and what is allocated. From there a planner can:

- **Expedite** a receipt (move the arrival earlier; the preview shows which orders improve).
- **Reassign** a line to another warehouse (it compares every warehouse side by side).
- **Override** the promised date (a justification is required, and the calculated date is kept next to it).
- **Split** a shipment (ship what is on hand now, keep the rest open).
- **Resolve** it with a note.

Most exceptions close by themselves once the cause goes away.

**Activity & Audit Logs.** A permanent record of every change: who did it, what changed, the old and new values, the reason, and when. Records cannot be edited or deleted. You can filter by user, type of record, action and dates.

**AI Assistant.** Covered in [section 6](#6-ai-features-prompts-safety-and-audit).

**Settings.** Company name, default safety stock, which user you are acting as, customer preferred warehouses, and a button that recalculates all allocations.

### What happens when you act

| You do this | The system does this |
|---|---|
| Confirm an order | Reserves stock and calculates promise dates. |
| Edit an order | Recalculates without counting the demand twice. |
| Cancel an order | Releases its units. Orders that were waiting get them. |
| Receive a receipt | Adds the stock once and stops counting it as "incoming". |
| Delay a receipt | Moves the promises that depend on it later and raises exceptions. |
| Cancel a receipt | Removes the supply and raises dependency exceptions. |
| Ship | Reduces stock and records a shipment. Only units that are on hand can ship. |
| Adjust inventory | Adds a ledger entry and recalculates ATP. |

---

## 2. Setup

### Option A: use the live demo on Render

Open https://supply-chain-order-promising-inventory-bsvh.onrender.com

**It can take about a minute for data to appear the first time.** The free Render plan puts the app to sleep after roughly 15 minutes without visitors, and it needs time to wake up. If you see "The API is not responding", wait a moment and click Refresh.

How the demo is put together, if you want to host your own copy:

| Part | Where it runs | Settings |
|---|---|---|
| Frontend | Render **Static Site** | Root directory `frontend`, build command `npm ci && npm run build`, publish directory `dist`, environment variable `NODE_VERSION=22` |
| Backend | Render **Web Service** (Docker) | Root directory `backend`, Dockerfile `./Dockerfile` |
| Database | An external MySQL 8 (Render has no MySQL). The demo uses Aiven. | Connection string goes in `DATABASE_URL` |

### Option B: run it on your own computer

You need **Node.js 20 or 22** and **MySQL 8.0**. MariaDB is not the same thing. This project was built and tested on MySQL 8 only.

**1. Create the database and a user.** In a MySQL shell as the admin user:

```sql
CREATE DATABASE IF NOT EXISTS sct CHARACTER SET utf8mb4;
CREATE DATABASE IF NOT EXISTS sct_test CHARACTER SET utf8mb4;
CREATE USER IF NOT EXISTS 'sct'@'%' IDENTIFIED BY 'sct_password';
CREATE USER IF NOT EXISTS 'sct'@'localhost' IDENTIFIED BY 'sct_password';
GRANT ALL PRIVILEGES ON *.* TO 'sct'@'%';
GRANT ALL PRIVILEGES ON *.* TO 'sct'@'localhost';
FLUSH PRIVILEGES;
```

The file `backend/prisma/setup-mysql.sql` contains the same statements.

**2. Start the backend.**

```
cd backend
copy .env.example .env        (macOS/Linux: cp .env.example .env)
npm ci
npx prisma migrate deploy
npm run seed
npm run start:dev
```

In `backend/.env`, check `DATABASE_URL`. If MySQL listens on a different port (for example 3307 because something else uses 3306), change it, and use `127.0.0.1` instead of `localhost`:

```
DATABASE_URL="mysql://sct:sct_password@127.0.0.1:3306/sct"
```

When it works, the terminal prints `Connected to MySQL`. The API is at http://localhost:3000/api/v1 and the API documentation (Swagger) is at http://localhost:3000/api/docs.

**3. Start the frontend** in a second terminal.

```
cd frontend
npm ci
npm run dev
```

Open http://localhost:5173. You are acting as **Dana Ortiz (planner)** by default. You can switch user from the menu at the bottom of the sidebar.

**Common problems**

| What you see | Likely cause |
|---|---|
| `P1000 Authentication failed` | The user in `DATABASE_URL` does not exist in MySQL, or the password is wrong. |
| Pages say "The API is not responding" | The backend is not running or crashed. Look at the backend terminal. |
| Pages are empty or the API says "Unknown or missing user" | The seed has not run. Run `npm run seed`. |
| `mysql` is not recognized (Windows) | Use the full path to `mysql.exe`, or run the SQL in MySQL Workbench. |

**Docker (optional).** `docker compose up --build` starts MySQL, the backend and the frontend, and the app opens at http://localhost:8080. The compose file is checked, but the images were not built during development, so treat this route as untested.

---

## 3. Architecture overview

```
 Browser (React app)
        |
        |  /api/v1/...  (JSON over HTTP)
        v
 NestJS API  ----------------------------->  MySQL 8
   |   controllers  (validate input, return JSON)
   |   services     (business rules, one write path per fact)
   |   allocation engine (pure calculation, no database inside)
   |   AI service  (parse, validate, simulate, approve)
```

**Frontend.** A React single-page app written in TypeScript. Redux Toolkit holds small pieces of interface state (theme, sidebar, current user, notifications). Server data comes through RTK Query, which fetches, caches and refreshes it. After any change, all related data is reloaded from the server, so the screen never shows a number the client calculated on its own. Forms use React Hook Form with Zod rules. Charts use Recharts and tables use TanStack Table. Pages load on demand, so the first download stays small.

**Backend.** A NestJS API under `/api/v1`, written in TypeScript. Prisma talks to MySQL. Every successful response looks like `{ "success": true, "data": ..., "meta": ... }` and every error looks like `{ "success": false, "error": { "code": ..., "message": ... } }`. Input is validated before it reaches the business code.

**Folders**

```
backend/src
  allocation/   the calculation engine, ATP maths, exception rules, recalculation service
  receipts/     supplier deliveries: create, edit, in transit, receive, cancel
  inventory/    the stock ledger and the adjustment workflow
  orders/       orders: create, preview, edit, confirm, cancel, ship, timeline
  planner/      expedite, reassign, override promise, split shipment
  exceptions/   creating, updating and closing exceptions
  ai/           AI providers, note parser, validator, approval workflow
  skus/ locations/ customers/ dashboard/ settings/ audit/
  common/       database wrapper, error format, current-user check

frontend/src
  app/          store and every API call
  components/   buttons, dialogs, tables, layout, planner dialogs
  pages/        one folder per screen
  lib/          types, form rules, helpers
```

**Rules the code follows**

1. **Business logic stays out of the screens.** The React code only shows data and calls the API.
2. **One write path per fact.** Stock only changes through the ledger service. Allocations only change through the recalculation service. Derived numbers (promise dates, backorders, risk) are never edited by hand.
3. **Every change happens in one database transaction**, together with its audit record. If any part fails, nothing is saved.
4. **The calculation engine has no database inside it.** It receives plain data and returns a result. That makes it easy to test, and it lets the app run "what if" previews with the exact same code as the real thing.

**Who is the user?** There is no sign-in. The browser sends an `x-user-id` header and the API checks that this user exists, so every audit entry names a person. This is fine for a demo and **not safe for production**.

---

## 4. Database schema and migrations

### Tables

| Table | What it stores |
|---|---|
| `User` | The people who act in the app (name, email, role). |
| `Sku` | Products: unique code, name, unit, lead time in days, safety stock. |
| `Location` | Warehouses: unique code, name, timezone, active flag. |
| `Customer` | Customer name (unique) and an optional preferred warehouse. |
| `Order` | Order number (unique), customer, priority, status, requested date, and calculated fields: promised date, backordered units, risk, allocation status. |
| `OrderLine` | One SKU and quantity per line, how much has shipped, the calculated allocation and promise for that line, and the optional manual promise override. |
| `InventoryBalance` | Current on-hand units for one SKU in one warehouse (unique per pair). |
| `InventoryAdjustment` | The **ledger**: one row for every change to on-hand (opening balance, manual adjustment, receipt, shipment), with the old and new quantity, who, and why. |
| `InboundReceipt` | Supplier deliveries: number (unique), SKU, destination, quantity, status, expected and original arrival date. |
| `Allocation` | A reservation of units for an order line from one source (on-hand at a warehouse, or a receipt). Released allocations are kept as history. |
| `Shipment`, `ShipmentLine` | What actually shipped, from where, and whether it was on time. |
| `Exception` | Open and closed problems, with type, severity, affected units and a recommended action. |
| `AuditLog` | The permanent record of every change. |
| `AIInteraction` | Every AI request and its result and decision. |
| `CustomerCommunication` | Customer messages saved as sent. |
| `AppSetting`, `Sequence` | Workspace settings and counters for numbers like `ADJ-000012`. |

Quantities are whole numbers. Business dates (requested, promised, arrival) are plain calendar dates. Timestamps are stored in UTC.

### Protection built into the database

The most important rules are enforced by MySQL itself, not just by application code:

- **Unique values:** order numbers, SKU codes, location codes, receipt numbers.
- **No negative stock:** a CHECK constraint on `onHand`. Quantities on receipts, order lines and allocations must also be above zero.
- **No duplicate active allocation:** each active allocation has a key (line, source, warehouse, receipt) that must be unique. When an allocation is released, the key is cleared.
- **One open exception per problem:** the same idea, with a unique key per line and exception type.
- **A receipt can be received only once:** the ledger row for a receipt has the unique key `RECEIPT:<id>`.
- **Audit log and stock ledger cannot be changed:** triggers reject any UPDATE or DELETE on those two tables.
- **Version numbers** on orders, receipts, SKUs and locations catch edits made on out-of-date data.

### Migrations

Schema changes are managed by Prisma migrations, kept in `backend/prisma/migrations`. There are three:

1. `init`: creates all tables, keys and indexes.
2. `exception_ranks`: adds numeric rank columns so exceptions and orders can be sorted by risk or priority in SQL.
3. `integrity_constraints`: adds the CHECK constraints and the triggers above. Prisma cannot describe these, so this migration is written by hand in SQL.

On a real server, run `npx prisma migrate deploy`. It applies anything not yet applied and never changes existing data. For development, `npx prisma migrate dev --name <change>` creates a new migration from schema edits (it needs permission to create a temporary database). The Docker and Render setups run `migrate deploy` automatically each time the backend starts.

The **seed** (`npm run seed`) fills an empty database with demo data: 3 warehouses, 12 SKUs, 8 customers, 3 users, 6 receipts and 26 orders. It does this by calling the real services (adjust stock, create receipts, create and confirm orders, ship), so the allocations, exceptions and audit entries are real, not copied rows. `npm run seed -- --reset` empties the tables first.

---

## 5. Allocation, ATP and promise rules

The full written specification is in [`docs/ALLOCATION_ALGORITHM.md`](docs/ALLOCATION_ALGORITHM.md). This is the short version.

### ATP

For every SKU and warehouse:

```
ATP = on-hand + eligible inbound − allocated demand
```

- **Eligible inbound** means receipts that are Planned or In transit. A received receipt is already counted in on-hand, so it is not counted twice. A canceled receipt never counts.
- **Allocated demand** is everything currently reserved, whether from stock or from inbound.
- A negative ATP means demand is bigger than supply.

The Inventory and SKU pages also show a 30-day projection of ATP, which adds each delivery on its arrival day and subtracts each reservation on its ship day.

### Which orders get stock first (tie-breakers)

When orders want the same units, they are served in this order:

1. **Priority:** High, then Medium, then Low.
2. **Earlier creation time.**
3. **Order number**, compared as text. This final rule means two orders never tie.
4. Line number, then line id (only matters inside one order).

The supply is used in this order: earliest availability first, stock already on hand before deliveries on the same day, then warehouse code, receipt number and an internal key.

So a new High-priority order can take units from an older Low-priority order. The Low order's allocation shrinks and the change is written to the audit log.

### How each line is filled

For each order line, in the order above:

- If a **preferred warehouse** is set (on the line, the order, or the customer, in that order of strength), that warehouse's supply is used first. Then the rest comes from other warehouses, earliest first.
- The line takes units until its open quantity is covered. Units no supply can cover are **backordered**.
- The line may be filled from several sources, for example 3 units on hand in CA plus 5 units from a delivery.

Only **Confirmed** and **Fulfilling** orders take part. Drafts never reserve stock.

### Promise dates

| Situation | Promised date |
|---|---|
| Fully covered | The day the last unit becomes available. |
| Partly covered, rest backordered | The later of that day and (today + the SKU's lead time). |
| Nothing covered | Today + the SKU's lead time. |
| Backordered and the SKU has no lead time | No date can be given. This is treated as "at risk". |

The **order's** promised date is the latest promise among its open lines. A planner can override a line's promise. The override is stored separately and the calculated date is kept, so you can always see both. The override is what the rest of the app uses.

### Idempotency (doing something twice must not do it twice)

- **Receiving a receipt:** the first call changes the status from open to received inside a locked transaction, and only the call that changes it adds stock. The ledger key `RECEIPT:<id>` is unique, so even a bug could not add the stock twice. A repeated call returns "already received" and changes nothing.
- **Recalculating:** the engine compares what it wants with what is saved and writes only the differences. Running it again on the same data writes nothing. This is tested.
- **Exceptions:** one open exception per problem, enforced by a unique key. Recalculation updates or closes them, but never duplicates them.
- **Shipments and ledger rows** have unique references as well.

### Concurrency (many people at once)

- Before changing anything for a SKU, the code locks that SKU's row in the database. Two people changing the same SKU wait for each other. Different SKUs do not block each other.
- SKUs are always locked in ascending order, so two requests cannot lock each other out.
- The recalculation always reads fresh data from the database after the lock, never numbers sent from the browser.
- Orders carry a version number. If you edit an order that someone else changed, you get a "reload and try again" error.
- A deadlock is retried a few times before an error is shown.

Tested: eight orders created at the same time for five units allocate exactly five units, and six simultaneous "receive" calls add stock once.

### Edge cases and how they behave

| Case | What happens |
|---|---|
| Two orders want the last units | The higher priority wins. At equal priority, the older order wins. At equal age, the lower order number wins. Units are never given to both. |
| 10 requested, 6 available | 6 allocated, 4 backordered, promise uses the lead-time estimate. |
| More units arrive later | A new or edited receipt triggers a recalculation, and the backorder fills on its own. |
| A delivery is delayed | Dependent promises move later. A "Delayed inbound" exception is raised, and a "Promise at risk" one if the requested date is now missed. |
| A delivery is canceled | The units leave ATP. Every line that used them gets a "Canceled inbound dependency" exception, then the lines are recalculated (re-covered from other stock or backordered). A received receipt cannot be canceled. |
| An order is canceled | Its allocations are released and waiting orders get the units in the same recalculation. An order that has shipped something cannot be canceled. |
| A delivery is overdue | It is treated as available today, never in the past. |
| Rapid edits to one order | Edits are serialized by the SKU lock and checked with the version number, so allocation is never counted twice. |
| Running recalculation again | Nothing changes. |
| Shipping | Only units that are on hand and allocated to the line can ship. Units that depend on a delivery that has not arrived cannot. |
| Stock adjusted below what is reserved | On-hand cannot go below zero. If reserved units no longer fit, the recalculation reassigns them and may create backorders. |

---

## 6. AI features: prompts, safety and audit

By default, the AI features work **without any outside service**. They use fixed rules and exact matching against your real data. You can switch to a language model by setting `LLM_PROVIDER` and `LLM_API_KEY`, but that path has not been tested against a live service (no key was available during development).

### What it does

**1. Planner note (AI Assistant page).** You type supplier news or a customer request, for example: *"Vendor confirmed PO-22 slips by 5 days. Can we move order A104 to NJ warehouse? The customer wants partial ASAP."* The app finds the receipts, orders and warehouses you named, with a confidence score for each, and proposes actions: delay a receipt, expedite a receipt, reassign a warehouse, or ship what is on hand now. It then checks each proposal against the business rules and shows a before-and-after preview. You approve or reject.

This is for **changes**, not questions. A note like "what is the status of A104?" produces "no change could be identified". Use the order page for status.

**2. Customer update (order page, "Generate customer update").** Writes a message from the live plan: what ships now, from which warehouse, what is backordered, the planned date, risks, options, and when the next update will come. You can edit it, regenerate it, copy it, and save it as a sent message. No email is sent.

**3. Exception explanation (exceptions drawer, "Explain").** Gives four parts: what happened, the current plan, the next best actions, and the impact of each. It is advice only. The impact figures come from running the allocation engine on the alternatives.

**4. Shortage insights (stretch).** Lists SKUs heading for a shortage, with the date, the days of cover, and ideas (pull a delivery forward, move stock between warehouses, protect High-priority orders). This one is plain calculation, not a language model.

### Prompts

When a language model is used, it receives only facts taken from the database, never free access to it.

- **Planner note:** *"You convert a supply-chain planner's note into proposed structured changes. Only use receiptNumber, orderNumber and locationCode values that appear in the provided catalog, copied exactly. Action types: DELAY_RECEIPT, EXPEDITE_RECEIPT, REASSIGN_LOCATION, SPLIT_SHIPMENT. Use deltaDays for relative changes. Do not decide anything yourself: this is a proposal for a human to approve."* It must answer with JSON: a summary plus a list of actions, each with a type, the identifiers, a day count or date, a confidence from 0 to 1, and the quote from the note that supports it. The message also includes a catalog of the open receipts, active orders and active warehouses.
- **Customer update:** *"You draft professional customer shipping updates for a supply-chain planning team. Use only the facts provided. Never invent dates, quantities or warehouses."* It answers with a subject and a body, under 180 words.
- **Exception explanation:** *"You explain supply-chain fulfillment exceptions to planners. Use only the facts provided. Advisory only; never claim an action has been taken."* It answers with the four parts above.

Whatever comes back is checked against a strict format. If the answer is unusable, the app falls back to the fixed rules and says so.

### Safety design

- **The AI never writes to the database.** It returns text or JSON. Only a person's approval triggers changes, and those changes go through the same code a planner's click would.
- **Names must exist.** Receipts, orders and warehouses are looked up by exact identifier. Unknown ones are rejected instead of guessed.
- **Every proposal is checked** against the rules a person would face: a delay must move the date later, an expedite must move it earlier and not before today, a closed receipt cannot be changed, an order must be active, and so on. Invalid proposals are shown as blocked and cannot be approved.
- **Preview before approval.** The impact is calculated by running the real engine on a copy of the data, with nothing saved.
- **Stale proposals are refused.** When you approve, the app compares a fingerprint of the affected data with the one from the proposal. If anything changed in between, the approval is rejected and you re-run the note.
- **Customer messages are drafts.** Nothing is sent anywhere.

### Audit approach

Every AI interaction is saved with: who asked, the input text, the structured output, which provider and model produced it, its status (proposed, approved, partly applied, rejected, stale), who decided, when, and the reason. Creating a proposal, approving it, rejecting it and a stale refusal each add an entry to the audit log. The changes an approval makes (for example, moving a receipt date) are logged by the normal services with the reason "AI proposal #n". The **Interaction log** tab lists all of it.

One known limit: approving several actions applies them one after another, each in its own transaction. If the second one fails, the first stays applied, and the result shows as "partially applied" with the status of each action.

---

## 7. Trade-offs and next steps

### Trade-offs

- **Recalculate a whole SKU each time, save only the differences.** This is easy to reason about and always consistent with the data. The cost is that work grows with the number of open lines for a SKU, which is fine for hundreds of lines per SKU, not for millions.
- **A preferred warehouse is used first, even when another warehouse could ship sooner.** This follows the requirement as written ("allocate from the preferred location if specified"). It can make a promise later than necessary. The Reassign preview exists to show that difference. Changing it to "prefer, but only if not later" is a small code change.
- **Days, not hours.** Promises are calendar dates. Cut-off times and carrier calendars are not modelled.
- **Backorder dates are estimates** based on the SKU's lead time. They are not supplier commitments. A SKU without a lead time gets no date.
- **Derived values are stored on orders and lines** (promised date, risk, backorder). This makes list screens fast to filter and sort in SQL, but it means the engine must keep them up to date. It does so on every change.
- **The audit log and stock ledger are protected by database triggers**, not only by code. That blocks edits even from someone with direct database access, unless they remove the triggers first.
- **Rule-based AI first.** It works offline, gives the same answer each time and is easy to test. It does not understand free-form questions.
- **Inventory list paging happens in memory.** The SKU-by-warehouse grid is small, so it is computed in full and then paged. Orders, receipts, exceptions, SKUs, locations and the audit log are paged in SQL.
- **"Compared with last week" on the Overview** is rebuilt from timestamps. Where no history exists (orders at risk, backordered units), the card shows no comparison rather than a made-up one.
- **No real sign-in.** A header names the acting user. Fine for a demo, not for production.
- **Free hosting limits.** The demo sleeps when idle and uses a small free database, so it is slow to start and not meant for real use.

### Next steps if there were more time

1. **Sign-in and roles** (planner, support, admin), with permissions per action, for example only planners may override a promise.
2. **Test with a real language model**, with a set of sample notes and the proposals they should produce.
3. **Supplier connections** (EDI or API feeds) so delivery changes arrive automatically instead of being typed in.
4. **Demand forecasting** for shortage insights, instead of looking only at open orders.


# Allocation Algorithm, ATP and Business Assumptions

This document is the normative specification for the allocation engine
(`backend/src/allocation/allocation-engine.ts`). The engine is a **pure function**: the same
input always produces the same output, independent of the order in which data was loaded.
Unit tests for every rule below live in `allocation-engine.spec.ts` and `exception-rules.spec.ts`.

---

## 1. Definitions

| Term | Meaning |
|---|---|
| **On-hand** | `InventoryBalance.onHand` for a SKU at a location. Physically present stock. |
| **Eligible inbound** | Receipts with status `PLANNED` or `IN_TRANSIT`. `RECEIVED` receipts are already in on-hand; `CANCELED` receipts are never eligible. |
| **Allocated demand** | Sum of `ACTIVE` allocation rows for a SKU/location. |
| **ATP** | `ATP = on-hand + eligible inbound − allocated demand`, per SKU and location. |
| **Available** | `on-hand − allocated from on-hand` (never negative for an on-hand source). |
| **Open quantity** | `requestedQty − shippedQty` for an order line whose order is `CONFIRMED` or `FULFILLING`. |
| **Supply source** | One pool unit: `ON_HAND:<locationId>` or `INBOUND:<receiptId>`, with an *available date*. |
| **Available date** | The earliest day a source's units can ship: `max(asOfDate, arrival day)` for inbound, `asOfDate` for on-hand. A receipt that is overdue is treated as available today. |

Planning uses **calendar days in UTC** (`YYYY-MM-DD`). Timestamps are kept for ordering only.

---

## 2. Demand ordering (tie-breaker)

Demand lines are processed in this total order. Earlier positions consume supply first.

1. **Priority**: `HIGH` → `MED` → `LOW`.
2. **Order creation timestamp**: earlier first.
3. **Order number**: lexicographic (`<` on strings), the final deterministic tie-breaker.
4. **Line number**, then **line id** (only relevant to multi-line orders).

Consequence: a later `HIGH` order can take supply that an earlier `LOW` order already had.
When that happens, the `LOW` line's allocation is reduced and the change is recorded in the audit log.

## 3. Supply ordering

Within the pool, supply is consumed in this order:

1. **Available date**: earliest first.
2. **Kind**: `ON_HAND` before `INBOUND` on the same day.
3. **Location code**, then **receipt number**, then **source key** (total order).

## 4. The algorithm

```
pool      = supplies with quantity > 0, availableDate := max(asOfDate, availableDate), remaining := quantity
sort pool by supply ordering (§3)
demands   = sort by demand ordering (§2)

for each demand d in order:
    need = d.openQty
    candidates =
        if d.preferredLocationId is set:  [pool entries at preferred location, in pool order]
                                          ++ [all other entries, in pool order]
        else:                              pool
    for entry in candidates:
        if need == 0: break
        take = min(need, entry.remaining)
        if take == 0: continue
        entry.remaining -= take ; need -= take
        emit piece(d, entry, take)          # at most one piece per (line, source)
    allocated  = d.openQty − need
    backordered = need
    promise    = see §5
    fulfillmentLocation = see §6
```

Because the pool is shared and consumed in demand order, no unit can be allocated twice
(§8, invariant I1). Quantities are conserved: `allocated + backordered = openQty` for every line
(invariant I2).

## 5. Promised dates

For each line:

| Case | Calculated promise (`calculatedPromisedDate`) |
|---|---|
| Fully allocated | Latest `availableDate` among its pieces (the day the last unit can ship). |
| Partially allocated | `max(latest allocated availableDate, asOfDate + SKU leadTimeDays)`. The backorder is estimated from the replenishment lead time. |
| Fully backordered | `asOfDate + SKU leadTimeDays`. If the SKU has **no lead time**, the promise is **null** ("unpromisable"). |
| Open quantity is 0 | Not applicable (no promise). |

- `earliestShipDate` is the earliest piece `availableDate` (the earliest possible shipment).
- `expectedCompletionDate` is the calculated promise for the **full** open quantity.
- A **manual override** (planner action) is stored separately in `manualPromisedDate`.
  The *effective* promise used everywhere (order header, risk, exceptions) is
  `manualPromisedDate ?? calculatedPromisedDate`. The calculated value is never overwritten.
- An order's promised ship date is the latest effective promise across its open lines, or null if any open line is unpromisable.

## 6. Fulfillment location

The fulfillment location is the location supplying the largest allocated quantity for the line.
Ties go to the earlier available date, then the lower location id. If nothing is allocated, the preferred
location (or null) is shown.

## 7. Preferences

- Effective preference per line: `line.preferredLocationId ?? order.preferredLocationId ?? customer.preferredLocationId`.
- A preference is a **hard priority**: that location's pool entries are consumed first, in pool order,
  before any other location. This is a deliberate trade-off. A preferred location that only receives
  stock later can make a line promise later than an alternative would. The planner can compare both
  choices with the **Reassign location** preview, which runs the same engine per location.

---

## 8. Invariants (enforced by tests and by the database)

| ID | Invariant | Enforced by |
|---|---|---|
| I1 | No unit is allocated to two lines. Allocated per source ≤ source quantity. | Engine (shared pool), unit tests |
| I2 | `allocated + backordered = openQty` per line. | Engine, unit tests |
| I3 | Determinism: input reordering and repeated runs give identical output. | Unit tests (`shuffled`, `repeatable`) |
| I4 | At most one ACTIVE allocation per (line, source, location, receipt). | `Allocation.activeKey` UNIQUE index (NULL once released) |
| I5 | On-hand never negative. | `CHECK (onHand >= 0)` and ledger guard |
| I6 | A receipt's units are added to on-hand exactly once. | Ledger `referenceKey` UNIQUE (`RECEIPT:<id>`) and conditional status flip |
| I7 | Audit and ledger rows are never updated or deleted. | MySQL triggers `audit_log_no_update/delete`, `inventory_adjustment_no_update/delete` |

## 9. Concurrency and recalculation

- Every mutation that can change allocation runs in a database transaction at **READ COMMITTED**.
- Before reading any data, the transaction locks the affected SKU rows with
  `SELECT … FOR UPDATE`, in **ascending id order** (no deadlocks between SKU sets).
- The engine then reads **persisted source records only**: balances, eligible receipts, confirmed order lines.
  Client-supplied numbers are never trusted.
- Allocations are reconciled by **diff**: stale rows are released (kept for history),
  changed quantities are updated in place, new rows are inserted. Running the same recalculation again
  changes nothing (the `recalculate` endpoint reports `changedLines: 0`).
- Order edits are additionally protected by an optimistic `version` check (`409 VERSION_CONFLICT`).
- Deadlock and serialization failures are retried a bounded number of times.

## 10. Lifecycle events and how they recalculate

| Event | Effect on supply / demand | Recalculation |
|---|---|---|
| Inventory adjustment | Changes on-hand (ledger row) | SKU recalculated |
| Receipt created / in transit | Adds eligible inbound | SKU recalculated |
| Receipt received | Inbound becomes on-hand, exactly once | SKU recalculated |
| Receipt arrival changed | Shifts an inbound availability date | SKU recalculated; DELAYED_INBOUND / PROMISE_DATE_AT_RISK raised |
| Receipt canceled | Removes inbound from ATP; dependent lines lose units | CANCELED_INBOUND_DEPENDENCY raised per dependent line, then recalculated |
| Order created (draft) | No demand (drafts do not reserve) | Nothing |
| Order confirmed | Demand becomes active | SKU recalculated |
| Order edited | Demand quantity / preference / priority changes | SKU recalculated (no duplicate demand) |
| Order canceled | Releases all active allocations | SKU recalculated; freed supply goes to other lines |
| Shipment posted | On-hand decreases by shipped units; line open qty decreases | SKU recalculated for the remainder |

## 11. Exception generation (per active line)

| Type | Condition | Severity |
|---|---|---|
| `BACKORDER` | `backorderedQty > 0` | HIGH priority → CRITICAL, MED → HIGH, LOW → MEDIUM; one level higher if unpromisable |
| `HIGH_PRIORITY_INSUFFICIENT_STOCK` | HIGH priority and `backorderedQty > 0` | CRITICAL |
| `PROMISE_DATE_AT_RISK` | Effective promise later than requested date, or no promise at all | Based on days late; HIGH priority ≥3 days → CRITICAL |
| `DELAYED_INBOUND` | An active allocation depends on a receipt whose arrival is later than its original arrival | ≥5 days → HIGH, else MEDIUM |
| `CANCELED_INBOUND_DEPENDENCY` | Raised when a receipt is canceled while lines depend on it | Based on priority; resolved only by a planner |

Exceptions are reconciled, not regenerated: an open exception is updated in place, created when newly
needed, and **auto-resolved** when its condition clears. Each change writes an audit entry (EXCEPTION_CREATED,
EXCEPTION_AUTO_RESOLVED, EXCEPTION_RESOLVED).

## 12. Business assumptions

1. Day granularity. Promises are calendar days; sub-day timing is not modeled.
2. Stock on hand is available to ship on the planning day.
3. The SKU lead time is the replenishment estimate for units with no committed supply.
4. Draft orders do not reserve stock; confirming them does.
5. Shipping consumes on-hand allocations only. Units allocated from an inbound receipt can ship after
   the receipt is received (they then become on-hand allocations).
6. Partial shipments are allowed; the remainder stays allocated or backordered.
7. A received receipt is never counted as future supply; a canceled receipt is never counted at all.
8. Customer and order preferences are soft defaults only in the sense that the planner can always change them;
   they are hard priorities within the engine (see §7).
9. Priority always beats creation time, even when that means a newer high-priority order takes stock from an older low-priority one.

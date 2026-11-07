-- Integrity constraints that the Prisma schema cannot express.

-- 1. Never allow negative on-hand inventory.
ALTER TABLE `InventoryBalance` ADD CONSTRAINT `chk_inventory_onhand_nonnegative` CHECK (`onHand` >= 0);

-- 2. Quantities must be strictly positive where a zero would be meaningless.
ALTER TABLE `OrderLine` ADD CONSTRAINT `chk_orderline_requested_positive` CHECK (`requestedQty` > 0);
ALTER TABLE `InboundReceipt` ADD CONSTRAINT `chk_receipt_quantity_positive` CHECK (`quantity` > 0);
ALTER TABLE `Allocation` ADD CONSTRAINT `chk_allocation_quantity_positive` CHECK (`quantity` > 0);

-- 3. Immutable audit trail: AuditLog rows can never be changed or removed.
CREATE TRIGGER `audit_log_no_update` BEFORE UPDATE ON `AuditLog` FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'AuditLog is immutable: UPDATE is not allowed';
CREATE TRIGGER `audit_log_no_delete` BEFORE DELETE ON `AuditLog` FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'AuditLog is immutable: DELETE is not allowed';

-- 4. Append-only inventory ledger: historical adjustments are never rewritten or removed.
CREATE TRIGGER `inventory_adjustment_no_update` BEFORE UPDATE ON `InventoryAdjustment` FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'InventoryAdjustment is append-only: UPDATE is not allowed';
CREATE TRIGGER `inventory_adjustment_no_delete` BEFORE DELETE ON `InventoryAdjustment` FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'InventoryAdjustment is append-only: DELETE is not allowed';

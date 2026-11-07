-- CreateTable
CREATE TABLE `User` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `email` VARCHAR(255) NOT NULL,
    `name` VARCHAR(120) NOT NULL,
    `role` ENUM('PLANNER', 'SUPPORT', 'ADMIN') NOT NULL DEFAULT 'PLANNER',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `User_email_key`(`email`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Sku` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `skuCode` VARCHAR(64) NOT NULL,
    `name` VARCHAR(255) NOT NULL,
    `unitOfMeasure` VARCHAR(32) NULL,
    `leadTimeDays` INTEGER NULL,
    `safetyStockQty` INTEGER NOT NULL DEFAULT 10,
    `version` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Sku_skuCode_key`(`skuCode`),
    INDEX `Sku_name_idx`(`name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Location` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `locationCode` VARCHAR(32) NOT NULL,
    `name` VARCHAR(255) NOT NULL,
    `timezone` VARCHAR(64) NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `version` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Location_locationCode_key`(`locationCode`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Customer` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(255) NOT NULL,
    `preferredLocationId` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Customer_name_key`(`name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Order` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `orderNumber` VARCHAR(64) NOT NULL,
    `customerId` INTEGER NOT NULL,
    `priority` ENUM('HIGH', 'MED', 'LOW') NOT NULL DEFAULT 'MED',
    `priorityRank` INTEGER NOT NULL DEFAULT 1,
    `status` ENUM('DRAFT', 'CONFIRMED', 'FULFILLING', 'SHIPPED', 'CANCELED') NOT NULL DEFAULT 'DRAFT',
    `allocationStatus` ENUM('UNALLOCATED', 'FULLY_ALLOCATED', 'PARTIALLY_ALLOCATED', 'BACKORDERED', 'SHIPPED', 'NOT_APPLICABLE') NOT NULL DEFAULT 'UNALLOCATED',
    `riskLevel` ENUM('ON_TRACK', 'AT_RISK', 'CRITICAL') NOT NULL DEFAULT 'ON_TRACK',
    `riskRank` INTEGER NOT NULL DEFAULT 2,
    `requestedShipDate` DATE NULL,
    `promisedShipDate` DATE NULL,
    `backorderedQty` INTEGER NOT NULL DEFAULT 0,
    `preferredLocationId` INTEGER NULL,
    `createdById` INTEGER NULL,
    `version` INTEGER NOT NULL DEFAULT 0,
    `confirmedAt` DATETIME(3) NULL,
    `shippedAt` DATETIME(3) NULL,
    `canceledAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Order_orderNumber_key`(`orderNumber`),
    INDEX `Order_status_idx`(`status`),
    INDEX `Order_priorityRank_createdAt_idx`(`priorityRank`, `createdAt`),
    INDEX `Order_riskRank_idx`(`riskRank`),
    INDEX `Order_requestedShipDate_idx`(`requestedShipDate`),
    INDEX `Order_promisedShipDate_idx`(`promisedShipDate`),
    INDEX `Order_createdAt_idx`(`createdAt`),
    INDEX `Order_customerId_idx`(`customerId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `OrderLine` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `orderId` INTEGER NOT NULL,
    `lineNumber` INTEGER NOT NULL,
    `skuId` INTEGER NOT NULL,
    `requestedQty` INTEGER NOT NULL,
    `shippedQty` INTEGER NOT NULL DEFAULT 0,
    `preferredLocationId` INTEGER NULL,
    `allocatedQty` INTEGER NOT NULL DEFAULT 0,
    `backorderedQty` INTEGER NOT NULL DEFAULT 0,
    `allocationStatus` ENUM('UNALLOCATED', 'FULLY_ALLOCATED', 'PARTIALLY_ALLOCATED', 'BACKORDERED', 'SHIPPED', 'NOT_APPLICABLE') NOT NULL DEFAULT 'UNALLOCATED',
    `calculatedPromisedDate` DATE NULL,
    `earliestShipDate` DATE NULL,
    `expectedCompletionDate` DATE NULL,
    `fulfillmentLocationId` INTEGER NULL,
    `manualPromisedDate` DATE NULL,
    `manualPromiseReason` VARCHAR(500) NULL,
    `manualPromiseSetById` INTEGER NULL,
    `manualPromiseSetAt` DATETIME(3) NULL,
    `version` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `canceledAt` DATETIME(3) NULL,

    INDEX `OrderLine_skuId_idx`(`skuId`),
    INDEX `OrderLine_preferredLocationId_idx`(`preferredLocationId`),
    INDEX `OrderLine_fulfillmentLocationId_idx`(`fulfillmentLocationId`),
    UNIQUE INDEX `OrderLine_orderId_lineNumber_key`(`orderId`, `lineNumber`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `InventoryBalance` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `skuId` INTEGER NOT NULL,
    `locationId` INTEGER NOT NULL,
    `onHand` INTEGER NOT NULL DEFAULT 0,
    `version` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `InventoryBalance_locationId_idx`(`locationId`),
    UNIQUE INDEX `InventoryBalance_skuId_locationId_key`(`skuId`, `locationId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `InventoryAdjustment` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `adjustmentNumber` VARCHAR(40) NOT NULL,
    `movementType` ENUM('OPENING_BALANCE', 'MANUAL_ADJUSTMENT', 'RECEIPT_RECEIVED', 'SHIPMENT') NOT NULL,
    `skuId` INTEGER NOT NULL,
    `locationId` INTEGER NOT NULL,
    `quantityDelta` INTEGER NOT NULL,
    `previousOnHand` INTEGER NOT NULL,
    `newOnHand` INTEGER NOT NULL,
    `reason` VARCHAR(500) NOT NULL,
    `referenceKey` VARCHAR(120) NULL,
    `userId` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `InventoryAdjustment_adjustmentNumber_key`(`adjustmentNumber`),
    UNIQUE INDEX `InventoryAdjustment_referenceKey_key`(`referenceKey`),
    INDEX `InventoryAdjustment_skuId_locationId_createdAt_idx`(`skuId`, `locationId`, `createdAt`),
    INDEX `InventoryAdjustment_createdAt_idx`(`createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `InboundReceipt` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `receiptNumber` VARCHAR(64) NOT NULL,
    `skuId` INTEGER NOT NULL,
    `locationId` INTEGER NOT NULL,
    `quantity` INTEGER NOT NULL,
    `status` ENUM('PLANNED', 'IN_TRANSIT', 'RECEIVED', 'CANCELED') NOT NULL DEFAULT 'PLANNED',
    `expectedArrivalTime` DATETIME(3) NOT NULL,
    `originalExpectedArrivalTime` DATETIME(3) NOT NULL,
    `inTransitAt` DATETIME(3) NULL,
    `receivedAt` DATETIME(3) NULL,
    `canceledAt` DATETIME(3) NULL,
    `cancelReason` VARCHAR(500) NULL,
    `version` INTEGER NOT NULL DEFAULT 0,
    `createdById` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `InboundReceipt_receiptNumber_key`(`receiptNumber`),
    INDEX `InboundReceipt_status_expectedArrivalTime_idx`(`status`, `expectedArrivalTime`),
    INDEX `InboundReceipt_skuId_status_idx`(`skuId`, `status`),
    INDEX `InboundReceipt_locationId_idx`(`locationId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Allocation` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `orderLineId` INTEGER NOT NULL,
    `skuId` INTEGER NOT NULL,
    `locationId` INTEGER NOT NULL,
    `sourceType` ENUM('ON_HAND', 'INBOUND') NOT NULL,
    `receiptId` INTEGER NULL,
    `quantity` INTEGER NOT NULL,
    `availableDate` DATE NOT NULL,
    `status` ENUM('ACTIVE', 'RELEASED') NOT NULL DEFAULT 'ACTIVE',
    `activeKey` VARCHAR(160) NULL,
    `releaseReason` VARCHAR(255) NULL,
    `releasedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Allocation_activeKey_key`(`activeKey`),
    INDEX `Allocation_orderLineId_status_idx`(`orderLineId`, `status`),
    INDEX `Allocation_skuId_status_idx`(`skuId`, `status`),
    INDEX `Allocation_receiptId_status_idx`(`receiptId`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Shipment` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `shipmentNumber` VARCHAR(40) NOT NULL,
    `orderId` INTEGER NOT NULL,
    `locationId` INTEGER NOT NULL,
    `shippedAt` DATETIME(3) NOT NULL,
    `isSplit` BOOLEAN NOT NULL DEFAULT false,
    `reason` VARCHAR(500) NULL,
    `createdById` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `Shipment_shipmentNumber_key`(`shipmentNumber`),
    INDEX `Shipment_orderId_idx`(`orderId`),
    INDEX `Shipment_shippedAt_idx`(`shippedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ShipmentLine` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `shipmentId` INTEGER NOT NULL,
    `orderLineId` INTEGER NOT NULL,
    `skuId` INTEGER NOT NULL,
    `quantity` INTEGER NOT NULL,
    `promisedDate` DATE NULL,
    `onTime` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ShipmentLine_orderLineId_idx`(`orderLineId`),
    INDEX `ShipmentLine_createdAt_idx`(`createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Exception` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `exceptionNumber` VARCHAR(20) NOT NULL,
    `type` ENUM('PROMISE_DATE_AT_RISK', 'BACKORDER', 'DELAYED_INBOUND', 'CANCELED_INBOUND_DEPENDENCY', 'HIGH_PRIORITY_INSUFFICIENT_STOCK') NOT NULL,
    `severity` ENUM('CRITICAL', 'HIGH', 'MEDIUM', 'LOW') NOT NULL,
    `status` ENUM('OPEN', 'RESOLVED') NOT NULL DEFAULT 'OPEN',
    `orderId` INTEGER NOT NULL,
    `orderLineId` INTEGER NULL,
    `skuId` INTEGER NOT NULL,
    `locationId` INTEGER NULL,
    `receiptId` INTEGER NULL,
    `priority` ENUM('HIGH', 'MED', 'LOW') NOT NULL,
    `affectedQty` INTEGER NOT NULL DEFAULT 0,
    `currentPromisedDate` DATE NULL,
    `requestedShipDate` DATE NULL,
    `recommendedAction` TEXT NOT NULL,
    `details` JSON NULL,
    `openKey` VARCHAR(160) NULL,
    `resolvedAt` DATETIME(3) NULL,
    `resolvedById` INTEGER NULL,
    `resolutionNote` VARCHAR(500) NULL,
    `resolutionKind` VARCHAR(40) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Exception_exceptionNumber_key`(`exceptionNumber`),
    UNIQUE INDEX `Exception_openKey_key`(`openKey`),
    INDEX `Exception_status_severity_idx`(`status`, `severity`),
    INDEX `Exception_type_status_idx`(`type`, `status`),
    INDEX `Exception_orderId_idx`(`orderId`),
    INDEX `Exception_createdAt_idx`(`createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AuditLog` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `eventId` CHAR(36) NOT NULL,
    `userId` INTEGER NULL,
    `entityType` VARCHAR(40) NOT NULL,
    `entityId` VARCHAR(64) NOT NULL,
    `action` VARCHAR(64) NOT NULL,
    `previousValue` JSON NULL,
    `newValue` JSON NULL,
    `reason` VARCHAR(500) NULL,
    `metadata` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `AuditLog_eventId_key`(`eventId`),
    INDEX `AuditLog_entityType_entityId_idx`(`entityType`, `entityId`),
    INDEX `AuditLog_action_idx`(`action`),
    INDEX `AuditLog_userId_idx`(`userId`),
    INDEX `AuditLog_createdAt_idx`(`createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AIInteraction` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `interactionId` CHAR(36) NOT NULL,
    `type` ENUM('PLANNER_NOTE', 'CUSTOMER_COMMUNICATION', 'EXCEPTION_SUMMARY', 'SHORTAGE_INSIGHTS') NOT NULL,
    `status` ENUM('GENERATED', 'PROPOSED', 'APPROVED', 'PARTIALLY_APPLIED', 'REJECTED', 'STALE', 'FAILED') NOT NULL DEFAULT 'GENERATED',
    `inputText` TEXT NOT NULL,
    `context` JSON NULL,
    `output` JSON NOT NULL,
    `provider` VARCHAR(40) NOT NULL,
    `model` VARCHAR(120) NOT NULL,
    `requestedById` INTEGER NULL,
    `decidedById` INTEGER NULL,
    `decisionReason` VARCHAR(500) NULL,
    `decidedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `AIInteraction_interactionId_key`(`interactionId`),
    INDEX `AIInteraction_type_createdAt_idx`(`type`, `createdAt`),
    INDEX `AIInteraction_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CustomerCommunication` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `orderId` INTEGER NOT NULL,
    `channel` VARCHAR(20) NOT NULL DEFAULT 'EMAIL',
    `subject` VARCHAR(255) NOT NULL,
    `body` TEXT NOT NULL,
    `status` ENUM('DRAFT', 'SENT') NOT NULL DEFAULT 'SENT',
    `aiInteractionId` INTEGER NULL,
    `sentAt` DATETIME(3) NULL,
    `createdById` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `CustomerCommunication_orderId_createdAt_idx`(`orderId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AppSetting` (
    `id` INTEGER NOT NULL DEFAULT 1,
    `companyName` VARCHAR(255) NOT NULL,
    `timezone` VARCHAR(64) NOT NULL,
    `defaultSafetyStock` INTEGER NOT NULL DEFAULT 10,
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Sequence` (
    `name` VARCHAR(40) NOT NULL,
    `value` INTEGER NOT NULL DEFAULT 0,

    PRIMARY KEY (`name`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `Customer` ADD CONSTRAINT `Customer_preferredLocationId_fkey` FOREIGN KEY (`preferredLocationId`) REFERENCES `Location`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Order` ADD CONSTRAINT `Order_customerId_fkey` FOREIGN KEY (`customerId`) REFERENCES `Customer`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Order` ADD CONSTRAINT `Order_preferredLocationId_fkey` FOREIGN KEY (`preferredLocationId`) REFERENCES `Location`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Order` ADD CONSTRAINT `Order_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `OrderLine` ADD CONSTRAINT `OrderLine_orderId_fkey` FOREIGN KEY (`orderId`) REFERENCES `Order`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `OrderLine` ADD CONSTRAINT `OrderLine_skuId_fkey` FOREIGN KEY (`skuId`) REFERENCES `Sku`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `OrderLine` ADD CONSTRAINT `OrderLine_preferredLocationId_fkey` FOREIGN KEY (`preferredLocationId`) REFERENCES `Location`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `OrderLine` ADD CONSTRAINT `OrderLine_fulfillmentLocationId_fkey` FOREIGN KEY (`fulfillmentLocationId`) REFERENCES `Location`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `InventoryBalance` ADD CONSTRAINT `InventoryBalance_skuId_fkey` FOREIGN KEY (`skuId`) REFERENCES `Sku`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `InventoryBalance` ADD CONSTRAINT `InventoryBalance_locationId_fkey` FOREIGN KEY (`locationId`) REFERENCES `Location`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `InventoryAdjustment` ADD CONSTRAINT `InventoryAdjustment_skuId_fkey` FOREIGN KEY (`skuId`) REFERENCES `Sku`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `InventoryAdjustment` ADD CONSTRAINT `InventoryAdjustment_locationId_fkey` FOREIGN KEY (`locationId`) REFERENCES `Location`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `InventoryAdjustment` ADD CONSTRAINT `InventoryAdjustment_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `InboundReceipt` ADD CONSTRAINT `InboundReceipt_skuId_fkey` FOREIGN KEY (`skuId`) REFERENCES `Sku`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `InboundReceipt` ADD CONSTRAINT `InboundReceipt_locationId_fkey` FOREIGN KEY (`locationId`) REFERENCES `Location`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `InboundReceipt` ADD CONSTRAINT `InboundReceipt_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Allocation` ADD CONSTRAINT `Allocation_orderLineId_fkey` FOREIGN KEY (`orderLineId`) REFERENCES `OrderLine`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Allocation` ADD CONSTRAINT `Allocation_skuId_fkey` FOREIGN KEY (`skuId`) REFERENCES `Sku`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Allocation` ADD CONSTRAINT `Allocation_locationId_fkey` FOREIGN KEY (`locationId`) REFERENCES `Location`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Allocation` ADD CONSTRAINT `Allocation_receiptId_fkey` FOREIGN KEY (`receiptId`) REFERENCES `InboundReceipt`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Shipment` ADD CONSTRAINT `Shipment_orderId_fkey` FOREIGN KEY (`orderId`) REFERENCES `Order`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Shipment` ADD CONSTRAINT `Shipment_locationId_fkey` FOREIGN KEY (`locationId`) REFERENCES `Location`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Shipment` ADD CONSTRAINT `Shipment_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ShipmentLine` ADD CONSTRAINT `ShipmentLine_shipmentId_fkey` FOREIGN KEY (`shipmentId`) REFERENCES `Shipment`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ShipmentLine` ADD CONSTRAINT `ShipmentLine_orderLineId_fkey` FOREIGN KEY (`orderLineId`) REFERENCES `OrderLine`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Exception` ADD CONSTRAINT `Exception_orderId_fkey` FOREIGN KEY (`orderId`) REFERENCES `Order`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Exception` ADD CONSTRAINT `Exception_orderLineId_fkey` FOREIGN KEY (`orderLineId`) REFERENCES `OrderLine`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Exception` ADD CONSTRAINT `Exception_skuId_fkey` FOREIGN KEY (`skuId`) REFERENCES `Sku`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Exception` ADD CONSTRAINT `Exception_locationId_fkey` FOREIGN KEY (`locationId`) REFERENCES `Location`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Exception` ADD CONSTRAINT `Exception_receiptId_fkey` FOREIGN KEY (`receiptId`) REFERENCES `InboundReceipt`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Exception` ADD CONSTRAINT `Exception_resolvedById_fkey` FOREIGN KEY (`resolvedById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AuditLog` ADD CONSTRAINT `AuditLog_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AIInteraction` ADD CONSTRAINT `AIInteraction_requestedById_fkey` FOREIGN KEY (`requestedById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AIInteraction` ADD CONSTRAINT `AIInteraction_decidedById_fkey` FOREIGN KEY (`decidedById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CustomerCommunication` ADD CONSTRAINT `CustomerCommunication_orderId_fkey` FOREIGN KEY (`orderId`) REFERENCES `Order`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CustomerCommunication` ADD CONSTRAINT `CustomerCommunication_aiInteractionId_fkey` FOREIGN KEY (`aiInteractionId`) REFERENCES `AIInteraction`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CustomerCommunication` ADD CONSTRAINT `CustomerCommunication_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

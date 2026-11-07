-- DropIndex
DROP INDEX `Exception_status_severity_idx` ON `Exception`;

-- AlterTable
ALTER TABLE `Exception` ADD COLUMN `priorityRank` INTEGER NOT NULL DEFAULT 1,
    ADD COLUMN `severityRank` INTEGER NOT NULL DEFAULT 3;

-- CreateIndex
CREATE INDEX `Exception_status_severityRank_idx` ON `Exception`(`status`, `severityRank`);

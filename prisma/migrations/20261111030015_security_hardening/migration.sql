-- AlterTable
ALTER TABLE `audit_logs` ADD COLUMN `request_id` VARCHAR(64) NULL,
    ADD COLUMN `result` VARCHAR(16) NOT NULL DEFAULT 'SUCCESS',
    ADD COLUMN `source_ip_hash` CHAR(16) NULL;

-- AlterTable
ALTER TABLE `departments` MODIFY `code` VARCHAR(32) NOT NULL;

-- AlterTable
ALTER TABLE `deployments` ADD COLUMN `quarantined_at` DATETIME(3) NULL;

-- AlterTable
ALTER TABLE `sessions` ADD COLUMN `authenticated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3);

-- AlterTable
ALTER TABLE `users` ADD COLUMN `disabled_at` DATETIME(3) NULL,
    ADD COLUMN `membership_source` VARCHAR(16) NULL;

-- AlterTable
ALTER TABLE `websites` ADD COLUMN `suspended_at` DATETIME(3) NULL,
    ADD COLUMN `suspended_reason` VARCHAR(255) NULL;

-- CreateIndex
CREATE INDEX `audit_logs_request_id_idx` ON `audit_logs`(`request_id`);

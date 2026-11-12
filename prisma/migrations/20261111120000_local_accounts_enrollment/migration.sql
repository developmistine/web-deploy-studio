-- Local email/password accounts + admin-managed enrollment (ADR 0002). Replaces OIDC identities.
-- Existing SSO / dev-fixture accounts become REVOKED legacy rows: their history (uploads, audit) is preserved,
-- they can never sign in, and their email stays free for a fresh enrollment by an administrator.

DROP INDEX `users_identity_provider_provider_subject_key` ON `users`;

ALTER TABLE `users`
    ADD COLUMN `email_normalized` VARCHAR(320) NULL,
    ADD COLUMN `active_email` VARCHAR(320) NULL,
    ADD COLUMN `password_hash` VARCHAR(255) NULL,
    ADD COLUMN `status` ENUM('INVITED', 'ACTIVE', 'DISABLED', 'REVOKED') NOT NULL DEFAULT 'INVITED',
    ADD COLUMN `must_change_password` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `password_changed_at` DATETIME(3) NULL,
    ADD COLUMN `password_reset_requested_at` DATETIME(3) NULL,
    ADD COLUMN `revoked_at` DATETIME(3) NULL;

UPDATE `users`
   SET `email` = COALESCE(NULLIF(TRIM(`email`), ''), CONCAT('legacy-', `id`, '@legacy.invalid')),
       `email_normalized` = LOWER(TRIM(`email`)),
       `active_email` = NULL,
       `status` = 'REVOKED',
       `revoked_at` = NOW(3);

ALTER TABLE `users`
    MODIFY `email` VARCHAR(320) NOT NULL,
    MODIFY `email_normalized` VARCHAR(320) NOT NULL,
    DROP COLUMN `identity_provider`,
    DROP COLUMN `provider_subject`,
    DROP COLUMN `membership_source`;

CREATE UNIQUE INDEX `users_active_email_key` ON `users`(`active_email`);
CREATE INDEX `users_email_normalized_idx` ON `users`(`email_normalized`);
CREATE INDEX `users_status_idx` ON `users`(`status`);

-- Every pre-existing session belonged to an SSO/dev identity.
DELETE FROM `sessions`;
ALTER TABLE `sessions` ADD COLUMN `stage` ENUM('FULL', 'PASSWORD_CHANGE') NOT NULL DEFAULT 'FULL';

ALTER TABLE `departments` ADD COLUMN `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3);

DROP TABLE `auth_flows`;

CREATE TABLE `enrollments` (
    `id` CHAR(36) NOT NULL,
    `user_id` CHAR(36) NOT NULL,
    `created_by_user_id` CHAR(36) NULL,
    `status` ENUM('ACTIVE', 'REVOKED') NOT NULL DEFAULT 'ACTIVE',
    `activation_state` ENUM('PENDING_SETUP', 'ACTIVATED') NOT NULL DEFAULT 'PENDING_SETUP',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `revoked_at` DATETIME(3) NULL,
    `revoked_by_user_id` CHAR(36) NULL,
    UNIQUE INDEX `enrollments_user_id_key`(`user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

INSERT INTO `enrollments` (`id`, `user_id`, `status`, `activation_state`, `created_at`, `updated_at`, `revoked_at`)
    SELECT UUID(), `id`, 'REVOKED', 'ACTIVATED', `created_at`, NOW(3), NOW(3) FROM `users`;

CREATE TABLE `password_links` (
    `id` CHAR(64) NOT NULL,
    `user_id` CHAR(36) NOT NULL,
    `purpose` ENUM('SETUP', 'RESET') NOT NULL,
    `created_by_user_id` CHAR(36) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `expires_at` DATETIME(3) NOT NULL,
    `used_at` DATETIME(3) NULL,
    INDEX `password_links_user_id_idx`(`user_id`),
    INDEX `password_links_expires_at_idx`(`expires_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `enrollments` ADD CONSTRAINT `enrollments_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `enrollments` ADD CONSTRAINT `enrollments_created_by_user_id_fkey` FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `enrollments` ADD CONSTRAINT `enrollments_revoked_by_user_id_fkey` FOREIGN KEY (`revoked_by_user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `password_links` ADD CONSTRAINT `password_links_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `password_links` ADD CONSTRAINT `password_links_created_by_user_id_fkey` FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

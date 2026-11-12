-- CreateTable
CREATE TABLE `departments` (
    `id` CHAR(36) NOT NULL,
    `code` VARCHAR(16) NOT NULL,
    `name` VARCHAR(100) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `departments_code_key`(`code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `users` (
    `id` CHAR(36) NOT NULL,
    `identity_provider` VARCHAR(255) NOT NULL,
    `provider_subject` VARCHAR(255) NOT NULL,
    `email` VARCHAR(320) NULL,
    `display_name` VARCHAR(200) NOT NULL,
    `role` ENUM('ADMIN', 'USER') NOT NULL,
    `department_id` CHAR(36) NULL,
    `last_login_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `users_department_id_idx`(`department_id`),
    UNIQUE INDEX `users_identity_provider_provider_subject_key`(`identity_provider`, `provider_subject`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `websites` (
    `id` CHAR(36) NOT NULL,
    `department_id` CHAR(36) NOT NULL,
    `site_name` VARCHAR(48) NOT NULL,
    `hostname` VARCHAR(253) NOT NULL,
    `active_deployment_id` CHAR(36) NULL,
    `next_version` INTEGER NOT NULL DEFAULT 1,
    `created_by_user_id` CHAR(36) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `websites_department_id_key`(`department_id`),
    UNIQUE INDEX `websites_hostname_key`(`hostname`),
    UNIQUE INDEX `websites_active_deployment_id_key`(`active_deployment_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `deployments` (
    `id` CHAR(36) NOT NULL,
    `website_id` CHAR(36) NOT NULL,
    `version` INTEGER NOT NULL,
    `uploaded_by_user_id` CHAR(36) NOT NULL,
    `source_artifact_key` VARCHAR(512) NULL,
    `source_sha256` CHAR(64) NULL,
    `source_size_bytes` INTEGER NULL,
    `original_filename` VARCHAR(255) NOT NULL,
    `file_count` INTEGER NULL,
    `build_artifact_key` VARCHAR(512) NULL,
    `build_sha256` CHAR(64) NULL,
    `image_reference` VARCHAR(255) NULL,
    `status` ENUM('DRAFT', 'UPLOADED', 'VALIDATING', 'BUILDING', 'PREVIEW_READY', 'DEPLOYING', 'LIVE', 'FAILED', 'ROLLED_BACK') NOT NULL DEFAULT 'DRAFT',
    `preview_url` VARCHAR(512) NULL,
    `preview_expires_at` DATETIME(3) NULL,
    `preview_viewed_at` DATETIME(3) NULL,
    `error_code` VARCHAR(64) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `deployed_at` DATETIME(3) NULL,

    INDEX `deployments_website_id_status_idx`(`website_id`, `status`),
    INDEX `deployments_status_preview_expires_at_idx`(`status`, `preview_expires_at`),
    UNIQUE INDEX `deployments_website_id_version_key`(`website_id`, `version`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `deployment_jobs` (
    `id` CHAR(36) NOT NULL,
    `deployment_id` CHAR(36) NOT NULL,
    `website_id` CHAR(36) NOT NULL,
    `job_type` ENUM('BUILD', 'PROMOTE', 'ROLLBACK') NOT NULL,
    `status` ENUM('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED') NOT NULL DEFAULT 'QUEUED',
    `attempts` INTEGER NOT NULL DEFAULT 0,
    `max_attempts` INTEGER NOT NULL DEFAULT 3,
    `error_code` VARCHAR(64) NULL,
    `active_lock_key` CHAR(36) NULL,
    `lease_token` CHAR(32) NULL,
    `lease_owner` VARCHAR(100) NULL,
    `lease_expires_at` DATETIME(3) NULL,
    `run_after` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `from_deployment_id` CHAR(36) NULL,
    `requested_by_user_id` CHAR(36) NOT NULL,
    `started_at` DATETIME(3) NULL,
    `finished_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `deployment_jobs_active_lock_key_key`(`active_lock_key`),
    INDEX `deployment_jobs_status_run_after_idx`(`status`, `run_after`),
    INDEX `deployment_jobs_status_lease_expires_at_idx`(`status`, `lease_expires_at`),
    INDEX `deployment_jobs_deployment_id_idx`(`deployment_id`),
    INDEX `deployment_jobs_website_id_idx`(`website_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `deployment_logs` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `deployment_id` CHAR(36) NOT NULL,
    `level` VARCHAR(10) NOT NULL,
    `message` VARCHAR(500) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `deployment_logs_deployment_id_id_idx`(`deployment_id`, `id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `audit_logs` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `actor_user_id` CHAR(36) NULL,
    `department_id` CHAR(36) NULL,
    `website_id` CHAR(36) NULL,
    `deployment_id` CHAR(36) NULL,
    `action` VARCHAR(64) NOT NULL,
    `metadata` JSON NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `audit_logs_department_id_created_at_idx`(`department_id`, `created_at`),
    INDEX `audit_logs_website_id_created_at_idx`(`website_id`, `created_at`),
    INDEX `audit_logs_actor_user_id_created_at_idx`(`actor_user_id`, `created_at`),
    INDEX `audit_logs_action_created_at_idx`(`action`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `sessions` (
    `id` CHAR(64) NOT NULL,
    `user_id` CHAR(36) NOT NULL,
    `csrf_token` VARCHAR(64) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `last_seen_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `expires_at` DATETIME(3) NOT NULL,

    INDEX `sessions_user_id_idx`(`user_id`),
    INDEX `sessions_expires_at_idx`(`expires_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `auth_flows` (
    `id` CHAR(64) NOT NULL,
    `state` VARCHAR(128) NOT NULL,
    `nonce` VARCHAR(128) NOT NULL,
    `code_verifier` VARCHAR(128) NOT NULL,
    `return_to` VARCHAR(512) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `expires_at` DATETIME(3) NOT NULL,

    INDEX `auth_flows_expires_at_idx`(`expires_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `idempotency_keys` (
    `id` CHAR(36) NOT NULL,
    `user_id` CHAR(36) NOT NULL,
    `scope` VARCHAR(100) NOT NULL,
    `key` VARCHAR(128) NOT NULL,
    `request_hash` CHAR(64) NOT NULL,
    `response_status` INTEGER NULL,
    `response_body` JSON NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `expires_at` DATETIME(3) NOT NULL,

    INDEX `idempotency_keys_expires_at_idx`(`expires_at`),
    UNIQUE INDEX `idempotency_keys_user_id_scope_key_key`(`user_id`, `scope`, `key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `rate_limits` (
    `key` VARCHAR(191) NOT NULL,
    `window_start` DATETIME(3) NOT NULL,
    `count` INTEGER NOT NULL DEFAULT 0,

    INDEX `rate_limits_window_start_idx`(`window_start`),
    PRIMARY KEY (`key`, `window_start`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `users` ADD CONSTRAINT `users_department_id_fkey` FOREIGN KEY (`department_id`) REFERENCES `departments`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `websites` ADD CONSTRAINT `websites_department_id_fkey` FOREIGN KEY (`department_id`) REFERENCES `departments`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `websites` ADD CONSTRAINT `websites_active_deployment_id_fkey` FOREIGN KEY (`active_deployment_id`) REFERENCES `deployments`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `websites` ADD CONSTRAINT `websites_created_by_user_id_fkey` FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `deployments` ADD CONSTRAINT `deployments_website_id_fkey` FOREIGN KEY (`website_id`) REFERENCES `websites`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `deployments` ADD CONSTRAINT `deployments_uploaded_by_user_id_fkey` FOREIGN KEY (`uploaded_by_user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `deployment_jobs` ADD CONSTRAINT `deployment_jobs_deployment_id_fkey` FOREIGN KEY (`deployment_id`) REFERENCES `deployments`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `deployment_jobs` ADD CONSTRAINT `deployment_jobs_website_id_fkey` FOREIGN KEY (`website_id`) REFERENCES `websites`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `deployment_jobs` ADD CONSTRAINT `deployment_jobs_requested_by_user_id_fkey` FOREIGN KEY (`requested_by_user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `deployment_logs` ADD CONSTRAINT `deployment_logs_deployment_id_fkey` FOREIGN KEY (`deployment_id`) REFERENCES `deployments`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `audit_logs` ADD CONSTRAINT `audit_logs_actor_user_id_fkey` FOREIGN KEY (`actor_user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `audit_logs` ADD CONSTRAINT `audit_logs_department_id_fkey` FOREIGN KEY (`department_id`) REFERENCES `departments`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `audit_logs` ADD CONSTRAINT `audit_logs_website_id_fkey` FOREIGN KEY (`website_id`) REFERENCES `websites`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `audit_logs` ADD CONSTRAINT `audit_logs_deployment_id_fkey` FOREIGN KEY (`deployment_id`) REFERENCES `deployments`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sessions` ADD CONSTRAINT `sessions_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `idempotency_keys` ADD CONSTRAINT `idempotency_keys_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

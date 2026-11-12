-- Enrollment and password events record the affected account separately from the actor.
ALTER TABLE `audit_logs` ADD COLUMN `target_user_id` CHAR(36) NULL;
CREATE INDEX `audit_logs_target_user_id_created_at_idx` ON `audit_logs`(`target_user_id`, `created_at`);

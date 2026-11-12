-- Heuristic suspicious-script findings for each revision (written by the worker during validation).
ALTER TABLE `deployments` ADD COLUMN `content_findings` JSON NULL;

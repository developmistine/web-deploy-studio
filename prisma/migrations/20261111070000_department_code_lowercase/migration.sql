-- Department codes are the lower-case output of normalizeDepartmentCode(). Rows seeded by an early build kept
-- upper-case codes ("DTD"). The column's collation is case-insensitive, so lookups for "dtd" kept finding the old row,
-- while authorization compares codes in TypeScript (case-sensitive) -> every USER request carrying a department
-- label was refused with DEPARTMENT_MISMATCH. Normalize existing rows, then make the invariant a DB constraint.
UPDATE `departments` SET `code` = LOWER(`code`)
  WHERE CAST(`code` AS BINARY) <> CAST(LOWER(`code`) AS BINARY);

ALTER TABLE `departments`
  ADD CONSTRAINT `departments_code_lowercase` CHECK (CAST(`code` AS BINARY) = CAST(LOWER(`code`) AS BINARY));

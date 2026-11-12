#!/bin/sh
# Least-privilege MySQL accounts for Deploy Studio (runs once on first MySQL init in local compose).
# Passwords come from the environment (DS_APP_PASSWORD / DS_MIGRATE_PASSWORD) — never hard-coded.
# In production run the equivalent SQL with a DBA account and secrets from your secret store.
#
#   ds_migrate : schema changes (prisma migrate deploy), one-shot migration job only
#   ds_app     : runtime (web + worker) — DML only, no DDL (cannot DROP/ALTER/TRUNCATE).
# audit_logs immutability is enforced by triggers (migration 20261111040000_audit_append_only).
set -eu
: "${DS_APP_PASSWORD:?}" "${DS_MIGRATE_PASSWORD:?}"
mysql -uroot -p"${MYSQL_ROOT_PASSWORD}" <<SQL
CREATE USER IF NOT EXISTS 'ds_migrate'@'%' IDENTIFIED BY '${DS_MIGRATE_PASSWORD}';
CREATE USER IF NOT EXISTS 'ds_app'@'%' IDENTIFIED BY '${DS_APP_PASSWORD}';
GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, DROP, INDEX, REFERENCES, TRIGGER ON deploy_studio.* TO 'ds_migrate'@'%';
GRANT SELECT, INSERT, UPDATE, DELETE ON deploy_studio.* TO 'ds_app'@'%';
FLUSH PRIVILEGES;
SQL

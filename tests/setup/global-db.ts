import { execSync } from 'node:child_process'
import mariadb from 'mariadb'
import { poolConfigFromUrl } from '../../src/server/db'
import { TEST_DATABASE_URL } from './env'

/** Creates the isolated test database and applies all migrations (including audit triggers). */
export default async function setup() {
  const cfg = poolConfigFromUrl(TEST_DATABASE_URL)
  const conn = await mariadb.createConnection({ ...cfg, database: undefined })
  try {
    if (!/_test$/.test(cfg.database)) throw new Error('Refusing to run integration tests against a non-*_test database')
    await conn.query(`CREATE DATABASE IF NOT EXISTS \`${cfg.database}\``)
  } finally {
    await conn.end()
  }
  execSync('npx prisma migrate deploy', { stdio: 'inherit', env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL } })
}

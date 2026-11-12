import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

/** Deterministic test configuration. Never points at production resources. */
export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'mysql://deploy_studio:devpass@localhost:3307/deploy_studio_test?allowPublicKeyRetrieval=true&connection_limit=10'

const defaults: Record<string, string> = {
  APP_URL: 'http://localhost:3000',
  DATABASE_URL: TEST_DATABASE_URL,
  ALLOWED_EMAIL_DOMAINS: 'test.example',
  // Low Argon2 cost keeps tests fast; production refuses values below the OWASP minimum (tested).
  ARGON2_MEMORY_KIB: '1024',
  ARGON2_TIME_COST: '1',
  SITES_BASE_URL: 'http://sites.localhost:8080',
  PREVIEW_BASE_URL: 'http://preview.localhost:8080',
  GATEWAY_SIGNING_SECRET: 'test-gateway-signing-secret-0123456789abcdef',
  HEALTH_PROBE_TOKEN: 'test-probe-token-0123456789abcdef',
  ADMIN_STEP_UP_MAX_AGE_MINUTES: '15',
  STORAGE_ROOT: mkdtempSync(path.join(tmpdir(), 'ds-test-storage-')),
  UPLOAD_MAX_ARCHIVE_MB: '5',
  UPLOAD_MAX_FILES: '50',
  UPLOAD_MAX_EXTRACTED_MB: '8',
  UPLOAD_MAX_FILE_MB: '4',
  UPLOAD_MAX_RATIO: '50',
  RATE_LIMIT_UPLOADS_PER_HOUR: '1000',
  RATE_LIMIT_PROMOTIONS_PER_HOUR: '1000',
}
for (const [k, v] of Object.entries(defaults)) process.env[k] = v

// DOM matchers for UI tests (no-op in node environments).
if (typeof window !== 'undefined') {
  await import('@testing-library/jest-dom/vitest')
  // jsdom lacks a few browser APIs that Radix primitives (Select, DropdownMenu, Dialog) use.
  const proto = window.HTMLElement.prototype as unknown as Record<string, unknown>
  proto.hasPointerCapture ??= () => false
  proto.setPointerCapture ??= () => undefined
  proto.releasePointerCapture ??= () => undefined
  proto.scrollIntoView ??= () => undefined
  ;(window as unknown as Record<string, unknown>).ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
}

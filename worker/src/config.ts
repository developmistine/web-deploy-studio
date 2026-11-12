import { hostname } from 'node:os'
import { z } from 'zod'
import { limitsFromEnvNumbers, type UploadLimits } from '@/server/uploads/limits'
import { withoutEmpty } from '@/server/config'

const int = (d: number, min = 1) => z.coerce.number().int().min(min).default(d)

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  STORAGE_ROOT: z.string().default('./data/storage'),
  WORK_DIR: z.string().optional(),
  WORKER_ID: z.string().default(`${hostname()}-${process.pid}`),
  WORKER_POLL_MS: int(1000, 100),
  WORKER_LEASE_SECONDS: int(60, 10),
  JOB_TIMEOUT_SECONDS: int(900, 30),
  RECONCILE_INTERVAL_SECONDS: int(30, 5),
  DRAIN_SECONDS: int(5, 0),

  RUNTIME: z.enum(['docker', 'fake']).default('docker'),
  DOCKER_BIN: z.string().default('docker'),
  SITE_BASE_IMAGE: z.string().default('nginxinc/nginx-unprivileged:1.29-alpine'),
  SITE_IMAGE_REPO: z.string().regex(/^[a-z0-9][a-z0-9._/-]*$/).default('deploy-studio-site'),
  SITES_NETWORK: z.string().regex(/^[A-Za-z0-9_.-]+$/).default('ds-sites'),
  SITE_CONTAINER_MEMORY: z.string().regex(/^\d+[kmg]$/).default('128m'),
  SITE_CONTAINER_CPUS: z.string().regex(/^\d+(\.\d+)?$/).default('0.25'),
  SITE_CONTAINER_PIDS: int(64),
  HEALTH_CHECK_TIMEOUT_SECONDS: int(30, 1),
  IMAGE_SCAN_COMMAND: z.string().optional(),

  ROUTES_DIR: z.string().default('./data/routes'),
  PROXY_INTERNAL_URL: z.url().default('http://proxy:80'),
  ROUTER_ENTRYPOINTS: z.string().default('web'),
  ROUTER_TLS: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
  /** Forward-auth gateway middleware applied to EVERY site and preview route (no public routes). */
  GATEWAY_MIDDLEWARE: z.string().default('ds-gateway@file'),
  SITE_MIDDLEWARES: z.string().default('ds-site-headers@file'),
  /** Shared with the web gate so proxy readiness probes can reach /__ds_health. */
  HEALTH_PROBE_TOKEN: z.string().min(24),
  /** Content-Security-Policy baked into every hosted site (restricts exfiltration from uploaded JS). */
  SITE_CSP: z
    .string()
    .refine((v) => !/["\r\n]/.test(v), 'SITE_CSP must be a single line without double quotes')
    .default("default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; media-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; worker-src 'none'"),

  APP_URL: z.url(),
  SITES_BASE_URL: z.url(),
  PREVIEW_BASE_URL: z.url(),
  PREVIEW_TTL_MINUTES: int(120, 5),

  MALWARE_SCAN_MODE: z.enum(['none', 'clamav']).default('none'),
  /** Suspicious-script check: block = HIGH findings fail the upload; warn = report only; off = skip. */
  CONTENT_SCAN_MODE: z.enum(['block', 'warn', 'off']).default('block'),
  CLAMAV_HOST: z.string().default('clamav'),
  CLAMAV_PORT: int(3310),

  UPLOAD_MAX_ARCHIVE_MB: int(50),
  UPLOAD_MAX_FILES: int(2000),
  UPLOAD_MAX_EXTRACTED_MB: int(200),
  UPLOAD_MAX_FILE_MB: int(25),
  UPLOAD_MAX_RATIO: int(100, 2),
})

export type WorkerConfig = z.infer<typeof schema> & { limits: UploadLimits }

export function loadWorkerConfig(env: NodeJS.ProcessEnv = process.env): WorkerConfig {
  const parsed = schema.safeParse(withoutEmpty(env))
  if (!parsed.success) throw new Error(`Invalid worker configuration: ${parsed.error.issues.map((i) => i.path.join('.')).join(', ')}`)
  const c = parsed.data
  return {
    ...c,
    limits: limitsFromEnvNumbers({
      archiveMb: c.UPLOAD_MAX_ARCHIVE_MB,
      files: c.UPLOAD_MAX_FILES,
      extractedMb: c.UPLOAD_MAX_EXTRACTED_MB,
      fileMb: c.UPLOAD_MAX_FILE_MB,
      ratio: c.UPLOAD_MAX_RATIO,
    }),
  }
}

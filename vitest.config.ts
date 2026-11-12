import path from 'node:path'
import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

const root = path.dirname(fileURLToPath(import.meta.url))
const resolve = { alias: { '@': path.join(root, 'src') } }

export default defineConfig({
  test: {
    projects: [
      {
        resolve,
        test: { name: 'unit', environment: 'node', include: ['tests/unit/**/*.test.ts'], setupFiles: ['tests/setup/env.ts'] },
      },
      {
        plugins: [react()],
        resolve,
        test: { name: 'ui', environment: 'jsdom', include: ['tests/ui/**/*.test.tsx'], setupFiles: ['tests/setup/env.ts'] },
      },
      {
        resolve,
        test: {
          name: 'integration',
          environment: 'node',
          include: ['tests/integration/**/*.test.ts'],
          setupFiles: ['tests/setup/env.ts'],
          globalSetup: ['tests/setup/global-db.ts'],
          fileParallelism: false,
          testTimeout: 60_000,
          hookTimeout: 120_000,
        },
      },
    ],
  },
})

import nextVitals from 'eslint-config-next/core-web-vitals'
import nextTs from 'eslint-config-next/typescript'

const config = [
  ...nextVitals,
  ...nextTs,
  {
    ignores: ['.next/**', 'node_modules/**', 'src/generated/**', 'next-env.d.ts', 'coverage/**', '*.html', 'data/**'],
  },
  {
    rules: {
      'no-restricted-imports': [
        'error',
        { patterns: [{ group: ['node:child_process', 'child_process'], message: 'Only the worker may spawn processes.' }] },
      ],
    },
  },
  {
    files: ['worker/**/*.ts', 'tests/**/*.ts', 'tests/**/*.tsx', 'scripts/**/*.ts'],
    rules: { 'no-restricted-imports': 'off' },
  },
  {
    files: ['tests/**/*.ts', 'tests/**/*.tsx'],
    rules: { '@typescript-eslint/no-explicit-any': 'off' },
  },
]

export default config

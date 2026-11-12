import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'

/**
 * Keeps AGENTS.md and the agent skills discoverable and truthful. Codex discovers repository skills in
 * `.agents/skills/<name>/SKILL.md` and requires YAML frontmatter with `name` and `description`; stale paths in
 * guidance files silently mislead agents, so every referenced repository path must exist.
 */
const SKILLS_DIR = '.agents/skills'
const skillNames = readdirSync(SKILLS_DIR, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name)
const agentsMd = readFileSync('AGENTS.md', 'utf8')

function frontmatter(file: string): { data: Record<string, unknown>; body: string } {
  const text = readFileSync(file, 'utf8')
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/.exec(text)
  if (!m) throw new Error(`${file}: missing YAML frontmatter`)
  return { data: parse(m[1]!) as Record<string, unknown>, body: m[2]! }
}

const ROOTS = /^(src|worker|scripts|infra|prisma|tests|docs|docker|\.agents|references)\//
const ROOT_FILES = new Set(['AGENTS.md', 'docker-compose.yml', 'deploy-studio-layout-updated.html', '.dockerignore', 'package.json'])

/** Backticked repository paths, normalised: globs and `a|b` alternatives reduced to their existing prefix. */
function referencedPaths(text: string): string[] {
  const out: string[] = []
  for (const [, tok] of text.matchAll(/`([^`\n]+)`/g)) {
    const first = tok!.split(/\s/)[0]!
    if (!ROOTS.test(first) && !ROOT_FILES.has(first)) continue
    if (first.includes('<')) continue // placeholders like .agents/skills/<name>/SKILL.md
    out.push(first.replace(/\/?\*.*$/, '').replace(/\|.*$/, '').replace(/\/$/, ''))
  }
  return out
}

describe('agent skills', () => {
  it('the four Deploy Studio skills exist', () => {
    expect(skillNames.sort()).toEqual(
      ['deploy-studio-auth', 'deploy-studio-deployment', 'deploy-studio-security', 'deploy-studio-threat-model'].sort(),
    )
  })

  for (const name of skillNames) {
    describe(name, () => {
      const file = path.join(SKILLS_DIR, name, 'SKILL.md')
      const { data, body } = frontmatter(file)

      it('has valid, discoverable frontmatter (name matches folder; single-line description ≤ 500 chars)', () => {
        expect(Object.keys(data).sort()).toEqual(['description', 'name'])
        expect(data.name).toBe(name)
        expect(name).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/)
        expect(name.length).toBeLessThanOrEqual(64)
        expect(typeof data.description).toBe('string')
        const d = data.description as string
        expect(d.length).toBeGreaterThan(50)
        expect(d.length).toBeLessThanOrEqual(500)
        expect(d).not.toMatch(/[\n<>]/)
        expect(d).toMatch(/^Use (when|for)/)
      })

      it('has activation criteria, responsibilities, workflow and verification sections', () => {
        for (const heading of ['## When to use', '## Responsibilities', '## Workflow', '## Verification']) {
          expect(body, heading).toContain(heading)
        }
      })

      it('every referenced repository path exists', () => {
        const dir = path.join(SKILLS_DIR, name)
        for (const p of referencedPaths(body)) {
          const resolved = p.startsWith('references/') ? path.join(dir, p) : p
          expect(existsSync(resolved), `${file} → ${p}`).toBe(true)
        }
      })

      it('is listed in AGENTS.md', () => {
        expect(agentsMd).toContain(`\`${name}\``)
      })
    })
  }

  it('AGENTS.md lists no skill that does not exist, and every path it references exists', () => {
    const table = [...agentsMd.matchAll(/^\| `(deploy-studio-[a-z-]+)` \|/gm)].map((m) => m[1])
    expect(table.sort()).toEqual([...skillNames].sort())
    for (const p of referencedPaths(agentsMd)) expect(existsSync(p), `AGENTS.md → ${p}`).toBe(true)
  })

  it('skill reference files exist and are referenced paths that resolve', () => {
    const refsDir = path.join(SKILLS_DIR, 'deploy-studio-security', 'references')
    for (const f of readdirSync(refsDir)) {
      for (const p of referencedPaths(readFileSync(path.join(refsDir, f), 'utf8'))) {
        expect(existsSync(p), `${f} → ${p}`).toBe(true)
      }
    }
  })

  it('changes to agent guidance are documented', () => {
    expect(existsSync('.agents/CHANGELOG.md')).toBe(true)
  })
})

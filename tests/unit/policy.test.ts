import { describe, expect, it } from 'vitest'
import type { Actor } from '@/server/auth/session'
import { canAccessDepartment, requiresStepUp, resolveTargetDepartment, websiteScope } from '@/server/authz/policy'
import { needsRecentAuth } from '@/server/authz/policy'
import { normalizeDepartmentCode, isValidSiteName, createWebsiteSchema } from '@/lib/validation'
import { AppError } from '@/server/http/errors'

const user = (dept: string | null, code: string | null = dept): Actor => ({
  userId: 'u1',
  role: 'USER',
  departmentId: dept,
  departmentCode: code,
  displayName: 'U',
  email: 'u@test.example',
  authenticatedAt: new Date(),
})
const admin = (dept: string | null = null, authAgoMin = 0): Actor => ({ ...user(dept), role: 'ADMIN', authenticatedAt: new Date(Date.now() - authAgoMin * 60_000) })

const code = (e: unknown) => (e instanceof AppError ? e.code : String(e))

describe('authorization policy (role + department only)', () => {
  it('USER of DTD can access DTD only', () => {
    expect(canAccessDepartment(user('dtd-id'), 'dtd-id')).toBe(true)
    expect(canAccessDepartment(user('dtd-id'), 'erp-id')).toBe(false)
    expect(canAccessDepartment(user('dtd-id'), 'ka-id')).toBe(false)
  })
  it('ADMIN can access all departments', () => {
    for (const d of ['dtd-id', 'erp-id', 'ka-id']) expect(canAccessDepartment(admin(), d)).toBe(true)
  })
  it('USER without department membership is denied everything (deny by default)', () => {
    expect(canAccessDepartment(user(null), 'dtd-id')).toBe(false)
    expect(websiteScope(user(null))).toEqual({ departmentId: '__none__' })
  })
  it('a typed department never grants membership (client tampering rejected)', () => {
    expect(() => resolveTargetDepartment(user('dtd-id', 'dtd'), 'ERP')).toThrowError(AppError)
    try {
      resolveTargetDepartment(user('dtd-id', 'dtd'), 'erp')
    } catch (e) {
      expect(code(e)).toBe('DEPARTMENT_MISMATCH')
    }
    expect(resolveTargetDepartment(user('dtd-id', 'dtd'), 'DTD')).toEqual({ code: 'dtd', label: 'dtd' })
    expect(resolveTargetDepartment(user('dtd-id', 'dtd'), undefined).code).toBe('dtd')
  })
  it('unassigned USER cannot create by typing a department', () => {
    try {
      resolveTargetDepartment(user(null), 'ERP')
      throw new Error('should have thrown')
    } catch (e) {
      expect(code(e)).toBe('NO_DEPARTMENT')
    }
  })
  it('role escalation fields in the body are rejected by strict validation', () => {
    expect(createWebsiteSchema.safeParse({ siteName: 'abc', role: 'ADMIN' }).success).toBe(false)
    expect(createWebsiteSchema.safeParse({ siteName: 'abc', departmentId: 'x' }).success).toBe(false)
    expect(createWebsiteSchema.safeParse({ siteName: 'abc', department: 'DTD' }).success).toBe(true)
  })
  it('admin step-up: required for stale cross-department changes only', () => {
    expect(requiresStepUp(admin('dtd-id', 60), 'erp-id', 15)).toBe(true)
    expect(requiresStepUp(admin('dtd-id', 5), 'erp-id', 15)).toBe(false)
    expect(requiresStepUp(admin('dtd-id', 60), 'dtd-id', 15)).toBe(false)
    expect(requiresStepUp(admin(null, 60), 'erp-id', 0)).toBe(false)
    expect(requiresStepUp(user('dtd-id'), 'dtd-id', 15)).toBe(false)
  })
})

describe('department identifiers', () => {
  it('normalizes free text to hostname-safe codes and rejects the rest', () => {
    expect(normalizeDepartmentCode('DTD')).toBe('dtd')
    expect(normalizeDepartmentCode('  Sales Ops ')).toBe('sales-ops')
    expect(normalizeDepartmentCode('ｅｒｐ')).toBe('erp') // NFKC full-width
    expect(normalizeDepartmentCode('a')).toBeNull()
    expect(normalizeDepartmentCode('fin/ance')).toBeNull()
    expect(normalizeDepartmentCode('-x-')).toBeNull()
    expect(normalizeDepartmentCode('a--b')).toBeNull()
    expect(normalizeDepartmentCode('ฝ่ายขาย')).toBeNull()
  })
  it('site names follow the prototype rule', () => {
    expect(isValidSiteName('sales-dashboard')).toBe(true)
    for (const bad of ['-x', 'x-', 'X Y', 'a--b', '']) expect(isValidSiteName(bad)).toBe(false)
  })
})


describe('re-authentication window', () => {
  it('requires a recent password confirmation for sensitive admin actions', () => {
    expect(needsRecentAuth(admin(null, 16), 15)).toBe(true)
    expect(needsRecentAuth(admin(null, 5), 15)).toBe(false)
    expect(needsRecentAuth(admin(null, 999), 0)).toBe(false) // 0 disables (tests/local only)
  })
})

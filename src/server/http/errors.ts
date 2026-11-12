/**
 * Safe error catalogue. Only these codes/messages ever reach clients.
 * Internal details (stack, SQL, Docker output, paths) stay in server logs.
 */
export const ERRORS = {
  UNAUTHENTICATED: [401, 'Sign in required.'],
  INVALID_CREDENTIALS: [401, 'Email or password is incorrect.'],
  PASSWORD_CHANGE_REQUIRED: [403, 'Please set a new password before continuing.'],
  REAUTH_REQUIRED: [401, 'Please confirm your password to continue.'],
  WRONG_PASSWORD: [400, 'The current password is incorrect.'],
  PASSWORD_POLICY: [422, 'This password does not meet the password requirements.'],
  PASSWORD_REUSED: [422, 'Choose a password different from your current one.'],
  INVALID_LINK: [400, 'This link is invalid, already used or expired. Ask an administrator for a new one.'],
  INVALID_EMAIL: [400, 'Enter a valid corporate email address.'],
  EMAIL_DOMAIN_NOT_ALLOWED: [422, 'This email domain is not allowed for Deploy Studio accounts.'],
  EMAIL_IN_USE: [409, 'An active account already uses this email address.'],
  DEPARTMENT_REQUIRED: [422, 'Users must be assigned to a department.'],
  LAST_ADMIN: [409, 'At least one active administrator is required.'],
  SELF_CHANGE_NOT_ALLOWED: [409, 'You cannot change your own role, status or enrollment.'],
  ACCOUNT_REVOKED: [409, 'This enrollment has been removed.'],
  FORBIDDEN: [403, 'You do not have permission to perform this action.'],
  DEPARTMENT_MISMATCH: [403, 'You can only manage your own department.'],
  NO_DEPARTMENT: [403, 'Your account has no department assignment yet. Contact a Deploy Studio administrator.'],
  WEBSITE_SUSPENDED: [423, 'This website is suspended by an administrator.'],
  HOST_NOT_ALLOWED: [421, 'Misdirected request.'],
  CSRF_FAILED: [403, 'Request could not be verified. Reload the page and try again.'],
  NOT_FOUND: [404, 'Not found.'],
  VALIDATION_FAILED: [400, 'Invalid request.'],
  PAYLOAD_TOO_LARGE: [413, 'Upload is too large.'],
  LENGTH_REQUIRED: [411, 'Content-Length is required.'],
  UNSUPPORTED_MEDIA_TYPE: [415, 'Unsupported request format.'],
  UPLOAD_REJECTED: [422, 'The uploaded files were rejected.'],
  INVALID_DEPARTMENT: [400, 'Department must use letters, numbers, spaces or "-" (2–32 characters).'],
  HOSTNAME_TOO_LONG: [400, 'Department and site name are too long together for a hostname (max 63 characters).'],
  WEBSITE_EXISTS: [409, 'This department already has a website. Upload a new version instead.'],
  HOSTNAME_TAKEN: [409, 'This hostname is already in use.'],
  INVALID_STATE: [409, 'This deployment is not in a state that allows this action.'],
  PREVIEW_REQUIRED: [409, 'Open the preview before deploying to production.'],
  PROMOTION_IN_PROGRESS: [409, 'Another production change for this website is in progress. Try again shortly.'],
  NO_ROLLBACK_TARGET: [409, 'There is no previous working version to roll back to.'],
  IDEMPOTENCY_MISMATCH: [422, 'Idempotency-Key was reused with a different request.'],
  RATE_LIMITED: [429, 'Too many requests. Please wait and try again.'],
  INTERNAL: [500, 'Something went wrong. Please try again later.'],
} as const satisfies Record<string, readonly [number, string]>

export type ErrorCode = keyof typeof ERRORS

export class AppError extends Error {
  readonly code: ErrorCode
  readonly status: number
  /** Optional safe, user-facing details (e.g. upload rejection reason, existing website id). */
  readonly details?: Record<string, unknown>

  constructor(code: ErrorCode, details?: Record<string, unknown>, message?: string) {
    const [status, defaultMessage] = ERRORS[code]
    super(message ?? defaultMessage)
    this.code = code
    this.status = status
    this.details = details
  }
}

export function isAppError(e: unknown): e is AppError {
  return e instanceof AppError
}

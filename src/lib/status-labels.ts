import { failureMessageTh } from '@/lib/i18n/upload-th'
import type { DeploymentStatus } from '@/lib/types'

export const STATUS_LABEL: Record<DeploymentStatus, string> = {
  DRAFT: 'Uploading',
  UPLOADED: 'Queued',
  VALIDATING: 'Validating',
  BUILDING: 'Building',
  PREVIEW_READY: 'Preview ready',
  DEPLOYING: 'Deploying',
  LIVE: 'Live',
  FAILED: 'Failed',
  ROLLED_BACK: 'Rolled back',
}

export const STATUS_TONE: Record<DeploymentStatus, '' | 'ready' | 'error'> = {
  DRAFT: '',
  UPLOADED: '',
  VALIDATING: '',
  BUILDING: '',
  PREVIEW_READY: 'ready',
  DEPLOYING: '',
  LIVE: 'ready',
  FAILED: 'error',
  ROLLED_BACK: '',
}

/**
 * User-safe explanations for worker error codes (Thai, shown on the upload page and history). Upload rejections carry
 * the specific reason (`UPLOAD_REJECTED:<REASON>`). Internal details are never sent to clients.
 */
export function errorMessageFor(code: string | null): string | null {
  return failureMessageTh(code)
}

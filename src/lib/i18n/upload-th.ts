/**
 * Thai explanations for upload / deployment failures, shown on the upload page. Codes stay unchanged; only the
 * wording is localised. Messages describe the user's own files or a safe outcome — never infrastructure details.
 */

export const UPLOAD_REASON_TH: Record<string, string> = {
  EMPTY_UPLOAD: 'ไม่พบไฟล์ที่อัปโหลด',
  ARCHIVE_TOO_LARGE: 'ไฟล์ที่อัปโหลดมีขนาดใหญ่เกินกำหนด',
  TOO_MANY_FILES: 'โปรเจกต์มีจำนวนไฟล์มากเกินกำหนด',
  EXTRACTED_TOO_LARGE: 'โปรเจกต์มีขนาดรวมหลังแตก ZIP ใหญ่เกินกำหนด',
  FILE_TOO_LARGE: 'มีไฟล์ที่ขนาดใหญ่เกินกำหนดต่อไฟล์',
  COMPRESSION_RATIO: 'มีไฟล์ที่ถูกบีบอัดผิดปกติ (อาจเป็น ZIP bomb)',
  UNSAFE_PATH: 'ชื่อหรือตำแหน่งไฟล์ไม่ปลอดภัย (เช่น มี .. หรืออักขระที่ไม่อนุญาต)',
  SYMLINK: 'ไม่อนุญาตให้มี symbolic link ในไฟล์ ZIP',
  UNSAFE_ENTRY: 'ไฟล์ ZIP มีรายการชนิดที่ไม่รองรับ',
  ENCRYPTED_ENTRY: 'ไม่รองรับไฟล์ ZIP ที่ตั้งรหัสผ่าน',
  UNSUPPORTED_COMPRESSION: 'ไฟล์ ZIP ใช้วิธีบีบอัดที่ไม่รองรับ',
  UNSUPPORTED_FILE_TYPE: 'มีชนิดไฟล์ที่ไม่อนุญาตสำหรับเว็บไซต์แบบ static',
  CONTENT_MISMATCH: 'เนื้อหาไฟล์ไม่ตรงกับนามสกุลไฟล์',
  DUPLICATE_PATH: 'มีไฟล์ชื่อซ้ำกันในโปรเจกต์',
  MISSING_INDEX: 'ไม่พบ index.html ที่โฟลเดอร์หลักของโปรเจกต์ (ถ้าอัปไฟล์ HTML หลายไฟล์ ต้องมีไฟล์ชื่อ index.html)',
  CORRUPT_ARCHIVE: 'ไฟล์ ZIP เสียหายหรือไม่ใช่ ZIP ที่ถูกต้อง',
  NESTED_ARCHIVE: 'ไม่อนุญาตให้มีไฟล์ ZIP ซ้อนอยู่ข้างใน',
  MALWARE_DETECTED: 'ระบบสแกนพบมัลแวร์ในไฟล์ที่อัปโหลด',
}

const FAILURE_TH: Record<string, string> = {
  MALWARE_DETECTED: UPLOAD_REASON_TH.MALWARE_DETECTED!,
  SUSPICIOUS_CONTENT: 'พบสคริปต์ที่น่าสงสัย จึงไม่อนุญาตให้เผยแพร่ (ดูรายการด้านล่าง)',
  BUILD_FAILED: 'สร้างแพ็กเกจเว็บไซต์ไม่สำเร็จ กรุณาลองอัปโหลดใหม่',
  IMAGE_SCAN_FAILED: 'แพ็กเกจเว็บไซต์ไม่ผ่านการสแกนความปลอดภัย',
  PREVIEW_START_FAILED: 'เปิดหน้าตัวอย่างไม่สำเร็จ กรุณาลองใหม่',
  HEALTH_CHECK_FAILED: 'เวอร์ชันใหม่ไม่ผ่านการตรวจความพร้อม เว็บไซต์เดิมยังออนไลน์ตามปกติ',
  ROUTE_SWITCH_FAILED: 'สลับเว็บไซต์ไปเวอร์ชันใหม่ไม่สำเร็จ เว็บไซต์เดิมยังออนไลน์ตามปกติ',
  TIMEOUT: 'ใช้เวลานานเกินกำหนด เว็บไซต์เดิมยังออนไลน์ตามปกติ',
  WORKER_LOST: 'ระบบ deploy หยุดทำงานกะทันหัน เว็บไซต์เดิมยังออนไลน์ตามปกติ',
  SUPERSEDED: 'มีการเปลี่ยนแปลงเวอร์ชันอื่นเสร็จก่อน',
  ARTIFACT_MISSING: 'ไม่พบแพ็กเกจของเวอร์ชันนี้',
  ARTIFACT_INTEGRITY_FAILED: 'แพ็กเกจของเวอร์ชันนี้ไม่ผ่านการตรวจความถูกต้อง เว็บไซต์เดิมยังออนไลน์ตามปกติ',
  QUARANTINED: 'เวอร์ชันนี้ถูกผู้ดูแลระบบกักกันไว้',
  SUSPENDED: 'เว็บไซต์นี้ถูกผู้ดูแลระบบระงับไว้',
}

/** Thai message for a failed deployment's error code (`UPLOAD_REJECTED:<REASON>` carries the specific reason). */
export function failureMessageTh(code: string | null): string | null {
  if (!code) return null
  if (code.startsWith('UPLOAD_REJECTED')) {
    const reason = code.split(':')[1] ?? ''
    return `ไฟล์ไม่ผ่านการตรวจสอบ: ${UPLOAD_REASON_TH[reason] ?? 'รูปแบบไฟล์ไม่ถูกต้อง'}`
  }
  return FAILURE_TH[code] ?? 'Deploy ไม่สำเร็จ เว็บไซต์เดิมยังออนไลน์ตามปกติ'
}

/** Thai message for an API error during upload (synchronous checks before anything is stored). */
export function uploadApiErrorTh(code: string, details?: Record<string, unknown>): string | null {
  const path = typeof details?.path === 'string' ? ` (ไฟล์: ${details.path})` : ''
  if (code === 'UPLOAD_REJECTED') {
    const reason = typeof details?.reason === 'string' ? details.reason : ''
    return `ไฟล์ไม่ผ่านการตรวจสอบ: ${UPLOAD_REASON_TH[reason] ?? 'รูปแบบไฟล์ไม่ถูกต้อง'}${path}`
  }
  const map: Record<string, string> = {
    PAYLOAD_TOO_LARGE: UPLOAD_REASON_TH.ARCHIVE_TOO_LARGE!,
    UNSUPPORTED_MEDIA_TYPE: 'รูปแบบการอัปโหลดไม่ถูกต้อง',
    RATE_LIMITED: 'อัปโหลดบ่อยเกินไป กรุณารอสักครู่',
    WEBSITE_SUSPENDED: FAILURE_TH.SUSPENDED!,
    DEPARTMENT_MISMATCH: 'คุณจัดการได้เฉพาะเว็บไซต์ของฝ่ายตัวเอง',
    NO_DEPARTMENT: 'บัญชีของคุณยังไม่ได้กำหนดฝ่าย กรุณาติดต่อผู้ดูแลระบบ',
    INVALID_DEPARTMENT: 'ชื่อฝ่ายไม่ถูกต้อง',
    HOSTNAME_TOO_LONG: 'ชื่อฝ่ายรวมกับชื่อเว็บไซต์ยาวเกินไป (สูงสุด 63 ตัวอักษร)',
    HOSTNAME_TAKEN: 'ชื่อเว็บไซต์นี้ถูกใช้แล้ว',
    PROMOTION_IN_PROGRESS: 'เว็บไซต์กำลัง Deploy หรือ Rollback อยู่ กรุณาลองใหม่เมื่อเสร็จ',
    PREVIEW_REQUIRED: 'กรุณาเปิดดูหน้าตัวอย่างก่อน Deploy',
    VALIDATION_FAILED: 'ข้อมูลไม่ถูกต้อง กรุณาตรวจสอบอีกครั้ง',
  }
  return map[code] ? `${map[code]}${path}` : null
}

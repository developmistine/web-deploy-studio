'use client'

import type { ContentFindingDTO } from '@/lib/types'

type Props = {
  findings: ContentFindingDTO[]
  /** Preview mode: medium findings must be acknowledged before Deploy unlocks. */
  acknowledged?: boolean
  onAcknowledge?: (v: boolean) => void
}

/** Results of the suspicious-script check. Text comes from the server's fixed rule messages (never file content). */
export function ContentFindings({ findings, acknowledged, onAcknowledge }: Props) {
  if (!findings.length) return null
  const blocked = findings.some((f) => f.severity === 'high')
  return (
    <section className={`findings${blocked ? ' blocked' : ''}`} aria-label="Suspicious script check" data-testid="content-findings">
      <p className="findings-title">
        {blocked ? 'ไม่อนุญาตให้เผยแพร่: พบสคริปต์ที่น่าสงสัย' : `พบ ${findings.length} จุดที่ควรตรวจสอบก่อน Deploy`}
      </p>
      <ul>
        {findings.map((f, i) => (
          <li key={`${f.path}:${f.line}:${f.rule}:${i}`}>
            <span className={`pill ${f.severity === 'high' ? 'error' : ''}`}>{f.severity === 'high' ? 'Blocked' : 'Review'}</span>{' '}
            <code>
              {f.path}:{f.line}
            </code>{' '}
            {f.message}
          </li>
        ))}
      </ul>
      {!blocked && onAcknowledge ? (
        <label className="findings-ack">
          <input type="checkbox" checked={!!acknowledged} onChange={(e) => onAcknowledge(e.target.checked)} />
          ฉันตรวจสอบรายการข้างต้นแล้ว และยืนยันว่าเป็นโค้ดที่ตั้งใจใส่
        </label>
      ) : null}
    </section>
  )
}

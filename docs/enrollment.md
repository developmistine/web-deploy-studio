# Enrollment management (Enroll IDs)

Administrators create and manage Deploy Studio accounts on **Enroll IDs** (`/admin/users`, ADMIN sidebar). The page
is hidden from USER accounts and returns 404 to them; every API below re-checks ADMIN on the server
(`src/server/services/users.ts`). Status: **Implemented, Tested** (`tests/integration/enrollment.test.ts`,
`tests/ui/admin.test.tsx`).

## What an administrator can do

| Action | API | Rules |
|---|---|---|
| List / search / filter / paginate | `GET /api/v1/admin/users?q=&department=&role=&status=&page=&pageSize=` | search by name or email; department filter options come from the database; removed accounts are hidden unless `status=REVOKED` |
| Enroll a user | `POST /api/v1/admin/users {displayName, email, department?, role}` | email must use an allowed domain and not belong to another non-removed account; USER needs a department (typing a new label creates the department); returns a **one-time setup link** shown once |
| Edit | `PATCH /api/v1/admin/users/:id {displayName?, department?, role?, status?}` | status ACTIVE/DISABLED only; email cannot change (create a new enrollment instead); role, department or status changes end the user's sessions |
| Reset password | `POST /api/v1/admin/users/:id/reset-password` | issues a one-time link (shown once) and ends the user's sessions; also allowed for your own account (owner decision 2026-11-12) — your own sessions end too and the dialog offers a button to open the link |
| Remove | `POST /api/v1/admin/users/:id/revoke` | soft revocation: status REVOKED, sign-in impossible, outstanding links expired, sessions ended, email released; the user row, enrollment record, uploads and audit history are kept |

Every write requires a password confirmation within the last `ADMIN_STEP_UP_MAX_AGE_MINUTES` (the UI asks for it).

**UI (2026-11-12):** account status is an on/off switch in the table (on = Online = `ACTIVE`, off = Offline = `DISABLED`;
locked for your own account and the last active admin; invited/removed accounts show a badge instead). The status filter
offers ทุกสถานะ / Online / Offline. The edit dialog changes display name, department and role only. Row actions (แก้ไขข้อมูล,
รีเซ็ตรหัสผ่าน, ยกเลิกการใช้งาน) are in a three-dot menu. There is no self-service "change password" button: users get
a one-time reset link from an administrator.

## Safety rules (server-enforced)

- **Last administrator:** a change that would leave no ACTIVE ADMIN fails with `LAST_ADMIN`. The check locks all
  active ADMIN rows (`SELECT … FOR UPDATE`), so two admins demoting each other concurrently cannot both succeed.
- **No self-changes:** administrators cannot change their own role or status, or remove themselves (resetting their own password is allowed and ends their sessions).
- **Removed accounts are final:** they cannot be edited back; enroll the person again (a new account) if needed.
- **No password visibility:** passwords and hashes are never shown or returned; links appear once and only their hash
  is stored.
- **Audit:** `USER_CREATED`, `USER_UPDATED`, `ROLE_CHANGED`, `MEMBERSHIP_CHANGED`, `USER_DISABLED`, `USER_ENABLED`,
  `USER_REVOKED`, `PASSWORD_RESET_ISSUED`, `REAUTH_REQUIRED` — with actor and **target user**. Enrolling or promoting an
  ADMIN raises a `PRIVILEGE_CHANGE` security alert.

## Handing over a link

The link looks like `https://<deploy-studio>/password#token=…`. Send it through an approved internal channel to the
person whose email is on the account (not to a shared mailbox). It works once and expires after
`PASSWORD_LINK_TTL_HOURS` (default 24). If it leaks before use, issue a new one — the old one stops working.

## Bootstrapping and incident response (CLI)

The infra-only CLI (`scripts/admin.ts`, needs database credentials, not reachable over HTTP) covers the first
administrator and emergencies:

```bash
npm run admin -- create-user --email first.admin@company.com --name "First Admin" --role ADMIN --operator <you>
npm run admin -- reset-password --email someone@company.com --operator <you>
npm run admin -- disable-user --email someone@company.com --operator <you>
npm run admin -- revoke-sessions --email someone@company.com --operator <you>
```

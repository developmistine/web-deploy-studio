# Upload security

Pipeline: browser → `POST /api/v1/websites/:id/deployments` (authorize **before** reading the body, rate limit)
→ `receiveUpload()` structural validation in a private temp dir → write-once private storage → `BUILD` job →
worker re-validates while extracting, malware scan hook, canonical build artifact → controlled image.

| Control | Implementation | Status |
|---|---|---|
| Request size gate (Content-Length required; > archive limit + 1 MB → 413) | `src/server/uploads/intake.ts` | Tested (`upload-api.test.ts`) |
| Max archive / file count / extracted bytes / per-file bytes / compression ratio (>1 MB entries) | `limits.ts` (`UPLOAD_MAX_*`) | Tested (`archive.test.ts`) |
| Real decompressed byte counting (headers not trusted); lying headers → reject | `archive.ts` `GuardStream`, yauzl `validateEntrySizes` | Tested |
| Path normalization: NFC; reject absolute, drive letters, `..`, `\`, control chars, empty/dot segments, leading `-`, unusual characters, depth/length | `paths.ts` | Tested |
| Duplicate / case-insensitive conflicting paths | `assertUniquePaths` | Tested |
| Symlinks, devices, FIFOs rejected | `archive.ts` (external attributes) | Tested |
| Encrypted entries, unsupported compression, nested archives rejected | `archive.ts`, `file-types.ts` | Tested |
| Extension allowlist (static web types only; no php/sh/exe/Dockerfile/wasm) | `file-types.ts` | Tested |
| Content verification: UTF-8 without NUL for text, magic bytes for binaries | `ContentValidator` | Tested |
| `index.html` required at root or in a single top-level folder | `determineRootPrefix` | Tested |
| SHA-256 of archive and every file; hash re-verified by the worker before build | `intake.ts`, `build.ts` | Implemented |
| Private quarantine storage, server-generated keys, root confinement, write-once (`COPYFILE_EXCL`, 0440) | `src/server/storage` | Tested |
| Temporary files always removed | `finally` blocks in intake/build | Implemented |
| Extraction confined to an empty private dir with exclusive (`wx`) creates | `extractZip` | Tested |
| Malware scanning integration (ClamAV clamd INSTREAM) | `worker/src/scan.ts`, `MALWARE_SCAN_MODE` | Implemented, **off by default** (R-08); a warning is logged per build |
| Suspicious-script check (heuristic static analysis of HTML/JS/SVG/CSS): HIGH findings (crypto miners, obfuscated `eval(atob(…))`/packer code, scripts loaded from raw IP addresses, password forms posting to another site) block the upload + `SECURITY_ALERT`; MEDIUM findings (external scripts/frames/forms/redirects, `eval`/`new Function`, `document.cookie`, SVG scripts, long encoded strings, CSS `javascript:`, plus CSP-bypassing channels: `window.open`, WebRTC, redirects to runtime-built URLs) are stored on the revision, logged and shown before Deploy, which requires an explicit acknowledgement | `src/server/uploads/content-scan.ts`, `worker/src/build.ts`, `CONTENT_SCAN_MODE` (`block` default / `warn` / `off`) | Implemented, Tested (`tests/unit/content-scan.test.ts`, `tests/integration/upload-api.test.ts`, `tests/ui/ui.test.tsx`). Heuristic: can miss obfuscated code and flag legitimate code — the CSP and origin isolation remain the primary runtime controls |
| Secret scanning of uploads | — | Planned |
| Upload rate limit per user | `RATE_LIMIT_UPLOADS_PER_HOUR` | Implemented |
| Rejections audited (`UPLOAD_REJECTED`) with reason only | upload route | Tested |
| Bounded CPU/memory/time for extraction | worker job timeout + compose limits | Implemented (compose); cgroup verification pending |

Static scanning cannot prove HTML/JS safe; hosted JS is treated as hostile and contained by origin isolation and
the gateway (see `domain-isolation.md`).

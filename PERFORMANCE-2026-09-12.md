# Performance changes — September 12, 2026

This release reduces initial JavaScript, avatar transfer/decode work and per-card visibility subscriptions. It builds on `ec4f0c5`, which includes the collectible gift and administration release.

## Browser measurements

Measured with the production build in Chromium, using the same isolated fixture: 60 text posts and 15 avatars copied from existing media. API responses were synthetic; no user messages, gifts or purchases were created. Byte counts below are decoded response sizes, not compressed download sizes.

| Resource | Before | After |
| --- | ---: | ---: |
| Main Noctgram module | 895,877 B | about 320 KB |
| JavaScript loaded on opening the feed | 1,666,502 B | 1,189,667 B |
| Seven initially requested avatar images | 1,405,535 B | 14,854 B |
| Initial feed requests | bootstrap + feed | bootstrap only |

No broken avatar images or main-thread tasks over 50 ms occurred during the four-second scroll check in either build. Timing on this machine did not reproduce the user's intermittent freezes, so these figures establish resource savings, not a guaranteed frame rate on every PC. Settings, profile design, channels, Premium, Stars, profiles and opening a conversation were checked in the browser.

## Implementation

- Eighteen large panels use shared lazy module promises, loading feedback and a retry boundary. The editor mounts each tab on its first visit and retains its draft afterward.
- Avatars have 96, 192 and 384 pixel WebP variants with responsive sources, explicit dimensions and asynchronous decoding. New avatar uploads generate bounded previews; ordinary attachments and original files retain their URLs and contents. Missing previews fall back to the original.
- Only current profile avatars use private HTTP revalidation. Authentication, account restrictions, file moderation and media permissions are checked before a 304 response. Chats, downloads, originals and range requests remain `private, no-store`.
- Storage reservations include original and preview bytes. Failed uploads enter cleanup, which removes all four object keys. No schema migration is required.
- Avatar/ring animations share one visibility observer; post view accounting shares another, retaining its 50% visibility and one-second dwell requirements. Decorative video elements pause outside the viewport and stay mounted during brief scroll reversals; after ten seconds offscreen they unmount to release decoder resources. Avatar memoization ignores unrelated profile counters.
- Bootstrap reuses its initial feed. Independent bootstrap/account reads run concurrently. Public media reference checks use `UNION ALL` with `LIMIT 1` to avoid unnecessary deduplication.

## Existing media

An additive backfill created and hash-verified 45 previews for 15 current avatars. Original files were verified unchanged. Original images total 4,035,545 B; all 192 pixel previews total 99,886 B. Upload byte accounting was updated idempotently to include previews. No profiles, messages or balances were changed.

## Validation and rollback

532 isolated tests, TypeScript, lint, production build, deployment configuration and secret checks passed. Added tests cover preview formats, access checks before cache validation, fallback and range delivery, upload accounting/failure cleanup, shared visibility, lazy module retries and retained editor drafts.

Rollback can restore the previous Worker without deleting previews. Original media URLs remain compatible; leave the additional storage accounting in place. Browser and deployment reports are kept in the ignored `work/perf-*` artifacts, which may reference private fixture media and must not be committed.

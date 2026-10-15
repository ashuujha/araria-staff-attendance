# Faster startup, directory and photo saves

Apply the contents of `supabase/migrations/20261015_z_fast_start.sql` in Supabase SQL Editor, after the existing photo and office-board migrations, then run `npm run deploy`. Existing accounts, holidays, notices and attendance remain intact.

## Requests removed

Counts below describe a successful ordinary startup, excluding optional translations and admin CAPTCHA:

| Path                                     | Previous upstream requests | Fast-start upstream requests |
| ---------------------------------------- | -------------------------: | ---------------------------: |
| Staff mobile login and initial dashboard |                          8 |                            3 |
| Admin email login and initial dashboard  |                          8 |                            2 |
| Restore a session and initial dashboard  |                          6 |                            1 |

Login now returns the initial records and office board, plus a directory only for an authorized admin. The client uses that response immediately instead of launching separate attendance/admin and office requests that each repeat profile validation. Session restoration uses the same authenticated database RPC. The SQL function is SECURITY INVOKER and keeps all existing RLS policies; inactive users, anonymous callers and out-of-block reads remain disallowed. Password verification, admin CAPTCHA and server-side attendance validation remain mandatory. Private responses keep `Cache-Control: no-store`.

If the function has not been installed, only a missing-function response triggers the original loading path. Invalid tokens and service failures never use this fallback. The speed improvement is fully active after installing the migration.

## Rendering and uploads

- Only 25 attendance or directory rows mount at a time. Search/filter matching still checks all loaded staff, and paging controls show the matching result range.
- Attendance snapshots and per-staff lookups are indexed/memoized rather than rescanned for every directory row.
- Visible admin attendance polling stays at 30 seconds. It does not repeatedly fetch all personnel: directory refreshes happen after five minutes or an explicit Refresh; successful staff mutations update the visible directory immediately.
- Workplace photos larger than 300 KB are resized in a supporting browser to a maximum 1600-pixel long edge and JPEG quality 0.82. The smaller result is uploaded only if it actually reduces bytes. Small originals, unsupported browsers and conversion failures use the existing path. Decoded image resources are closed. Leave documents are unchanged.
- Server image decoding imports load only when processing an image; signing an upload or validating a PDF no longer eagerly loads Sharp. Server validation and private storage links remain in place.

## Evidence and limits

`tests/fast-start.test.mjs` checks exact request counts, response reuse, missing-RPC fallback, rejected JWTs and browser resize dimensions/resource cleanup. `tests/office-board.test.mjs` exercises the real SQL under authenticated staff/admin/block-admin roles and RLS. Admin tests check directory-free polling. Existing attendance and file tests cover save rules.

`npm run check:capacity` exercises 250 logins, session restores and attendance reads against a simulated Supabase service. This tests concurrency and identity separation, not live hosting speed or uptime. `docs/CAPACITY_CHECK.json` records that scope. API responses include Server-Timing for login and session startup.

The current environment cannot reach live Vercel/Supabase services or run Chromium, so actual browser paint times, cold-start latency, database-region placement and production percentiles have not been measured here. No fixed response-time or uptime guarantee is made. The reduced request counts, smaller uploads and bounded lists are concrete code changes, not a live latency measurement.

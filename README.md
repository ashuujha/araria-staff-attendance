# अररिया कर्मी उपस्थिति पोर्टल

A login-first, Hindi/English staff attendance portal. Staff sign in at `/`; administrators sign in at `/admin`. No sample dashboard or sample staff data is published. Initial administrator: **sfc.aditya@gmail.com**.

The header language selector switches between Hindi and English and remembers the choice. English works without a Google key. Optional `GOOGLE_TRANSLATE_API_KEY` enables Google Cloud translation of fixed interface labels only; staff identities and saved details are never sent to that service.

## Daily use

1. Staff open `/` and administrators open `/admin`, then sign in with their phone number/email and password. Each page accepts its corresponding account role.
2. Staff see their own name and block from the staff register. Choose an assigned department, panchayat and position, then Present, Absent, On leave or Deputation.
3. Present and Deputation use **Save arrival draft** to record server in-time immediately. Deputation requires the actual workplace name. Upload an ordinary JPEG/PNG workplace photo strictly below 5 MiB. No GPS permission, camera capture, location confirmation or accuracy threshold is required. The admin sees the saved draft before out-time exists.
4. When leaving, reopen the same record and **Save out time & finish**. The server records out-time on the existing daily record; arrival details remain unchanged. Drafts survive browser refresh/sign-out.
5. Absent requires a written reason (3–1000 characters). Absent and On leave save a completed daily status without pretending that staff entered a workplace. Leave supports CL/SL and a required JPEG/PDF document (strictly below 5 MiB).
6. Admins see attendance and a staff directory, search by name/phone, and filter by date, department, block, panchayat, position, status and draft/completed state. A staff member without a daily record is **Not recorded**, distinct from a submitted Absent entry. Details include in/out times, status, absence reason, workplace photo and leave evidence. GPS/location links and device-reset controls remain hidden. Dashboard refreshes periodically and can be refreshed manually.

Staff select their own registered assignments; they cannot change another person's identity. Records snapshot names and assignments so later directory edits do not rewrite historical attendance. Admin/district/block access and private file access remain governed by database row-level security.

Staff can sign in from any browser with their password, including accounts previously linked to another device. Sessions do not require a device cookie. The current attendance route uses `save_attendance_with_evidence`; the previous GPS workflow remains in source for a later rollout. Existing photos and locations are retained in storage but hidden in the UI; no historical data is deleted by this change.

Routine admin actions—adding, editing or removing staff, resetting a password and managing attendance—do not ask for a reason. The server records the authenticated actor and an automatic operation description for the existing audit log. Holiday reasons and staff absence explanations remain required.

## Admin CAPTCHA setup (typed image code and Cloudflare Turnstile)

Only `/admin` shows a required six-character image CAPTCHA with an input box and refresh button, alongside the Turnstile widget. The image code is generated on the server, expires after five minutes and is checked using a signed challenge. The image is rasterized; its answer is not returned as text. Both the typed answer and provider verification must pass before password validation. Refresh and each login attempt reset the code. Staff login does not use CAPTCHA. Admin login requires a valid server-verified token; missing configuration, expired/reused tokens and provider failures do not bypass verification. A fresh widget is rendered after each login attempt. The server pins successful verification to action `admin_login` and the hostname in `APP_URL`.

1. Open https://dash.cloudflare.com/, choose **Turnstile**, then **Add widget**. Select **Managed**. In Hostname, enter `araria-staff-attendance.vercel.app` (no protocol/path). Also allow `localhost` if testing locally.
2. Add `TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET_KEY` to `.env.local`. The site key is public; the secret stays server-side. No keys are bundled into browser JavaScript. `/api/auth/captcha` returns the public site key, image and signed challenge; it never returns either secret or the plaintext answer.
3. Run `npm run deploy`; the deployment helper copies both variables to Vercel production. Keep `APP_URL` set to the production origin. `.env.development.local` overrides it for localhost.
4. Complete the CAPTCHA at `/admin`, then enter the admin credentials. Never use Cloudflare dummy keys in production; known test keys are rejected there.

Cloudflare references: [free plan](https://developers.cloudflare.com/turnstile/plans/), [widget setup](https://developers.cloudflare.com/turnstile/get-started/), [server verification](https://developers.cloudflare.com/turnstile/get-started/server-side-validation/). The widget loads asynchronously; a server verification call is added only to admin sign-in. No SQL update is needed for CAPTCHA.

## Admin staff management and loading

At `/admin`, authorized Super Admins and Block Admins can add staff, edit name/mobile/email/account status and assignments, or remove staff. New account credentials are displayed once after creation. Removing staff disables their login and hides them from the directory while retaining historical attendance. District viewers remain read-only. Changes use the existing scoped, audited staff-management RPCs.

The public staff/admin pages are pre-rendered and show login immediately. Session restoration runs in the background with stale-response protection. Supabase validates session JWTs and RLS during the profile read, avoiding a redundant Auth lookup. Admin attendance/directory reads run in parallel and omit unused GPS/photo fields. Staff editing loads as a separate chunk when opened. Database/Auth requests time out after 8 seconds each; client requests after 25 seconds. These changes reduce request waterfalls; live speed still depends on hosting and Supabase responsiveness. Login responses include a `Server-Timing` duration for measurement after deployment.

## Database setup / upgrade

Set server-only environment values in `.env.local` and Vercel production:

- `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY` (new `sb_secret_...` key, never `NEXT_PUBLIC_`).
- `APP_URL`: exact production origin, e.g. `https://araria-staff-attendance.vercel.app`.
- `UPLOAD_SCAN_URL`, `UPLOAD_SCAN_TOKEN`: optional external binary file scanning. Both values must be set together; if configured, a scan must succeed. Without it, the workflow still validates file bytes, decodes/reencodes JPEGs and performs limited PDF format/active-content checks (not comprehensive malware scanning).

For an **existing database**, apply any unapplied migrations in order:

1. `supabase/migrations/20261012_master_data_shared_attendance.sql`
2. `supabase/migrations/20261013_simple_attendance.sql`
3. `supabase/migrations/20261013_z_required_leave.sql`
4. `supabase/migrations/20261015_basic_staff_attendance.sql`
5. `supabase/migrations/20261015_workplace_evidence.sql` (required for ordinary photos and absence reasons)
6. `supabase/migrations/20261015_office_board.sql` (required for holidays and the notice board)
7. `supabase/migrations/20261015_z_fast_start.sql` (combines login/session dashboard loading into one authenticated database call)
8. `supabase/migrations/20261021_live_changes.sql` (scoped live-update counters for profiles, attendance, holidays and notices)

For a **new database**, first apply `supabase/schema.sql`, then `supabase/panchayats.sql`, then all migrations above. Do not rerun the initial schema on an existing installation. Deployment alone does not apply SQL migrations. Disable public Supabase sign-ups.

## Import the supplied staff workbook

From `portal/`:

```bash
npm ci
python3 scripts/import_staff.py '../ALL STAFF ARARIA.xlsx'
node --env-file=.env.local scripts/seed.mjs
# Review private/staff-import.json before applying:
node --env-file=.env.local scripts/seed.mjs --apply
```

The supplied workbook produces 242 identifiable accounts, 59 vacant rows and two conflicting identity groups. Three assignments have a missing department or position. Conflicting identities stay in the private review data; missing assignment fields are not guessed. Correct these using the source register and authorized master-data administration before those assignments can be used for attendance. Vacancies are not people and are not provisioned.

The importer preserves registered assignments and merges repeated entries by phone/email only when names agree. The seed creates missing accounts/profiles; it preserves existing passwords and existing master-data edits. Workbook, private imports, generated credentials and `.env.local` are ignored by Git and are never imported by browser components.

Set `INITIAL_ADMIN_PASSWORD` locally to provision a new administrator:

```bash
node --env-file=.env.local scripts/seed.mjs --admin-only --apply
```

New staff passwords follow `Araria@<last4 phone digits>#26` (email-only accounts get a random password). Newly created staff credentials are written once to a permissions-restricted `private/credentials-*.csv`. Deliver privately. This predictable phone-based pattern should be replaced with stronger passwords before an operational rollout. Provisioning does not reset existing accounts.

To reset the existing administrator, set a quoted `INITIAL_ADMIN_PASSWORD` in `.env.local` (quotes preserve `#`), then run `node --env-file=.env.local scripts/reset-admin-password.mjs`. The script updates the matching active administrator, clears that administrator's previous device binding, verifies the new login and records an audit event. It preserves staff credentials and device bindings. Do not upload this environment variable to Vercel.

## Retained GPS implementation (currently disabled in the client)

The website camera uses fresh browser location readings. Photon reverse geocoding supplies a **nearby mapped address**, and OpenStreetMap tiles supply the real map thumbnail with attribution. Both default services need no API key. The saved photo retains the full camera frame and appends the map, nearby address, assigned workplace, coordinates, reported accuracy and server save time in IST. Assigned workplace and nearby mapped address remain separate.

GPS Map Camera's public website offers mobile apps; its enterprise site advertises custom API integrations. This portal uses its own camera with free map/address services, rather than claiming an embedded GPS Map Camera app. Provider references: [Photon](https://github.com/komoot/photon), [OpenStreetMap tile policy](https://operations.osmfoundation.org/policies/tiles/), [GPS Map Camera Enterprise](https://enterprise.gpsmapcamera.com/).

Requests use bounded downloads, timeouts, caching and per-process throttling. Public providers have usage limits and no availability guarantee; multiple Vercel instances do not share a global limiter or durable tile cache. For substantial traffic, configure a suitable hosted or self-hosted provider through the trusted HTTPS `PHOTON_REVERSE_URL` and `OSM_TILE_BASE_URL` overrides. If a provider is unavailable, attendance still retains coordinates and explicitly marks the unavailable address/map. These APIs cannot correct an inaccurate browser/device location reading. Confirm the map position before saving; use a GPS-enabled phone when the laptop and Google Maps both return an incorrect location.

## Verify and publish

The application's five-attempt/15-minute login lockout has been removed at the owner's request. Existing `login_attempts` rows are no longer read or updated by login and do not require a database reset. Password validation and role checks still apply; staff device binding is disabled for onboarding. Supabase's own service limits remain controlled by Supabase.

```bash
npm run typecheck
npm test
npm run build
npm run dev
# In another terminal:
node scripts/browser-check.mjs
```

The browser check uses isolated test API responses to exercise real UI flows. Test data is confined to verification scripts, never the production application. Database tests verify draft persistence/visibility, same-record completion, duplicate protection, staff access restrictions and file ownership. API tests exercise upload scanning and validation.

Configure the production environment, apply database migrations, provision the reviewed workbook, then deploy from `portal/`:

```bash
npm run deploy
```

SQL setup requires database administrator access; a Supabase API key cannot execute arbitrary SQL. End-to-end production login, camera/GPS, optional scanner and private upload verification require reachable live services.

The existing staff-management, admin correction and sync APIs remain available. Optional Google Sheets configuration uses `GOOGLE_SHEET_ID`, `GOOGLE_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY` and `CRON_SECRET`; the current single-job worker is a periodic mirror, not real-time sync. Do not expose service-account credentials or source data through the client.

## Holidays and notices

After applying `20261015_office_board.sql`, admins open **Holidays & Notices** in the dashboard. Writing admins (super admin and block admin) can set/edit/remove a date and its holiday reason, and publish/remove notices. These settings apply to all staff across blocks; district viewers can only read them. Every Sunday is permanently closed for attendance, even after removing a holiday entry for that Sunday. Existing attendance is preserved. Staff see a Holiday message with the reason and cannot upload evidence, save an arrival/status or checkout on a closed day. Database triggers enforce the same rule for all attendance write paths. Holiday and notice changes are audited.

All active logged-in staff see the shared notice board above attendance. Notices retain their original text and line breaks and are rendered as plain text, never HTML. With the live-changes migration installed, the board and calendar refresh when their database counters change; the page checks while visible and on returning. The server rechecks closures for every upload and attendance save, so stale pages cannot bypass a new holiday. If the calendar cannot be loaded, the staff form stays unavailable until refresh succeeds. Historical records are neither deleted nor automatically turned into absences.

The staff and admin login cards use a consistent maximum width. The CAPTCHA image fits the input column, and narrow forms use Cloudflare's compact widget to avoid overflow. No CAPTCHA keys change.

## Loading and save performance

The fast-start migration makes login and session restoration return the initial dashboard, calendar and notices together. The function uses the caller's authenticated JWT and existing RLS; no private response or identity is globally cached. Staff do not receive a staff directory. Without this migration the server falls back to the previous loading path only when the RPC is missing. See `docs/PERFORMANCE.md` for request counts and verification limits.

Admin lists render 25 rows per page, while search and filters still cover the complete loaded directory. Each visible session checks scoped database change counters every five seconds and on focus/reconnect. Changed attendance, directory and office data refresh automatically. Changes to the logged-in profile refresh assignments; invalid workplace selections are cleared. This uses Supabase directly and does not depend on the optional Google Sheets mirror. Large workplace photos are resized in the browser to at most 1600 pixels on the long edge before upload when supported; inputs must still be under 5 MiB. The server still verifies file content, strips metadata and enforces the calendar and attendance rules. Small photos, unsupported browsers and failed resizing retain the original upload path. Leave documents are preserved.

## Attendance reports

An admin or district viewer can expand **Download attendance report** and choose a day, month or date range plus Excel or PDF. The panel first asks whether to include all staff or filter this download; report filters can combine name/mobile, department, designation, block and panchayat independently of dashboard filters. Every matching staff member is included, even beyond the current dashboard page. Each month gets its own worksheet or PDF section. The grid shows name, mobile, block and P (present), PP (checked in, not yet checked out), A (submitted absence or missing attendance after a working day ends), L (leave), O (deputation/on duty), H (administrator holiday), W (Sunday), NR (today awaiting attendance), or a blank future working day. A saved record takes precedence over a holiday marker. A separate Staff Details worksheet or PDF section lists each selected staff member's ID, names, mobile numbers, email, block, account status and all assigned department/panchayat/position combinations. The Excel Details sheet and PDF attendance details section include in/out times, leave type and stated reasons. A report is limited to 366 days and 4 MiB; choose a shorter period if it is too large. Downloads are private and uncached.

Report generation requires the `exceljs` and `pdfkit` npm dependencies. Font files for Hindi and English are bundled in `assets/report-fonts` for deployment. The report uses the same Bihar seal source as the site when the image host is reachable; a text Bihar mark is used if it is unavailable. The SQL migration above must be applied before the live counters are available. Production changes require redeployment after the migration; deployment does not run SQL automatically.

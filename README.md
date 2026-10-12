# अररिया कर्मी उपस्थिति पोर्टल

Hindi-first attendance portal built with Next.js App Router, TypeScript, Tailwind, PostgreSQL/Supabase and private file storage. Initial administrator: **sfc.aditya@gmail.com**.

Use the **हिन्दी / English** switch in the header to change the interface language. The selection is remembered on your browser, including navigation, forms, accessible labels and messages. Panchayat labels are translated for display; saved attendance values remain unchanged.

The public site starts in an explicitly labelled **preview workspace** with fictional staff records. Real names, phone numbers, the workbook and generated credentials are not shipped to the browser or committed. Live login and attendance require the database setup below.

## Setup with Supabase's new keys

```bash
npm ci
cp .env.example .env.local
```

Set these in `.env.local` and Vercel → Project → Settings → Environment Variables:

| Variable                   | Value                                                                   |
| -------------------------- | ----------------------------------------------------------------------- |
| `SUPABASE_URL`             | `https://vkflommzumlrrzvwbdub.supabase.co`                              |
| `SUPABASE_PUBLISHABLE_KEY` | Your `sb_publishable_...` key                                           |
| `SUPABASE_SECRET_KEY`      | Your **server-only** `sb_secret_...` key                                |
| `APP_URL`                  | Exact site origin, such as `https://araria-staff-attendance.vercel.app` |
| `CRON_SECRET`              | Random secret (`openssl rand -hex 32`)                                  |
| `UPLOAD_SCAN_URL`          | HTTPS file scanning endpoint                                            |
| `UPLOAD_SCAN_TOKEN`        | Its authentication secret                                               |

This app uses the new API key format. API keys are sent in `apikey`; `Authorization: Bearer` is used only for user session JWTs. See [Supabase API key migration](https://supabase.com/docs/guides/getting-started/migrating-to-new-api-keys). Do not prefix the secret key with `NEXT_PUBLIC_`. No legacy anon/service-role environment variables are needed.

1. Apply **supabase/schema.sql**, then **supabase/panchayats.sql**, in the project's SQL Editor. The schema is a first-install migration; do not rerun it on an existing installation.
2. Disable public sign-ups in Supabase Auth. Configure Supabase Auth's built-in rate limits and password policy. The server also maintains a five-attempt, 15-minute application login limit.
3. Review the workbook import locally:

   ```bash
   npm run import:staff
   npm run seed
   ```

   The supplied workbook yields 242 ready accounts, 59 vacancies and 2 conflicting identity groups. Conflicts remain in `private/staff-import.json` for review and are not provisioned. Secondary numbers are stored; primary phone or email is the login identifier. Email-only entries receive a random password.

4. Set `INITIAL_ADMIN_PASSWORD` to at least 14 characters in **local environment only**. Provision after reviewing the preview:

   ```bash
   node --env-file=.env.local scripts/seed.mjs --apply
   ```

   Newly generated credentials are written once to a private, permissions-restricted CSV. Existing accounts/passwords are not reset. Deliver credentials through your authorized channel; never commit them. The requested staff password pattern is `Araria@<last4>#26`, which is predictable; use Supabase Admin to replace it with stronger passwords before operational rollout.

5. Sign in as admin, open Panchayats, and set each worksite's verified latitude/longitude and radius. Unknown coordinates deliberately block punches. Defaults are 300 m; no coordinates have been guessed.
6. Configure file scanning: the endpoint accepts binary `POST`, `Authorization: Bearer <UPLOAD_SCAN_TOKEN>`, and must return `{"clean":true}` only after scanning successfully. Missing/unavailable scanning blocks uploads. Signed upload URLs send files directly to private Supabase storage, supporting 5 MB documents without Vercel request-body limits. Server validation, scanning and photo processing run before attendance is accepted.
7. Set the production `APP_URL`, redeploy and complete the [test checklist](docs/TEST_CHECKLIST.md).

## Google Sheets, when available

Set `GOOGLE_SHEET_ID`, `GOOGLE_SERVICE_ACCOUNT_EMAIL` and `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY`. Enable the Sheets API and share the spreadsheet with the service account as Editor. Keep human access read-only.

A database trigger queues each attendance update in the same transaction. The protected `/api/sync` endpoint processes **one job per call**, with a global lease, retries/backoff and monthly tabs. A hidden Record ID column lets retries and punch-out update the same row. File URLs require portal login and generate 60-second signed links.

The included Vercel Hobby-compatible cron runs once daily. For a live mirror, use a scheduler or plan supporting a call every minute with `Authorization: Bearer <CRON_SECRET>`. At peak this single-job worker drains 395 jobs in about 6.6 hours; it is a safe starter worker, not a real-time-throughput implementation. Increase batching and test quotas before calling it live. The Summary tab, flagged-row formatting and manual resync UI are not yet implemented.

## Run and verify

```bash
npm run dev
npm run typecheck
npm test
npm run build
npm start
# With Chrome installed:
node scripts/browser-check.mjs
```

The database tests execute the schema in embedded PostgreSQL, including RLS, concurrent duplicate punches, capture expiry, geofence failure, device binding, corrections and durable sync retry. Production Supabase, malware-scanner and Google integration still require live acceptance tests.

## Deploy

```bash
git init -b main
git add .
git commit -m "Build Araria staff attendance portal"
gh repo create araria-staff-attendance --private --source=. --remote=origin --push
vercel link --yes --project araria-staff-attendance
vercel git connect https://github.com/ashuujha/araria-staff-attendance.git
vercel --prod
```

Configure the server environment before enabling live attendance. Source data, secrets, credentials and `.vercel` are excluded by `.gitignore`.

## Security and operational limits

- Server date/time, one-use 120-second capture challenges, device cookie binding, 50 m accuracy limit, server geofences, impossible-travel rejection and repeated-coordinate/odd-hour flags.
- Camera-only staff UI; server-generated time/GPS watermark, byte-hash and normalized perceptual-hash duplicate checks. Perceptual collisions can reject similar scenes; an admin should investigate before loosening validation.
- RLS restricts staff to their own records and block admins to their block. Client writes and mutating RPC execution are revoked. Private storage has no client policies; signed upload tokens and server-mediated reads grant scoped access.
- Secure httpOnly one-hour sessions, SameSite cookies, exact-origin CSRF checks, input/file validation and security headers. Re-login is required after expiry. Device binding is a browser cookie, not hardware attestation.
- **Web GPS and camera cannot prove unmodified-device location/capture.** A modified client can forge browser coordinates or submit another image. Challenges prevent simple replay, not full client compromise. For verified anti-spoofing use a managed native app with device attestation. VPN/proxy detection, MFA enforcement and first-login password change are not implemented.
- Implemented admin flows: read dashboard/records, CSV and browser PDF exports, staff edit/deactivate/device reset, geofence edit, private attachments, audited punch-time corrections. API supports password resets and assignment changes; add accounts with the seed script. Browser XLSX upload/import preview, Excel export, map-pin view, date ranges and comprehensive audit/sync consoles are not yet implemented.
- Configure daily backups and at least one-year retention in your Supabase plan. This repository does not claim those services are enabled. Establish cleanup for unused signed uploads, expired challenges and abandoned private files.

[कर्मी मार्गदर्शिका](docs/STAFF_GUIDE_HI.md) · [एडमिन मार्गदर्शिका](docs/ADMIN_GUIDE_HI.md) · [Verification checklist](docs/TEST_CHECKLIST.md)

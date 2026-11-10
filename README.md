# Araria Staff Attendance

Panchayati Raj Department attendance for the nine blocks of Araria District. The application uses Next.js 16, Supabase Auth/Postgres/Storage, and Vercel. Hindi and English are available throughout the portal.

## Routes and roles

| Route    | Role     | Scope                                       |
| -------- | -------- | ------------------------------------------- |
| `/`      | Staff    | Own profile, assignments and attendance     |
| `/bpro`  | BPRO     | One assigned block                          |
| `/dpro`  | DPRO     | All nine blocks, with optional block filter |
| `/admin` | Redirect | Sends visitors to `/dpro`                   |

Both admin routes require the typed image CAPTCHA and Cloudflare Turnstile. Login checks the role on the server. BPRO and DPRO dashboards include attendance, staff management, holidays, notices, leave balances, evidence and PDF/XLSX reports. DPRO also sees a per-block daily summary. Staff continue to submit Present, Absent, Leave or Deputation, with arrival drafts and later out-time. Photos and documents remain private and have signed links after authorization checks. District holidays and notices reach all blocks; block entries reach the selected block.

## District conversion

The migration sequence and checks are in [docs/MIGRATIONS.md](docs/MIGRATIONS.md). **A Vercel deployment does not apply SQL.** First run the read-only dry-run SQL and take a database backup. The data-changing migrations are intentionally not run by `npm run deploy`. Non-Panchayati-Raj staff are archived, not physically deleted; historical attendance remains stored. Only one DPRO and one BPRO per block may be active.

The official district block list spells the fifth block **Kursakanta**. The new block catalog follows the [Araria district administration list](https://araria.nic.in/subdivision-blocks/).

## Administrator accounts

Copy `scripts/seed-admins.example.json` to `private/seed-admins.json`, replace all placeholders with the DPRO and nine BPRO credentials supplied by the owner, and keep the file private. Passwords must be at least 10 characters. Then, after applying the SQL migrations:

```bash
node --env-file=.env.local scripts/seed-admins.ts
node --env-file=.env.local scripts/seed-admins.ts --apply
```

The first command validates without writing. Repeating `--apply` updates profiles but preserves existing passwords. To rotate passwords deliberately, set new values in the private file and run `--apply --rotate-passwords`. Do not put admin passwords in Git, Vercel client variables, chat, or staff export sheets. If an active DPRO with a different email already exists, the script stops for manual review.

## Staff import

Run the importer for one block at a time. It accepts only Panchayati Raj rows; review its output before creating accounts.

```bash
python3 scripts/import_staff.py '../ALL STAFF ARARIA.xlsx' --block Araria
node --env-file=.env.local scripts/seed.mjs
node --env-file=.env.local scripts/seed.mjs --apply
```

The import and generated credentials live under gitignored `private/`. Existing staff passwords are preserved. New staff may also be added in the authorized BPRO/DPRO dashboard.

## Environment and verification

Set server-only `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`, `APP_URL`, `TURNSTILE_SITE_KEY`, and `TURNSTILE_SECRET_KEY` in `.env.local` and the corresponding deployment environment. Set a strong server-only `LOGIN_LIMIT_SECRET` for stable keyed rate-limit identifiers. `APP_URL` must use HTTPS in production. Disable public Supabase sign-ups. The optional `GOOGLE_TRANSLATE_API_KEY`, `PHOTON_REVERSE_URL`, `OSM_TILE_BASE_URL`, and upload scanner variables retain their previous behavior.

```bash
npm ci
npm run typecheck
npm test
npm run build
npm run dev
```

Production login, device camera, Supabase RLS, storage signing, and capacity require a separately authorized live verification. Build or unit test success alone does not establish production capacity or security certification.

Reports retain the existing PDF/XLSX layouts; the district header changes according to the export scope. The admin dashboard shows 25 rows per page and polls scoped changes while visible. The earlier reference PDFs were not present in this branch, so final visual comparison still needs the original files.

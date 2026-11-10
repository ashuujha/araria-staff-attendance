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

CL/SL submissions now create pending applications. The staff member sees the pending decision, and the request appears simultaneously in that block's BPRO dashboard and the DPRO dashboard. Either administrator may approve or reject it; the first decision wins. Only approval creates a leave attendance row and uses the leave allowance. Administrators see a pending alert and can enable the new-application sound from their dashboard; browsers require that click before audio can play. Apply migration 10 before deploying this code.

Approving a leave application requires a signed copy. An administrator can draw a visual signature in the portal, which adds a signed decision page to the original PDF or JPEG, or upload an already signed JPEG/PDF smaller than 5 MB. The applicant can open that private signed copy from their leave history. Rejection requires a reason shown to the applicant. BPRO and DPRO have a date-filtered leave decision history with the decision time and approver. The drawn signature is a visual mark, not a cryptographic digital certificate. Apply migration 11 after migration 10 before deploying this version.

## District conversion

The migration sequence and checks are in [docs/MIGRATIONS.md](docs/MIGRATIONS.md). **A Vercel deployment does not apply SQL.** First run the read-only dry-run SQL and take a database backup. The data-changing migrations are intentionally not run by `npm run deploy`. Non-Panchayati-Raj staff are archived, not physically deleted; historical attendance remains stored. Only one DPRO and one BPRO per block may be active.

The official district block list spells the fifth block **Kursakanta**. The new block catalog follows the [Araria district administration list](https://araria.nic.in/subdivision-blocks/).

## Administrator accounts

Copy `scripts/seed-admins.example.json` to `private/seed-admins.json`, replace all placeholders with the DPRO and nine BPRO credentials supplied by the owner, and keep the file private. Passwords must be at least 10 characters. Then, after applying the SQL migrations:

```bash
node --env-file=.env.local scripts/seed-admins.ts
node --env-file=.env.local scripts/seed-admins.ts --apply
```

The first command validates without writing. Repeating `--apply` updates profiles but preserves existing passwords. An existing DPRO with a different email keeps the same account ID; the first apply updates its email and password to the supplied DPRO credentials. If the new email belongs to another account, the script stops for review. To rotate unchanged accounts' passwords deliberately, set new values in the private file and run `--apply --rotate-passwords`. Do not put admin passwords in Git, Vercel client variables, chat, or staff export sheets.

## Staff import

Nine block workbooks are in `../STAFF DETAILS ALL BLOCK/`. The roster import creates directory entries for the corresponding BPROs without creating staff Auth users or passwords. Apply migration 09 first, then review the read-only comparison. Select only the blocks you intend to import, since reimporting an existing block can overwrite dashboard edits:

```bash
node scripts/prepare-block-rosters.mjs
node scripts/import-block-rosters.mjs --blocks=forbesganj,narpatganj
node scripts/import-block-rosters.mjs --apply --blocks=forbesganj,narpatganj
```

The preview is gitignored under `private/`. These commands leave existing block rosters, Auth accounts, and historical attendance alone. The separate `--replace-araria` option soft archives former Araria staff accounts only when explicitly requested with `--blocks=araria`. The import does not create or distribute new staff credentials. New directory entries may also be added in the authorized BPRO/DPRO dashboard. See [docs/MIGRATIONS.md](docs/MIGRATIONS.md) for the archive and rollback notes.

### Non-Araria staff logins

After reviewing the live directory, run `node scripts/provision-block-staff.mjs` for a read-only count, then `node scripts/provision-block-staff.mjs --apply` to provision eligible staff in the eight non-Araria blocks. The login ID is the staff mobile number and the initial password is `BlockName@last4digits#26`. The script does not change Araria accounts. It links each new Auth profile to its roster entry so the directory does not show that staff member twice, and writes one private XLSX per block to `../STAFF CREDENTIALS/`. `NEEDS_REVIEW.xlsx` lists staff with a missing/invalid mobile, a shared number, or a number already assigned to another account; those records receive no login. The folder and files are restricted to the local user, excluded from Git, and contain passwords. Give each staff member only their own row. If a password is reset later, the saved sheet is a provisioning snapshot and must not be treated as the current password.

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

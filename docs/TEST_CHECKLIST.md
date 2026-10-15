> Current onboarding mode (15 October 2026): GPS/photo/map controls, 50 m accuracy and staff browser binding are disabled. No admin device reset is needed. Password login, attendance drafts/check-out and required CL/SL documents remain. Apply `supabase/migrations/20261015_basic_staff_attendance.sql` before deploying. GPS instructions below describe the retained future workflow.

# Simplified attendance verification

## Automated checks completed locally

- [x] TypeScript typecheck
- [x] Existing database/API/security/reporting regressions
- [x] Staff/Admin role selection enforced before session creation
- [x] Arrival draft persists with server in-time and is readable by admin
- [x] Duplicate/racing arrivals rejected
- [x] Out-time completes same record once, preserving arrival data
- [x] Legacy unfinished arrivals migrate to draft
- [x] Absent and CL/SL records have no invented in/out times
- [x] Required JPEG/PDF leave attachment below 5 MiB consumed atomically
- [x] Assignment validation, deputation workplace required
- [x] GPS/geofence handling and photo replay prevention
- [x] File owner/expiry/consumption, optional scanner fail-closed handling, JPEG decoding/reencoding, limited PDF checks and GPS watermarking
- [x] English catalog preserves stored values and staff identities
- [x] Google translation fallback works without keys and sends only fixed UI text when enabled
- [x] Portrait photo footer preserves framing and shows IST day/date/time and coordinates
- [x] RLS and trusted RPC restrictions
- [x] Format and diff whitespace checks

## Requires browser execution / live services

- [ ] Run `node scripts/browser-check.mjs`: Chromium launch is blocked by this session's sandbox (`setsockopt EPERM`)
- [x] Initial SQL setup completed by user in Supabase
- [ ] Apply `20261013_z_required_leave.sql` database enforcement upgrade
- [x] User provisioned 242 reviewed staff accounts and initial administrator
- [ ] Correct two conflicting identity groups and three incomplete assignments
- [ ] Configure production environment in Vercel; external scanner is optional
- [ ] Deploy to Vercel and verify production health/login
- [ ] Test camera/location permissions on actual staff devices
- [ ] Verify real uploaded GPS photo and CL/SL PDF/JPG private access
- [ ] Confirm two-device staff/admin draft visibility and later completion

The browser regression script uses test responses confined to verification. None of that staff data is shipped in the production UI. Do not mark production or browser acceptance complete from mocked API/database tests.

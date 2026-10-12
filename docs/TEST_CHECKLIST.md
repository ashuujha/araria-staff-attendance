# Acceptance checklist

## Automated locally
- [x] IST day rollover
- [x] GPS accuracy and coordinate validation
- [x] Geofence distance and outside-radius rejection
- [x] Actual file magic checks
- [x] Spreadsheet formula escaping
- [x] SQL migration compilation
- [x] Expired capture challenge rejected
- [x] Punch out before punch in rejected
- [x] Concurrent duplicate punch in rejected atomically
- [x] One record and durable sync job created
- [x] Reused image rejected
- [x] Punch out updates existing record
- [x] Different-device login binding rejected
- [x] Mandatory correction reason and audit trail
- [x] Staff RLS and denied role/device-hash access
- [x] Sync failure retry/backoff leaves attendance saved

## Browser and deployed verification
Use scripts/browser-check.mjs for search, day/night persistence, leave toggle, camera-only attendance UI, CSV export, mobile overflow/navigation and setup dialogs.

## Required after real service configuration
- [ ] Apply schema/panchayat seed in intended Supabase project
- [ ] Confirm publishable key cannot call mutating RPCs
- [ ] Import reviewed staff and provision initial admin
- [ ] Test phone login and email login on actual devices
- [ ] Confirm five-attempt lockout and exact-origin rejection
- [ ] Accept privacy notice, deny location/camera, then retry
- [ ] Verify within-radius punch with fresh camera capture
- [ ] Reuse photo with a changed watermark; verify perceptual rejection
- [ ] Verify impossible travel and shared-coordinate flag
- [ ] Test 5 MB direct signed upload and rejected 5 MB+1 upload
- [ ] Scanner failure/dirty file rejects and cleans staging file
- [ ] Private file endpoint rejects another staff member
- [ ] Test block-admin scope and viewer read-only actions
- [ ] Retry successful punch-out requests and confirm one row
- [ ] Configure Google service account and test append/update after retry
- [ ] Simulate Sheets outage/rate limit; confirm durable queue recovery
- [ ] Test 395 parallel punch requests on production-size database
- [ ] Enable backups, retention, orphan cleanup and monitor queue age

Native device attestation, VPN detection, MFA, mandatory password change, XLSX export/import UI, Summary tab and a live-throughput sync worker remain rollout work, as described in README.

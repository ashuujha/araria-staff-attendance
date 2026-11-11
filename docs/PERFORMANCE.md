# Login and dashboard performance

## Current request flow

- Staff mobile login performs an indexed phone lookup (`profiles.phone` is unique), login limit check, Supabase password authentication, a scoped profile read, and a limit reset. Admin login also checks CAPTCHA and writes an audit record. The limit reset and audit write run together after authorization.
- Login and session restore return only the verified profile. They no longer wait for `portal_bootstrap`, which aggregated the full admin directory, daily attendance, notices, holidays, and leave balances.
- Staff attendance, office notices, and revision counters load separately after the session is usable. The admin daily attendance request skips directory and leave-balance aggregation; those requests load independently. Directory reads remain role/block scoped by RLS.
- `Server-Timing` reports total login and its upstream stages, session restore, admin attendance/directory/balances, and staff dashboard time. Browser developer tools can show these timings without logging credentials or staff data.

## Capacity evidence

`npm run check:capacity` runs 700 concurrent synthetic logins, 700 session restores, and 700 attendance reads against a **mocked** Supabase service. It also exercises bounded evidence processing in waves. The generated `docs/CAPACITY_CHECK.json` records the result. This checks handler behavior and identity separation; it does **not** measure production throughput, Supabase Auth limits, database CPU, phone networks, or photo upload speed.

Before claiming the 10–11 AM peak is supported, run a staging load test with representative staff and attendance data: 700 logins over five minutes, a shorter burst, attendance saves, evidence uploads, and BPRO/DPRO reads. Record p50/p95/p99 latency, 429/5xx rates, Supabase query statistics, and Vercel function timings. Target p95 usable staff login below 5 seconds, admin login below 8 seconds, and under 1% application errors. Investigate any slow stage with `EXPLAIN (ANALYZE, BUFFERS)` before adding indexes or upgrading compute.

The app runs Vercel functions in `bom1` (Mumbai). Vercel handles function scaling; add capacity or a different hosting design only after a real staging test identifies the limiting service. Keep Supabase's trusted end-user IP forwarding configured for Auth so a shared server IP does not consume one rate-limit bucket.

The old `portal_bootstrap` SQL remains installed for compatibility with earlier deployments, but current login and session routes do not invoke it. No database migration is required for this change.

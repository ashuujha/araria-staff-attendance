# Workplace evidence, HTTPS and 250-user readiness

## Current workflow

Present and Deputation require an ordinary JPEG/PNG photo, strictly below 5 MiB. No geolocation calls, GPS accuracy threshold, camera challenge or single-browser binding is used. The file is selected from the device; it is not captured by an embedded GPS camera. The server validates actual bytes, decodes and resizes the image, strips metadata including embedded GPS and saves a normalized JPEG. Existing photo flags/hash-based replay rules are not applied. Leave continues to require JPEG/PDF evidence below 5 MiB.

Absent requires a nonblank reason of 3–1000 trimmed characters in both the API and database transaction. It saves a completed absence status, with no invented arrival/departure times. Present/Deputation save an arrival draft; checkout completes the same daily record. Admins can open private workplace-photo links and read the absence reason.

Apply the **contents** of `supabase/migrations/20261015_workplace_evidence.sql` in Supabase SQL Editor before deploying. It adds `absence_reason`, the dedicated evidence RPC and a date index, and retains a private storage bucket. It does not erase historical attendance. Existing base migrations must already be installed.

## Capacity work completed

- Static login pages and lazy-loaded admin editor remain enabled.
- JWT subjects are only query hints; Supabase verifies the token/RLS during profile lookup, avoiding redundant Auth requests.
- Admin directory/attendance reads run in parallel and pause automatic refresh while the page is hidden.
- Browser-to-storage signed uploads avoid sending photo bytes through Vercel request bodies; viewing also uses short-lived signed storage links.
- Image buffers/decoders are capped at four active evidence requests per function instance; queued requests do not download images until a slot opens. Busy requests return a retryable error instead of unbounded memory allocation.
- Per-user database advisory locks and the active-day unique index prevent duplicate daily records; staff identity and assignment checks remain server-side.
- Upstream login throttling or outages are reported as busy/unavailable, rather than misleading password errors. The removed application five-attempt/15-minute lockout is not reinstated.

`npm run check:capacity` runs the real route handlers against simulated Supabase responses for 700 parallel staff logins, 700 session views and 700 attendance views, including cross-user identity checks. Evidence memory admission runs in waves of 100 because the per-instance queue is intentionally bounded. The result is saved in `docs/CAPACITY_CHECK.json`. This is an application concurrency regression check, **not** proof of 700 simultaneous users on the deployed Vercel/Supabase service. Its simulated elapsed time is not a real-world response-time measurement.

## Live rollout requirements

Vercel documents automatic scaling on all plans and an initial burst allowance of 1000 executions per 10 seconds per region. That supports this architecture, but it does not certify this particular application's uptime. Project quotas, database size/compute, storage, bandwidth, provider outages and the real workload still matter. Check actual project settings and run a representative staging test before relying on 250 simultaneous users. Do not load-test production with real staff credentials.

Supabase currently documents a default token-endpoint bucket of 150 requests per five minutes per IP with bursts of 30. Because this app signs in server-side, all users can otherwise appear behind server egress IPs. For production on Vercel:

1. In **Supabase → Authentication → Rate Limits → IP Address Forwarding**, enable forwarding.
2. Set `SUPABASE_AUTH_FORWARD_IP=true` in `.env.local`, then deploy. The app forwards only Vercel's trusted `x-vercel-forwarded-for` value, validates its IP format and uses the required server-only secret key for this Auth request.
3. Users sharing one office's external IP still share Supabase's limits. Check the project's Auth limit configuration and test that real network pattern; forwarding is not a bypass for provider limits.
4. Check storage and bandwidth with real photo sizes and your retention period. A 250-photo round can contain up to about 1.22 GiB of uploaded input before image normalization. Do not assume the free storage quota covers a whole month.

The current session cannot reach the live services or modify their dashboard quotas, so these settings and a production capacity guarantee have not been verified here.

## HTTPS

Use `https://araria-staff-attendance.vercel.app`. Deployment checks require HTTPS for both `APP_URL` and `SUPABASE_URL`. Vercel handles certificates. The app also sets HSTS and Secure/HttpOnly/SameSite session cookies in production, checks the configured origin for mutations and redirects forwarded HTTP requests to the configured HTTPS origin. Local development remains available over localhost HTTP. The live certificate/redirect could not be independently inspected from this session.

Official references: [Vercel concurrency scaling](https://vercel.com/docs/functions/concurrency-scaling), [Vercel function payload limits](https://vercel.com/docs/functions/limitations), [Vercel SSL](https://vercel.com/docs/domains/working-with-ssl), [Supabase Auth rate limits and trusted forwarding](https://supabase.com/docs/guides/auth/rate-limits).

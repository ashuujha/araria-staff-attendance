import {
  csrf,
  sb,
  failure,
  HttpError,
  requireSetup,
  sessionCookie,
  audit,
} from "../../../../lib/server";
import { verifyAdminCaptcha } from "../../../../lib/admin-captcha";
import { isIP } from "node:net";
import { createHmac } from "node:crypto";
export async function POST(req: Request) {
  const started = performance.now();
  const timings: string[] = [];
  const stage = (name: string, since: number) =>
    timings.push(`${name};dur=${Math.round(performance.now() - since)}`);
  try {
    csrf(req);
    requireSetup();
    const body = await req.json();
    if (
      !body ||
      typeof body !== "object" ||
      Array.isArray(body) ||
      !["staff", "bpro", "dpro"].includes(body.role)
    )
      throw new HttpError(400, "अनुरोध अमान्य।");
    const identifier = String(body.identifier || "")
      .trim()
      .toLowerCase();
    const password = String(body.password || "");
    if (
      !identifier ||
      identifier.length > 254 ||
      password.length < 8 ||
      password.length > 128
    )
      throw new HttpError(400, "मोबाइल/ईमेल और पासवर्ड जाँचें।");
    if (body.role !== "staff") await verifyAdminCaptcha(body.captcha_token);
    let email = identifier;
    if (!identifier.includes("@")) {
      const lookupStarted = performance.now();
      const phone = identifier.replace(/^(?:\+91|91(?=\d{10}$))/, "");
      if (!/^[6-9]\d{9}$/.test(phone))
        throw new HttpError(400, "मान्य 10 अंकों का मोबाइल नंबर डालें।");
      const profiles = await sb(
        "/rest/v1/profiles?phone=eq." + phone + "&select=login_email",
      );
      email = profiles?.[0]?.login_email || `${phone}@staff.araria.invalid`;
      stage("phone_lookup", lookupStarted);
    }
    const keyFor = (value: string) =>
      createHmac(
        "sha256",
        process.env.LOGIN_LIMIT_SECRET || process.env.SUPABASE_SECRET_KEY!,
      )
        .update(value)
        .digest("hex");
    const accountKey = keyFor("account:" + email);
    const rawIp =
      process.env.VERCEL === "1"
        ? req.headers.get("x-vercel-forwarded-for")?.split(",")[0].trim()
        : null;
    const ipKey = rawIp && isIP(rawIp) ? keyFor("ip:" + rawIp) : null;
    const limitStarted = performance.now();
    const allowed = await sb("/rest/v1/rpc/login_limit_status", {
      method: "POST",
      body: JSON.stringify({ account_key: accountKey, ip_key: ipKey }),
    });
    stage("login_limit", limitStarted);
    if (!allowed)
      throw new HttpError(429, "Too many attempts. Try again in 15 minutes.");
    // Enable only after Supabase's trusted IP forwarding is configured. Use
    // Vercel's overwritten header, never a client-supplied forwarded-for value.
    const forwardedIp =
      process.env.VERCEL === "1" &&
      process.env.SUPABASE_AUTH_FORWARD_IP === "true"
        ? req.headers.get("x-vercel-forwarded-for")?.split(",")[0].trim()
        : undefined;
    const forward = forwardedIp && isIP(forwardedIp) ? forwardedIp : null;
    const authStarted = performance.now();
    const res = await fetch(
      `${process.env.SUPABASE_URL}/auth/v1/token?grant_type=password`,
      {
        method: "POST",
        headers: {
          apikey: forward
            ? process.env.SUPABASE_SECRET_KEY!
            : process.env.SUPABASE_PUBLISHABLE_KEY!,
          "Content-Type": "application/json",
          ...(forward ? { "Sb-Forwarded-For": forward } : {}),
        },
        body: JSON.stringify({ email, password }),
        signal: AbortSignal.timeout(8000),
      },
    );
    stage("auth", authStarted);
    if (res.status === 429)
      throw new HttpError(
        429,
        "लॉगिन सेवा व्यस्त है। थोड़ी देर में फिर कोशिश करें। / Login service busy. Please retry shortly.",
      );
    if (res.status >= 500)
      throw new HttpError(
        503,
        "लॉगिन सेवा उपलब्ध नहीं है। फिर कोशिश करें। / Login service unavailable. Please retry.",
      );
    if (!res.ok) {
      await sb("/rest/v1/rpc/record_login_failure", {
        method: "POST",
        body: JSON.stringify({ account_key: accountKey, ip_key: ipKey }),
      });
      throw new HttpError(401, "मोबाइल/ईमेल या पासवर्ड गलत है।");
    }
    const session = await res.json();
    // The dashboard fetches its own scoped data after the session is usable.
    // Login must not wait for every staff row and leave balance in the district.
    const profileStarted = performance.now();
    const profiles = await sb(
      "/rest/v1/profiles?id=eq." +
        session.user.id +
        "&deleted_at=is.null&select=id,name,phone,email,assignments,role,block,block_id,active,gender",
      {},
      session.access_token,
    );
    stage("profile", profileStarted);
    const profile = profiles?.[0];
    if (
      !profile?.active ||
      profile.role !== body.role ||
      (profile.role === "bpro" && !profile.block_id) ||
      (profile.role === "staff" && !profile.block_id)
    ) {
      await sb("/rest/v1/rpc/record_login_failure", {
        method: "POST",
        body: JSON.stringify({ account_key: accountKey, ip_key: ipKey }),
      });
      throw new HttpError(403, "इस कार्यस्थल में प्रवेश की अनुमति नहीं है।");
    }
    await Promise.all([
      sb("/rest/v1/rpc/clear_login_account", {
        method: "POST",
        body: JSON.stringify({ account_key: accountKey }),
      }),
      ...(profile.role !== "staff"
        ? [
            audit(
              profile.id,
              "admin_login",
              profile.role,
              "Administrator signed in",
              null,
              profile.block_id,
            ),
          ]
        : []),
    ]);
    const headers = new Headers({
      "Cache-Control": "no-store",
      "Content-Type": "application/json",
      "Server-Timing": [
        ...timings,
        `login;dur=${Math.round(performance.now() - started)}`,
      ].join(", "),
    });
    headers.append(
      "Set-Cookie",
      sessionCookie(
        "araria_session",
        session.access_token,
        Math.min(session.expires_in || 3600, 3600),
      ),
    );
    delete profile.login_email;
    delete profile.device_hash;
    return new Response(JSON.stringify({ profile }), { headers });
  } catch (e) {
    return failure(e);
  }
}

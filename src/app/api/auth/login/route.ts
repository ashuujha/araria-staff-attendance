import {
  csrf,
  sb,
  failure,
  HttpError,
  requireSetup,
  sessionCookie,
} from "../../../../lib/server";
import { verifyAdminCaptcha } from "../../../../lib/admin-captcha";
import { isIP } from "node:net";
import { portalBootstrap } from "../../../../lib/bootstrap";
export async function POST(req: Request) {
  const started = performance.now();
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
      const phone = identifier.replace(/^(?:\+91|91(?=\d{10}$))/, "");
      if (!/^[6-9]\d{9}$/.test(phone))
        throw new HttpError(400, "मान्य 10 अंकों का मोबाइल नंबर डालें।");
      const profiles = await sb(
        "/rest/v1/profiles?phone=eq." + phone + "&select=login_email",
      );
      email = profiles?.[0]?.login_email || `${phone}@staff.araria.invalid`;
    }
    // Enable only after Supabase's trusted IP forwarding is configured. Use
    // Vercel's overwritten header, never a client-supplied forwarded-for value.
    const forwardedIp =
      process.env.VERCEL === "1" &&
      process.env.SUPABASE_AUTH_FORWARD_IP === "true"
        ? req.headers.get("x-vercel-forwarded-for")?.split(",")[0].trim()
        : undefined;
    const forward = forwardedIp && isIP(forwardedIp) ? forwardedIp : null;
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
    if (!res.ok) throw new HttpError(401, "मोबाइल/ईमेल या पासवर्ड गलत है।");
    const session = await res.json();
    const bootstrap = await portalBootstrap(session.access_token);
    const profiles = bootstrap
      ? [bootstrap.profile]
      : await sb(
          "/rest/v1/profiles?id=eq." +
            session.user.id +
            "&deleted_at=is.null&select=id,name,phone,email,assignments,role,block,block_id,active,gender",
          {},
          session.access_token,
        );
    const profile = profiles?.[0];
    if (
      !profile?.active || profile.role !== body.role ||
      (profile.role === "bpro" && !profile.block_id) ||
      (profile.role === "staff" && !profile.block_id)
    )
      throw new HttpError(403, "इस कार्यस्थल में प्रवेश की अनुमति नहीं है।");
    const headers = new Headers({
      "Cache-Control": "no-store",
      "Content-Type": "application/json",
      "Server-Timing": `login;dur=${Math.round(performance.now() - started)}`,
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
    return new Response(
      JSON.stringify({ profile, ...(bootstrap ? { bootstrap } : {}) }),
      { headers },
    );
  } catch (e) {
    return failure(e);
  }
}

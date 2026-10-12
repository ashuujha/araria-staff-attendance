import { createHash, randomUUID } from "node:crypto";
import type { Profile } from "./types";
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export function json(
  value: unknown,
  status = 200,
  headers: Record<string, string> = {},
) {
  return Response.json(value, {
    status,
    headers: { "Cache-Control": "no-store", ...headers },
  });
}
export function failure(e: unknown) {
  if (e instanceof HttpError) return json({ error: e.message }, e.status);
  console.error(
    "Portal operation failed:",
    e instanceof Error ? e.name : "Unknown",
  );
  return json(
    { error: "अनुरोध पूरा नहीं हुआ। फिर कोशिश करें या एडमिन से संपर्क करें।" },
    500,
  );
}
export function configured() {
  return !!(
    process.env.SUPABASE_URL &&
    process.env.SUPABASE_PUBLISHABLE_KEY &&
    process.env.SUPABASE_SECRET_KEY
  );
}
export function requireSetup() {
  if (!configured())
    throw new HttpError(
      503,
      "लाइव पोर्टल सेटअप बाकी है। एडमिन से Supabase कॉन्फ़िगरेशन पूरा करवाएँ।",
    );
}
export function csrf(req: Request) {
  const origin = req.headers.get("origin");
  const expected = process.env.APP_URL;
  if (!expected || origin !== new URL(expected).origin)
    throw new HttpError(403, "अनुरोध का स्रोत मान्य नहीं है।");
}
export async function sb(path: string, init: RequestInit = {}, token?: string) {
  requireSetup();
  const key = token
    ? process.env.SUPABASE_PUBLISHABLE_KEY!
    : process.env.SUPABASE_SECRET_KEY!;
  const res = await fetch(`${process.env.SUPABASE_URL}${path}`, {
    ...init,
    headers: {
      apikey: key,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      "Content-Type": "application/json",
      ...init.headers,
    },
    cache: "no-store",
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) {
    let detail = "";
    try {
      const d = await res.json();
      detail = d.message || d.msg || d.error_description || "";
    } catch {}
    if (detail.includes("PORTAL:"))
      throw new HttpError(409, detail.split("PORTAL:")[1]);
    throw new HttpError(
      res.status === 401 ? 401 : 502,
      res.status === 401
        ? "सत्र समाप्त हो गया। फिर लॉगिन करें।"
        : "डेटाबेस अनुरोध विफल। कॉन्फ़िगरेशन जाँचें।",
    );
  }
  if (res.status === 204) return null;
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}
export function cookies(req: Request) {
  return Object.fromEntries(
    (req.headers.get("cookie") || "").split(";").map((s) => {
      const i = s.indexOf("=");
      return i >= 0
        ? [s.slice(0, i).trim(), decodeURIComponent(s.slice(i + 1))]
        : ["", ""];
    }),
  );
}
export async function identity(
  req: Request,
): Promise<{ profile: Profile; token: string; device: string }> {
  requireSetup();
  const c = cookies(req);
  if (!c.araria_session) throw new HttpError(401, "कृपया लॉगिन करें।");
  const user = await sb("/auth/v1/user", {}, c.araria_session);
  const profiles = await sb(
    "/rest/v1/profiles?id=eq." +
      encodeURIComponent(user.id) +
      "&select=id,name,phone,email,assignments,role,block,active",
    {},
    c.araria_session,
  );
  const profile = profiles?.[0];
  if (!profile?.active)
    throw new HttpError(403, "खाता निष्क्रिय या अपूर्ण है।");
  if (!c.araria_device)
    throw new HttpError(403, "डिवाइस पंजीकरण आवश्यक है। फिर लॉगिन करें।");
  return { profile, token: c.araria_session, device: hash(c.araria_device) };
}
export function admin(profile: Profile, write = false) {
  if (profile.role === "staff" || (write && profile.role === "district_viewer"))
    throw new HttpError(403, "यह कार्रवाई केवल अधिकृत एडमिन के लिए है।");
}
export function hash(value: string | Uint8Array) {
  return createHash("sha256").update(value).digest("hex");
}
export function sessionCookie(name: string, value: string, maxAge: number) {
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${process.env.NODE_ENV === "production" ? "; Secure" : ""}`;
}
export async function rateLimit(req: Request, identifier: string) {
  const ip = (
    req.headers.get("x-vercel-forwarded-for") ||
    req.headers.get("x-forwarded-for") ||
    "unknown"
  )
    .split(",")[0]
    .trim();
  const keys = [hash("user:" + identifier), hash("ip:" + ip)];
  for (const key of keys) {
    const allowed = await sb("/rest/v1/rpc/consume_login_attempt", {
      method: "POST",
      body: JSON.stringify({ attempt_key: key }),
    });
    if (!allowed)
      throw new HttpError(429, "बहुत अधिक प्रयास। 15 मिनट बाद कोशिश करें।");
  }
  return keys[0];
}
export async function audit(
  actor: string,
  action: string,
  target: string,
  reason: string,
  details: unknown,
) {
  await sb("/rest/v1/audit_logs", {
    method: "POST",
    body: JSON.stringify({
      actor_id: actor,
      action,
      target_id: target,
      reason,
      details,
    }),
  });
}
export { randomUUID };

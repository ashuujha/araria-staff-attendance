import { createHash, randomUUID } from "node:crypto";
import type { Profile } from "./types";
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
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
  if (e instanceof Error && ["TimeoutError", "AbortError"].includes(e.name))
    return json(
      {
        error:
          "कनेक्शन में देर हो रही है। फिर कोशिश करें। / Connection timed out. Please retry.",
      },
      504,
    );
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
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) {
    let detail = "";
    let code = "";
    try {
      const d = await res.json();
      detail = d.message || d.msg || d.error_description || "";
      code = String(d.code || "");
    } catch {}
    if (detail.includes("PORTAL:"))
      throw new HttpError(409, detail.split("PORTAL:")[1]);
    // Log only endpoint/status/code: queries, tokens and private data stay out of logs.
    console.error("Supabase request failed", {
      endpoint: path.split("?")[0],
      status: res.status,
      code,
    });
    if (
      ["PGRST202", "PGRST205", "42P01", "42883", "42703", "PGRST204"].includes(
        code,
      )
    )
      throw new HttpError(
        503,
        "डेटाबेस सेटअप अधूरा है। प्रशासक को Supabase में पोर्टल की SQL फ़ाइलें लागू करनी होंगी।",
        code,
      );
    if (res.status === 401 && !token)
      throw new HttpError(
        503,
        "डेटाबेस की सर्वर कुंजी अमान्य है। प्रशासक Supabase कॉन्फ़िगरेशन जाँचें।",
      );
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
  // This subject is only a query hint, never proof of identity. Supabase
  // validates the JWT and applies RLS to the following profile request.
  let subject: string | undefined;
  try {
    const payload = JSON.parse(
      Buffer.from(c.araria_session.split(".")[1], "base64url").toString(),
    );
    if (/^[0-9a-f-]{36}$/i.test(payload.sub)) subject = payload.sub;
  } catch {}
  if (!subject) subject = (await sb("/auth/v1/user", {}, c.araria_session)).id;
  const profiles = await sb(
    "/rest/v1/profiles?id=eq." +
      encodeURIComponent(subject!) +
      "&deleted_at=is.null&select=id,name,phone,email,assignments,role,block,active",
    {},
    c.araria_session,
  );
  const profile = profiles?.[0];
  if (!profile?.active)
    throw new HttpError(403, "खाता निष्क्रिय या अपूर्ण है।");
  return {
    profile,
    token: c.araria_session,
    device: hash(c.araria_device || profile.id),
  };
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

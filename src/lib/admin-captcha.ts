import { HttpError } from "./server";
import { verifyTypedCaptcha } from "./typed-captcha";

export function captchaConfiguration() {
  const siteKey = process.env.TURNSTILE_SITE_KEY?.trim();
  const secretKey = process.env.TURNSTILE_SECRET_KEY?.trim();
  if (
    !siteKey ||
    !secretKey ||
    !process.env.APP_URL ||
    (process.env.NODE_ENV === "production" &&
      [siteKey, secretKey].some((key) => /^[123]x0{10,}/.test(key)))
  )
    throw new HttpError(
      503,
      "प्रशासक लॉगिन फिलहाल उपलब्ध नहीं है। कार्यालय से संपर्क करें। / Admin login is temporarily unavailable. Contact the office.",
    );
  return { siteKey, secretKey };
}

export async function verifyAdminCaptcha(token: unknown) {
  const { secretKey } = captchaConfiguration();
  let submitted;
  try {
    submitted =
      typeof token === "string" && token.length <= 4096
        ? JSON.parse(token)
        : null;
  } catch {
    submitted = null;
  }
  if (
    !submitted ||
    typeof submitted.turnstile !== "string" ||
    !submitted.turnstile.trim() ||
    submitted.turnstile.length > 2048
  )
    throw new HttpError(
      400,
      "CAPTCHA सत्यापन पूरा करें। / Complete CAPTCHA verification.",
    );
  let result;
  try {
    const response = await fetch(
      "https://challenges.cloudflare.com/turnstile/v0/siteverify",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          secret: secretKey,
          response: submitted.turnstile,
        }),
        signal: AbortSignal.timeout(5000),
        cache: "no-store",
      },
    );
    if (!response.ok) throw Error("Provider unavailable");
    result = await response.json();
  } catch {
    throw new HttpError(
      503,
      "CAPTCHA सेवा उपलब्ध नहीं है। फिर कोशिश करें। / CAPTCHA service unavailable. Please retry.",
    );
  }
  // Siteverify rejects expired/reused tokens. Pin each successful response to
  // our hostname and admin form, rather than trusting a client success callback.
  if (
    result?.success !== true ||
    result.action !== "admin_login" ||
    result.hostname !== new URL(process.env.APP_URL!).hostname
  )
    throw new HttpError(
      400,
      "CAPTCHA सत्यापन विफल या समाप्त। फिर पूरा करें। / CAPTCHA verification failed or expired. Complete it again.",
    );
  // The provider consumes its token on each attempt; the typed code is also
  // checked on the server before any password or profile request is made.
  verifyTypedCaptcha(submitted.challenge, submitted.answer, secretKey);
}

import {
  createHmac,
  randomBytes,
  randomInt,
  timingSafeEqual,
} from "node:crypto";
import { HttpError } from "./server";
import { captchaLetter } from "./captcha-artwork";

const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
function digest(value: string, secret: string) {
  return createHmac("sha256", secret).update(value).digest("base64url");
}
function equal(a: string, b: string) {
  const x = Buffer.from(a),
    y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
export async function issueTypedCaptcha(secret: string) {
  const { default: sharp } = await import("sharp");
  const answer = Array.from(
    { length: 6 },
    () => alphabet[randomInt(alphabet.length)],
  ).join("");
  const nonce = randomBytes(24).toString("base64url");
  const expires = Date.now() + 5 * 60_000;
  const payload = Buffer.from(
    JSON.stringify({
      nonce,
      expires,
      proof: digest(`answer:${nonce}:${answer}`, secret),
    }),
  ).toString("base64url");
  const challenge = `${payload}.${digest(`challenge:${payload}`, secret)}`;
  const noise = Array.from(
    { length: 5 },
    () =>
      `<path d="M ${randomInt(300)} ${randomInt(84)} Q ${randomInt(300)} ${randomInt(84)} ${randomInt(300)} ${randomInt(84)}" stroke="#94a3b8" fill="none" opacity=".4"/>`,
  ).join("");
  const letters = [...answer]
    .map((letter, i) => captchaLetter(letter, i, randomInt(-8, 9)))
    .join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="84"><rect width="300" height="84" fill="#edf5fb"/>${noise}${letters}</svg>`;
  // Return raster pixels, never SVG text or the plaintext answer to the client.
  const png = await sharp(Buffer.from(svg)).png().toBuffer();
  return {
    challenge,
    image: `data:image/png;base64,${png.toString("base64")}`,
  };
}

export function verifyTypedCaptcha(
  challenge: unknown,
  answer: unknown,
  secret: string,
) {
  const invalid = () =>
    new HttpError(
      400,
      "CAPTCHA कोड गलत या समाप्त है। नया कोड लेकर फिर भरें। / CAPTCHA code is incorrect or expired. Refresh and try again.",
    );
  if (
    typeof challenge !== "string" ||
    challenge.length > 1000 ||
    typeof answer !== "string" ||
    !/^[a-zA-Z2-9]{6}$/.test(answer.trim())
  )
    throw invalid();
  const [payload, signature, extra] = challenge.split(".");
  if (
    !payload ||
    !signature ||
    extra !== undefined ||
    !equal(signature, digest(`challenge:${payload}`, secret))
  )
    throw invalid();
  let data;
  try {
    data = JSON.parse(Buffer.from(payload, "base64url").toString());
  } catch {
    throw invalid();
  }
  if (
    typeof data?.nonce !== "string" ||
    typeof data.proof !== "string" ||
    typeof data.expires !== "number" ||
    data.expires < Date.now() ||
    data.expires > Date.now() + 5 * 60_000 ||
    !equal(
      data.proof,
      digest(`answer:${data.nonce}:${answer.trim().toUpperCase()}`, secret),
    )
  )
    throw invalid();
}

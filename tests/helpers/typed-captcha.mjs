import { createHmac } from "node:crypto";
// Test-only known answers; production generates random answers and raster images.
export function typedCaptchaFixture(secret, patch = {}) {
  const sign = (value) =>
    createHmac("sha256", secret).update(value).digest("base64url");
  const nonce = "fixture-random-nonce";
  const payload = Buffer.from(
    JSON.stringify({
      nonce,
      expires: Date.now() + 120000,
      proof: sign(`answer:${nonce}:ABC234`),
      ...patch,
    }),
  ).toString("base64url");
  return {
    challenge: `${payload}.${sign(`challenge:${payload}`)}`,
    answer: "ABC234",
  };
}
export function adminCaptchaFixture(
  secret = "private-fixture-secret",
  patch = {},
) {
  return JSON.stringify({
    turnstile: "fixture-token",
    ...typedCaptchaFixture(secret),
    ...patch,
  });
}

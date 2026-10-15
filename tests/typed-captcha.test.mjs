import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdir } from "node:fs/promises";
import { typedCaptchaFixture } from "./helpers/typed-captcha.mjs";
await mkdir(".preview", { recursive: true });
await build({
  entryPoints: ["src/lib/typed-captcha.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  packages: "external",
  outfile: ".preview/typed-captcha-test.mjs",
});
const { verifyTypedCaptcha, issueTypedCaptcha } =
  await import("../.preview/typed-captcha-test.mjs");
const secret = "fixture-private-secret";
test("typed codes require correct server-signed unexpired challenge, accepting letter case", () => {
  const { challenge, answer } = typedCaptchaFixture(secret);
  assert.doesNotThrow(() =>
    verifyTypedCaptcha(challenge, answer.toLowerCase(), secret),
  );
  for (const [token, code, key] of [
    [challenge, "WRONG2", secret],
    [challenge, "", secret],
    [challenge, {}, secret],
    [challenge + "x", answer, secret],
    [challenge, answer, "other-secret"],
    [
      typedCaptchaFixture(secret, { expires: Date.now() - 1 }).challenge,
      answer,
      secret,
    ],
    [
      typedCaptchaFixture(secret, { expires: Date.now() + 600000 }).challenge,
      answer,
      secret,
    ],
  ]) {
    assert.throws(
      () => verifyTypedCaptcha(token, code, key),
      (error) => error.status === 400,
    );
  }
});
test("issued challenges are unique raster images without plaintext answers", async () => {
  const one = await issueTypedCaptcha(secret),
    two = await issueTypedCaptcha(secret);
  assert.notEqual(one.challenge, two.challenge);
  assert.notEqual(one.image, two.image);
  const bytes = Buffer.from(one.image.split(",")[1], "base64");
  assert.equal(bytes.subarray(1, 4).toString(), "PNG");
  const payload = JSON.parse(
    Buffer.from(one.challenge.split(".")[0], "base64url").toString(),
  );
  assert.deepEqual(Object.keys(payload).sort(), ["expires", "nonce", "proof"]);
  assert.ok(payload.expires > Date.now());
  assert.ok(!JSON.stringify(one).includes(secret));
});

await build({
  entryPoints: ["src/lib/captcha-artwork.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  outfile: ".preview/captcha-artwork-test.mjs",
});
const { captchaGlyphs, captchaLetter } =
  await import("../.preview/captcha-artwork-test.mjs");
test("every CAPTCHA character renders visible vector strokes without a server font", async () => {
  const { default: sharp } = await import("sharp");
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  assert.equal(new Set(alphabet).size, Object.keys(captchaGlyphs).length);
  assert.equal(new Set(Object.values(captchaGlyphs)).size, alphabet.length);
  for (const letter of alphabet) {
    const artwork = captchaLetter(letter, 0, 0);
    assert.doesNotMatch(artwork, /<text|font-family|href=/);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="70" height="84"><rect width="70" height="84" fill="white"/>${artwork}</svg>`;
    const { data, info } = await sharp(Buffer.from(svg))
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    let darkPixels = 0;
    for (let offset = 0; offset < data.length; offset += info.channels) {
      if (data[offset] < 90 && data[offset + 1] < 90 && data[offset + 2] < 110)
        darkPixels++;
    }
    assert.ok(darkPixels >= 150, `${letter} did not render readable strokes`);
  }
});

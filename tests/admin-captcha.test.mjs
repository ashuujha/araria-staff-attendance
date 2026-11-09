import { adminCaptchaFixture } from "./helpers/typed-captcha.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
await mkdir(".preview", { recursive: true });
await build({
  entryPoints: ["src/app/api/auth/login/route.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  packages: "external",
  outfile: ".preview/admin-captcha-login-test.mjs",
});
await build({
  entryPoints: ["src/app/api/auth/captcha/route.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  packages: "external",
  outfile: ".preview/admin-captcha-config-test.mjs",
});
const { POST } = await import(
  pathToFileURL(resolve(".preview/admin-captcha-login-test.mjs"))
);
const { GET } = await import(
  pathToFileURL(resolve(".preview/admin-captcha-config-test.mjs"))
);
process.env.SUPABASE_URL = "https://fixture.supabase.invalid";
process.env.SUPABASE_SECRET_KEY = "sb_secret_fixture";
process.env.SUPABASE_PUBLISHABLE_KEY = "sb_publishable_fixture";
process.env.APP_URL = "https://portal.example.test";
process.env.TURNSTILE_SITE_KEY = "site-fixture";
process.env.TURNSTILE_SECRET_KEY = "private-fixture-secret";
function request(patch = {}) {
  return new Request("https://portal.example.test/api/auth/login", {
    method: "POST",
    headers: {
      origin: process.env.APP_URL,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      identifier: "admin@example.test",
      password: "fixture-password",
      role: "dpro",
      captcha_token: adminCaptchaFixture(process.env.TURNSTILE_SECRET_KEY),
      ...patch,
    }),
  });
}
function fixture(
  calls,
  result = {
    success: true,
    hostname: "portal.example.test",
    action: "admin_login",
  },
) {
  return async (input, init = {}) => {
    const url = new URL(String(input));
    calls.push({ url, init });
    if (url.hostname === "challenges.cloudflare.com") {
      assert.equal(url.pathname, "/turnstile/v0/siteverify");
      assert.deepEqual(JSON.parse(init.body), {
        secret: "private-fixture-secret",
        response: "fixture-token",
      });
      return Response.json(result);
    }
    if (url.pathname === "/auth/v1/token")
      return Response.json({
        user: { id: "11111111-1111-4111-8111-111111111111" },
        access_token: "fixture-jwt",
      });
    if (url.pathname === "/rest/v1/rpc/login_limit_status")
      return Response.json(true);
    if (
      url.pathname === "/rest/v1/rpc/record_login_failure" ||
      url.pathname === "/rest/v1/rpc/clear_login_account"
    )
      return Response.json(null);
    if (url.pathname === "/rest/v1/audit_logs") return Response.json(null);
    if (url.pathname === "/rest/v1/rpc/portal_bootstrap")
      return Response.json({
        profile: {
          id: "11111111-1111-4111-8111-111111111111",
          role: "dpro",
          active: true,
          block_id: "33333333-3333-4333-8333-333333333333",
        },
        records: [],
        staff: [],
        office: { today: "2026-10-15", holidays: [], notices: [] },
      });
    if (url.pathname === "/rest/v1/profiles")
      return Response.json([
        {
          id: "11111111-1111-4111-8111-111111111111",
          role: "dpro",
          active: true,
          block_id: "33333333-3333-4333-8333-333333333333",
        },
      ]);
    throw Error("Unexpected request");
  };
}
test("admin token is validated before credentials and only public site key is exposed", async () => {
  const original = globalThis.fetch,
    calls = [];
  globalThis.fetch = fixture(calls);
  try {
    const config = await GET();
    const publicConfig = await config.json();
    assert.deepEqual(Object.keys(publicConfig).sort(), [
      "challenge",
      "image",
      "siteKey",
    ]);
    assert.equal(publicConfig.siteKey, "site-fixture");
    assert.match(publicConfig.image, /^data:image\/png;base64,/);
    assert.ok(!JSON.stringify(publicConfig).includes("private-fixture-secret"));
    const response = await POST(request());
    assert.equal(response.status, 200);
    assert.equal(calls[0].url.hostname, "challenges.cloudflare.com");
    assert.ok(response.headers.get("set-cookie"));
    assert.equal(
      (await response.text()).includes("private-fixture-secret"),
      false,
    );
  } finally {
    globalThis.fetch = original;
  }
});
test("missing, malformed and oversized admin tokens stop before Auth or profile lookup", async () => {
  const original = globalThis.fetch,
    calls = [];
  globalThis.fetch = fixture(calls);
  try {
    for (const token of ["", null, {}, "x".repeat(2049)])
      assert.equal((await POST(request({ captcha_token: token }))).status, 400);
    assert.equal(calls.length, 0);
  } finally {
    globalThis.fetch = original;
  }
});
test("provider refusal, expired/replayed tokens and wrong hostname or action cannot create sessions", async () => {
  const original = globalThis.fetch;
  try {
    for (const result of [
      { success: false, "error-codes": ["timeout-or-duplicate"] },
      { success: true, hostname: "other.example", action: "admin_login" },
      { success: true, hostname: "portal.example.test", action: "other-form" },
      { success: true },
    ]) {
      const calls = [];
      globalThis.fetch = fixture(calls, result);
      const response = await POST(request());
      assert.equal(response.status, 400);
      assert.equal(response.headers.get("set-cookie"), null);
      assert.equal(calls.length, 1);
    }
  } finally {
    globalThis.fetch = original;
  }
});
test("missing configuration and provider failures fail closed while staff login does not require CAPTCHA", async () => {
  const original = globalThis.fetch,
    secret = process.env.TURNSTILE_SECRET_KEY;
  try {
    delete process.env.TURNSTILE_SECRET_KEY;
    globalThis.fetch = async () => {
      throw Error("No external call expected");
    };
    assert.equal((await POST(request())).status, 503);
    assert.equal((await GET()).status, 503);
    process.env.TURNSTILE_SECRET_KEY = secret;
    for (const kind of ["network", "http"]) {
      globalThis.fetch = async () => {
        if (kind === "network") throw Error("offline");
        return new Response(null, { status: 503 });
      };
      assert.equal((await POST(request())).status, 503);
    }
    const calls = [];
    globalThis.fetch = fixture(calls);
    assert.equal(
      (await POST(request({ role: "staff", captcha_token: null }))).status,
      403,
      "Admin account cannot bypass CAPTCHA through staff login",
    );
    assert.equal(
      calls.some((c) => c.url.hostname === "challenges.cloudflare.com"),
      false,
    );
    assert.equal((await POST(request({ role: "invalid" }))).status, 400);
  } finally {
    globalThis.fetch = original;
    process.env.TURNSTILE_SECRET_KEY = secret;
  }
});

test("wrong or missing typed CAPTCHA cannot reach password validation", async () => {
  const original = globalThis.fetch;
  try {
    for (const patch of [
      { answer: "WRONG2" },
      { answer: "" },
      { challenge: "tampered" },
    ]) {
      const calls = [];
      globalThis.fetch = fixture(calls);
      const response = await POST(
        request({
          captcha_token: adminCaptchaFixture(
            process.env.TURNSTILE_SECRET_KEY,
            patch,
          ),
        }),
      );
      assert.equal(response.status, 400);
      assert.equal(response.headers.get("set-cookie"), null);
      assert.equal(calls.length, 1);
      assert.equal(calls[0].url.hostname, "challenges.cloudflare.com");
    }
  } finally {
    globalThis.fetch = original;
  }
});

import { adminCaptchaFixture } from "./helpers/typed-captcha.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdir } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
await mkdir(".preview", { recursive: true });
await build({
  entryPoints: ["src/app/api/auth/login/route.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  packages: "external",
  outfile: ".preview/login-role-test.mjs",
});
const { POST } = await import(
  pathToFileURL(resolve(".preview/login-role-test.mjs"))
);
process.env.SUPABASE_URL = "https://fixture.supabase.invalid";
process.env.SUPABASE_SECRET_KEY = "sb_secret_fixture";
process.env.SUPABASE_PUBLISHABLE_KEY = "sb_publishable_fixture";
process.env.APP_URL = "https://portal.example.test";
process.env.TURNSTILE_SITE_KEY = "site-fixture";
process.env.TURNSTILE_SECRET_KEY = "secret-fixture";
function request(role) {
  return new Request("https://portal.example.test/api/auth/login", {
    method: "POST",
    headers: {
      origin: process.env.APP_URL,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      identifier: "person@example.test",
      password: "fixture-password",
      role,
      captcha_token: adminCaptchaFixture(process.env.TURNSTILE_SECRET_KEY),
    }),
  });
}
test("staff, BPRO and DPRO logins require the matching role", async () => {
  const original = globalThis.fetch;
  try {
    for (const [role, requestedRole, expected] of [
      ["staff", "staff", 200],
      ["dpro", "dpro", 200],
      ["bpro", "bpro", 200],
      ["staff", "bpro", 403],
      ["dpro", "staff", 403],
      ["bpro", "dpro", 403],
    ]) {
      let bound = false;
      globalThis.fetch = async (input, init = {}) => {
        const url = new URL(String(input));
        if (url.hostname === "challenges.cloudflare.com")
          return Response.json({
            success: true,
            hostname: "portal.example.test",
            action: "admin_login",
          });
        if (url.pathname === "/rest/v1/rpc/login_limit_status")
          return Response.json(true);
        if (
          url.pathname === "/rest/v1/rpc/record_login_failure" ||
          url.pathname === "/rest/v1/rpc/clear_login_account"
        )
          return Response.json(null);
        if (url.pathname === "/rest/v1/audit_logs") return Response.json(null);
        if (url.pathname === "/auth/v1/token")
          return Response.json({
            user: { id: "11111111-1111-4111-8111-111111111111" },
            access_token: "fixture-user-jwt",
            expires_in: 3600,
          });
        if (url.pathname === "/rest/v1/rpc/portal_bootstrap")
          return Response.json({
            profile: {
              id: "11111111-1111-4111-8111-111111111111",
              role,
              active: true,
              block_id: "22222222-2222-4222-8222-222222222222",
              name: "Test account",
              assignments: [],
            },
            records: [],
            staff: [],
            office: { today: "2026-10-15", holidays: [], notices: [] },
          });
        if (url.pathname === "/rest/v1/profiles")
          return Response.json([
            {
              id: "11111111-1111-4111-8111-111111111111",
              role,
              active: true,
              block_id: "22222222-2222-4222-8222-222222222222",
              name: "Test account",
              assignments: [],
              device_hash: "old-browser-binding",
            },
          ]);
        if (url.pathname === "/rest/v1/rpc/bind_device") {
          bound = true;
          return new Response(null, { status: 204 });
        }
        throw Error("Unexpected request " + url.pathname);
      };
      const response = await POST(request(requestedRole));
      assert.equal(
        response.status,
        expected,
        `${role} through ${requestedRole}`,
      );
      assert.equal(
        bound,
        false,
        "Login must not bind staff or admin to a browser",
      );
      assert.equal(!!response.headers.get("set-cookie"), expected === 200);
      assert.equal(
        (response.headers.get("set-cookie") || "").includes("araria_device="),
        false,
      );
    }
  } finally {
    globalThis.fetch = original;
  }
});

test("five failed credentials trigger the account lockout", async () => {
  const original = globalThis.fetch;
  let authRequests = 0;
  let failures = 0;
  try {
    globalThis.fetch = async (input) => {
      const url = new URL(String(input));
      if (url.pathname === "/rest/v1/rpc/login_limit_status")
        return Response.json(failures < 5);
      if (url.pathname === "/rest/v1/rpc/record_login_failure") {
        failures++;
        return Response.json(null);
      }
      if (url.pathname === "/auth/v1/token") {
        authRequests++;
        return Response.json({ error: "invalid_credentials" }, { status: 400 });
      }
      throw Error("Unexpected request " + url.pathname);
    };
    for (let attempt = 0; attempt < 5; attempt++)
      assert.equal((await POST(request("staff"))).status, 401);
    assert.equal((await POST(request("staff"))).status, 429);
    assert.equal(authRequests, 5);
  } finally {
    globalThis.fetch = original;
  }
});

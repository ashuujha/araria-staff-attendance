import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdir } from "node:fs/promises";
await mkdir(".preview", { recursive: true });
for (const [name, entry] of Object.entries({
  login: "src/app/api/auth/login/route.ts",
  session: "src/app/api/session/route.ts",
  photo: "src/lib/photo-upload.ts",
}))
  await build({
    entryPoints: [entry],
    bundle: true,
    platform: "node",
    format: "esm",
    packages: "external",
    outfile: `.preview/fast-${name}-test.mjs`,
  });
const login = await import("../.preview/fast-login-test.mjs");
const session = await import("../.preview/fast-session-test.mjs");
const { prepareWorkplacePhoto } =
  await import("../.preview/fast-photo-test.mjs");
process.env.SUPABASE_URL = "https://fixture.supabase.invalid";
process.env.SUPABASE_SECRET_KEY = "sb_secret_fixture";
process.env.SUPABASE_PUBLISHABLE_KEY = "sb_publishable_fixture";
process.env.APP_URL = "https://portal.example.test";
const user = {
  id: "11111111-1111-4111-8111-111111111111",
  role: "staff",
  active: true,
  block_id: "22222222-2222-4222-8222-222222222222",
  name: "Fixture Staff",
  assignments: [],
};
const token = `header.${Buffer.from(JSON.stringify({ sub: user.id })).toString("base64url")}.signature`;
const request = () =>
  new Request(process.env.APP_URL + "/api/auth/login", {
    method: "POST",
    headers: {
      origin: process.env.APP_URL,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      identifier: "9000000001",
      password: "fixture-password",
      role: "staff",
    }),
  });
test("staff login returns only the verified profile and checks the login limit", async () => {
  const original = globalThis.fetch,
    calls = [];
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(input);
    calls.push(url.pathname);
    if (url.pathname === "/rest/v1/profiles") {
      if (url.searchParams.has("phone"))
        return Response.json([{ login_email: "staff@fixture.invalid" }]);
      assert.equal(
        new Headers(init.headers).get("authorization"),
        "Bearer " + token,
      );
      return Response.json([user]);
    }
    if (url.pathname === "/rest/v1/rpc/login_limit_status")
      return Response.json(true);
    if (url.pathname === "/rest/v1/rpc/clear_login_account")
      return Response.json(null);
    if (url.pathname === "/auth/v1/token")
      return Response.json({
        access_token: token,
        user: { id: user.id },
        expires_in: 3600,
      });
    throw Error("Unexpected " + url.pathname);
  };
  try {
    const response = await login.POST(request());
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.deepEqual(data, { profile: user });
    assert.ok(!calls.includes("/rest/v1/rpc/portal_bootstrap"));
    assert.equal(calls.length, 5);
    assert.equal(response.headers.get("cache-control"), "no-store");
  } finally {
    globalThis.fetch = original;
  }
});
test("session restoration reads only the verified profile and never caches it", async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async (input, init) => {
    calls++;
    assert.equal(new URL(input).pathname, "/rest/v1/profiles");
    assert.equal(
      new Headers(init.headers).get("authorization"),
      "Bearer " + token,
    );
    return Response.json([user]);
  };
  try {
    const response = await session.GET(
      new Request(process.env.APP_URL + "/api/session", {
        headers: { cookie: "araria_session=" + token },
      }),
    );
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).profile, user);
    assert.equal(calls, 1);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(
      (await session.GET(new Request(process.env.APP_URL + "/api/session")))
        .status,
      401,
    );
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = original;
  }
});
test("session does not depend on bootstrap SQL and rejected tokens stay rejected", async () => {
  const original = globalThis.fetch;
  let calls = [];
  globalThis.fetch = async (input) => {
    const path = new URL(input).pathname;
    calls.push(path);
    if (path === "/rest/v1/profiles") return Response.json([user]);
    throw Error("Unexpected");
  };
  const req = new Request(process.env.APP_URL + "/api/session", {
    headers: { cookie: "araria_session=" + token },
  });
  try {
    const response = await session.GET(req);
    assert.equal(response.status, 200);
    assert.equal((await response.json()).profile.id, user.id);
    assert.deepEqual(calls, ["/rest/v1/profiles"]);
    calls = [];
    globalThis.fetch = async (input) => {
      calls.push(new URL(input).pathname);
      return Response.json({ message: "JWT invalid" }, { status: 401 });
    };
    assert.equal((await session.GET(req)).status, 401);
    assert.equal(calls.length, 1);
  } finally {
    globalThis.fetch = original;
  }
});
test("photo resizing bounds dimensions, shrinks uploaded bytes and closes decoded images", async () => {
  const oldBitmap = globalThis.createImageBitmap,
    oldDocument = globalThis.document;
  let closed = false;
  const dimensions = [];
  let canvas;
  globalThis.createImageBitmap = async () => ({
    width: 4000,
    height: 3000,
    close() {
      closed = true;
    },
  });
  globalThis.document = {
    createElement() {
      canvas = {
        getContext() {
          return {
            fillRect() {},
            drawImage(_image, _x, _y, width, height) {
              dimensions.push([width, height]);
            },
          };
        },
        toBlob(callback, type, quality) {
          assert.equal(type, "image/jpeg");
          assert.equal(quality, 0.82);
          callback(new Blob([new Uint8Array(100000)], { type }));
        },
      };
      return canvas;
    },
  };
  try {
    const original = new Blob([new Uint8Array(4000000)], { type: "image/png" });
    const result = await prepareWorkplacePhoto(original);
    assert.equal(result.size, 100000);
    assert.equal(result.type, "image/jpeg");
    assert.deepEqual(dimensions, [[1600, 1200]]);
    assert.equal(closed, true);
    const small = new Blob(["small"]);
    assert.equal(await prepareWorkplacePhoto(small), small);
  } finally {
    globalThis.createImageBitmap = oldBitmap;
    globalThis.document = oldDocument;
  }
});

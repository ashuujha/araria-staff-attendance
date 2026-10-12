import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdir } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import sharp from "sharp";
import { istDate } from "../src/lib/security.mjs";
await mkdir(".preview", { recursive: true });
await build({
  entryPoints: ["src/app/api/attendance/route.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  packages: "external",
  outfile: ".preview/attendance-api-test.mjs",
});
const { POST } = await import(
  pathToFileURL(resolve(".preview/attendance-api-test.mjs"))
);
process.env.SUPABASE_URL = "https://fixture.supabase.invalid";
process.env.SUPABASE_PUBLISHABLE_KEY = "sb_publishable_fixture";
process.env.SUPABASE_SECRET_KEY = "sb_secret_fixture";
process.env.APP_URL = "https://portal.example.test";
process.env.UPLOAD_SCAN_URL = "https://scanner.example.test";
process.env.UPLOAD_SCAN_TOKEN = "fixture";
const user = "11111111-1111-4111-8111-111111111111";
const path = `${user}/${istDate()}/22222222-2222-4222-8222-222222222222.jpg`;
const image = await sharp({
  create: { width: 960, height: 720, channels: 3, background: "#345678" },
})
  .jpeg()
  .toBuffer();
function request() {
  const f = new FormData();
  for (const [key, value] of Object.entries({
    action: "in",
    panchayat: "Test",
    upload_path: path,
    latitude: "26.15",
    longitude: "87.46",
    accuracy: "10",
    challenge: "33333333-3333-4333-8333-333333333333",
  }))
    f.set(key, value);
  return new Request("https://portal.example.test/api/attendance", {
    method: "POST",
    headers: {
      origin: "https://portal.example.test",
      cookie: "araria_session=fixture-jwt; araria_device=fixture-device",
    },
    body: f,
  });
}
function fakeFetch(consumed, calls) {
  return async (input, init = {}) => {
    const url = new URL(String(input));
    calls.push({ url, init });
    const header = new Headers(init.headers);
    if (url.hostname === "fixture.supabase.invalid") {
      assert.ok(header.get("apikey"));
      assert.notEqual(header.get("authorization"), "Bearer sb_secret_fixture");
    }
    if (url.pathname === "/auth/v1/user") return Response.json({ id: user });
    if (url.pathname === "/rest/v1/profiles")
      return Response.json([
        {
          id: user,
          name: "Staff",
          role: "staff",
          active: true,
          assignments: [{ panchayat: "Test" }],
        },
      ]);
    if (url.pathname === "/rest/v1/pending_uploads") {
      assert.equal(
        url.searchParams.has("deleted_at"),
        false,
        "Pending uploads have no deleted_at column",
      );
      return Response.json([
        { consumed, expires_at: new Date(Date.now() + 600000).toISOString() },
      ]);
    }
    if (url.hostname === "scanner.example.test")
      return Response.json({ clean: true });
    if (url.pathname.startsWith("/storage/v1/object/attendance-private/"))
      return init.method === "POST"
        ? Response.json({ uploaded: true })
        : new Response(image);
    if (url.pathname === "/rest/v1/rpc/submit_attendance") {
      const b = JSON.parse(init.body);
      assert.equal(b.storage_path, path);
      assert.equal(b.perceptual_hash.length, 64);
      return Response.json({
        id: "saved-record",
        staff_id: user,
        status: "present",
      });
    }
    if (
      url.pathname === "/storage/v1/object/attendance-private" &&
      init.method === "DELETE"
    )
      return Response.json({ deleted: true });
    throw Error("Unexpected fixture request: " + url.pathname);
  };
}
test("signed upload is scanned, watermarked and submitted using the new key headers", async () => {
  const original = globalThis.fetch,
    calls = [];
  globalThis.fetch = fakeFetch(false, calls);
  try {
    const response = await POST(request());
    assert.equal(response.status, 200);
    assert.equal((await response.json()).record.id, "saved-record");
    assert.ok(calls.some((c) => c.url.hostname === "scanner.example.test"));
    const uploaded = calls.find(
      (c) => c.init.method === "POST" && c.url.pathname.startsWith("/storage/"),
    );
    assert.ok(uploaded.init.body.byteLength > 0);
    assert.equal(
      calls.filter((c) => c.url.pathname === "/rest/v1/rpc/submit_attendance")
        .length,
      1,
    );
  } finally {
    globalThis.fetch = original;
  }
});
test("a consumed upload cannot be reused or removed by a repeated submission", async () => {
  const original = globalThis.fetch,
    calls = [];
  globalThis.fetch = fakeFetch(true, calls);
  try {
    const response = await POST(request());
    assert.equal(response.status, 400);
    assert.equal(calls.filter((c) => c.init.method === "DELETE").length, 0);
    assert.equal(
      calls.filter((c) => c.url.pathname === "/rest/v1/rpc/submit_attendance")
        .length,
      0,
    );
  } finally {
    globalThis.fetch = original;
  }
});

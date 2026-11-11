import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdir } from "node:fs/promises";

await mkdir(".preview", { recursive: true });
await build({
  entryPoints: ["src/app/api/upload/route.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  packages: "external",
  outfile: ".preview/departure-upload-api-test.mjs",
});
const { POST } = await import("../.preview/departure-upload-api-test.mjs");
process.env.SUPABASE_URL = "https://fixture.supabase.invalid";
process.env.SUPABASE_SECRET_KEY = "sb_secret_fixture";
process.env.SUPABASE_PUBLISHABLE_KEY = "sb_publishable_fixture";
process.env.APP_URL = "https://portal.example.test";
const staff = "11111111-1111-4111-8111-111111111111";
const block = "22222222-2222-4222-8222-222222222222";
function request(purpose) {
  return new Request(process.env.APP_URL + "/api/upload", {
    method: "POST",
    headers: {
      origin: process.env.APP_URL,
      "content-type": "application/json",
      cookie: "araria_session=fixture-session",
    },
    body: JSON.stringify({ purpose, type: "image/jpeg", size: 100_000 }),
  });
}
test("departure GPS photo receives a private signed JPEG upload owned by staff", async () => {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    calls.push({ url, init });
    if (url.pathname === "/auth/v1/user") return Response.json({ id: staff });
    if (url.pathname === "/rest/v1/profiles")
      return Response.json([
        {
          id: staff,
          role: "staff",
          active: true,
          block_id: block,
          assignments: [],
        },
      ]);
    if (url.pathname === "/rest/v1/office_holidays") return Response.json([]);
    if (url.pathname === "/rest/v1/pending_uploads")
      return new Response(null, { status: 201 });
    if (
      url.pathname.startsWith(
        "/storage/v1/object/upload/sign/attendance-private/",
      )
    )
      return Response.json({
        url: "/object/upload/sign/attendance-private/path?token=fixture",
      });
    throw Error(`Unexpected ${url.pathname}`);
  };
  try {
    assert.equal((await POST(request("invalid"))).status, 400);
    const response = await POST(request("departure_photo"));
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.ok(data.path.startsWith(`${block}/${staff}/`));
    assert.ok(data.path.endsWith(".jpg"));
    const pending = calls.find(
      (call) => call.url.pathname === "/rest/v1/pending_uploads",
    );
    assert.equal(JSON.parse(pending.init.body).path, data.path);
  } finally {
    globalThis.fetch = original;
  }
});

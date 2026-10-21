import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdir } from "node:fs/promises";

await mkdir(".preview", { recursive: true });
await build({
  entryPoints: ["src/app/api/changes/route.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  packages: "external",
  outfile: ".preview/changes-api-test.mjs",
});
const { GET } = await import("../.preview/changes-api-test.mjs");
process.env.SUPABASE_URL = "https://fixture.supabase.invalid";
process.env.SUPABASE_SECRET_KEY = "sb_secret_fixture";
process.env.SUPABASE_PUBLISHABLE_KEY = "sb_publishable_fixture";
const session = "fixture-token";
const request = () =>
  new Request("https://portal.example.test/api/changes", {
    headers: { cookie: `araria_session=${session}` },
  });

test("version check is authenticated, uncached, and makes one scoped database call", async () => {
  const original = globalThis.fetch;
  let count = 0;
  globalThis.fetch = async (input, init) => {
    count++;
    assert.equal(
      new URL(String(input)).pathname,
      "/rest/v1/rpc/portal_changes",
    );
    assert.equal(
      new Headers(init.headers).get("authorization"),
      `Bearer ${session}`,
    );
    return Response.json({
      profile: 1,
      directory: 2,
      attendance: 3,
      holidays: 4,
      notices: 5,
      today: "2026-10-21",
    });
  };
  try {
    assert.equal(
      (await GET(new Request("https://portal.example.test/api/changes")))
        .status,
      401,
    );
    const responses = await Promise.all(
      Array.from({ length: 250 }, () => GET(request())),
    );
    assert.equal(count, 250);
    assert.ok(
      responses.every(
        (response) =>
          response.status === 200 &&
          response.headers.get("cache-control") === "no-store",
      ),
    );
  } finally {
    globalThis.fetch = original;
  }
});

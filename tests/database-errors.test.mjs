import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdir } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
await mkdir(".preview", { recursive: true });
await build({
  entryPoints: ["src/lib/server.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  packages: "external",
  outfile: ".preview/database-errors-test.mjs",
});
const { sb } = await import(
  pathToFileURL(resolve(".preview/database-errors-test.mjs"))
);
process.env.SUPABASE_URL = "https://fixture.supabase.invalid";
process.env.SUPABASE_PUBLISHABLE_KEY = "sb_publishable_fixture";
process.env.SUPABASE_SECRET_KEY = "sb_secret_fixture";
test("Missing database setup is distinct from invalid server keys and expired user sessions", async () => {
  const originalFetch = globalThis.fetch,
    originalLog = console.error;
  const logs = [];
  console.error = (...args) => logs.push(args);
  try {
    for (const code of ["PGRST202", "PGRST205", "42703", "PGRST204"]) {
      globalThis.fetch = async () =>
        Response.json(
          { code, message: "internal private detail" },
          { status: 404 },
        );
      await assert.rejects(
        sb("/rest/v1/profiles?phone=eq.private-phone"),
        (e) => e.status === 503 && e.message.includes("SQL"),
      );
    }
    globalThis.fetch = async () =>
      Response.json({ message: "Invalid API key" }, { status: 401 });
    await assert.rejects(
      sb("/rest/v1/profiles"),
      (e) => e.status === 503 && e.message.includes("कुंजी"),
    );
    await assert.rejects(
      sb("/auth/v1/user", {}, "fixture-user-token"),
      (e) => e.status === 401,
    );
    const output = JSON.stringify(logs);
    for (const privateValue of [
      "private-phone",
      "internal private detail",
      "sb_secret_fixture",
      "fixture-user-token",
    ])
      assert.equal(output.includes(privateValue), false);
  } finally {
    globalThis.fetch = originalFetch;
    console.error = originalLog;
  }
});

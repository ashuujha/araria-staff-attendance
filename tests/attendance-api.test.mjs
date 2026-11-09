import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

await mkdir(".preview", { recursive: true });
await build({
  entryPoints: ["src/app/api/attendance/route.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  packages: "external",
  outfile: ".preview/legacy-attendance-test.mjs",
});
const { POST } = await import(
  pathToFileURL(resolve(".preview/legacy-attendance-test.mjs"))
);
test("legacy attendance endpoint is closed; current workflow is the only write path", async () => {
  const before = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    throw Error("Legacy route reached Supabase");
  };
  try {
    const response = await POST(
      new Request("https://portal.example.test/api/attendance", {
        method: "POST",
      }),
    );
    assert.equal(response.status, 410);
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = before;
  }
});

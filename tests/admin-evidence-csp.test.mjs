import test from "node:test";
import assert from "node:assert/strict";
import config from "../next.config.mjs";

test("admin evidence images can load from private Supabase signed URLs", async () => {
  const rules = await config.headers();
  const policy = rules
    .flatMap((rule) => rule.headers)
    .find((header) => header.key === "Content-Security-Policy")?.value;
  assert.ok(policy);
  const imageSources = policy.match(/(?:^|;)\s*img-src\s+([^;]+)/)?.[1];
  assert.ok(imageSources);
  assert.match(imageSources, /https:\/\/vkflommzumlrrzvwbdub\.supabase\.co/);
});

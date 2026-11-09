import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdir } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
await mkdir(".preview", { recursive: true });
await build({
  entryPoints: ["src/app/api/files/route.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  packages: "external",
  outfile: ".preview/files-api-test.mjs",
});
const { GET } = await import(
  pathToFileURL(resolve(".preview/files-api-test.mjs"))
);
process.env.SUPABASE_URL = "https://fixture.supabase.invalid";
process.env.SUPABASE_SECRET_KEY = "sb_secret_fixture";
process.env.SUPABASE_PUBLISHABLE_KEY = "sb_publishable_fixture";
const id = "11111111-1111-4111-8111-111111111111";
const blockId = "22222222-2222-4222-8222-222222222222";
test("private workplace photos use short-lived storage links after caller-scoped authorization", async () => {
  const original = globalThis.fetch;
  let accessible = true,
    signs = 0;
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(input);
    if (url.pathname === "/auth/v1/user") return Response.json({ id });
    if (url.pathname === "/rest/v1/profiles")
      return Response.json([{ id, role: "dpro", active: true }]);
    if (url.pathname === "/rest/v1/attendance") {
      assert.equal(init.headers.Authorization, "Bearer fixture-session");
      assert.equal(url.searchParams.get("id"), "eq." + id);
      return Response.json(
        accessible
          ? [
              {
                staff_id: id,
                block_id: blockId,
                photo_path: `${blockId}/${id}/photo.jpg`,
              },
            ]
          : [],
      );
    }
    if (
      url.pathname ===
      `/storage/v1/object/sign/attendance-private/${blockId}/${id}/photo.jpg`
    ) {
      signs++;
      assert.equal(JSON.parse(init.body).expiresIn, 60);
      return Response.json({
        signedURL: "/object/sign/attendance-private/photo.jpg?token=fixture",
      });
    }
    throw Error("Unexpected request");
  };
  const request = (authenticated = true) =>
    new Request(`https://portal.test/api/files?id=${id}&kind=photo_path`, {
      headers: authenticated
        ? { cookie: "araria_session=fixture-session" }
        : {},
    });
  try {
    const response = await GET(request());
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.match(
      data.url,
      /^https:\/\/fixture.supabase.invalid\/storage\/v1\/object\/sign\//,
    );
    assert.equal(data.expires_in, 60);
    accessible = false;
    assert.equal((await GET(request())).status, 403);
    assert.equal((await GET(request(false))).status, 401);
    assert.equal(signs, 1);
  } finally {
    globalThis.fetch = original;
  }
});

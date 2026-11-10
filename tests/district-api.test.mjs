import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

await mkdir(".preview", { recursive: true });
const routes = {};
for (const name of ["admin", "staff", "office", "files", "admin/reports"]) {
  const short = name.replace("/", "-");
  const output = `.preview/district-${short}.mjs`;
  await build({
    entryPoints: [`src/app/api/${name}/route.ts`],
    bundle: true,
    platform: "node",
    format: "esm",
    packages: "external",
    outfile: output,
  });
  routes[name] = await import(pathToFileURL(resolve(output)));
}
process.env.SUPABASE_URL = "https://fixture.supabase.invalid";
process.env.SUPABASE_SECRET_KEY = "sb_secret_fixture";
process.env.SUPABASE_PUBLISHABLE_KEY = "sb_publishable_fixture";
process.env.APP_URL = "https://portal.example.test";
const actor = "11111111-1111-4111-8111-111111111111";
const target = "22222222-2222-4222-8222-222222222222";
const blockA = "33333333-3333-4333-8333-333333333333";
const blockB = "44444444-4444-4444-8444-444444444444";
const headers = {
  cookie: "araria_session=fixture-session",
  origin: process.env.APP_URL,
  "content-type": "application/json",
};
const req = (path, body) =>
  new Request(process.env.APP_URL + path, {
    method: body ? "POST" : "GET",
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
function fixture(role, calls) {
  return async (input, init = {}) => {
    const url = new URL(input);
    calls.push(url.pathname);
    if (url.pathname === "/auth/v1/user") return Response.json({ id: actor });
    if (url.pathname === "/rest/v1/profiles") {
      if (url.searchParams.get("id") === `eq.${target}`)
        return Response.json([
          { id: target, role: "staff", block_id: blockB, active: true },
        ]);
      return Response.json([
        { id: actor, role, block_id: blockA, block: "Araria", active: true },
      ]);
    }
    if (url.pathname === "/rest/v1/attendance") return Response.json([]);
    if (url.pathname === "/rest/v1/staff_roster") return Response.json([]);
    if (url.pathname === "/rest/v1/blocks")
      return Response.json([{ id: blockB, name_en: "Sikti" }]);
    if (
      url.pathname === "/rest/v1/office_holidays" ||
      url.pathname === "/rest/v1/office_notices"
    )
      return Response.json([]);
    if (url.pathname === "/rest/v1/rpc/leave_balance_snapshot")
      return Response.json({ balances: [] });
    throw Error(`Unexpected ${url.pathname}`);
  };
}
test("BPRO cannot select another block or mutate its staff, attendance or notices", async () => {
  const before = globalThis.fetch,
    calls = [];
  globalThis.fetch = fixture("bpro", calls);
  try {
    const cross = `?block_id=${blockB}`;
    for (const [route, path] of [
      ["admin", "/api/admin"],
      ["staff", "/api/staff"],
      ["office", "/api/office"],
      ["admin/reports", "/api/admin/reports"],
    ])
      assert.equal(
        (await routes[route].GET(req(path + cross))).status,
        403,
        route,
      );
    assert.equal(
      (
        await routes.staff.POST(
          req("/api/staff", {
            action: "create",
            block_id: blockB,
            name: "Other",
            phone: "9000000000",
            gender: "male",
            assignments: [],
          }),
        )
      ).status,
      403,
    );
    assert.equal(
      (
        await routes.admin.POST(
          req("/api/admin", {
            action: "input",
            staff_id: target,
            date: "2026-11-06",
            status: "present",
            panchayat: "Office",
          }),
        )
      ).status,
      403,
    );
    assert.equal(
      (
        await routes.office.POST(
          req("/api/office", {
            action: "publish_notice",
            block_id: blockB,
            title: "Other block",
            body: "Other block staff only",
          }),
        )
      ).status,
      403,
    );
    assert.equal(
      (await routes.files.GET(req(`/api/files?id=${target}&kind=photo_path`)))
        .status,
      403,
    );
    assert.equal(
      calls.includes("/storage/v1/object/sign/attendance-private"),
      false,
    );
  } finally {
    globalThis.fetch = before;
  }
});
test("DPRO may select any block and the scoped query includes its block ID", async () => {
  const before = globalThis.fetch,
    calls = [];
  globalThis.fetch = fixture("dpro", calls);
  try {
    assert.equal(
      (
        await routes.admin.GET(
          req(`/api/admin?date=2026-11-06&block_id=${blockB}`),
        )
      ).status,
      200,
    );
    assert.equal(
      (await routes.staff.GET(req(`/api/staff?block_id=${blockB}`))).status,
      200,
    );
    assert.equal(
      (await routes.office.GET(req(`/api/office?block_id=${blockB}`))).status,
      200,
    );
  } finally {
    globalThis.fetch = before;
  }
});

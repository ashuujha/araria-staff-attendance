import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdir } from "node:fs/promises";

await mkdir(".preview", { recursive: true });
await build({
  entryPoints: ["src/app/api/admin/reports/route.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  packages: "external",
  outfile: ".preview/reports-api-test.mjs",
});
const { GET } = await import("../.preview/reports-api-test.mjs");
process.env.SUPABASE_URL = "https://fixture.supabase.invalid";
process.env.SUPABASE_SECRET_KEY = "sb_secret_fixture";
process.env.SUPABASE_PUBLISHABLE_KEY = "sb_publishable_fixture";
const id = "11111111-1111-4111-8111-111111111111";
function req(query) {
  return new Request(`https://portal.example.test/api/admin/reports?${query}`, {
    headers: { cookie: "araria_session=fixture-token" },
  });
}
function fixture(role, calls) {
  return async (input, init = {}) => {
    const url = new URL(String(input));
    calls.push({ url, init });
    if (url.pathname === "/auth/v1/user") return Response.json({ id });
    if (url.pathname === "/rest/v1/profiles")
      return Response.json([{ id, role, active: true, assignments: [] }]);
    throw Error(`Unexpected report data fetch: ${url.pathname}`);
  };
}
test("reports reject staff and invalid date ranges before reading attendance", async () => {
  const original = globalThis.fetch;
  try {
    const calls = [];
    globalThis.fetch = fixture("staff", calls);
    assert.equal(
      (await GET(req("format=xlsx&period=day&start=2026-10-21"))).status,
      403,
    );
    globalThis.fetch = fixture("super_admin", calls);
    for (const query of [
      "format=csv&period=day&start=2026-10-21",
      "format=pdf&period=day&start=2026-02-30",
      "format=xlsx&period=range&start=2025-01-01&end=2026-10-21",
      "format=xlsx&period=day&start=2026-10-21&status=unknown",
    ])
      assert.equal((await GET(req(query))).status, 400);
    assert.ok(
      !calls.some((call) => call.url.pathname === "/rest/v1/attendance"),
    );
  } finally {
    globalThis.fetch = original;
  }
});

test("admin can download a year-specific leave balance report", async () => {
  const original = globalThis.fetch;
  const calls = [];
  try {
    globalThis.fetch = async (input, init = {}) => {
      const url = new URL(String(input));
      calls.push({ url, init });
      if (url.pathname === "/auth/v1/user") return Response.json({ id });
      if (url.pathname === "/rest/v1/profiles" && url.searchParams.has("id"))
        return Response.json([
          { id, role: "super_admin", active: true, assignments: [] },
        ]);
      const firstPage = url.searchParams.get("offset") === "0";
      if (url.pathname === "/rest/v1/profiles")
        return Response.json(
          firstPage
            ? [
                {
                  id: "staff-1",
                  name: "Sample Staff",
                  phone: "9000000000",
                  block: "Araria",
                  gender: "female",
                  role: "staff",
                  active: true,
                  assignments: [
                    {
                      department: "Agriculture",
                      panchayat: "Bairgachhi",
                      position: "Assistant",
                    },
                  ],
                },
              ]
            : [],
        );
      if (url.pathname === "/rest/v1/attendance")
        return Response.json(
          firstPage
            ? [
                {
                  id: "leave-1",
                  staff_id: "staff-1",
                  date: "2026-10-21",
                  status: "leave",
                  leave_type: "CL",
                },
              ]
            : [],
        );
      throw Error(`Unexpected URL: ${url}`);
    };
    const response = await GET(
      req(
        "kind=leave&format=xlsx&year=2026&leave_only=1&department=Agriculture",
      ),
    );
    assert.equal(response.status, 200);
    assert.match(
      response.headers.get("content-disposition"),
      /araria-leave-report-2026\.xlsx/,
    );
    const bytes = Buffer.from(await response.arrayBuffer());
    assert.equal(bytes.subarray(0, 2).toString(), "PK");
    assert.ok(
      calls.some(
        (call) =>
          call.url.pathname === "/rest/v1/attendance" &&
          call.url.searchParams.get("status") === "eq.leave" &&
          call.url.searchParams.get("date") === "gte.2026-01-01",
      ),
    );
  } finally {
    globalThis.fetch = original;
  }
});

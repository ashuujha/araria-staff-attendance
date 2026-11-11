import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdir } from "node:fs/promises";
import ExcelJS from "exceljs";

await mkdir(".preview", { recursive: true });
await build({
  entryPoints: ["src/app/api/staff/export/route.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  packages: "external",
  outfile: ".preview/staff-directory-export-test.mjs",
});
const { GET } = await import("../.preview/staff-directory-export-test.mjs");
process.env.APP_URL = "https://portal.example.test";
process.env.SUPABASE_URL = "https://fixture.supabase.invalid";
process.env.SUPABASE_SECRET_KEY = "sb_secret_fixture";
process.env.SUPABASE_PUBLISHABLE_KEY = "sb_publishable_fixture";
const actor = "11111111-1111-4111-8111-111111111111";
const block = "22222222-2222-4222-8222-222222222222";
const otherBlock = "33333333-3333-4333-8333-333333333333";
const token = `header.${Buffer.from(JSON.stringify({ sub: actor })).toString("base64url")}.signature`;
const request = (query) =>
  new Request(`${process.env.APP_URL}/api/staff/export?${query}`, {
    headers: { cookie: `araria_session=${token}` },
  });

test("BPRO cannot export another block's directory", async () => {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (input) => {
    const path = new URL(input).pathname;
    calls.push(path);
    if (path === "/rest/v1/profiles")
      return Response.json([
        { id: actor, role: "bpro", active: true, block_id: block },
      ]);
    throw Error("Out-of-block read");
  };
  try {
    assert.equal(
      (await GET(request(`format=xlsx&block_id=${otherBlock}`))).status,
      403,
    );
    assert.deepEqual(calls, ["/rest/v1/profiles"]);
  } finally {
    globalThis.fetch = original;
  }
});

test("DPRO XLSX directory contains staff identity and workspace", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = new URL(input);
    if (url.pathname === "/rest/v1/profiles") {
      if (url.searchParams.has("id"))
        return Response.json([{ id: actor, role: "dpro", active: true }]);
      return Response.json([
        {
          name: "Staff One",
          phone: "9000000001",
          email: null,
          gender: "female",
          block: "Araria",
          assignments: [{ panchayat: "Office", position: "Auditor" }],
        },
      ]);
    }
    if (url.pathname === "/rest/v1/staff_roster") return Response.json([]);
    if (url.pathname === "/rest/v1/audit_logs")
      return new Response(null, { status: 204 });
    throw Error("Unexpected " + url.pathname);
  };
  try {
    const response = await GET(request("format=xlsx"));
    assert.equal(response.status, 200);
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(Buffer.from(await response.arrayBuffer()));
    const sheet = book.worksheets[0];
    assert.equal(sheet.getCell("B2").value, "Staff One");
    assert.equal(sheet.getCell("C2").value, "9000000001");
    assert.match(String(sheet.getCell("F2").value), /Office • Auditor/);
  } finally {
    globalThis.fetch = original;
  }
});

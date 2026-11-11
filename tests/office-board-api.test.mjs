import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdir } from "node:fs/promises";
await mkdir(".preview", { recursive: true });
for (const [key, path] of Object.entries({
  api: "src/app/api/office/route.ts",
  server: "src/lib/office-server.ts",
  types: "src/lib/office-types.ts",
}))
  await build({
    entryPoints: [path],
    bundle: true,
    platform: "node",
    format: "esm",
    packages: "external",
    outfile: ".preview/office-" + key + "-test.mjs",
  });
const { GET, POST } = await import("../.preview/office-api-test.mjs");
const { requireWorkingDay } =
  await import("../.preview/office-server-test.mjs");
const { validOfficeDate, officeClosure } =
  await import("../.preview/office-types-test.mjs");
process.env.SUPABASE_URL = "https://fixture.supabase.invalid";
process.env.SUPABASE_SECRET_KEY = "sb_secret_fixture";
process.env.SUPABASE_PUBLISHABLE_KEY = "sb_publishable_fixture";
process.env.APP_URL = "https://portal.example.test";
const id = "11111111-1111-4111-8111-111111111111";
function req(body, origin = process.env.APP_URL) {
  return new Request(process.env.APP_URL + "/api/office", {
    method: body ? "POST" : "GET",
    headers: {
      cookie: "araria_session=fixture-token",
      origin,
      "content-type": "application/json",
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}
function fixture(calls, role = "dpro", holidays = []) {
  return async (input, init = {}) => {
    const url = new URL(String(input));
    calls.push({ url, init });
    if (url.pathname === "/auth/v1/user") return Response.json({ id });
    if (url.pathname === "/rest/v1/profiles")
      return Response.json([{ id, role, active: true, assignments: [] }]);
    if (url.pathname === "/rest/v1/office_holidays")
      return Response.json(holidays);
    if (url.pathname === "/rest/v1/office_notices")
      return Response.json([
        {
          id,
          title: "Office notice",
          body: "Same message for all staff",
          created_at: "2026-10-15T00:00:00Z",
        },
      ]);
    if (url.pathname === "/rest/v1/rpc/manage_office_board")
      return Response.json({ id });
    throw Error("Unexpected " + url.pathname);
  };
}
test("office feed requires login and uses authenticated RLS for shared notices", async () => {
  const original = globalThis.fetch,
    calls = [];
  globalThis.fetch = fixture(calls, "staff");
  try {
    assert.equal(
      (await GET(new Request(process.env.APP_URL + "/api/office"))).status,
      401,
    );
    const response = await GET(req());
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.equal(data.notices[0].title, "Office notice");
    const holiday = calls.find(
      (x) => x.url.pathname === "/rest/v1/office_holidays",
    );
    assert.equal(holiday.url.searchParams.get("date"), `eq.${data.today}`);
    assert.equal(
      calls
        .find((x) => x.url.pathname === "/rest/v1/office_notices")
        .url.searchParams.get("limit"),
      "20",
    );
    assert.equal(response.headers.get("cache-control"), "no-store");
    for (const call of calls.filter((x) =>
      ["/rest/v1/office_holidays", "/rest/v1/office_notices"].includes(
        x.url.pathname,
      ),
    ))
      assert.equal(
        new Headers(call.init.headers).get("authorization"),
        "Bearer fixture-token",
      );
  } finally {
    globalThis.fetch = original;
  }
});
test("only writing admins can publish or change holidays, and invalid input stops before RPC", async () => {
  const original = globalThis.fetch;
  try {
    for (const role of ["staff", "district_viewer"]) {
      const calls = [];
      globalThis.fetch = fixture(calls, role);
      assert.equal(
        (
          await POST(
            req({
              action: "set_holiday",
              date: "2026-10-19",
              reason: "Festival",
            }),
          )
        ).status,
        403,
      );
      assert.ok(!calls.some((c) => c.url.pathname.includes("/rpc/")));
    }
    const calls = [];
    globalThis.fetch = fixture(calls);
    for (const body of [
      { action: "set_holiday", date: "2026-02-30", reason: "Festival" },
      { action: "set_holiday", date: "2026-10-19", reason: " " },
      { action: "publish_notice", title: " ", body: "Valid message" },
      { action: "remove_notice", id: "invalid" },
    ])
      assert.equal((await POST(req(body))).status, 400);
    assert.ok(!calls.some((c) => c.url.pathname.includes("/rpc/")));
    assert.equal(
      (
        await POST(
          req({
            action: "set_holiday",
            date: "2026-10-19",
            reason: " Festival ",
          }),
        )
      ).status,
      200,
    );
    const payload = JSON.parse(calls.at(-1).init.body);
    assert.equal(payload.actor_id, id);
    assert.equal(payload.payload.reason, "Festival");
    assert.equal(
      (
        await POST(
          req({
            action: "publish_notice",
            title: "Meeting notice",
            body: "All staff meeting tomorrow",
          }),
        )
      ).status,
      200,
    );
    assert.equal(
      (await POST(req({ action: "remove_notice", id }))).status,
      200,
    );
    assert.equal(
      (
        await POST(
          req(
            { action: "remove_holiday", date: "2026-10-19" },
            "https://other.invalid",
          ),
        )
      ).status,
      403,
    );
  } finally {
    globalThis.fetch = original;
  }
});
test("server working-day guard blocks Sundays without I/O and holidays with their actual reason", async () => {
  const original = globalThis.fetch,
    calls = [];
  globalThis.fetch = fixture(calls, "staff", [
    { date: "2026-10-19", reason: "Festival leave" },
  ]);
  try {
    await assert.rejects(
      requireWorkingDay("11111111-1111-4111-8111-111111111111", "2026-10-18"),
      (e) => e.status === 409 && e.message.includes("Sunday"),
    );
    assert.equal(calls.length, 0);
    await assert.rejects(
      requireWorkingDay("11111111-1111-4111-8111-111111111111", "2026-10-19"),
      (e) => e.status === 409 && e.message.includes("Festival leave"),
    );
    globalThis.fetch = fixture(calls, "staff", []);
    await requireWorkingDay(
      "11111111-1111-4111-8111-111111111111",
      "2026-10-20",
    );
    for (const date of ["2026-02-30", "2026-13-01", "invalid", null])
      assert.equal(validOfficeDate(date), false);
    assert.equal(validOfficeDate("2028-02-29"), true);
    assert.equal(officeClosure("2026-10-18", []), "रविवार / Sunday");
    assert.equal(
      officeClosure("2026-10-19", [{ date: "2026-10-19", reason: "Festival" }]),
      "Festival",
    );
  } finally {
    globalThis.fetch = original;
  }
});

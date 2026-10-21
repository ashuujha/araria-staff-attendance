import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
await mkdir(".preview", { recursive: true });
for (const [name, entry] of [
  ["staff", "src/app/api/staff/route.ts"],
  ["admin-load", "src/app/api/admin/route.ts"],
])
  await build({
    entryPoints: [entry],
    bundle: true,
    platform: "node",
    format: "esm",
    packages: "external",
    outfile: `.preview/${name}-management-test.mjs`,
  });
const { POST } = await import(
  pathToFileURL(resolve(".preview/staff-management-test.mjs"))
);
const { GET, POST: adminPOST } = await import(
  pathToFileURL(resolve(".preview/admin-load-management-test.mjs"))
);
process.env.SUPABASE_URL = "https://fixture.supabase.invalid";
process.env.SUPABASE_SECRET_KEY = "sb_secret_fixture";
process.env.SUPABASE_PUBLISHABLE_KEY = "sb_publishable_fixture";
process.env.APP_URL = "https://portal.test";
const admin = "11111111-1111-4111-8111-111111111111",
  staff = "22222222-2222-4222-8222-222222222222";
const token = `header.${Buffer.from(JSON.stringify({ sub: admin })).toString("base64url")}.signature`;
const headers = {
  cookie: `araria_session=${token}`,
  origin: process.env.APP_URL,
  "content-type": "application/json",
};
const request = (body) =>
  new Request(process.env.APP_URL + "/api/staff", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
test("admin add/edit/remove uses scoped RPCs, returns only new account password and rejects invalid changes", async () => {
  const original = globalThis.fetch,
    calls = [];
  let role = "super_admin";
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(input),
      body = init.body ? JSON.parse(init.body) : null;
    calls.push({ url, init, body });
    if (url.pathname === "/rest/v1/profiles") {
      if (url.searchParams.has("phone")) return Response.json([]);
      if (url.searchParams.get("id") === "eq." + staff)
        return Response.json([
          { id: staff, role: "staff", phone: "9000000002" },
        ]);
      return Response.json([
        { id: admin, role, active: true, block: "Araria" },
      ]);
    }
    if (url.pathname === "/auth/v1/admin/users")
      return Response.json({ id: staff });
    if (url.pathname.startsWith("/rest/v1/rpc/"))
      return Response.json({ id: staff, name: "New Staff", active: true });
    throw Error("Unexpected endpoint " + url.pathname);
  };
  try {
    const created = await POST(
      request({
        action: "create",
        name: "New Staff",
        phone: "9000000002",
        email: "",
        gender: "female",
        assignments: [
          { department: "Office", panchayat: "Pokharia", position: "Staff" },
        ],
      }),
    );
    assert.equal(created.status, 200);
    assert.equal((await created.json()).password, "Araria@0002#26");
    const updated = await POST(
      request({
        action: "update",
        id: staff,
        changes: {
          name: "Edited Staff",
          phone: "9000000002",
          active: false,
          gender: "female",
        },
      }),
    );
    assert.equal(updated.status, 200);
    assert.equal((await updated.json()).password, undefined);
    const removed = await POST(request({ action: "delete", id: staff }));
    assert.equal(removed.status, 200);
    for (const name of [
      "create_master_staff_with_gender",
      "manage_staff_with_gender",
      "delete_master_staff",
    ])
      assert.ok(
        calls.some(
          (c) =>
            c.url.pathname.endsWith("/" + name) && c.body.actor_id === admin,
        ),
      );
    for (const call of calls.filter((c) =>
      c.url.pathname.startsWith("/rest/v1/rpc/"),
    )) {
      assert.equal(typeof call.body.reason_text, "string");
      assert.ok(call.body.reason_text.startsWith("Administrator "));
    }
    const before = calls.filter((c) =>
      c.url.pathname.endsWith("/manage_staff_with_gender"),
    ).length;
    assert.equal(
      (
        await POST(
          request({
            action: "update",
            id: staff,
            changes: { email: "invalid", active: "false" },
          }),
        )
      ).status,
      400,
    );
    assert.equal(
      calls.filter((c) => c.url.pathname.endsWith("/manage_staff_with_gender"))
        .length,
      before,
    );
    role = "district_viewer";
    assert.equal(
      (await POST(request({ action: "delete", id: staff }))).status,
      403,
    );
    assert.equal(
      calls.some((c) => c.url.pathname === "/auth/v1/user"),
      false,
      "JWT profile lookup should avoid redundant Auth request",
    );
  } finally {
    globalThis.fetch = original;
  }
});
test("admin loading validates JWT through Supabase then starts attendance and directory reads together", async () => {
  const original = globalThis.fetch,
    calls = [];
  let directoryStarted = false;
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(input);
    calls.push(url.pathname);
    assert.equal(
      new Headers(init.headers).get("authorization"),
      "Bearer " + token,
    );
    if (url.pathname === "/rest/v1/profiles" && url.searchParams.has("id"))
      return Response.json([{ id: admin, role: "super_admin", active: true }]);
    if (url.pathname === "/rest/v1/attendance") {
      assert.ok(url.searchParams.get("select").includes("latitude"));
      await new Promise((r) => setTimeout(r, 0));
      assert.ok(
        directoryStarted,
        "Directory must start before attendance read finishes",
      );
      return Response.json([]);
    }
    if (url.pathname === "/rest/v1/rpc/leave_balance_snapshot")
      return Response.json({ year: 2026, month: 10, balances: [] });
    if (url.pathname === "/rest/v1/profiles") {
      directoryStarted = true;
      return Response.json([]);
    }
    throw Error("Unexpected endpoint");
  };
  try {
    const response = await GET(
      new Request(process.env.APP_URL + "/api/admin", { headers }),
    );
    assert.equal(response.status, 200);
    assert.equal(calls.length, 5);
  } finally {
    globalThis.fetch = original;
  }
});

test("removed staff stays discoverable and can be restored in scope", async () => {
  const original = globalThis.fetch;
  const calls = [];
  let role = "super_admin";
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(input);
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ url, init, body });
    if (url.pathname === "/rest/v1/profiles") {
      if (url.searchParams.has("phone"))
        return Response.json([
          {
            id: staff,
            name: "Existing Staff",
            phone: "9000000002",
            role: "staff",
            block: "Araria",
            deleted_at: "2026-10-20T00:00:00Z",
          },
        ]);
      if (url.searchParams.get("id") === "eq." + staff) {
        if (init.method === "PATCH")
          return Response.json([
            { id: staff, name: "Existing Staff", active: true },
          ]);
        return Response.json([
          {
            id: staff,
            role: "staff",
            block: "Araria",
            deleted_at: "2026-10-20T00:00:00Z",
          },
        ]);
      }
      return Response.json([
        { id: admin, role, active: true, block: "Araria" },
      ]);
    }
    if (url.pathname === "/rest/v1/audit_logs")
      return new Response(null, { status: 204 });
    throw Error("Unexpected endpoint " + url.pathname);
  };
  try {
    const duplicate = await POST(
      request({
        action: "create",
        name: "New Staff",
        phone: "9000000002",
        gender: "male",
        assignments: [],
      }),
    );
    assert.equal(duplicate.status, 409);
    assert.deepEqual((await duplicate.json()).existing, {
      id: staff,
      name: "Existing Staff",
      phone: "9000000002",
      removed: true,
    });
    const restored = await POST(request({ action: "restore", id: staff }));
    assert.equal(restored.status, 200);
    assert.ok(calls.some((c) => c.init.method === "PATCH" && c.body.active));
    role = "district_viewer";
    assert.equal(
      (await POST(request({ action: "restore", id: staff }))).status,
      403,
    );
  } finally {
    globalThis.fetch = original;
  }
});
test("forged or expired JWT is rejected by upstream validation without trusting decoded claims", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () =>
    Response.json({ message: "JWT invalid" }, { status: 401 });
  try {
    assert.equal(
      (await GET(new Request(process.env.APP_URL + "/api/admin", { headers })))
        .status,
      401,
    );
  } finally {
    globalThis.fetch = original;
  }
});

test("routine admin attendance actions do not require an entered reason", async () => {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(input);
    if (url.pathname === "/rest/v1/profiles")
      return Response.json([{ id: admin, role: "super_admin", active: true }]);
    if (url.pathname.startsWith("/rest/v1/rpc/")) {
      const body = JSON.parse(init.body);
      assert.equal(body.actor_id, admin);
      assert.ok(body.reason_text.startsWith("Administrator "));
      calls.push(url.pathname);
      return Response.json({ id: staff });
    }
    throw Error("Unexpected endpoint " + url.pathname);
  };
  try {
    for (const body of [
      {
        action: "input",
        staff_id: staff,
        date: "2026-10-19",
        status: "present",
        panchayat: "Office",
      },
      { action: "correct", id: staff, correction: { status: "present" } },
      { action: "delete", id: staff },
      {
        action: "geofence",
        panchayat: "Office",
        latitude: 26,
        longitude: 87,
        radius: 300,
      },
    ]) {
      const response = await adminPOST(
        new Request(process.env.APP_URL + "/api/admin", {
          method: "POST",
          headers,
          body: JSON.stringify(body),
        }),
      );
      assert.equal(response.status, 200);
    }
    assert.equal(calls.length, 4);
  } finally {
    globalThis.fetch = original;
  }
});

test("attendance polling skips the directory without returning a misleading empty staff list", async () => {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (input) => {
    const url = new URL(input);
    calls.push(url);
    if (url.pathname === "/rest/v1/profiles" && url.searchParams.has("id"))
      return Response.json([{ id: admin, role: "super_admin", active: true }]);
    if (url.pathname === "/rest/v1/attendance") return Response.json([]);
    if (url.pathname === "/rest/v1/rpc/leave_balance_snapshot")
      return Response.json({ year: 2026, month: 10, balances: [] });
    throw Error("Directory should not be downloaded on this request");
  };
  try {
    const response = await GET(
      new Request(process.env.APP_URL + "/api/admin?directory=0", { headers }),
    );
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.deepEqual(data.records, []);
    assert.equal(Object.hasOwn(data, "staff"), false);
    assert.equal(calls.length, 3);
  } finally {
    globalThis.fetch = original;
  }
});

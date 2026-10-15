import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdir } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import sharp from "sharp";
import { istDate } from "../src/lib/security.mjs";
await mkdir(".preview", { recursive: true });
await build({
  entryPoints: ["src/app/api/attendance-workflow/route.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  packages: "external",
  outfile: ".preview/attendance-workflow-api-test.mjs",
});
const { POST } = await import(
  pathToFileURL(resolve(".preview/attendance-workflow-api-test.mjs"))
);
process.env.SUPABASE_URL = "https://fixture.supabase.invalid";
process.env.SUPABASE_SECRET_KEY = "sb_secret_fixture";
process.env.SUPABASE_PUBLISHABLE_KEY = "sb_publishable_fixture";
process.env.APP_URL = "https://portal.example.test";
const user = "11111111-1111-4111-8111-111111111111";
const path = `${user}/${istDate()}/leave.pdf`;
const jpeg = await sharp({
  create: { width: 640, height: 480, channels: 3, background: "#456789" },
})
  .jpeg()
  .toBuffer();
function request(patch = {}) {
  return new Request(process.env.APP_URL + "/api/attendance-workflow", {
    method: "POST",
    headers: {
      origin: process.env.APP_URL,
      "content-type": "application/json",
      cookie: "araria_session=fixture-session",
    },
    body: JSON.stringify({
      action: "save_draft",
      status: "present",
      department: "Department",
      panchayat: "Office",
      position: "Staff",
      photo_upload_path: path.replace("leave.pdf", "photo.jpg"),
      ...patch,
    }),
  });
}
function fixture(
  calls,
  { consumed = false, role = "staff", clean = true, holiday = false } = {},
) {
  return async (input, init = {}) => {
    const url = new URL(String(input));
    calls.push({ url, init });
    if (url.pathname === "/rest/v1/office_holidays")
      return Response.json(
        holiday ? [{ date: istDate(), reason: "Festival holiday" }] : [],
      );
    if (url.pathname === "/auth/v1/user") return Response.json({ id: user });
    if (url.pathname === "/rest/v1/profiles")
      return Response.json([
        {
          id: user,
          role,
          active: true,
          device_hash: "another-browser",
          assignments: [
            {
              department: "Department",
              panchayat: "Office",
              position: "Staff",
            },
          ],
        },
      ]);
    if (url.pathname === "/rest/v1/pending_uploads")
      return Response.json([
        { consumed, expires_at: new Date(Date.now() + 600000).toISOString() },
      ]);
    if (url.hostname === "scanner.example.test")
      return Response.json({ clean });
    if (url.pathname.startsWith("/storage/v1/object/attendance-private/"))
      return new Response(
        url.pathname.endsWith(".pdf")
          ? Buffer.from(
              "%PDF-1.7\n1 0 obj << /Type /Catalog >> endobj\n%%EOF\n",
            )
          : jpeg,
      );
    if (url.pathname === "/storage/v1/object/attendance-private")
      return Response.json([]);
    if (url.pathname === "/rest/v1/rpc/save_attendance_with_evidence") {
      const body = JSON.parse(init.body);
      for (const field of [
        "device_hash",
        "lat",
        "lng",
        "acc",
        "capture_id",
        "image_hash",
        "perceptual_hash",
      ])
        assert.equal(body[field], null, field);
      return Response.json({
        id: "same-record",
        staff_id: user,
        status: body.status,
        phase: body.action === "complete" ? "submitted" : "draft",
      });
    }
    throw Error("Unexpected request " + url.pathname);
  };
}
test("arrival and departure work without GPS, camera, challenge or device cookie", async () => {
  const original = globalThis.fetch,
    calls = [];
  globalThis.fetch = fixture(calls);
  try {
    for (const patch of [
      {},
      { action: "complete", photo_upload_path: null },
      { status: "deputation", deputation_workplace: "District office" },
      {
        latitude: 26,
        longitude: 87,
        accuracy: 5000,
        photo_upload_path: path.replace("leave.pdf", "photo.jpg"),
        challenge: "expired",
        location_confirmed: false,
      },
    ]) {
      const response = await POST(request(patch));
      assert.equal(response.status, 200);
      assert.equal((await response.json()).record.id, "same-record");
    }
    assert.equal(
      calls.some(
        (c) =>
          c.url.pathname.includes("bind_device") ||
          c.url.pathname.includes("challenge"),
      ),
      false,
    );
  } finally {
    globalThis.fetch = original;
  }
});
test("assignment, status and deputation validation still apply", async () => {
  const original = globalThis.fetch,
    calls = [];
  globalThis.fetch = fixture(calls);
  try {
    for (const patch of [
      { department: 42 },
      { position: {} },
      { department: "Wrong" },
      { status: ["present"] },
      { status: "deputation", deputation_workplace: "" },
      { action: "save_status", status: "leave", leave_type: "CL" },
      { status: "absent" },
    ])
      assert.equal((await POST(request(patch))).status, 400);
    assert.equal(
      calls.some((c) => c.url.pathname.includes("/rpc/")),
      false,
    );
  } finally {
    globalThis.fetch = original;
  }
});
test("leave PDF remains owned, bounded and scanned when configured", async () => {
  const original = globalThis.fetch,
    calls = [];
  globalThis.fetch = fixture(calls);
  process.env.UPLOAD_SCAN_URL = "https://scanner.example.test";
  process.env.UPLOAD_SCAN_TOKEN = "fixture";
  try {
    const response = await POST(
      request({
        action: "save_status",
        photo_upload_path: null,
        status: "leave",
        leave_type: "SL",
        leave_upload_path: path,
      }),
    );
    assert.equal(response.status, 200);
    assert.ok(calls.some((c) => c.url.hostname === "scanner.example.test"));
    const rpc = calls.find(
      (c) => c.url.pathname === "/rest/v1/rpc/save_attendance_with_evidence",
    );
    assert.equal(JSON.parse(rpc.init.body).leave_path, path);
  } finally {
    globalThis.fetch = original;
    delete process.env.UPLOAD_SCAN_URL;
    delete process.env.UPLOAD_SCAN_TOKEN;
  }
});
test("consumed or rejected leave evidence cannot create attendance", async () => {
  const original = globalThis.fetch;
  process.env.UPLOAD_SCAN_URL = "https://scanner.example.test";
  process.env.UPLOAD_SCAN_TOKEN = "fixture";
  try {
    for (const options of [{ consumed: true }, { clean: false }]) {
      const calls = [];
      globalThis.fetch = fixture(calls, options);
      assert.equal(
        (
          await POST(
            request({
              action: "save_status",
              status: "leave",
              leave_type: "CL",
              leave_upload_path: path,
            }),
          )
        ).status,
        400,
      );
      assert.equal(
        calls.some(
          (c) =>
            c.url.pathname === "/rest/v1/rpc/save_attendance_with_evidence",
        ),
        false,
      );
      if (options.consumed)
        assert.equal(
          calls.some((c) => c.init.method === "DELETE"),
          false,
        );
    }
  } finally {
    globalThis.fetch = original;
    delete process.env.UPLOAD_SCAN_URL;
    delete process.env.UPLOAD_SCAN_TOKEN;
  }
});
test("admin cannot submit staff attendance", async () => {
  const original = globalThis.fetch,
    calls = [];
  globalThis.fetch = fixture(calls, { role: "super_admin" });
  try {
    assert.equal((await POST(request())).status, 403);
  } finally {
    globalThis.fetch = original;
  }
});

test("absence cannot save without a meaningful reason and is returned to the trusted RPC", async () => {
  const original = globalThis.fetch,
    calls = [];
  globalThis.fetch = fixture(calls);
  try {
    for (const absence_reason of [
      undefined,
      "",
      "   ",
      "ab",
      {},
      "x".repeat(1001),
    ])
      assert.equal(
        (
          await POST(
            request({
              action: "save_status",
              status: "absent",
              photo_upload_path: null,
              absence_reason,
            }),
          )
        ).status,
        400,
      );
    assert.equal(
      calls.some((c) => c.url.pathname.includes("/rpc/")),
      false,
    );
    assert.equal(
      (
        await POST(
          request({
            action: "save_status",
            status: "absent",
            photo_upload_path: null,
            absence_reason: "  Family emergency  ",
          }),
        )
      ).status,
      200,
    );
    const rpc = calls.find((c) => c.url.pathname.includes("/rpc/"));
    assert.equal(JSON.parse(rpc.init.body).absence_reason, "Family emergency");
  } finally {
    globalThis.fetch = original;
  }
});
test("present and deputation cannot save without a photo", async () => {
  const original = globalThis.fetch,
    calls = [];
  globalThis.fetch = fixture(calls);
  try {
    for (const status of ["present", "deputation"])
      assert.equal(
        (
          await POST(
            request({
              status,
              photo_upload_path: null,
              deputation_workplace: "District office",
            }),
          )
        ).status,
        400,
      );
    assert.equal(
      calls.some((c) => c.url.pathname.includes("/rpc/")),
      false,
    );
  } finally {
    globalThis.fetch = original;
  }
});

test("holiday blocks arrival, status and checkout before reading any image or saving attendance", async () => {
  const original = globalThis.fetch;
  try {
    for (const patch of [
      {},
      { action: "complete", photo_upload_path: null },
      {
        action: "save_status",
        status: "absent",
        absence_reason: "Personal reason",
        photo_upload_path: null,
      },
    ]) {
      const calls = [];
      globalThis.fetch = fixture(calls, { holiday: true });
      const response = await POST(request(patch));
      assert.equal(response.status, 409);
      assert.match((await response.json()).error, /Festival holiday/);
      assert.equal(
        calls.some(
          (call) =>
            call.url.pathname.includes("pending_uploads") ||
            call.url.pathname.includes("/storage/") ||
            call.url.pathname.includes("/rpc/"),
        ),
        false,
      );
    }
  } finally {
    globalThis.fetch = original;
  }
});

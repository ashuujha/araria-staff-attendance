import test from "node:test";
import assert from "node:assert/strict";
import { clearTestGps } from "../scripts/clear-test-gps.mjs";

test("cleanup clears only attendance GPS fields and deletes only unreferenced photos", async () => {
  const original = globalThis.fetch;
  const row = {
    id: "record",
    version: 3,
    photo_path: "staff/in.jpg",
    out_photo_path: "staff/out.jpg",
    latitude: 26,
    longitude: 87,
    accuracy: 12,
    out_location: { latitude: 26 },
    photo_hash: "hash",
    out_photo_hash: "out-hash",
    leave_path: "staff/leave.jpg",
  };
  const calls = [],
    manifests = [];
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(input),
      method = init.method || "GET";
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ url, method, body });
    if (url.pathname === "/rest/v1/profiles")
      return Response.json([{ id: "admin" }]);
    if (url.pathname === "/rest/v1/attendance" && method === "GET")
      return Response.json(url.searchParams.has("offset") ? [row] : []);
    if (url.pathname === "/rest/v1/attendance" && method === "PATCH") {
      assert.equal(url.searchParams.get("version"), "eq.3");
      assert.equal(url.searchParams.get("id"), "eq.record");
      assert.deepEqual(body, {
        latitude: null,
        longitude: null,
        accuracy: null,
        out_location: null,
        photo_path: null,
        out_photo_path: null,
        photo_hash: null,
        out_photo_hash: null,
        version: 4,
      });
      return Response.json([{ id: "record" }]);
    }
    if (url.pathname === "/storage/v1/object/attendance-private")
      return Response.json([]);
    if (
      url.pathname === "/rest/v1/pending_uploads" ||
      url.pathname === "/rest/v1/audit_logs"
    )
      return new Response(null, { status: 204 });
    throw Error("Unexpected request");
  };
  const config = {
    url: "https://fixture.invalid",
    key: "sb_secret_fixture",
    adminEmail: "admin@example.test",
    cutoff: "2026-10-13T12:00:00Z",
    savePending: async (paths) => manifests.push(paths),
  };
  try {
    const preview = await clearTestGps(config);
    assert.equal(preview.attendanceRecords, 1);
    assert.equal(preview.gpsPhotos, 2);
    assert.equal(
      calls.every((c) => c.method === "GET"),
      true,
    );
    calls.length = 0;
    const result = await clearTestGps({ ...config, apply: true });
    assert.equal(result.cleared, 1);
    assert.deepEqual(
      calls
        .filter(
          (c) => c.url.pathname === "/storage/v1/object/attendance-private",
        )
        .map((c) => c.body.prefixes[0]),
      ["staff/in.jpg", "staff/out.jpg"],
    );
    assert.equal(
      calls.some(
        (c) => c.method !== "GET" && c.url.pathname === "/rest/v1/profiles",
      ),
      false,
    );
    assert.deepEqual(manifests.at(-1), []);
    const audit = calls.at(-1).body;
    assert.equal(audit.action, "clear_test_gps");
    assert.equal(JSON.stringify(audit).includes("latitude"), false);
  } finally {
    globalThis.fetch = original;
  }
});

test("cleanup refuses to delete a photo used by a leave document", async () => {
  const original = globalThis.fetch;
  let mutations = 0;
  globalThis.fetch = async (input, init = {}) => {
    if (init.method !== "GET") mutations++;
    const url = new URL(input);
    return Response.json(
      url.searchParams.has("offset")
        ? [{ id: "record", photo_path: "staff/shared.jpg" }]
        : [{ id: "leave-record" }],
    );
  };
  try {
    await assert.rejects(
      clearTestGps({
        url: "https://fixture.invalid",
        key: "sb_secret_fixture",
        adminEmail: "admin@example.test",
        apply: true,
      }),
      /leave document/,
    );
    assert.equal(mutations, 0);
  } finally {
    globalThis.fetch = original;
  }
});

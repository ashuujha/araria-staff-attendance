import test from "node:test";
import assert from "node:assert/strict";
import { resetStaffDevice } from "../scripts/reset-device.mjs";
test("reset targets one matching staff account using audited RPC, preserves credentials and other accounts", async () => {
  const original = globalThis.fetch,
    calls = [];
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(input);
    calls.push({ url, init });
    if (url.pathname === "/rest/v1/profiles")
      return Response.json([
        { id: url.searchParams.has("phone") ? "staff-target" : "admin-actor" },
      ]);
    if (url.pathname === "/rest/v1/rpc/manage_staff")
      return Response.json({ id: "staff-target" });
    throw Error("Unexpected reset call");
  };
  try {
    await resetStaffDevice("9572505783", {
      url: "https://fixture.invalid",
      key: "sb_secret_fixture",
      adminEmail: "admin@example.test",
    });
    const b = JSON.parse(calls.at(-1).init.body);
    assert.equal(b.actor_id, "admin-actor");
    assert.equal(b.target_id, "staff-target");
    assert.deepEqual(b.changes, { reset_device: true });
    assert.ok(b.reason_text.length >= 10);
    assert.equal(calls.filter((c) => c.init.method === "POST").length, 1);
    assert.equal(calls[1].url.searchParams.get("phone"), "eq.9572505783");
    await assert.rejects(
      resetStaffDevice("all", {
        url: "https://fixture.invalid",
        key: "sb_secret_fixture",
        adminEmail: "admin@example.test",
      }),
    );
    assert.equal(calls.length, 3);
  } finally {
    globalThis.fetch = original;
  }
});

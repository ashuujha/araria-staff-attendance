import test from "node:test";
import assert from "node:assert/strict";
import { resetAdminPassword } from "../scripts/reset-admin-password.mjs";
test("admin reset verifies new login, clears only admin device and excludes secrets from audit", async () => {
  const original = globalThis.fetch,
    calls = [];
  const config = {
    url: "https://fixture.invalid",
    key: "sb_secret_fixture",
    publishableKey: "sb_publishable_fixture",
    email: "admin@example.test",
    password: "requested-fixture-password",
  };
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(input);
    calls.push({ url, init });
    if (url.pathname === "/rest/v1/profiles" && init.method === "GET")
      return Response.json([{ id: "admin-target" }]);
    if (url.pathname === "/auth/v1/token")
      return Response.json({
        user: { id: "admin-target" },
        access_token: "private-user-token",
      });
    if (url.pathname === "/rest/v1/audit_logs")
      return new Response(null, { status: 201 });
    if (init.method === "PATCH") return new Response(null, { status: 204 });
    if (url.pathname === "/auth/v1/admin/users/admin-target")
      return Response.json({ id: "admin-target" });
    throw Error("Unexpected request");
  };
  try {
    await resetAdminPassword(config);
    const update = calls.find((c) => c.init.method === "PUT");
    assert.equal(JSON.parse(update.init.body).password, config.password);
    const patch = calls.find((c) => c.init.method === "PATCH");
    assert.deepEqual(JSON.parse(patch.init.body), { device_hash: null });
    assert.equal(patch.url.searchParams.get("id"), "eq.admin-target");
    assert.equal(
      calls.some((c) => c.url.searchParams.get("role") === "eq.staff"),
      false,
    );
    const audit = calls.at(-1).init.body;
    assert.equal(audit.includes(config.password), false);
    assert.equal(audit.includes("private-user-token"), false);
    assert.equal(
      calls.find((c) => c.url.pathname === "/auth/v1/token").init.headers
        .apikey,
      config.publishableKey,
    );
  } finally {
    globalThis.fetch = original;
  }
});

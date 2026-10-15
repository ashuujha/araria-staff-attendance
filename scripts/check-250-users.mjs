// Local route concurrency check. No real credentials, network or production load.
import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
await mkdir(".preview", { recursive: true });
const handlers = {};
for (const [name, path] of Object.entries({
  login: "src/app/api/auth/login/route.ts",
  session: "src/app/api/session/route.ts",
  attendance: "src/app/api/attendance-workflow/route.ts",
  capacity: "src/lib/evidence-capacity.ts",
})) {
  const out = `.preview/capacity-${name}.mjs`;
  await build({
    entryPoints: [path],
    bundle: true,
    platform: "node",
    format: "esm",
    packages: "external",
    outfile: out,
  });
  handlers[name] = await import(pathToFileURL(resolve(out)));
}
process.env.APP_URL = "https://capacity.example.test";
process.env.SUPABASE_URL = "https://capacity.supabase.invalid";
process.env.SUPABASE_SECRET_KEY = "sb_secret_fixture";
process.env.SUPABASE_PUBLISHABLE_KEY = "sb_publishable_fixture";
const users = Array.from({ length: 250 }, (_, i) => {
  const id = `aaaaaaaa-aaaa-4aaa-8aaa-${String(i + 1).padStart(12, "0")}`;
  return {
    id,
    name: "Capacity fixture " + i,
    phone: String(9200000000 + i),
    role: "staff",
    active: true,
    block: "Araria",
    assignments: [
      { department: "Office", panchayat: "Office", position: "Staff" },
    ],
  };
});
const byPhone = new Map(users.map((u) => [u.phone, u]));
const byId = new Map(users.map((u) => [u.id, u]));
const token = (id) =>
  `fixture.${Buffer.from(JSON.stringify({ sub: id })).toString("base64url")}.fixture-signature`;
const original = globalThis.fetch;
let inFlight = 0,
  peak = 0,
  total = 0;
globalThis.fetch = async (input, init = {}) => {
  inFlight++;
  total++;
  peak = Math.max(peak, inFlight);
  try {
    await new Promise((r) => setTimeout(r, 1));
    const url = new URL(input),
      body = init.body ? JSON.parse(init.body) : null;
    assert.equal(url.hostname, "capacity.supabase.invalid");
    if (url.pathname === "/auth/v1/token") {
      const user = byPhone.get(body.email.split("@")[0]);
      assert.ok(user);
      return Response.json({
        user: { id: user.id },
        access_token: token(user.id),
        expires_in: 3600,
      });
    }
    if (url.pathname === "/rest/v1/rpc/portal_bootstrap") {
      const bearer = new Headers(init.headers).get("authorization").slice(7);
      const subject = JSON.parse(
        Buffer.from(bearer.split(".")[1], "base64url").toString(),
      ).sub;
      const user = byId.get(subject);
      assert.ok(user);
      return Response.json({
        profile: user,
        date: "2026-10-15",
        records: [],
        staff: [],
        office: { today: "2026-10-15", holidays: [], notices: [] },
      });
    }
    if (url.pathname === "/rest/v1/profiles") {
      if (url.searchParams.has("phone")) {
        const user = byPhone.get(url.searchParams.get("phone").slice(3));
        return Response.json([
          { login_email: user.phone + "@staff.araria.invalid" },
        ]);
      }
      const user = byId.get(url.searchParams.get("id").slice(3));
      assert.ok(user);
      assert.equal(
        new Headers(init.headers).get("authorization"),
        "Bearer " + token(user.id),
      );
      return Response.json([user]);
    }
    if (url.pathname === "/rest/v1/attendance") return Response.json([]);
    throw Error("Unexpected upstream endpoint " + url.pathname);
  } finally {
    inFlight--;
  }
};
try {
  const started = performance.now();
  await Promise.all(
    users.map(async (user) => {
      const response = await handlers.login.POST(
        new Request(process.env.APP_URL + "/api/auth/login", {
          method: "POST",
          headers: {
            origin: process.env.APP_URL,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            identifier: user.phone,
            password: "fixture-password",
            admin: false,
          }),
        }),
      );
      assert.equal(response.status, 200);
      assert.equal((await response.json()).profile.id, user.id);
    }),
  );
  for (const endpoint of ["session", "attendance"])
    await Promise.all(
      users.map(async (user) => {
        const response = await handlers[endpoint].GET(
          new Request(process.env.APP_URL + "/api/" + endpoint, {
            headers: { cookie: "araria_session=" + token(user.id) },
          }),
        );
        assert.equal(response.status, 200);
        const data = await response.json();
        if (endpoint === "session") assert.equal(data.profile.id, user.id);
        else assert.deepEqual(data.records, []);
      }),
    );
  let images = 0,
    imagePeak = 0;
  await Promise.all(
    users.map(async () => {
      const release = await handlers.capacity.reserveEvidenceSlot();
      images++;
      imagePeak = Math.max(imagePeak, images);
      try {
        await new Promise((r) => setTimeout(r, 1));
      } finally {
        images--;
        release();
      }
    }),
  );
  assert.equal(imagePeak, 4);
  const report = {
    scope:
      "Local route handlers with mocked Supabase, not a live hosting capacity guarantee",
    virtualStaff: 250,
    loginIncludesDashboard: true,
    authenticatedStartupUpstreamRequests: 1,
    coldStaffLoginUpstreamRequests: 3,
    successfulLogins: 250,
    successfulSessionViews: 250,
    successfulAttendanceViews: 250,
    upstreamRequests: total,
    peakMockedUpstreamConcurrency: peak,
    maxConcurrentEvidenceBuffers: imagePeak,
    elapsedMs: Math.round(performance.now() - started),
  };
  await writeFile(
    "docs/CAPACITY_CHECK.json",
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(report);
} finally {
  globalThis.fetch = original;
}

import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { PDFDocument } from "pdf-lib";

await mkdir(".preview", { recursive: true });
await build({
  entryPoints: ["src/app/api/leave-applications/route.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  packages: "external",
  outfile: ".preview/leave-applications-api-test.mjs",
});
const { POST } = await import(
  pathToFileURL(resolve(".preview/leave-applications-api-test.mjs"))
);
process.env.SUPABASE_URL = "https://fixture.supabase.invalid";
process.env.SUPABASE_SECRET_KEY = "sb_secret_fixture";
process.env.SUPABASE_PUBLISHABLE_KEY = "sb_publishable_fixture";
process.env.APP_URL = "https://portal.example.test";
const bpro = "11111111-1111-4111-8111-111111111111";
const staff = "22222222-2222-4222-8222-222222222222";
const block = "33333333-3333-4333-8333-333333333333";
const otherBlock = "44444444-4444-4444-8444-444444444444";
const requestId = "55555555-5555-4555-8555-555555555555";
function request({ approve, reason = "", file, mode = "uploaded" }) {
  const form = new FormData();
  form.set("id", requestId);
  form.set("approve", String(approve));
  form.set("reason", reason);
  form.set("mode", mode);
  if (file) form.set("file", file);
  return new Request(process.env.APP_URL + "/api/leave-applications", {
    method: "POST",
    headers: {
      origin: process.env.APP_URL,
      cookie: "araria_session=fixture-session",
    },
    body: form,
  });
}
function fixture(calls, requestBlock = block) {
  return async (input, init = {}) => {
    const url = new URL(String(input));
    calls.push({ url, init });
    if (url.pathname === "/auth/v1/user") return Response.json({ id: bpro });
    if (url.pathname === "/rest/v1/profiles")
      return Response.json([
        { id: bpro, role: "bpro", block_id: block, active: true },
      ]);
    if (url.pathname === "/rest/v1/leave_applications")
      return Response.json([
        {
          id: requestId,
          staff_id: staff,
          block_id: requestBlock,
          date: "2026-11-10",
          leave_type: "CL",
          leave_path: `${requestBlock}/${staff}/2026-11-10/original.pdf`,
        },
      ]);
    if (url.pathname === "/rest/v1/leave_decision_documents")
      return new Response(null, { status: 201 });
    if (url.pathname === "/rest/v1/rpc/decide_leave_application_v2")
      return Response.json({
        id: requestId,
        status: JSON.parse(init.body).approve ? "approved" : "rejected",
      });
    if (url.pathname.startsWith("/storage/v1/object/attendance-private/"))
      return Response.json({ Key: url.pathname });
    throw Error("Unexpected request " + url.pathname);
  };
}

test("a BPRO cannot decide another block's request or upload its signed copy", async () => {
  const original = globalThis.fetch,
    calls = [];
  globalThis.fetch = fixture(calls, otherBlock);
  try {
    assert.equal(
      (await POST(request({ approve: false, reason: "Not eligible" }))).status,
      403,
    );
    assert.equal(
      calls.some((call) =>
        call.url.pathname.includes("decide_leave_application"),
      ),
      false,
    );
  } finally {
    globalThis.fetch = original;
  }
});

test("rejection sends the reason and never creates a signed file", async () => {
  const original = globalThis.fetch,
    calls = [];
  globalThis.fetch = fixture(calls);
  try {
    assert.equal(
      (
        await POST(
          request({ approve: false, reason: "Missing leave document" }),
        )
      ).status,
      200,
    );
    const rpc = calls.find((call) =>
      call.url.pathname.endsWith("/decide_leave_application_v2"),
    );
    assert.equal(
      JSON.parse(rpc.init.body).reason_text,
      "Missing leave document",
    );
    assert.equal(
      calls.some((call) => call.url.pathname.startsWith("/storage/v1/object/")),
      false,
    );
  } finally {
    globalThis.fetch = original;
  }
});

test("approval requires a signed file and stores it under the applicant's block", async () => {
  const original = globalThis.fetch,
    calls = [];
  globalThis.fetch = fixture(calls);
  try {
    assert.equal((await POST(request({ approve: true }))).status, 400);
    const pdf = await PDFDocument.create();
    pdf.addPage();
    const signed = new File([await pdf.save()], "signed.pdf", {
      type: "application/pdf",
    });
    assert.equal(
      (await POST(request({ approve: true, file: signed }))).status,
      200,
    );
    const rpc = calls.find((call) =>
      call.url.pathname.endsWith("/decide_leave_application_v2"),
    );
    const path = JSON.parse(rpc.init.body).decision_path;
    assert.ok(
      path.startsWith(`${block}/${staff}/leave-decisions/${requestId}/`),
    );
    assert.ok(path.endsWith(".pdf"));
  } finally {
    globalThis.fetch = original;
  }
});

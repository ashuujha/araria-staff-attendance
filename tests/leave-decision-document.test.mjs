import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import sharp from "sharp";
import { PDFDocument } from "pdf-lib";

await mkdir(".preview", { recursive: true });
await build({
  entryPoints: ["src/lib/leave-decision-document.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  packages: "external",
  outfile: ".preview/leave-decision-document-test.mjs",
});
const { makeSignedLeavePdf } = await import(
  pathToFileURL(resolve(".preview/leave-decision-document-test.mjs"))
);
const signature = await sharp({
  create: { width: 400, height: 120, channels: 4, background: "white" },
})
  .png()
  .toBuffer();
const input = {
  signature,
  requestId: "11111111-1111-4111-8111-111111111111",
  staffId: "22222222-2222-4222-8222-222222222222",
  leaveDate: "2026-11-10",
  leaveType: "CL",
  approverRole: "bpro",
  decidedAt: new Date("2026-11-10T08:30:00Z"),
};

test("drawn approval preserves the original PDF and appends a signed decision page", async () => {
  const original = await PDFDocument.create();
  original.addPage([595, 842]);
  const bytes = await makeSignedLeavePdf({
    ...input,
    original: await original.save(),
  });
  const final = await PDFDocument.load(bytes);
  assert.equal(final.getPageCount(), 2);
  assert.ok(bytes.length < 5 * 1024 * 1024);
});

test("JPEG leave application becomes a two-page signed PDF", async () => {
  const original = await sharp({
    create: { width: 600, height: 800, channels: 3, background: "white" },
  })
    .jpeg()
    .toBuffer();
  const bytes = await makeSignedLeavePdf({ ...input, original });
  assert.equal((await PDFDocument.load(bytes)).getPageCount(), 2);
});

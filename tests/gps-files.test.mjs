import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdir } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import sharp from "sharp";
await mkdir(".preview", { recursive: true });
for (const name of ["file-validation", "photo"])
  await build({
    entryPoints: [`src/lib/${name}.ts`],
    bundle: true,
    platform: "node",
    format: "esm",
    packages: "external",
    outfile: `.preview/${name}-test.mjs`,
  });
const {
  validateUploadBytes,
  readBoundedUpload,
  MAX_UPLOAD_BYTES,
  sanitizeLeaveJpeg,
} = await import(pathToFileURL(resolve(".preview/file-validation-test.mjs")));
const { processPhoto } = await import(
  pathToFileURL(resolve(".preview/photo-test.mjs"))
);
test("leave documents are strictly below 5 MiB and reject known active PDF content", async () => {
  const pdf = (text) =>
    Buffer.from(`%PDF-1.7\n1 0 obj << ${text} >> endobj\n%%EOF\n`);
  assert.equal(validateUploadBytes(pdf("/Type /Catalog")), "application/pdf");
  for (const content of [
    "/JavaScript",
    "/J#53",
    "/Launch",
    "/EmbeddedFile",
    "/Encrypt",
  ])
    assert.throws(() => validateUploadBytes(pdf(content)));
  assert.throws(() => validateUploadBytes(Buffer.alloc(MAX_UPLOAD_BYTES)));
  assert.throws(() =>
    validateUploadBytes(Buffer.from("not an image or PDF document")),
  );
  await assert.rejects(
    readBoundedUpload(new Response(Buffer.alloc(MAX_UPLOAD_BYTES))),
  );
});
test("JPEG evidence reencode strips metadata and rejects malformed JPEG", async () => {
  const source = await sharp({
    create: { width: 500, height: 400, channels: 3, background: "#987654" },
  })
    .withMetadata()
    .jpeg()
    .toBuffer();
  const clean = await sanitizeLeaveJpeg(source);
  assert.equal((await sharp(clean).metadata()).exif, undefined);
  await assert.rejects(
    sanitizeLeaveJpeg(Buffer.from([255, 216, 255, ...Array(30).fill(0)])),
  );
});
test("GPS footer preserves entire portrait and landscape dimensions instead of cropping", async () => {
  for (const [width, height] of [
    [1200, 1600],
    [1200, 800],
  ]) {
    const source = await sharp({
      create: { width, height, channels: 3, background: "#345678" },
    })
      .jpeg()
      .toBuffer();
    const output = await processPhoto(
      source,
      26.17424,
      87.38991,
      9,
      "test",
      "Tharia <office> & staff",
      new Date("2026-10-12T05:57:00Z"),
    );
    const metadata = await sharp(output.bytes).metadata();
    assert.equal(metadata.width, width);
    assert.ok(metadata.height > height);
    assert.equal(output.perceptualHash.length, 64);
    // Body image remains intact above the appended dark stamp.
    const { data } = await sharp(output.bytes)
      .extract({ left: 0, top: height - 16, width: 1, height: 1 })
      .raw()
      .toBuffer({ resolveWithObject: true });
    assert.ok(Math.abs(data[0] - 52) < 4);
    const footer = await sharp(output.bytes)
      .extract({
        left: 0,
        top: height,
        width,
        height: metadata.height - height,
      })
      .raw()
      .toBuffer();
    assert.ok(
      footer.some((n) => n > 200),
      "readable light text is rendered in footer",
    );
  }
});

test("authoritative photo embeds a real map beside nearby mapped address and preserves portrait", async () => {
  const map = await sharp({
    create: { width: 256, height: 180, channels: 3, background: "#ddeedd" },
  })
    .png()
    .toBuffer();
  const source = await sharp({
    create: { width: 1200, height: 1600, channels: 3, background: "#345678" },
  })
    .jpeg()
    .toBuffer();
  const output = await processPhoto(
    source,
    26.17424,
    87.38991,
    9,
    "test",
    "Assigned office",
    new Date("2026-10-12T05:57:00Z"),
    { address: "Mapped locality, Bihar, India", map },
  );
  const m = await sharp(output.bytes).metadata();
  assert.equal(m.width, 1200);
  assert.ok(m.height > 1800);
  const { data } = await sharp(output.bytes)
    .extract({ left: 45, top: 1645, width: 1, height: 1 })
    .raw()
    .toBuffer({ resolveWithObject: true });
  assert.ok(
    data[0] > 200 && data[1] > 220,
    "map pixels are embedded in appended footer",
  );
});

test("ordinary workplace JPEG/PNG images normalize to bounded JPEG without retained EXIF location metadata", async () => {
  const { sanitizeWorkplacePhoto } = await import(
    pathToFileURL(resolve(".preview/file-validation-test.mjs"))
  );
  for (const format of ["jpeg", "png"]) {
    const source = await sharp({
      create: { width: 2400, height: 1600, channels: 3, background: "#527364" },
    })
      .withMetadata({ exif: { IFD0: { Artist: "Private metadata fixture" } } })
      [format]()
      .toBuffer();
    const output = await sanitizeWorkplacePhoto(source);
    const metadata = await sharp(output).metadata();
    assert.equal(metadata.format, "jpeg");
    assert.equal(metadata.exif, undefined);
    assert.ok(metadata.width <= 1920);
    assert.ok(output.length < MAX_UPLOAD_BYTES);
  }
  await assert.rejects(
    sanitizeWorkplacePhoto(Buffer.from("%PDF-1.7\nfixture evidence\n%%EOF\n")),
  );
  await assert.rejects(sanitizeWorkplacePhoto(Buffer.alloc(MAX_UPLOAD_BYTES)));
  await assert.rejects(
    sanitizeWorkplacePhoto(
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, ...Array(40).fill(0)]),
    ),
  );
});

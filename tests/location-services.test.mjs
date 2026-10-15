import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdir } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import sharp from "sharp";
await mkdir(".preview", { recursive: true });
await build({
  entryPoints: ["src/lib/location-services.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  packages: "external",
  outfile: ".preview/location-services-test.mjs",
});
const {
  coordinatePair,
  requestCoordinates,
  getLocationDetails,
  getMapThumbnail,
  mapGeometry,
} = await import(pathToFileURL(resolve(".preview/location-services-test.mjs")));
const originalFetch = globalThis.fetch;
process.env.APP_URL = "https://portal.example.test";
test("coordinates are bounded and empty query values do not silently become zero", () => {
  for (const [lat, lon] of [
    [NaN, 87],
    [Infinity, 87],
    [91, 87],
    [26, -181],
    ["26", 87],
  ])
    assert.throws(() => coordinatePair(lat, lon));
  assert.throws(() =>
    requestCoordinates(
      new Request("https://portal.example.test/api/location?lat=&lon=87"),
    ),
  );
  assert.deepEqual(coordinatePair(0, 0), { latitude: 0, longitude: 0 });
});
test("Photon address uses coordinate-only query, deduplicates results and caches concurrent requests", async () => {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: new URL(String(url)), init });
    return Response.json({
      features: [
        {
          properties: {
            name: "Test locality",
            street: "Main Road",
            district: "Test locality",
            city: "Araria",
            state: "Bihar",
            country: "India",
          },
        },
      ],
    });
  };
  try {
    const [a, b] = await Promise.all([
      getLocationDetails(26.123456, 87.123456),
      getLocationDetails(26.123456, 87.123456),
    ]);
    assert.equal(a.address, "Test locality, Main Road, Araria, Bihar, India");
    assert.deepEqual(a, b);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url.hostname, "photon.komoot.io");
    assert.equal(calls[0].url.searchParams.get("lat"), "26.123456");
    assert.equal(calls[0].url.searchParams.has("q"), false);
    assert.match(calls[0].init.headers["User-Agent"], /^ArariaStaffAttendance/);
    assert.equal(calls[0].init.headers.Referer, process.env.APP_URL);
    await getLocationDetails(26.123456, 87.123456);
    assert.equal(calls.length, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
test("provider failures and malformed/oversized payloads produce no fabricated address or map", async () => {
  globalThis.fetch = async () => {
    throw new Error("offline");
  };
  try {
    const value = await getLocationDetails(26.223456, 87.223456);
    assert.equal(value.address, null);
    assert.equal(value.available, false);
    assert.equal(await getMapThumbnail(26.223456, 87.223456), null);
  } finally {
    globalThis.fetch = originalFetch;
  }
  globalThis.fetch = async () => new Response("X".repeat(128 * 1024 + 1));
  try {
    assert.equal(
      (await getLocationDetails(26.323456, 87.323456)).address,
      null,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
  globalThis.fetch = async () => new Response("not a tile");
  try {
    assert.equal(await getMapThumbnail(26.423456, 87.423456), null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
test("OSM map stitches only viewed tiles, pins exact coordinate at centre and caches tiles/maps", async () => {
  const tile = await sharp({
    create: { width: 256, height: 256, channels: 3, background: "#ddeedd" },
  })
    .png()
    .toBuffer();
  const calls = [];
  globalThis.fetch = async (input, init) => {
    calls.push({ url: new URL(String(input)), init, at: Date.now() });
    return new Response(tile, {
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "public, max-age=604800",
      },
    });
  };
  try {
    const lat = 26.17424,
      lon = 87.38991;
    const [a, b] = await Promise.all([
      getMapThumbnail(lat, lon),
      getMapThumbnail(lat, lon),
    ]);
    assert.ok(a);
    assert.deepEqual(a, b);
    const m = await sharp(a).metadata();
    assert.equal(m.width, 256);
    assert.equal(m.height, 180);
    assert.ok(calls.length >= 1 && calls.length <= 4);
    for (const call of calls) {
      assert.equal(call.url.hostname, "tile.openstreetmap.org");
      assert.match(call.url.pathname, /^\/16\/\d+\/\d+\.png$/);
      assert.equal(call.init.redirect, "error");
      assert.equal(call.init.headers.Referer, process.env.APP_URL);
      assert.match(call.init.headers["User-Agent"], /ArariaStaffAttendance/);
      assert.equal(call.init.headers["Cache-Control"], undefined);
    }
    for (let i = 1; i < calls.length; i++)
      assert.ok(
        calls[i].at - calls[i - 1].at >= 850,
        "upstream rate stays around one request per second",
      );
    const g = mapGeometry(lat, lon);
    assert.ok(g.x - g.left >= 128 && g.x - g.left < 129);
    assert.ok(g.y - g.top >= 90 && g.y - g.top < 91);
    const { data } = await sharp(a)
      .extract({ left: 127, top: 71, width: 2, height: 3 })
      .raw()
      .toBuffer({ resolveWithObject: true });
    assert.ok(
      data[0] > 170 && data[1] < 100,
      "real map is stamped with a red location pin",
    );
    const count = calls.length;
    await getMapThumbnail(lat, lon);
    assert.equal(calls.length, count);
    assert.equal(await getMapThumbnail(89, 87), null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

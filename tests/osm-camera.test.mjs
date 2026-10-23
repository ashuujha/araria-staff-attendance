import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

await mkdir(".preview", { recursive: true });
await build({
  entryPoints: ["src/lib/osm-camera.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  outfile: ".preview/osm-camera-test.mjs",
});
const {
  cameraLocation,
  openStreetMapUrl,
  openStreetMapEmbedUrl,
  googleMapsUrl,
} = await import(pathToFileURL(resolve(".preview/osm-camera-test.mjs")));

test("fresh device location is accepted without a 50 metre cutoff and maps to OSM", () => {
  const now = Date.now();
  const location = cameraLocation(
    {
      coords: { latitude: 22.5643, longitude: 88.3693, accuracy: 1200 },
      timestamp: now - 1000,
    },
    now,
  );
  assert.equal(location.accuracy, 1200);
  assert.match(openStreetMapUrl(location), /mlat=22\.564300&mlon=88\.369300/);
  const embed = new URL(openStreetMapEmbedUrl(location));
  assert.equal(embed.hostname, "www.openstreetmap.org");
  assert.equal(embed.searchParams.get("marker"), "22.5643,88.3693");
  const google = new URL(googleMapsUrl(location));
  assert.equal(google.origin, "https://www.google.com");
  assert.equal(google.pathname, "/maps/search/");
  assert.equal(google.searchParams.get("api"), "1");
  assert.equal(google.searchParams.get("query"), "22.564300,88.369300");
});

test("stale or invalid device positions cannot be stamped", () => {
  const now = Date.now();
  for (const position of [
    {
      coords: { latitude: 26, longitude: 87, accuracy: 20 },
      timestamp: now - 21_000,
    },
    { coords: { latitude: 92, longitude: 87, accuracy: 20 }, timestamp: now },
    { coords: { latitude: 26, longitude: 87, accuracy: 0 }, timestamp: now },
  ])
    assert.throws(
      () => cameraLocation(position, now),
      /fresh location reading|ताज़ा स्थान/,
    );
});

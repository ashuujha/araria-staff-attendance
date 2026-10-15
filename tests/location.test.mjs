import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdir } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
await mkdir(".preview", { recursive: true });
await build({
  entryPoints: ["src/lib/location.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  outfile: ".preview/location-test.mjs",
});
const { getFreshLocation, validateDevicePosition } = await import(
  pathToFileURL(resolve(".preview/location-test.mjs"))
);
const position = (values = {}) => ({
  coords: { latitude: 22.56, longitude: 88.36, accuracy: 10, ...values },
  timestamp: Date.now(),
});
function device() {
  let success, error;
  const cleared = [];
  return {
    cleared,
    watchPosition(onSuccess, onError, options) {
      assert.equal(options.maximumAge, 0);
      assert.equal(options.enableHighAccuracy, true);
      success = onSuccess;
      error = onError;
      return 42;
    },
    clearWatch(id) {
      cleared.push(id);
    },
    emit(p) {
      success(p);
    },
    fail(code) {
      error({ code });
    },
  };
}
const quick = { settleMs: 15, timeoutMs: 150 };
test("cached first reading is ignored until a fresh fix arrives", async () => {
  const gps = device();
  const result = getFreshLocation(gps, undefined, quick);
  gps.emit({ ...position(), timestamp: Date.now() - 30_000 });
  const fresh = position({ latitude: 22.6 });
  gps.emit(fresh);
  assert.equal(await result, fresh);
  assert.deepEqual(gps.cleared, [42]);
});
test("poor accuracy waits for a usable fix", async () => {
  const gps = device();
  const result = getFreshLocation(gps, undefined, quick);
  gps.emit(position({ accuracy: 300 }));
  const good = position({ accuracy: 12 });
  gps.emit(good);
  assert.equal(await result, good);
});
test("a later displaced fix resets settling and replaces the initial location", async () => {
  const gps = device();
  const result = getFreshLocation(gps, undefined, { ...quick, settleMs: 30 });
  gps.emit(position());
  await new Promise((resolve) => setTimeout(resolve, 20));
  const actual = position({ latitude: 22.62 });
  gps.emit(actual);
  const start = Date.now();
  assert.equal(await result, actual);
  assert.ok(Date.now() - start >= 20);
  assert.deepEqual(gps.cleared, [42]);
});
test("stable later readings use the latest coordinates and timestamp", async () => {
  const gps = device();
  const result = getFreshLocation(gps, undefined, quick);
  gps.emit(position());
  const latest = position({ latitude: 22.56001 });
  gps.emit(latest);
  assert.equal(await result, latest);
});
test("permission rejection is immediate and clears watching", async () => {
  const gps = device();
  const result = getFreshLocation(gps, undefined, quick);
  gps.fail(1);
  await assert.rejects(result, /permission denied/);
  assert.deepEqual(gps.cleared, [42]);
});
test("invalid readings timeout without a fabricated fallback", async () => {
  const gps = device();
  const result = getFreshLocation(gps, undefined, {
    settleMs: 5,
    timeoutMs: 15,
  });
  gps.emit(position({ latitude: NaN }));
  gps.fail(2);
  await assert.rejects(result, /No fresh, stable location/);
  assert.deepEqual(gps.cleared, [42]);
});
test("abort clears watching and rejects", async () => {
  const gps = device(),
    controller = new AbortController();
  const result = getFreshLocation(gps, controller.signal, quick);
  controller.abort();
  await assert.rejects(result, { name: "AbortError" });
  assert.deepEqual(gps.cleared, [42]);
});
test("continuous changing locations cannot settle before the deadline", async () => {
  const gps = device();
  const result = getFreshLocation(gps, undefined, {
    settleMs: 25,
    timeoutMs: 60,
  });
  gps.emit(position());
  let moved = false;
  const updates = setInterval(() => {
    moved = !moved;
    gps.emit(position({ latitude: moved ? 22.7 : 22.6 }));
  }, 10);
  try {
    await assert.rejects(result, /No fresh, stable location/);
  } finally {
    clearInterval(updates);
  }
  assert.deepEqual(gps.cleared, [42]);
});
test("validation rejects stale, future, impossible coordinates and accuracy", () => {
  const now = Date.now();
  assert.equal(validateDevicePosition(position(), now), true);
  for (const values of [
    { latitude: 91 },
    { longitude: -181 },
    { accuracy: 0 },
    { accuracy: -1 },
    { accuracy: 51 },
    { longitude: Infinity },
  ])
    assert.equal(validateDevicePosition(position(values), now), false);
  assert.equal(
    validateDevicePosition({ ...position(), timestamp: now - 10_001 }, now),
    false,
  );
  assert.equal(
    validateDevicePosition({ ...position(), timestamp: now + 2_001 }, now),
    false,
  );
});
test("current-position fallback validates the returned device timestamp", async () => {
  const fresh = position();
  const gps = {
    getCurrentPosition(success) {
      success(fresh);
    },
  };
  assert.equal(await getFreshLocation(gps, undefined, quick), fresh);
});

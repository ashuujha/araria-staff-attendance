import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdir } from "node:fs/promises";

await mkdir(".preview", { recursive: true });
await build({
  entryPoints: ["src/lib/leave-dates.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  outfile: ".preview/leave-dates-test.mjs",
});
const { validLeaveDate, leaveDateRange, normalizeLeaveDates, leaveDatesLabel } =
  await import("../.preview/leave-dates-test.mjs");

test("calendar dates validate real dates and expand a range across months", () => {
  assert.equal(validLeaveDate("2026-02-29"), false);
  assert.deepEqual(leaveDateRange("2026-11-30", "2026-12-02"), [
    "2026-11-30",
    "2026-12-01",
    "2026-12-02",
  ]);
  assert.deepEqual(normalizeLeaveDates(["2026-12-05", "2026-12-01"]), [
    "2026-12-01",
    "2026-12-05",
  ]);
  assert.match(
    leaveDatesLabel(["2026-12-01", "2026-12-05"], "2026-12-01"),
    /2 selected dates/,
  );
});

test("calendar dates reject reversed, duplicate and oversized selections", () => {
  assert.throws(() => leaveDateRange("2026-12-02", "2026-12-01"));
  assert.throws(() => normalizeLeaveDates(["2026-12-01", "2026-12-01"]));
  assert.throws(() => normalizeLeaveDates(["2026-12-01", "2028-01-01"]));
});

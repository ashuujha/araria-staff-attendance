import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
await build({
  entryPoints: ["src/lib/attendance-hours.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  outfile: ".preview/attendance-hours-test.mjs",
});
const { attendanceHoursError } =
  await import("../.preview/attendance-hours-test.mjs");
test("arrival closes exactly at 3 PM India time and checkout opens at that boundary", () => {
  const before = new Date("2026-11-19T09:29:59Z");
  const boundary = new Date("2026-11-19T09:30:00Z");
  assert.equal(attendanceHoursError("save_draft", before), null);
  assert.ok(attendanceHoursError("complete", before));
  assert.ok(attendanceHoursError("save_draft", boundary));
  assert.equal(attendanceHoursError("complete", boundary), null);
  assert.equal(attendanceHoursError("save_status", boundary), null);
});

import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdir } from "node:fs/promises";

await mkdir(".preview", { recursive: true });
await build({
  entryPoints: ["src/lib/daily-attendance-summary.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  outfile: ".preview/daily-attendance-summary-test.mjs",
});
const { dailyAttendanceSummary, dailyAttendanceBreakdown } =
  await import("../.preview/daily-attendance-summary-test.mjs");

test("daily totals identify active staff who have not marked attendance in the selected block", () => {
  const staff = [
    { id: "a", name: "A", block_id: "araria", active: true },
    { id: "b", name: "B", block_id: "araria", active: true },
    { id: "c", name: "C", block_id: "sikti", active: true },
    { id: "d", name: "D", block_id: "araria", active: false },
  ];
  const records = [
    { staff_id: "a", block_id: "araria", date: "2026-11-12" },
    { staff_id: "a", block_id: "araria", date: "2026-11-12" },
    { staff_id: "c", block_id: "sikti", date: "2026-11-12" },
    { staff_id: "b", block_id: "araria", date: "2026-11-11" },
  ];
  const araria = dailyAttendanceSummary(staff, records, "2026-11-12", "araria");
  assert.equal(araria.total, 2);
  assert.equal(araria.marked, 1);
  assert.deepEqual(
    araria.unmarked.map((person) => person.name),
    ["B"],
  );
  const district = dailyAttendanceSummary(staff, records, "2026-11-12");
  assert.equal(district.total, 3);
  assert.equal(district.marked, 2);
});

test("attendance chart keeps categories separate and follows the selected block", () => {
  const staff = [
    { id: "a", name: "A", block_id: "araria", active: true },
    { id: "b", name: "B", block_id: "araria", active: true },
    { id: "c", name: "C", block_id: "araria", active: true },
    { id: "d", name: "D", block_id: "sikti", active: true },
    { id: "e", name: "E", block_id: "araria", active: false },
  ];
  const records = [
    {
      staff_id: "a",
      block_id: "araria",
      date: "2026-11-19",
      status: "present",
    },
    {
      staff_id: "a",
      block_id: "araria",
      date: "2026-11-19",
      status: "present",
    },
    {
      staff_id: "b",
      block_id: "araria",
      date: "2026-11-19",
      status: "on_duty",
    },
    { staff_id: "d", block_id: "sikti", date: "2026-11-19", status: "leave" },
    { staff_id: "e", block_id: "araria", date: "2026-11-19", status: "absent" },
  ];
  const block = dailyAttendanceBreakdown(
    staff,
    records,
    "2026-11-19",
    "araria",
  );
  assert.equal(block.present, 1);
  assert.equal(block.on_duty, 1);
  assert.equal(block.not_marked, 1);
  assert.equal(block.leave, 0);
  assert.equal(
    Object.values(block).reduce((sum, value) => sum + value, 0),
    3,
  );
  const district = dailyAttendanceBreakdown(staff, records, "2026-11-19");
  assert.equal(district.leave, 1);
  assert.equal(
    Object.values(district).reduce((sum, value) => sum + value, 0),
    4,
  );
});

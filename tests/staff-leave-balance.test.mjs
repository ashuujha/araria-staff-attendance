import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdir } from "node:fs/promises";

await mkdir(".preview", { recursive: true });
await build({
  entryPoints: ["src/lib/staff-leave-balance.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  outfile: ".preview/staff-leave-balance-test.mjs",
});
const { staffLeaveBalance } =
  await import("../.preview/staff-leave-balance-test.mjs");

test("staff sees current-year CL and female monthly/yearly SL remaining", () => {
  const days = [
    { date: "2025-12-31", leave_type: "CL" },
    { date: "2026-01-05", leave_type: "CL" },
    { date: "2026-10-01", leave_type: "SL" },
    { date: "2026-11-01", leave_type: "SL" },
    { date: "2026-11-03", leave_type: "SL" },
    { date: "2026-11-04", leave_type: "MATERNITY" },
  ];
  const result = staffLeaveBalance(
    { id: "staff", gender: "female" },
    days,
    "2026-11-12",
  );
  assert.deepEqual(
    [
      result.cl_used,
      result.cl_left,
      result.sl_used,
      result.sl_left,
      result.sl_month_used,
      result.sl_month_left,
    ],
    [1, 15, 3, 21, 2, 0],
  );
  const male = staffLeaveBalance(
    { id: "staff", gender: "male" },
    days,
    "2026-11-12",
  );
  assert.equal(male.sl_left, 0);
  assert.equal(male.cl_left, 15);
});

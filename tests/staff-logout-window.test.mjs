import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";

const bundled = await build({
  entryPoints: ["src/lib/staff-logout-window.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
});
const { isStaffLogoutLocked } = await import(
  `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`
);

test("staff logout window follows Asia/Kolkata office hours", () => {
  assert.equal(isStaffLogoutLocked(new Date("2026-11-16T04:29:00Z")), false);
  assert.equal(isStaffLogoutLocked(new Date("2026-11-16T04:30:00Z")), true);
  assert.equal(isStaffLogoutLocked(new Date("2026-11-16T09:29:00Z")), true);
  assert.equal(isStaffLogoutLocked(new Date("2026-11-16T09:30:00Z")), false);
});

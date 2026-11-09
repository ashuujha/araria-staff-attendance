import test from "node:test";
import assert from "node:assert/strict";
import {
  makeAdminRows,
  matchesWorkplace,
  planSheetRows,
  sheetRecordKey,
} from "../src/lib/reporting.mjs";
const assignments = [
  { panchayat: "A", position: "Secretary", department: "पंचायती राज विभाग" },
  { panchayat: "B", position: "Secretary", department: "पंचायती राज विभाग" },
];
const profile = { id: "staff", name: "Staff", assignments, active: true };
const record = {
  id: "record",
  staff_id: "staff",
  panchayat: "A",
  working_places: assignments,
  status: "present",
  time_in: "2026-10-12T03:30:00Z",
  time_out: null,
  flags: [],
  profiles: profile,
};
test("same daily record appears in every assigned panchayat without inflating staff total", () => {
  const rows = makeAdminRows([record], [profile]);
  assert.equal(rows.length, 1);
  assert.equal(rows.filter((r) => matchesWorkplace(r, "A"))[0].id, "record");
  assert.equal(rows.filter((r) => matchesWorkplace(r, "B"))[0].id, "record");
  assert.equal(
    rows.filter((r) => matchesWorkplace(r, "B"))[0].time_in,
    rows[0].time_in,
  );
  assert.equal(rows.filter((r) => matchesWorkplace(r, "C")).length, 0);
});
test("missing punches are also visible in every master-data assignment", () => {
  const rows = makeAdminRows([], [profile]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].status, "absent");
  assert.ok(matchesWorkplace(rows[0], "B"));
});
test("snapshotted attendance is stable after master data changes", () => {
  const rows = makeAdminRows(
    [{ ...record, profiles: { ...profile, assignments: [assignments[0]] } }],
    [profile],
  );
  assert.deepEqual(rows[0].working_places, ["A", "B"]);
});
test("sheet mirror uses one stable row per worksite and reuses rows on punch out", () => {
  const first = planSheetRows(record, profile, []);
  assert.equal(first.writes.length, 2);
  const next = planSheetRows(
    { ...record, time_out: "2026-10-12T11:30:00Z" },
    profile,
    first.writes.map((w) => [w.key]),
  );
  assert.deepEqual(
    next.writes.map((w) => w.row),
    [2, 3],
  );
  assert.deepEqual(next.clearRows, []);
});
test("sheet migration reuses existing legacy row and clears deleted records in every panchayat", () => {
  const old = planSheetRows(record, profile, [[record.id]]);
  assert.deepEqual(
    old.writes.map((w) => w.row),
    [2, 3],
  );
  const deleted = planSheetRows({ ...record, deleted_at: "now" }, profile, [
    [sheetRecordKey(record.id, "A")],
    [sheetRecordKey(record.id, "B")],
    ["other-record"],
  ]);
  assert.equal(deleted.writes.length, 0);
  assert.deepEqual(deleted.clearRows, [2, 3]);
});
test("deleted daily records are excluded and admin entries are labelled honestly", () => {
  assert.equal(makeAdminRows([{ ...record, deleted_at: "now" }], []).length, 0);
  const row = makeAdminRows(
    [{ ...record, flags: ["admin_entered"] }],
    [profile],
  )[0];
  assert.equal(row.origin, "admin");
});

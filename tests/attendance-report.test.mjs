import test from "node:test";
import assert from "node:assert/strict";
import {
  dateSections,
  attendanceCode,
  makeAttendanceReport,
} from "../src/lib/attendance-report.mjs";

test("date ranges validate leap days and split at each month", () => {
  assert.deepEqual(
    dateSections("2028-02-28", "2028-03-02").map((s) => s.dates.length),
    [2, 2],
  );
  assert.throws(() => dateSections("2026-02-29", "2026-03-01"), /valid/);
  assert.throws(() => dateSections("2026-10-21", "2026-10-20"), /366/);
});

test("saved status wins over calendar; past missing days become absent", () => {
  const holidays = new Set(["2026-10-18", "2026-10-19"]);
  assert.equal(attendanceCode(null, "2026-10-18", "2026-10-21", holidays), "H");
  assert.equal(attendanceCode(null, "2026-10-25", "2026-10-26", holidays), "W");
  assert.equal(attendanceCode(null, "2026-10-20", "2026-10-21", holidays), "A");
  assert.equal(
    attendanceCode(null, "2026-10-21", "2026-10-21", holidays),
    "NR",
  );
  assert.equal(attendanceCode(null, "2026-10-22", "2026-10-21", holidays), "");
  assert.equal(
    attendanceCode(
      { status: "present", phase: "draft", time_in: "2026-10-19T05:00:00Z" },
      "2026-10-19",
      "2026-10-21",
      holidays,
    ),
    "PP",
  );
  assert.equal(
    attendanceCode(
      { status: "deputation", phase: "submitted", time_in: "x", time_out: "y" },
      "2026-10-20",
      "2026-10-21",
      holidays,
    ),
    "O",
  );
  assert.equal(
    attendanceCode({ status: "leave" }, "2026-10-20", "2026-10-21", holidays),
    "L",
  );
});

test("one row per staff, full grid retained when status filter matches one day", () => {
  const profile = {
    id: "1",
    name: "Updated name",
    phone: "9876543210",
    role: "staff",
    block: "Araria",
    active: true,
    assignments: [],
  };
  const report = makeAttendanceReport({
    profiles: [profile],
    records: [
      {
        id: "a",
        staff_id: "1",
        date: "2026-10-19",
        staff_name: "Old name",
        block: "Araria",
        status: "leave",
        leave_type: "CL",
      },
    ],
    holidays: [],
    start: "2026-10-19",
    end: "2026-10-20",
    today: "2026-10-21",
    filters: { status: "leave" },
  });
  assert.equal(report.sections[0].rows.length, 1);
  assert.equal(report.sections[0].rows[0].name, "Old name");
  assert.deepEqual(
    report.sections[0].rows[0].cells.map((c) => c.code),
    ["L", "A"],
  );
});

test("a district report includes all 250 staff and recorded removed staff", () => {
  const profiles = Array.from({ length: 250 }, (_, index) => ({
    id: String(index),
    name: `Staff ${index}`,
    phone: String(index),
    role: "staff",
    block: "Araria",
    active: true,
    assignments: [],
  }));
  const report = makeAttendanceReport({
    profiles,
    records: [
      {
        id: "historical",
        staff_id: "removed",
        date: "2026-10-20",
        staff_name: "Historical name",
        status: "leave",
      },
    ],
    holidays: [],
    start: "2026-10-20",
    end: "2026-10-21",
    today: "2026-10-21",
  });
  assert.equal(report.sections[0].rows.length, 251);
  assert.equal(
    report.sections[0].rows.find((row) => row.id === "removed").name,
    "Historical name",
  );
});

test("days before staff joined and after removal stay blank", () => {
  const report = makeAttendanceReport({
    profiles: [
      {
        id: "late",
        name: "Late joiner",
        phone: "",
        role: "staff",
        block: "Araria",
        active: true,
        assignments: [],
        created_at: "2026-10-20T20:00:00Z",
      },
      {
        id: "removed",
        name: "Former staff",
        phone: "",
        role: "staff",
        block: "Araria",
        active: false,
        assignments: [],
        deleted_at: "2026-10-21T13:00:00Z",
      },
    ],
    records: [
      {
        id: "former-attendance",
        staff_id: "removed",
        date: "2026-10-20",
        staff_name: "Former staff",
        status: "leave",
      },
    ],
    holidays: [],
    start: "2026-10-20",
    end: "2026-10-22",
    today: "2026-10-23",
  });
  assert.deepEqual(
    report.sections[0].rows
      .find((row) => row.id === "late")
      .cells.map((cell) => cell.code),
    ["", "A", "A"],
  );
  assert.deepEqual(
    report.sections[0].rows
      .find((row) => row.id === "removed")
      .cells.map((cell) => cell.code),
    ["L", "A", ""],
  );
});

test("department and panchayat filters must match one assignment", () => {
  const report = makeAttendanceReport({
    profiles: [
      {
        id: "1",
        name: "One",
        role: "staff",
        block: "Araria",
        active: true,
        assignments: [
          { department: "Agriculture", panchayat: "North", position: "Clerk" },
          { department: "Welfare", panchayat: "South", position: "Clerk" },
        ],
      },
    ],
    records: [],
    holidays: [],
    start: "2026-10-21",
    end: "2026-10-21",
    today: "2026-10-21",
    filters: { department: "Agriculture", panchayat: "South" },
  });
  assert.equal(report.sections[0].rows.length, 0);
});

test("today's daily report shows the current staff name", () => {
  const report = makeAttendanceReport({
    profiles: [
      {
        id: "1",
        name: "Current name",
        role: "staff",
        block: "Araria",
        active: true,
        assignments: [],
      },
    ],
    records: [
      {
        id: "a",
        staff_id: "1",
        staff_name: "Previous name",
        date: "2026-10-21",
        status: "leave",
      },
    ],
    holidays: [],
    start: "2026-10-21",
    end: "2026-10-21",
    today: "2026-10-21",
  });
  assert.equal(report.sections[0].rows[0].name, "Current name");
});

test("staff contact and every current assignment accompany attendance", () => {
  const assignments = [
    { department: "Agriculture", panchayat: "North", position: "Clerk" },
    { department: "Welfare", panchayat: "South", position: "Coordinator" },
  ];
  const report = makeAttendanceReport({
    profiles: [
      {
        id: "1",
        name: "Staff member",
        phone: "1111111111",
        secondary_phones: ["2222222222"],
        email: "staff@example.org",
        role: "staff",
        block: "Araria",
        active: true,
        assignments,
      },
    ],
    records: [],
    holidays: [],
    start: "2026-10-21",
    end: "2026-10-21",
    today: "2026-10-21",
  });
  const row = report.sections[0].rows[0];
  assert.equal(row.phone, "1111111111");
  assert.deepEqual(row.secondaryPhones, ["2222222222"]);
  assert.equal(row.email, "staff@example.org");
  assert.deepEqual(row.workplaces, assignments);
  assert.equal(row.cells[0].code, "NR");
});

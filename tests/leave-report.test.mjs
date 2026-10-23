import test from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import { makeLeaveReport } from "../src/lib/leave-report.mjs";
import { renderLeaveReportPdf } from "../src/lib/leave-report-pdf.mjs";
import { renderLeaveReportXlsx } from "../src/lib/leave-report-xlsx.mjs";

const profiles = [
  {
    id: "female",
    role: "staff",
    active: true,
    name: "कविता कुमारी",
    phone: "9000000001",
    gender: "female",
    block: "Araria",
    assignments: [
      {
        department: "पंचायती राज विभाग",
        panchayat: "Bairgachhi",
        position: "Secretary",
      },
    ],
  },
  {
    id: "male",
    role: "staff",
    active: true,
    name: "Ravi Kumar",
    phone: "9000000002",
    gender: "male",
    block: "Forbesganj",
    assignments: [
      {
        department: "Agriculture",
        panchayat: "Kursakanta",
        position: "Assistant",
      },
    ],
  },
];
const records = [
  {
    id: "one",
    staff_id: "female",
    date: "2026-02-02",
    status: "leave",
    leave_type: "CL",
    version: 1,
  },
  {
    id: "same-date-later",
    staff_id: "female",
    date: "2026-02-02",
    status: "leave",
    leave_type: "SL",
    version: 2,
  },
  {
    id: "second",
    staff_id: "female",
    date: "2026-03-03",
    status: "leave",
    leave_type: "CL",
    version: 1,
  },
  {
    id: "legacy",
    staff_id: "male",
    date: "2026-04-04",
    status: "leave",
    leave_type: null,
  },
  {
    id: "old",
    staff_id: "female",
    date: "2025-05-05",
    status: "leave",
    leave_type: "CL",
  },
  {
    id: "removed",
    staff_id: "female",
    date: "2026-06-06",
    status: "leave",
    leave_type: "CL",
    deleted_at: "2026-06-07",
  },
];

test("annual leave report counts current-year saved leave once per date", () => {
  const report = makeLeaveReport({ profiles, records, year: 2026 });
  assert.equal(report.rows.length, 2);
  const female = report.rows.find((row) => row.id === "female");
  assert.equal(female.clGranted, 16);
  assert.equal(female.clTaken, 1);
  assert.equal(female.clBalance, 15);
  assert.equal(female.slGranted, 24);
  assert.equal(female.slTaken, 1);
  assert.equal(female.slBalance, 23);
  const male = report.rows.find((row) => row.id === "male");
  assert.equal(male.slGranted, null);
  assert.equal(male.otherTaken, 1);
  assert.deepEqual(
    makeLeaveReport({
      profiles,
      records,
      year: 2026,
      filters: { department: "Agriculture", search: "9000000002" },
      onlyWithLeave: true,
    }).rows.map((row) => row.id),
    ["male"],
  );
  assert.equal(
    makeLeaveReport({
      profiles,
      records: [],
      year: 2026,
      onlyWithLeave: true,
    }).rows.length,
    0,
  );
});

test("leave exports retain separate staff columns and leave balance numbers", async () => {
  const report = {
    ...makeLeaveReport({ profiles, records, year: 2026 }),
    officeLabel: "District Araria",
  };
  const pdf = await renderLeaveReportPdf(report);
  assert.equal(pdf.subarray(0, 5).toString(), "%PDF-");
  assert.ok(pdf.byteLength > 10000);
  const bytes = await renderLeaveReportXlsx(report);
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(bytes);
  const sheet = book.getWorksheet("Leave 2026");
  assert.equal(sheet.getCell("B7").value, "Name");
  assert.equal(sheet.getCell("C7").value, "Mobile number");
  assert.equal(sheet.getCell("E7").value, "Designation");
  assert.equal(sheet.getCell("F7").value, "Workplace");
  const femaleRow = sheet
    .getRows(9, 2)
    .find((row) => row.getCell(2).value === "कविता कुमारी");
  assert.equal(femaleRow.getCell(8).value, 1);
  assert.equal(femaleRow.getCell(11).value, 1);
  assert.equal(femaleRow.getCell(12).value, 23);
});

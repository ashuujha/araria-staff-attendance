import test from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import { makeAttendanceReport } from "../src/lib/attendance-report.mjs";
import { renderReportXlsx } from "../src/lib/report-xlsx.mjs";
import { renderReportPdf } from "../src/lib/report-pdf.mjs";

test("Excel and PDF downloads contain a Hindi staff member's saved attendance", async () => {
  const report = makeAttendanceReport({
    profiles: [
      {
        id: "staff-1",
        name: "सीमा कुमारी",
        phone: "0000000000",
        secondary_phones: ["0000000001"],
        email: "staff@example.org",
        role: "staff",
        active: true,
        block: "Araria",
        assignments: [
          {
            department: "पंचायती राज विभाग",
            panchayat: "Pokharia",
            position: "Assistant",
          },
          {
            department: "पंचायती राज विभाग",
            panchayat: "Rampur",
            position: "Coordinator",
          },
        ],
        created_at: "2026-01-01T00:00:00Z",
      },
    ],
    records: [
      {
        id: "attendance-1",
        staff_id: "staff-1",
        date: "2026-10-20",
        staff_name: "सीमा कुमारी",
        block: "Araria",
        department: "पंचायती राज विभाग",
        panchayat: "Pokharia",
        position: "Assistant",
        status: "present",
        phase: "submitted",
        time_in: "2026-10-20T04:00:00Z",
        time_out: "2026-10-20T12:00:00Z",
      },
    ],
    holidays: [],
    start: "2026-10-20",
    end: "2026-10-20",
    today: "2026-10-21",
  });

  const [xlsx, pdf] = await Promise.all([
    renderReportXlsx(report),
    renderReportPdf(report),
  ]);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(xlsx);
  const sheet = workbook.getWorksheet("2026_10");
  assert.equal(sheet.getCell("A8").value, 1);
  assert.equal(sheet.getCell("B8").value, "सीमा कुमारी");
  assert.equal(sheet.getCell("C8").value, "0000000000");
  assert.equal(sheet.getCell("D8").value, "Assistant");
  assert.match(sheet.getCell("E8").value, /Pokharia.*Araria/);
  assert.equal(sheet.getCell("F8").value, "Present · Saved");
  assert.match(sheet.getCell("G8").value, /9:30/i);
  assert.match(sheet.getCell("H8").value, /5:30/i);
  assert.deepEqual(
    workbook.worksheets.map((sheet) => sheet.name),
    ["2026_10"],
  );
  assert.equal(pdf.subarray(0, 5).toString(), "%PDF-");
  assert.ok(pdf.length > 1000);
  assert.equal(
    (pdf.toString("latin1").match(/\/Type\s*\/Page\b/g) || []).length,
    1,
  );
});

test("two-page attendance grid does not append staff or in/out detail pages", async () => {
  const profiles = Array.from({ length: 20 }, (_, index) => ({
    id: `staff-${index}`,
    name: `Staff ${index + 1}`,
    phone: String(9000000000 + index),
    role: "staff",
    active: true,
    block: "Araria",
    assignments: [],
    created_at: "2026-01-01T00:00:00Z",
  }));
  const report = makeAttendanceReport({
    profiles,
    records: [],
    holidays: [],
    start: "2026-10-20",
    end: "2026-10-20",
    today: "2026-10-21",
  });
  const pdf = await renderReportPdf(report);
  assert.equal(
    (pdf.toString("latin1").match(/\/Type\s*\/Page\b/g) || []).length,
    2,
  );
});

test("multi-day exports keep identity fields separate from daily attendance codes", async () => {
  const report = makeAttendanceReport({
    profiles: [
      {
        id: "staff-1",
        name: "सीमा कुमारी",
        phone: "9000000000",
        role: "staff",
        active: true,
        block: "Araria",
        assignments: [
          {
            department: "पंचायती राज विभाग",
            panchayat: "Pokharia",
            position: "Assistant",
          },
        ],
        created_at: "2026-01-01T00:00:00Z",
      },
    ],
    records: [
      {
        id: "attendance-1",
        staff_id: "staff-1",
        date: "2026-10-20",
        staff_name: "सीमा कुमारी",
        block: "Araria",
        department: "पंचायती राज विभाग",
        panchayat: "Pokharia",
        position: "Assistant",
        status: "present",
        phase: "submitted",
        time_in: "2026-10-20T04:00:00Z",
        time_out: "2026-10-20T12:00:00Z",
      },
    ],
    holidays: [],
    start: "2026-10-20",
    end: "2026-10-21",
    today: "2026-10-21",
  });
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await renderReportXlsx(report));
  const sheet = workbook.getWorksheet("2026_10");
  assert.deepEqual(sheet.getRow(7).values.slice(1, 6), [
    "Sr. No.",
    "Staff name",
    "Mobile",
    "Designation",
    "Workplace",
  ]);
  assert.equal(sheet.getCell("A8").value, 1);
  assert.equal(sheet.getCell("B8").value, "सीमा कुमारी");
  assert.equal(sheet.getCell("C8").value, "9000000000");
  assert.equal(sheet.getCell("D8").value, "Assistant");
  assert.match(sheet.getCell("E8").value, /Pokharia.*Araria/);
  assert.equal(sheet.getCell("F8").value, "P");
  assert.equal(sheet.getCell("G8").value, "NR");
  assert.deepEqual(
    workbook.worksheets.map((item) => item.name),
    ["2026_10"],
  );
  const pdf = await renderReportPdf(report);
  assert.equal(
    (pdf.toString("latin1").match(/\/Type\s*\/Page\b/g) || []).length,
    1,
  );
});

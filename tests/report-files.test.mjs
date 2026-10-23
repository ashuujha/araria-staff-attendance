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
            department: "Agriculture",
            panchayat: "Pokharia",
            position: "Assistant",
          },
          {
            department: "Welfare",
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
        department: "Agriculture",
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
  assert.equal(
    workbook.getWorksheet("2026_10").getCell("A8").value,
    "सीमा कुमारी",
  );
  assert.equal(
    workbook.getWorksheet("2026_10").getCell("B8").value,
    "0000000000",
  );
  assert.equal(workbook.getWorksheet("2026_10").getCell("C8").value, "Araria");
  assert.equal(workbook.getWorksheet("2026_10").getCell("D8").value, "P");
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

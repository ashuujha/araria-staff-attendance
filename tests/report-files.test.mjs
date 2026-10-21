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
        role: "staff",
        active: true,
        block: "Araria",
        assignments: [],
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
  assert.equal(workbook.getWorksheet("2026_10").getCell("B8").value, "P");
  assert.equal(
    workbook.getWorksheet("Details").getCell("L8").value,
    "20 Oct 2026, 09:30 am",
  );
  assert.equal(pdf.subarray(0, 5).toString(), "%PDF-");
  assert.ok(pdf.length > 1000);
});

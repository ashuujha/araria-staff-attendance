import { STATUS_LEGEND } from "./attendance-report.mjs";
import { reportEmblem } from "./report-emblem.mjs";

const BLUE = "173B63";
const PALE = "EAF1F8";
const EDGE = "C9D4E1";
const safe = (value) => {
  const text = String(value ?? "");
  return /^[\s]*[=+@-]/.test(text) ? "'" + text : text;
};
const time = (value) =>
  value
    ? new Date(value).toLocaleString("en-IN", {
        timeZone: "Asia/Kolkata",
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "";

function heading(sheet, columns, title, subtitle, period, office) {
  for (let row = 1; row <= 4; row++) sheet.mergeCells(row, 1, row, columns);
  const values = [
    `GOVERNMENT OF BIHAR • ${office || "DISTRICT ARARIA"}`,
    "ARARIA STAFF ATTENDANCE",
    title,
    subtitle,
  ];
  values.forEach((value, index) => {
    const cell = sheet.getCell(index + 1, 1);
    cell.value = safe(value);
    cell.alignment = { horizontal: "center", vertical: "middle" };
    cell.font = {
      name: "Noto Sans Devanagari",
      bold: index < 3,
      size: index === 1 ? 16 : 11,
      color: { argb: BLUE },
    };
    sheet.getRow(index + 1).height = index === 1 ? 27 : 23;
  });
  sheet.getCell(5, 1).value = "Period: " + period;
  sheet.getCell(5, Math.max(2, columns - 2)).value =
    "Generated: " + time(new Date().toISOString());
  sheet.getRow(5).height = 24;
  sheet.views = [{ state: "frozen", xSplit: 1, ySplit: 7 }];
  sheet.pageSetup = {
    paperSize: 9,
    orientation: "landscape",
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
    margins: {
      left: 0.25,
      right: 0.25,
      top: 0.35,
      bottom: 0.35,
      header: 0.12,
      footer: 0.12,
    },
  };
  sheet.headerFooter.oddFooter = "Araria Staff Attendance • Page &P of &N";
  sheet.printTitlesRow = "1:7";
}

function styleHeader(row) {
  row.height = 28;
  row.eachCell((cell) => {
    cell.font = {
      name: "Noto Sans",
      bold: true,
      color: { argb: "FFFFFF" },
      size: 9,
    };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: BLUE } };
    cell.alignment = {
      horizontal: "center",
      vertical: "middle",
      wrapText: true,
    };
    cell.border = { bottom: { style: "thin", color: { argb: EDGE } } };
  });
}
function styleData(row, index) {
  row.height = 27;
  row.eachCell({ includeEmpty: true }, (cell) => {
    cell.font = {
      name: "Noto Sans Devanagari",
      size: 9,
      color: { argb: "1D324A" },
    };
    cell.alignment = {
      vertical: "middle",
      horizontal: cell.col === 1 ? "left" : "center",
      wrapText: true,
    };
    cell.border = {
      top: { style: "hair", color: { argb: EDGE } },
      bottom: { style: "hair", color: { argb: EDGE } },
      left: { style: "hair", color: { argb: EDGE } },
      right: { style: "hair", color: { argb: EDGE } },
    };
    if (index % 2)
      cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "F4F7FA" },
      };
  });
}
function detailRows(report) {
  return report.sections
    .flatMap((section) =>
      section.rows.flatMap((row) => row.cells.map((cell) => ({ row, cell }))),
    )
    .filter(({ cell }) => cell.record || cell.code === "A");
}

export async function renderReportXlsx(report) {
  const emblem = await reportEmblem();
  const ExcelJS = (await import("exceljs")).default;
  const book = new ExcelJS.Workbook();
  const image = emblem
    ? book.addImage({ buffer: emblem, extension: "png" })
    : null;
  book.creator = "Araria Staff Attendance";
  book.created = new Date();
  for (const section of report.sections) {
    const sheet = book.addWorksheet(section.month.replace("-", "_"));
    sheet.getColumn(1).width = 33;
    for (let i = 0; i < section.dates.length; i++)
      sheet.getColumn(i + 2).width = 7;
    heading(
      sheet,
      section.dates.length + 1,
      "Attendance report",
      `Month: ${section.month}`,
      `${section.dates[0]} to ${section.dates.at(-1)}`,
      report.officeLabel,
    );
    if (image !== null)
      sheet.addImage(image, {
        tl: { col: 0.15, row: 0.1 },
        ext: { width: 45, height: 57 },
      });
    sheet.getRow(7).values = [
      "Staff name",
      ...section.dates.map((d) => Number(d.slice(-2))),
    ];
    styleHeader(sheet.getRow(7));
    section.rows.forEach((row, index) => {
      const out = sheet.getRow(8 + index);
      out.values = [safe(row.name), ...row.cells.map((cell) => cell.code)];
      styleData(out, index);
    });
    const legendRow = sheet.getRow(9 + section.rows.length);
    sheet.mergeCells(
      legendRow.number,
      1,
      legendRow.number,
      section.dates.length + 1,
    );
    legendRow.getCell(1).value = STATUS_LEGEND.map(
      ([code, label]) => `${code} ${label}`,
    ).join("    |    ");
    legendRow.getCell(1).font = {
      name: "Noto Sans",
      size: 8,
      color: { argb: BLUE },
    };
    sheet.autoFilter = {
      from: { row: 7, column: 1 },
      to: { row: 7 + section.rows.length, column: section.dates.length + 1 },
    };
  }
  const details = book.addWorksheet("Details");
  const headers = [
    "Date",
    "Staff name",
    "Current name",
    "Phone",
    "Block",
    "Department",
    "Panchayat",
    "Position",
    "Code",
    "Status",
    "Phase",
    "In time (IST)",
    "Out time (IST)",
    "Leave type",
    "Deputation workplace",
    "Absence reason",
  ];
  heading(
    details,
    headers.length,
    "Attendance details",
    "In/out times, leave and absence reasons",
    `${report.start} to ${report.end}`,
    report.officeLabel,
  );
  if (image !== null)
    details.addImage(image, {
      tl: { col: 0.15, row: 0.1 },
      ext: { width: 45, height: 57 },
    });
  details.getRow(7).values = headers;
  styleHeader(details.getRow(7));
  headers.forEach(
    (_, index) =>
      (details.getColumn(index + 1).width = [
        14, 28, 28, 17, 16, 22, 22, 22, 9, 16, 13, 23, 23, 12, 26, 42,
      ][index]),
  );
  const items = detailRows(report);
  items.forEach(({ row, cell }, index) => {
    const r = cell.record || {};
    const out = details.getRow(8 + index);
    out.values = [
      cell.date,
      safe(row.name),
      safe(row.currentName),
      safe(row.phone),
      safe(row.block),
      safe(r.department),
      safe(r.panchayat),
      safe(r.position),
      cell.code,
      safe(r.status || (cell.code === "A" ? "Missing attendance" : "")),
      safe(r.phase),
      time(r.time_in),
      time(r.time_out),
      safe(r.leave_type),
      safe(r.deputation_workplace),
      safe(r.absence_reason),
    ];
    styleData(out, index);
  });
  details.autoFilter = {
    from: { row: 7, column: 1 },
    to: { row: 7 + items.length, column: headers.length },
  };
  return Buffer.from(await book.xlsx.writeBuffer());
}

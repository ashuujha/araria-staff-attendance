import { reportEmblem } from "./report-emblem.mjs";

const BLUE = "173B63";
const EDGE = "C9D4E1";
const safe = (value) => {
  const text = String(value ?? "");
  return /^\s*[=+@-]/.test(text) ? "'" + text : text;
};
const monthName = (month) =>
  new Date(Date.UTC(2026, Number(month) - 1, 1)).toLocaleString("en-IN", {
    month: "long",
  });

export async function renderLeaveReportXlsx(report) {
  const ExcelJS = (await import("exceljs")).default;
  const book = new ExcelJS.Workbook();
  book.creator = "Araria Staff Attendance";
  book.created = new Date();
  const sheet = book.addWorksheet(`Leave ${report.year}-${report.month}`);
  [8, 28, 18, 16, 28, 43, 13, 12, 13, 13, 13, 13, 13, 15].forEach(
    (width, index) => (sheet.getColumn(index + 1).width = width),
  );
  for (const line of [1, 2, 3, 4]) sheet.mergeCells(line, 1, line, 14);
  const headings = [
    `GOVERNMENT OF BIHAR • ${report.officeLabel || "DISTRICT ARARIA"}`,
    `STAFF LEAVE DETAILS REPORT ${report.year}`,
    `Casual leave: 16/year • Special leave: 2 in ${monthName(report.month)}, 24/year for female staff`,
    `SL month: ${monthName(report.month)} ${report.year} • Year balance: ${report.year}`,
  ];
  headings.forEach((value, index) => {
    const cell = sheet.getCell(index + 1, 1);
    cell.value = safe(value);
    cell.alignment = { horizontal: "center", vertical: "middle" };
    cell.font = {
      name: "Noto Sans Devanagari",
      bold: index < 2,
      size: index === 1 ? 16 : 11,
      color: { argb: BLUE },
    };
    sheet.getRow(index + 1).height = index === 1 ? 30 : 24;
  });
  const emblem = await reportEmblem();
  if (emblem) {
    const image = book.addImage({ buffer: emblem, extension: "png" });
    sheet.addImage(image, {
      tl: { col: 0.15, row: 0.1 },
      ext: { width: 45, height: 57 },
    });
  }
  const group = sheet.getRow(7);
  sheet.mergeCells("A7:A8");
  sheet.mergeCells("B7:B8");
  sheet.mergeCells("C7:C8");
  sheet.mergeCells("D7:D8");
  sheet.mergeCells("E7:E8");
  sheet.mergeCells("F7:F8");
  sheet.mergeCells("G7:I7");
  sheet.mergeCells("J7:M7");
  sheet.mergeCells("N7:N8");
  [
    "Sr. No.",
    "Name",
    "Mobile number",
    "Block",
    "Designation",
    "Workplace",
    "Casual leave",
    "Special leave",
    "Other / untyped",
  ].forEach((label, index) => {
    const column =
      index < 6 ? index + 1 : index === 6 ? 7 : index === 7 ? 10 : 14;
    group.getCell(column).value = label;
  });
  const sub = sheet.getRow(8);
  [
    "Granted",
    "Taken",
    "Balance",
    `${monthName(report.month).slice(0, 3)} taken`,
    `${monthName(report.month).slice(0, 3)} left`,
    "Year taken",
    "Year left",
  ].forEach((label, index) => (sub.getCell(index + 7).value = label));
  for (const row of [group, sub]) {
    row.height = row === group ? 31 : 25;
    row.eachCell({ includeEmpty: true }, (cell) => {
      cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: BLUE },
      };
      cell.font = {
        name: "Noto Sans",
        bold: true,
        size: 9,
        color: { argb: "FFFFFF" },
      };
      cell.alignment = {
        horizontal: "center",
        vertical: "middle",
        wrapText: true,
      };
      cell.border = { bottom: { style: "thin", color: { argb: EDGE } } };
    });
  }
  report.rows.forEach((person, index) => {
    const out = sheet.getRow(index + 9);
    out.values = [
      index + 1,
      safe(person.name),
      safe(person.phone),
      safe(person.block),
      safe(person.designation),
      safe(person.workplace),
      person.clGranted,
      person.clTaken,
      person.clBalance,
      person.slMonthTaken,
      person.gender === "female"
        ? person.slMonthBalance
        : person.gender === "male"
          ? "N/A"
          : "Gender not set",
      person.slTaken,
      person.gender === "female"
        ? person.slBalance
        : person.gender === "male"
          ? "N/A"
          : "Gender not set",
      person.otherTaken,
    ];
    out.height = 37;
    out.eachCell({ includeEmpty: true }, (cell) => {
      cell.font = {
        name: "Noto Sans Devanagari",
        size: 9,
        color: { argb: "1D324A" },
      };
      cell.alignment = {
        vertical: "middle",
        horizontal: [2, 5, 6].includes(cell.col) ? "left" : "center",
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
  });
  const note = sheet.getRow(report.rows.length + 10);
  sheet.mergeCells(note.number, 1, note.number, 14);
  note.getCell(1).value =
    "Other counts recorded leave without a CL/SL type. Medical, maternity and earned leave balances are not tracked.";
  note.getCell(1).font = { name: "Noto Sans", size: 9, color: { argb: BLUE } };
  sheet.views = [{ state: "frozen", xSplit: 6, ySplit: 8 }];
  sheet.pageSetup = {
    paperSize: 8,
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
  sheet.printTitlesRow = "1:8";
  sheet.headerFooter.oddFooter = "Araria Staff Attendance • Page &P of &N";
  return Buffer.from(await book.xlsx.writeBuffer());
}

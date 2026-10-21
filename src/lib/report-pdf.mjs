import { join } from "node:path";
import { STATUS_LEGEND } from "./attendance-report.mjs";
import { reportEmblem } from "./report-emblem.mjs";

const WIDTH = 841.89,
  HEIGHT = 595.28,
  MARGIN = 30,
  BLUE = "#173b63";
const fonts = join(process.cwd(), "assets", "report-fonts");
const isHindi = (value) => /[\u0900-\u097f]/.test(String(value || ""));
function write(
  doc,
  value,
  x,
  y,
  width,
  size = 9,
  bold = false,
  align = "left",
  lines = 1,
) {
  const text = String(value ?? "");
  const font = (hindi) =>
    hindi ? (bold ? "HindiBold" : "Hindi") : bold ? "LatinBold" : "Latin";
  const runs =
    text.match(/[\u0900-\u097f\u200c\u200d]+|[^\u0900-\u097f\u200c\u200d]+/g) ||
    [];
  if (runs.length < 2 || lines > 1) {
    doc
      .font(font(isHindi(text)))
      .fontSize(size)
      .fillColor("#20344d")
      .text(text, x, y, {
        width,
        align,
        height: lines * size * 1.45,
        ellipsis: true,
      });
    return;
  }
  const measured = runs.map((run) => {
    doc.font(font(isHindi(run))).fontSize(size);
    return doc.widthOfString(run);
  });
  const total = measured.reduce((sum, n) => sum + n, 0);
  let cursor =
    x +
    (align === "right"
      ? Math.max(0, width - total)
      : align === "center"
        ? Math.max(0, (width - total) / 2)
        : 0);
  runs.forEach((run, index) => {
    const available = x + width - cursor;
    if (available <= 0) return;
    doc
      .font(font(isHindi(run)))
      .fontSize(size)
      .fillColor("#20344d")
      .text(run, cursor, y, {
        width: available,
        height: size * 1.45,
        ellipsis: true,
      });
    cursor += measured[index];
  });
}
function header(doc, title, period, office, emblem) {
  doc.rect(0, 0, WIDTH, 8).fill(BLUE);
  if (emblem) doc.image(emblem, MARGIN + 7, 24, { fit: [42, 61] });
  else {
    doc.fillColor(BLUE).rect(MARGIN, 26, 55, 55).fill();
    doc
      .fillColor("#ffffff")
      .font("LatinBold")
      .fontSize(9)
      .text("BIHAR", MARGIN + 5, 44, { width: 45, align: "center" });
  }
  write(
    doc,
    `GOVERNMENT OF BIHAR • ${office || "DISTRICT ARARIA"}`,
    95,
    27,
    WIDTH - 190,
    9,
    true,
    "center",
  );
  write(
    doc,
    "ARARIA STAFF ATTENDANCE",
    95,
    45,
    WIDTH - 190,
    15,
    true,
    "center",
  );
  write(doc, title, 95, 67, WIDTH - 190, 10, true, "center");
  doc
    .strokeColor("#acc0d4")
    .lineWidth(0.7)
    .moveTo(MARGIN, 91)
    .lineTo(WIDTH - MARGIN, 91)
    .stroke();
  write(doc, `Period: ${period}`, MARGIN, 101, 450, 8);
  write(
    doc,
    `Report date: ${new Date().toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata" })}`,
    WIDTH - 220,
    101,
    190,
    8,
    false,
    "right",
  );
}
function legend(doc) {
  const value = STATUS_LEGEND.map(([code, label]) => `${code} ${label}`).join(
    "   •   ",
  );
  doc
    .strokeColor("#b9c8d7")
    .moveTo(MARGIN, HEIGHT - 43)
    .lineTo(WIDTH - MARGIN, HEIGHT - 43)
    .stroke();
  write(doc, value, MARGIN, HEIGHT - 37, WIDTH - MARGIN * 2, 7);
}
function page(doc, title, period, office, emblem) {
  doc.addPage();
  header(doc, title, period, office, emblem);
  legend(doc);
}
function gridHeader(doc, dates, y) {
  const width = WIDTH - MARGIN * 2,
    nameWidth = 170,
    dayWidth = (width - nameWidth) / dates.length;
  doc.rect(MARGIN, y, width, 25).fill(BLUE);
  doc
    .fillColor("#ffffff")
    .font("LatinBold")
    .fontSize(8)
    .text("Staff name", MARGIN + 5, y + 7, { width: nameWidth - 10 });
  dates.forEach((date, index) =>
    doc.text(
      String(Number(date.slice(-2))),
      MARGIN + nameWidth + index * dayWidth,
      y + 7,
      { width: dayWidth, align: "center" },
    ),
  );
  return { nameWidth, dayWidth };
}
function gridRow(doc, row, index, dates, y, columns) {
  const width = WIDTH - MARGIN * 2,
    height = 26;
  if (index % 2) doc.rect(MARGIN, y, width, height).fill("#f1f5f9");
  doc
    .strokeColor("#d7e1ea")
    .lineWidth(0.35)
    .rect(MARGIN, y, width, height)
    .stroke();
  write(
    doc,
    row.name,
    MARGIN + 5,
    y + 3,
    columns.nameWidth - 10,
    8.1,
    false,
    "left",
    2,
  );
  row.cells.forEach((cell, column) => {
    const x = MARGIN + columns.nameWidth + column * columns.dayWidth;
    doc
      .strokeColor("#d7e1ea")
      .moveTo(x, y)
      .lineTo(x, y + height)
      .stroke();
    write(
      doc,
      cell.code,
      x,
      y + 8,
      columns.dayWidth,
      8,
      cell.code === "A" || cell.code === "PP",
      "center",
    );
  });
}
function detailEntry(doc, item, y, index) {
  const { row, cell } = item,
    r = cell.record;
  if (index % 2) doc.rect(MARGIN, y, WIDTH - MARGIN * 2, 42).fill("#f1f5f9");
  doc
    .strokeColor("#d7e1ea")
    .rect(MARGIN, y, WIDTH - MARGIN * 2, 42)
    .stroke();
  write(doc, `${cell.date}  ${cell.code}`, MARGIN + 6, y + 4, 115, 8, true);
  write(doc, row.name, MARGIN + 125, y + 4, 250, 8.3, true);
  write(
    doc,
    `${r.department || ""} • ${r.panchayat || ""} • ${r.position || ""}`,
    MARGIN + 380,
    y + 4,
    390,
    7.5,
  );
  const clock = (value) =>
    value
      ? new Date(value).toLocaleTimeString("en-IN", {
          timeZone: "Asia/Kolkata",
          hour: "2-digit",
          minute: "2-digit",
        })
      : "—";
  const details = `In ${clock(r.time_in)}   Out ${clock(r.time_out)}   ${r.leave_type || ""}   ${r.deputation_workplace || ""}   ${r.absence_reason || ""}`;
  write(doc, details, MARGIN + 125, y + 23, WIDTH - MARGIN * 2 - 132, 7.7);
}

export async function renderReportPdf(report) {
  const emblem = await reportEmblem();
  const PDFDocument = (await import("pdfkit")).default;
  const doc = new PDFDocument({
    size: "A4",
    layout: "landscape",
    margin: 0,
    bufferPages: true,
    autoFirstPage: false,
    compress: true,
    info: {
      Title: "Araria staff attendance report",
      Author: "Araria Staff Attendance",
    },
  });
  doc.registerFont("Latin", join(fonts, "NotoSans-Regular.ttf"));
  doc.registerFont("LatinBold", join(fonts, "NotoSans-Bold.ttf"));
  doc.registerFont("Hindi", join(fonts, "NotoSansDevanagari-Regular.ttf"));
  doc.registerFont("HindiBold", join(fonts, "NotoSansDevanagari-Bold.ttf"));
  const chunks = [];
  const output = new Promise((resolve, reject) => {
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });
  for (const section of report.sections) {
    const period = `${section.dates[0]} to ${section.dates.at(-1)}`;
    let y = 0,
      columns;
    for (let index = 0; index < section.rows.length; index++) {
      if (!y || y + 26 > HEIGHT - 55) {
        page(
          doc,
          `Attendance report • ${section.month}`,
          period,
          report.officeLabel,
          emblem,
        );
        y = 123;
        columns = gridHeader(doc, section.dates, y);
        y += 25;
      }
      gridRow(doc, section.rows[index], index, section.dates, y, columns);
      y += 26;
    }
    if (!section.rows.length) {
      page(
        doc,
        `Attendance report • ${section.month}`,
        period,
        report.officeLabel,
        emblem,
      );
      gridHeader(doc, section.dates, 123);
      write(
        doc,
        "No staff match the selected filters.",
        MARGIN + 4,
        157,
        WIDTH - MARGIN * 2 - 8,
        10,
      );
    }
  }
  const details = report.sections.flatMap((section) =>
    section.rows.flatMap((row) =>
      row.cells.filter((cell) => cell.record).map((cell) => ({ row, cell })),
    ),
  );
  let y = 0;
  for (let index = 0; index < details.length; index++) {
    if (!y || y + 42 > HEIGHT - 55) {
      page(
        doc,
        "Attendance details",
        `${report.start} to ${report.end}`,
        report.officeLabel,
        emblem,
      );
      y = 126;
    }
    detailEntry(doc, details[index], y, index);
    y += 42;
  }
  const count = doc.bufferedPageRange().count;
  for (let index = 0; index < count; index++) {
    doc.switchToPage(index);
    write(
      doc,
      `Araria Staff Attendance • Page ${index + 1} of ${count}`,
      WIDTH - 230,
      HEIGHT - 21,
      200,
      7,
      false,
      "right",
    );
  }
  doc.end();
  return output;
}

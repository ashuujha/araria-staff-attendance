import { join } from "node:path";
import { STATUS_LEGEND } from "./attendance-report.mjs";
import { reportEmblem } from "./report-emblem.mjs";
import { reportStaffDisplay } from "./report-display.mjs";

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
  if (runs.length > 1 && lines > 1) {
    let cursor = x;
    let line = 0;
    const lineHeight = size * 1.5;
    for (const token of text.match(/\s+|[^\s]+/g) || []) {
      const pieces =
        token.match(
          /[\u0900-\u097f\u200c\u200d]+|[^\u0900-\u097f\u200c\u200d]+/g,
        ) || [];
      const widths = pieces.map((piece) => {
        doc.font(font(isHindi(piece))).fontSize(size);
        return doc.widthOfString(piece);
      });
      const tokenWidth = widths.reduce((sum, value) => sum + value, 0);
      if (cursor > x && cursor + tokenWidth > x + width) {
        line++;
        cursor = x;
      }
      if (line >= lines) break;
      if (/^\s+$/.test(token)) {
        if (cursor !== x) cursor += tokenWidth;
        continue;
      }
      pieces.forEach((piece, index) => {
        const available = x + width - cursor;
        if (available <= 0) return;
        doc
          .font(font(isHindi(piece)))
          .fontSize(size)
          .fillColor("#20344d")
          .text(piece, cursor, y + line * lineHeight, {
            width: available,
            height: lineHeight,
            ellipsis: true,
          });
        cursor += widths[index];
      });
    }
    return;
  }
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
    fixed = [28, 113, 72, 95, 151],
    dayWidth = (width - fixed.reduce((sum, n) => sum + n, 0)) / dates.length;
  doc.rect(MARGIN, y, width, 25).fill(BLUE);
  let x = MARGIN;
  ["No.", "Name", "Mobile", "Designation", "Workplace"].forEach(
    (label, index) => {
      doc
        .fillColor("#ffffff")
        .font("LatinBold")
        .fontSize(index === 0 ? 7 : 8)
        .text(label, x + 3, y + 7, {
          width: fixed[index] - 6,
          align: index === 0 ? "center" : "left",
        });
      x += fixed[index];
    },
  );
  dates.forEach((date, index) =>
    doc
      .fillColor("#ffffff")
      .font("LatinBold")
      .fontSize(7)
      .text(String(Number(date.slice(-2))), x + index * dayWidth, y + 7, {
        width: dayWidth,
        align: "center",
      }),
  );
  return { fixed, dayWidth };
}
function gridRow(doc, row, index, dates, y, columns) {
  const width = WIDTH - MARGIN * 2,
    height = 32,
    display = reportStaffDisplay(row);
  if (index % 2) doc.rect(MARGIN, y, width, height).fill("#f1f5f9");
  doc
    .strokeColor("#d7e1ea")
    .lineWidth(0.35)
    .rect(MARGIN, y, width, height)
    .stroke();
  let x = MARGIN;
  [
    String(index + 1),
    display.name,
    display.phone,
    display.designation,
    display.workplace,
  ].forEach((value, column) => {
    if (column)
      doc
        .strokeColor("#d7e1ea")
        .moveTo(x, y)
        .lineTo(x, y + height)
        .stroke();
    write(
      doc,
      value,
      x + 3,
      y + (column === 0 || column === 2 ? 10 : 4),
      columns.fixed[column] - 6,
      column === 0 ? 7 : 7.3,
      false,
      column === 0 ? "center" : "left",
      column === 0 || column === 2 ? 1 : 2,
    );
    x += columns.fixed[column];
  });
  row.cells.forEach((cell, column) => {
    const dayX = x + column * columns.dayWidth;
    doc
      .strokeColor("#d7e1ea")
      .moveTo(dayX, y)
      .lineTo(dayX, y + height)
      .stroke();
    write(
      doc,
      cell.code,
      dayX,
      y + 10,
      columns.dayWidth,
      Math.min(7, Math.max(5.4, columns.dayWidth * 0.55)),
      cell.code === "A" || cell.code === "PP",
      "center",
    );
  });
}
const DAILY_WIDTHS = [32, 135, 80, 123, 185, 107, 60, 60];
const DAILY_HEADERS = [
  "No.",
  "Name",
  "Mobile",
  "Designation",
  "Workplace",
  "Attendance",
  "In",
  "Out",
];
function dailyHeader(doc, y) {
  doc.rect(MARGIN, y, WIDTH - MARGIN * 2, 28).fill(BLUE);
  let x = MARGIN;
  DAILY_HEADERS.forEach((label, index) => {
    doc
      .fillColor("#ffffff")
      .font("LatinBold")
      .fontSize(8)
      .text(label, x + 4, y + 8, {
        width: DAILY_WIDTHS[index] - 8,
        align: index === 0 || index > 5 ? "center" : "left",
      });
    x += DAILY_WIDTHS[index];
  });
}
function dailyRow(doc, row, index, date, y) {
  const fields = reportStaffDisplay(row, date);
  const values = [
    String(index + 1),
    fields.name,
    fields.phone,
    fields.designation,
    fields.workplace,
    fields.status,
    fields.inTime,
    fields.outTime,
  ];
  const height = dailyRowHeight(doc, row, date);
  if (index % 2)
    doc.rect(MARGIN, y, WIDTH - MARGIN * 2, height).fill("#f1f5f9");
  doc
    .strokeColor("#d7e1ea")
    .lineWidth(0.4)
    .rect(MARGIN, y, WIDTH - MARGIN * 2, height)
    .stroke();
  let x = MARGIN;
  values.forEach((value, column) => {
    if (column)
      doc
        .strokeColor("#d7e1ea")
        .moveTo(x, y)
        .lineTo(x, y + height)
        .stroke();
    const centered = column === 0 || column === 2 || column > 5;
    write(
      doc,
      value,
      x + 4,
      y + (centered ? (height - 10) / 2 : 6),
      DAILY_WIDTHS[column] - 8,
      column === 1 ? 8.2 : 7.7,
      column === 1,
      centered ? "center" : "left",
      centered ? 1 : Math.max(2, Math.floor((height - 8) / 11)),
    );
    x += DAILY_WIDTHS[column];
  });
  return height;
}
function dailyRowHeight(doc, row, date) {
  const fields = reportStaffDisplay(row, date);
  const values = [
    fields.name,
    fields.designation,
    fields.workplace,
    fields.status,
  ];
  const columns = [1, 3, 4, 5];
  const measured = columns.map((column, index) => {
    const value = values[index];
    doc.font(isHindi(value) ? "Hindi" : "Latin").fontSize(7.7);
    return doc.heightOfString(value, { width: DAILY_WIDTHS[column] - 10 });
  });
  return Math.max(36, Math.min(60, Math.ceil(Math.max(...measured) + 12)));
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
  const daily = report.start === report.end;
  for (const section of report.sections) {
    const period = `${section.dates[0]} to ${section.dates.at(-1)}`;
    if (daily) {
      const date = section.dates[0];
      let y = 0;
      for (let index = 0; index < section.rows.length; index++) {
        const row = section.rows[index];
        if (!y) {
          page(
            doc,
            `Daily attendance • ${date}`,
            date,
            report.officeLabel,
            emblem,
          );
          dailyHeader(doc, 123);
          y = 151;
        }
        const height = dailyRowHeight(doc, row, date);
        if (y + height > HEIGHT - 55) {
          page(
            doc,
            `Daily attendance • ${date}`,
            date,
            report.officeLabel,
            emblem,
          );
          dailyHeader(doc, 123);
          y = 151;
        }
        y += dailyRow(doc, row, index, date, y);
      }
      if (!section.rows.length) {
        page(
          doc,
          `Daily attendance • ${date}`,
          date,
          report.officeLabel,
          emblem,
        );
        dailyHeader(doc, 123);
        write(
          doc,
          "No staff match the selected filters.",
          MARGIN + 5,
          161,
          WIDTH - MARGIN * 2 - 10,
          10,
        );
      }
      continue;
    }
    let y = 0,
      columns;
    for (let index = 0; index < section.rows.length; index++) {
      if (!y || y + 32 > HEIGHT - 55) {
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
      y += 32;
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

import { join } from "node:path";
import { reportEmblem } from "./report-emblem.mjs";
import { reportPdfWrite as write } from "./report-pdf.mjs";

const WIDTH = 1190.55;
const HEIGHT = 841.89;
const MARGIN = 30;
const BLUE = "#173b63";
const WIDTHS = [32, 145, 95, 70, 148, 208, 60, 60, 60, 60, 60, 60, 72];
const HEADERS = ["No.", "Name", "Mobile", "Block", "Designation", "Workplace"];
const TOTAL = WIDTHS.reduce((sum, width) => sum + width, 0);
const fonts = join(process.cwd(), "assets", "report-fonts");
const isHindi = (value) => /[\u0900-\u097f]/.test(String(value || ""));

function page(doc, year, office, emblem) {
  doc.addPage();
  doc.rect(0, 0, WIDTH, 8).fill(BLUE);
  if (emblem) doc.image(emblem, MARGIN + 5, 22, { fit: [48, 66] });
  else {
    doc.rect(MARGIN, 27, 55, 55).fill(BLUE);
    doc
      .fillColor("#ffffff")
      .font("LatinBold")
      .fontSize(9)
      .text("BIHAR", MARGIN + 5, 47, { width: 45, align: "center" });
  }
  write(
    doc,
    `GOVERNMENT OF BIHAR • ${office || "DISTRICT ARARIA"}`,
    100,
    27,
    WIDTH - 200,
    9,
    true,
    "center",
  );
  write(
    doc,
    `STAFF LEAVE DETAILS REPORT ${year}`,
    100,
    48,
    WIDTH - 200,
    17,
    true,
    "center",
  );
  write(
    doc,
    "Casual leave: 16/year • Special leave: 24/year for female staff, maximum 2/month",
    100,
    76,
    WIDTH - 200,
    8.5,
    false,
    "center",
  );
  doc
    .strokeColor("#acc0d4")
    .lineWidth(0.7)
    .moveTo(MARGIN, 103)
    .lineTo(WIDTH - MARGIN, 103)
    .stroke();
  write(doc, `Leave year: ${year}`, MARGIN, 111, 300, 8);
  write(
    doc,
    `Report date: ${new Date().toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata" })}`,
    WIDTH - 250,
    111,
    220,
    8,
    false,
    "right",
  );
  tableHeader(doc, 131);
  doc
    .strokeColor("#b9c8d7")
    .moveTo(MARGIN, HEIGHT - 49)
    .lineTo(WIDTH - MARGIN, HEIGHT - 49)
    .stroke();
  write(
    doc,
    "Other = recorded leave without a CL/SL type. Medical, maternity and earned leave balances are not tracked.",
    MARGIN,
    HEIGHT - 43,
    TOTAL,
    7.5,
  );
}

function tableHeader(doc, y) {
  doc.rect(MARGIN, y, TOTAL, 28).fill(BLUE);
  doc.rect(MARGIN, y + 28, TOTAL, 24).fill("#eaf1f8");
  let x = MARGIN;
  HEADERS.forEach((label, index) => {
    doc
      .fillColor("#ffffff")
      .font("LatinBold")
      .fontSize(8)
      .text(label, x + 4, y + 10, {
        width: WIDTHS[index] - 8,
        align: index === 0 ? "center" : "left",
      });
    x += WIDTHS[index];
  });
  for (const group of ["CASUAL LEAVE", "SPECIAL LEAVE"]) {
    doc
      .fillColor("#ffffff")
      .font("LatinBold")
      .fontSize(9)
      .text(group, x, y + 9, { width: 180, align: "center" });
    for (const label of ["GRANTED", "TAKEN", "BALANCE"]) {
      doc
        .fillColor(BLUE)
        .font("LatinBold")
        .fontSize(7)
        .text(label, x, y + 35, { width: 60, align: "center" });
      x += 60;
    }
  }
  doc
    .fillColor("#ffffff")
    .font("LatinBold")
    .fontSize(9)
    .text("OTHER", x, y + 9, { width: 72, align: "center" });
  doc
    .fillColor(BLUE)
    .font("LatinBold")
    .fontSize(7)
    .text("UNTYPED", x, y + 35, { width: 72, align: "center" });
  x = MARGIN;
  WIDTHS.slice(0, -1).forEach((width) => {
    x += width;
    doc
      .strokeColor("#c9d4e1")
      .lineWidth(0.45)
      .moveTo(x, y)
      .lineTo(x, y + 52)
      .stroke();
  });
  doc.strokeColor("#c9d4e1").rect(MARGIN, y, TOTAL, 52).stroke();
}

function rowHeight(doc, row) {
  const measured = [
    [row.name, 1],
    [row.designation, 4],
    [row.workplace, 5],
  ].map(([value, column]) => {
    doc.font(isHindi(value) ? "Hindi" : "Latin").fontSize(8);
    return doc.heightOfString(String(value), { width: WIDTHS[column] - 10 });
  });
  return Math.max(37, Math.min(66, Math.ceil(Math.max(...measured) + 13)));
}

function tableRow(doc, row, index, y) {
  const height = rowHeight(doc, row);
  if (index % 2) doc.rect(MARGIN, y, TOTAL, height).fill("#f1f5f9");
  doc
    .strokeColor("#d7e1ea")
    .lineWidth(0.4)
    .rect(MARGIN, y, TOTAL, height)
    .stroke();
  const slGrant =
    row.gender === "female"
      ? row.slGranted
      : row.gender === "male"
        ? "N/A"
        : "—";
  const slBalance =
    row.gender === "female"
      ? row.slBalance
      : row.gender === "male"
        ? "N/A"
        : "—";
  const values = [
    index + 1,
    row.name,
    row.phone,
    row.block,
    row.designation,
    row.workplace,
    row.clGranted,
    row.clTaken,
    row.clBalance,
    slGrant,
    row.slTaken,
    slBalance,
    row.otherTaken,
  ];
  let x = MARGIN;
  values.forEach((value, column) => {
    if (column)
      doc
        .strokeColor("#d7e1ea")
        .moveTo(x, y)
        .lineTo(x, y + height)
        .stroke();
    const centered =
      column === 0 || column === 2 || column === 3 || column >= 6;
    write(
      doc,
      value,
      x + 4,
      y + (centered ? (height - 11) / 2 : 6),
      WIDTHS[column] - 8,
      column === 1 ? 8.4 : 8,
      column === 1,
      centered ? "center" : "left",
      centered ? 1 : Math.max(2, Math.floor((height - 9) / 12)),
    );
    x += WIDTHS[column];
  });
  return height;
}

export async function renderLeaveReportPdf(report) {
  const emblem = await reportEmblem();
  const PDFDocument = (await import("pdfkit")).default;
  const doc = new PDFDocument({
    size: "A3",
    layout: "landscape",
    margin: 0,
    bufferPages: true,
    autoFirstPage: false,
    compress: true,
    info: {
      Title: `Araria staff leave report ${report.year}`,
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
  let y = 0;
  for (let index = 0; index < report.rows.length; index++) {
    if (!y) {
      page(doc, report.year, report.officeLabel, emblem);
      y = 183;
    }
    const height = rowHeight(doc, report.rows[index]);
    if (y + height > HEIGHT - 55) {
      page(doc, report.year, report.officeLabel, emblem);
      y = 183;
    }
    y += tableRow(doc, report.rows[index], index, y);
  }
  if (!report.rows.length) {
    page(doc, report.year, report.officeLabel, emblem);
    write(
      doc,
      "No staff match the selected leave report filters.",
      MARGIN + 7,
      196,
      TOTAL - 14,
      10,
    );
  }
  const count = doc.bufferedPageRange().count;
  for (let index = 0; index < count; index++) {
    doc.switchToPage(index);
    write(
      doc,
      `Araria Staff Attendance • Page ${index + 1} of ${count}`,
      WIDTH - 250,
      HEIGHT - 21,
      220,
      7,
      false,
      "right",
    );
  }
  doc.end();
  return output;
}

import { join } from "node:path";
import { reportEmblem } from "./report-emblem.mjs";
import { reportPdfWrite as write } from "./report-pdf.mjs";

const WIDTH = 1190.55;
const HEIGHT = 841.89;
const MARGIN = 30;
const BLUE = "#173b63";
const WIDTHS = [32, 145, 95, 70, 148, 208, 52, 52, 52, 52, 52, 52, 52, 68];
const HEADERS = ["No.", "Name", "Mobile", "Block", "Designation", "Workplace"];
const TOTAL = WIDTHS.reduce((sum, width) => sum + width, 0);
const STAFF_WIDTH = WIDTHS.slice(0, 6).reduce((sum, width) => sum + width, 0);
const fonts = join(process.cwd(), "assets", "report-fonts");
const isHindi = (value) => /[\u0900-\u097f]/.test(String(value || ""));
const monthName = (month) =>
  new Date(Date.UTC(2026, Number(month) - 1, 1)).toLocaleString("en-IN", {
    month: "long",
  });

function page(doc, report, emblem) {
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
    `GOVERNMENT OF BIHAR • ${report.officeLabel || "DISTRICT ARARIA"}`,
    100,
    27,
    WIDTH - 200,
    9,
    true,
    "center",
  );
  write(
    doc,
    `STAFF LEAVE DETAILS REPORT ${report.year}`,
    100,
    48,
    WIDTH - 200,
    17,
    true,
    "center",
  );
  write(
    doc,
    `Casual leave: 16/year • Special leave: 2 in ${monthName(report.month)}, 24/year for female staff`,
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
  write(
    doc,
    `SL month: ${monthName(report.month)} ${report.year} • Year balance: ${report.year}`,
    MARGIN,
    111,
    400,
    8,
  );
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
  tableHeader(doc, 131, report.month);
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

function tableHeader(doc, y, month) {
  doc.rect(MARGIN, y, TOTAL, 52).fill(BLUE);
  doc
    .rect(MARGIN + STAFF_WIDTH, y + 28, TOTAL - STAFF_WIDTH, 24)
    .fill("#eaf1f8");
  let x = MARGIN;
  HEADERS.forEach((label, index) => {
    doc
      .fillColor("#ffffff")
      .font("LatinBold")
      .fontSize(8)
      .text(label, x + 4, y + 21, {
        width: WIDTHS[index] - 8,
        align: index === 0 ? "center" : "left",
      });
    x += WIDTHS[index];
  });
  const groups = [
    { title: "CASUAL LEAVE · YEAR", labels: ["GRANTED", "TAKEN", "LEFT"] },
    {
      title: "SPECIAL LEAVE · MONTH / YEAR",
      labels: [
        `${monthName(month).slice(0, 3).toUpperCase()} TAKEN`,
        `${monthName(month).slice(0, 3).toUpperCase()} LEFT`,
        "YEAR TAKEN",
        "YEAR LEFT",
      ],
    },
  ];
  for (const group of groups) {
    const groupWidth = group.labels.length * 52;
    doc
      .fillColor("#ffffff")
      .font("LatinBold")
      .fontSize(8)
      .text(group.title, x + 2, y + 9, {
        width: groupWidth - 4,
        align: "center",
      });
    for (const label of group.labels) {
      doc
        .fillColor(BLUE)
        .font("LatinBold")
        .fontSize(6.4)
        .text(label, x + 1, y + 35, { width: 50, align: "center" });
      x += 52;
    }
  }
  doc
    .fillColor("#ffffff")
    .font("LatinBold")
    .fontSize(9)
    .text("OTHER", x, y + 9, { width: 68, align: "center" });
  doc
    .fillColor(BLUE)
    .font("LatinBold")
    .fontSize(7)
    .text("UNTYPED", x, y + 35, { width: 68, align: "center" });
  x = MARGIN;
  WIDTHS.slice(0, -1).forEach((width, index) => {
    x += width;
    const isGroupEdge = [5, 8, 12].includes(index);
    doc
      .strokeColor("#c9d4e1")
      .lineWidth(0.45)
      .moveTo(x, isGroupEdge || index < 5 ? y : y + 28)
      .lineTo(x, y + 52)
      .stroke();
  });
  doc
    .moveTo(MARGIN + STAFF_WIDTH, y + 28)
    .lineTo(MARGIN + TOTAL, y + 28)
    .stroke();
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
  const slBalance =
    row.gender === "female"
      ? row.slBalance
      : row.gender === "male"
        ? "N/A"
        : "—";
  const slMonthBalance =
    row.gender === "female"
      ? row.slMonthBalance
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
    row.slMonthTaken,
    slMonthBalance,
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
      page(doc, report, emblem);
      y = 183;
    }
    const height = rowHeight(doc, report.rows[index]);
    if (y + height > HEIGHT - 55) {
      page(doc, report, emblem);
      y = 183;
    }
    y += tableRow(doc, report.rows[index], index, y);
  }
  if (!report.rows.length) {
    page(doc, report, emblem);
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

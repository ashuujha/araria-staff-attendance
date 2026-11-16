import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import sharp from "sharp";
import { HttpError } from "./server";
import { MAX_UPLOAD_BYTES, validateUploadBytes } from "./file-validation";
import { leaveDatesLabel } from "./leave-dates";

export async function makeSignedLeavePdf(input: {
  original: Uint8Array;
  signature: Uint8Array;
  requestId: string;
  staffId: string;
  leaveDate: string;
  leaveDates?: string[];
  leaveType: string;
  approverRole: string;
  decidedAt: Date;
}) {
  let pdf: PDFDocument;
  const kind = validateUploadBytes(input.original);
  try {
    if (kind === "application/pdf")
      pdf = await PDFDocument.load(input.original);
    else {
      pdf = await PDFDocument.create();
      const source = await pdf.embedJpg(input.original);
      const page = pdf.addPage([595, 842]);
      const ratio = Math.min(540 / source.width, 780 / source.height);
      page.drawImage(source, {
        x: (595 - source.width * ratio) / 2,
        y: (842 - source.height * ratio) / 2,
        width: source.width * ratio,
        height: source.height * ratio,
      });
    }
    const cleanSignature = await sharp(input.signature, {
      limitInputPixels: 2000000,
      failOn: "warning",
    })
      .resize({ width: 900, height: 300, fit: "inside" })
      .png()
      .toBuffer();
    const sign = await pdf.embedPng(cleanSignature);
    const page = pdf.addPage([595, 842]);
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
    const line = (label: string, value: string, y: number) => {
      page.drawText(label, { x: 48, y, size: 11, font: bold });
      page.drawText(value, { x: 190, y, size: 11, font });
    };
    page.drawText("ARARIA DISTRICT - LEAVE APPROVAL", {
      x: 48,
      y: 780,
      size: 17,
      font: bold,
      color: rgb(0.1, 0.25, 0.43),
    });
    page.drawText(
      "This signed decision page accompanies the original application.",
      {
        x: 48,
        y: 748,
        size: 10,
        font,
      },
    );
    line("Application ID", input.requestId, 690);
    line("Staff ID", input.staffId, 660);
    line(
      "Leave dates",
      input.leaveDates?.length && input.leaveDates.length > 1
        ? `${input.leaveDates[0]} to ${input.leaveDates.at(-1)} (${input.leaveDates.length} dates)`
        : input.leaveDate,
      630,
    );
    line("Leave type", input.leaveType, 600);
    line("Decision", "APPROVED", 570);
    line("Approved by", input.approverRole.toUpperCase(), 540);
    line(
      "Approved at (IST)",
      input.decidedAt.toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }),
      510,
    );
    page.drawText("Approver signature", {
      x: 48,
      y: 445,
      size: 11,
      font: bold,
    });
    const scale = Math.min(260 / sign.width, 100 / sign.height);
    page.drawImage(sign, {
      x: 48,
      y: 330,
      width: sign.width * scale,
      height: sign.height * scale,
    });
    page.drawLine({
      start: { x: 48, y: 325 },
      end: { x: 320, y: 325 },
      thickness: 0.8,
    });
    page.drawText("Visual signature supplied by the approving officer.", {
      x: 48,
      y: 295,
      size: 9,
      font,
    });
    if (input.leaveDates && input.leaveDates.length > 1) {
      const selected = leaveDatesLabel(input.leaveDates, input.leaveDate);
      const listPage = pdf.addPage([595, 842]);
      listPage.drawText("APPROVED LEAVE DATES", {
        x: 48,
        y: 780,
        size: 16,
        font: bold,
      });
      listPage.drawText(`Application ID: ${input.requestId}`, {
        x: 48,
        y: 750,
        size: 10,
        font,
      });
      listPage.drawText(
        `Selection: ${selected.startsWith(input.leaveDates[0] + " to ") ? "Continuous range" : "Individual dates"}`,
        { x: 48, y: 728, size: 10, font },
      );
      let y = 700;
      for (const date of input.leaveDates) {
        if (y < 52) {
          const next = pdf.addPage([595, 842]);
          y = 780;
          next.drawText("APPROVED LEAVE DATES (CONTINUED)", {
            x: 48,
            y,
            size: 14,
            font: bold,
          });
          y -= 30;
        }
        pdf.getPages().at(-1)!.drawText(date, { x: 48, y, size: 10, font });
        y -= 18;
      }
    }
    const bytes = await pdf.save();
    if (bytes.length >= MAX_UPLOAD_BYTES)
      throw new HttpError(
        400,
        "Signed PDF exceeds 5 MB. Upload a signed copy instead.",
      );
    return bytes;
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(
      400,
      "The application or signature could not be signed. Upload a signed PDF/JPEG instead.",
    );
  }
}

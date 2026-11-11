import { join } from "node:path";
import {
  admin,
  audit,
  failure,
  HttpError,
  identity,
  sb,
} from "../../../../lib/server";
import { requestedBlock } from "../../../../lib/district-scope";

export const runtime = "nodejs";
export const maxDuration = 60;

type Row = {
  name: string;
  phone: string | null;
  email: string | null;
  gender: string | null;
  block: string;
  assignments: { panchayat: string; position: string }[];
};
const safe = (value: unknown) => {
  const text = String(value ?? "");
  return /^[\s]*[=+@-]/.test(text) ? "'" + text : text;
};
async function pages(path: string, token: string) {
  const rows: Row[] = [];
  for (let offset = 0; offset < 10000; offset += 1000) {
    const page = await sb(`${path}&limit=1000&offset=${offset}`, {}, token);
    rows.push(...page);
    if (page.length < 1000) return rows;
  }
  throw new HttpError(413, "Directory is too large to export.");
}
export async function GET(req: Request) {
  try {
    const { profile, token } = await identity(req);
    admin(profile);
    const params = new URL(req.url).searchParams;
    const format = params.get("format");
    if (format !== "xlsx" && format !== "pdf")
      throw new HttpError(400, "Choose PDF or XLSX.");
    const blockId = requestedBlock(profile, params.get("block_id"));
    const filter = blockId ? `&block_id=eq.${blockId}` : "";
    const [profiles, roster] = await Promise.all([
      pages(
        `/rest/v1/profiles?role=eq.staff&deleted_at=is.null${filter}&select=name,phone,email,gender,block,assignments&order=name`,
        token,
      ),
      pages(
        `/rest/v1/staff_roster?deleted_at=is.null&linked_profile_id=is.null${filter}&select=name,phone,email,gender,assignments,blocks(name_en)&order=name`,
        token,
      ),
    ]);
    const rows = [
      ...profiles,
      ...roster.map((row) => ({
        ...row,
        block: (row as Row & { blocks: { name_en: string } }).blocks.name_en,
      })),
    ].sort(
      (a, b) => a.block.localeCompare(b.block) || a.name.localeCompare(b.name),
    );
    const name = `araria-staff-directory-${new Date().toISOString().slice(0, 10)}.${format}`;
    let bytes: Uint8Array;
    if (format === "xlsx") {
      const ExcelJS = (await import("exceljs")).default;
      const book = new ExcelJS.Workbook();
      const sheet = book.addWorksheet("Staff directory");
      sheet.columns = [
        { header: "Block", key: "block", width: 22 },
        { header: "Name", key: "name", width: 30 },
        { header: "Mobile", key: "phone", width: 18 },
        { header: "Gender", key: "gender", width: 14 },
        { header: "Email", key: "email", width: 32 },
        { header: "Workspaces / designation", key: "assignments", width: 70 },
      ];
      for (const row of rows)
        sheet.addRow({
          block: safe(row.block),
          name: safe(row.name),
          phone: safe(row.phone),
          gender: safe(row.gender),
          email: safe(row.email),
          assignments: safe(
            (row.assignments || [])
              .map((a) => `${a.panchayat} • ${a.position}`)
              .join("; "),
          ),
        });
      sheet.getRow(1).font = { bold: true };
      sheet.views = [{ state: "frozen", ySplit: 1 }];
      sheet.autoFilter = "A1:F1";
      bytes = new Uint8Array(await book.xlsx.writeBuffer());
    } else {
      // @ts-expect-error pdfkit has no bundled TypeScript declarations.
      const PDFDocument = (await import("pdfkit")).default;
      const doc = new PDFDocument({
        size: "A4",
        margin: 35,
        bufferPages: true,
      });
      const chunks: Buffer[] = [];
      doc.on("data", (chunk: Buffer) => chunks.push(chunk));
      const finished = new Promise<Buffer>((resolve) =>
        doc.on("end", () => resolve(Buffer.concat(chunks))),
      );
      doc.registerFont(
        "Text",
        join(
          process.cwd(),
          "assets/report-fonts/NotoSansDevanagari-Regular.ttf",
        ),
      );
      doc.registerFont(
        "Bold",
        join(process.cwd(), "assets/report-fonts/NotoSansDevanagari-Bold.ttf"),
      );
      doc
        .font("Bold")
        .fontSize(15)
        .text("Araria Staff Attendance • Staff directory");
      doc
        .font("Text")
        .fontSize(9)
        .text(
          `${blockId ? rows[0]?.block || "Selected block" : "Araria District"} • ${rows.length} staff • ${new Date().toLocaleDateString("en-IN")}`,
        );
      doc.moveDown();
      rows.forEach((row, index) => {
        const workspace = (row.assignments || [])
          .map((a) => `${a.panchayat} • ${a.position}`)
          .join("; ");
        const line = `${index + 1}. ${row.name}  |  ${row.phone || "No number"}  |  ${row.block}\n${row.gender || "Gender not set"}  |  ${row.email || "No email"}\n${workspace || "No assignment"}`;
        const height = doc.heightOfString(line, { width: 520 }) + 14;
        if (doc.y + height > doc.page.height - 35) doc.addPage();
        doc.font("Text").fontSize(9).text(line, 35, doc.y, { width: 520 });
        doc.moveDown(0.6);
      });
      doc.end();
      bytes = new Uint8Array(await finished);
    }
    await audit(
      profile.id,
      "export_staff_directory",
      blockId || "district",
      "Administrator exported staff directory",
      { format, count: rows.length },
      blockId,
    );
    return new Response(Uint8Array.from(bytes).buffer, {
      headers: {
        "Content-Type":
          format === "pdf"
            ? "application/pdf"
            : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${name}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return failure(error);
  }
}

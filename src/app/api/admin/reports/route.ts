import {
  admin,
  failure,
  HttpError,
  identity,
  sb,
} from "../../../../lib/server";
import { istDate } from "../../../../lib/security.mjs";
import {
  dateSections,
  makeAttendanceReport,
} from "../../../../lib/attendance-report.mjs";
import { renderReportXlsx } from "../../../../lib/report-xlsx.mjs";
import { renderReportPdf } from "../../../../lib/report-pdf.mjs";

export const runtime = "nodejs";
export const maxDuration = 60;
const PAGE = 1000;
const MAX_ROWS = 100000;
const MAX_BYTES = 4 * 1024 * 1024;

async function allPages(path: string, token: string) {
  const rows: Record<string, unknown>[] = [];
  for (let offset = 0; offset < MAX_ROWS; offset += PAGE * 4) {
    const pages = await Promise.all(
      Array.from({ length: 4 }, (_, page) =>
        sb(`${path}&limit=${PAGE}&offset=${offset + PAGE * page}`, {}, token),
      ),
    );
    for (const page of pages) {
      rows.push(...page);
      if (page.length < PAGE) return rows;
    }
  }
  throw new HttpError(413, "Report is too large. Choose a shorter range.");
}

export async function GET(req: Request) {
  try {
    const { profile, token } = await identity(req);
    admin(profile);
    const query = new URL(req.url).searchParams;
    const format = query.get("format");
    const period = query.get("period") || "day";
    if (
      !format ||
      !["xlsx", "pdf"].includes(format) ||
      !["day", "month", "range"].includes(period)
    )
      throw new HttpError(400, "Choose a valid report format and period.");
    let start = query.get("start") || istDate();
    let end = query.get("end") || start;
    if (period === "month") {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(start))
        throw new HttpError(400, "Invalid report month.");
      start = start.slice(0, 7) + "-01";
      end = new Date(
        Date.UTC(Number(start.slice(0, 4)), Number(start.slice(5, 7)), 0),
      )
        .toISOString()
        .slice(0, 10);
    } else if (period === "day") end = start;
    try {
      dateSections(start, end);
    } catch (error) {
      throw new HttpError(
        400,
        error instanceof Error ? error.message : "Invalid date range.",
      );
    }
    const filters: Record<string, string> = {};
    for (const field of [
      "search",
      "department",
      "block",
      "panchayat",
      "position",
      "status",
      "phase",
    ]) {
      const value = (query.get(field) || "").trim();
      if (value.length > 150)
        throw new HttpError(400, "Report filter is too long.");
      if (value) filters[field] = value;
    }
    if (
      filters.status &&
      !["present", "absent", "leave", "deputation"].includes(filters.status)
    )
      throw new HttpError(400, "Invalid status filter.");
    if (filters.phase && !["draft", "submitted"].includes(filters.phase))
      throw new HttpError(400, "Invalid phase filter.");
    const recordsPath = `/rest/v1/attendance?date=gte.${start}&date=lte.${end}&deleted_at=is.null&select=id,staff_id,date,staff_name,block,department,panchayat,position,status,phase,leave_type,deputation_workplace,absence_reason,time_in,time_out,created_at,version&order=date.asc,staff_id.asc,id.asc`;
    const profilesPath =
      "/rest/v1/profiles?role=eq.staff&select=id,name,phone,block,assignments,role,active,created_at,deleted_at&order=id.asc";
    const [records, profiles, holidays] = await Promise.all([
      allPages(recordsPath, token),
      allPages(profilesPath, token),
      sb(
        `/rest/v1/office_holidays?date=gte.${start}&date=lte.${end}&select=date,reason&order=date.asc`,
        {},
        token,
      ),
    ]);
    const report = makeAttendanceReport({
      profiles,
      records,
      holidays,
      start,
      end,
      today: istDate(),
      filters,
    });
    report.officeLabel =
      profile.role === "block_admin"
        ? `Block office ${profile.block}, Araria`
        : filters.block
          ? `Block office ${filters.block}, Araria`
          : "District Araria";
    const gridCells = report.sections.reduce(
      (count: number, section: { dates: string[]; rows: unknown[] }) =>
        count + section.dates.length * section.rows.length,
      0,
    );
    const includedRecords = report.sections.reduce(
      (count: number, section: { rows: { cells: { record: unknown }[] }[] }) =>
        count +
        section.rows.reduce(
          (sum, row) => sum + row.cells.filter((cell) => cell.record).length,
          0,
        ),
      0,
    );
    if (
      (format === "pdf" && (gridCells > 40000 || includedRecords > 3500)) ||
      (format === "xlsx" && includedRecords > 30000)
    )
      throw new HttpError(
        413,
        "Report is too large. Choose a shorter range or fewer staff.",
      );
    const output: Buffer =
      format === "xlsx"
        ? await renderReportXlsx(report)
        : await renderReportPdf(report);
    if (output.byteLength > MAX_BYTES)
      throw new HttpError(
        413,
        "Report exceeds 4 MB. Choose a shorter range or fewer staff.",
      );
    const filename = `araria-attendance-${start}${end === start ? "" : `-to-${end}`}.${format}`;
    return new Response(new Uint8Array(output), {
      headers: {
        "Content-Type":
          format === "xlsx"
            ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            : "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "private, no-store, max-age=0",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return failure(error);
  }
}

import {
  admin,
  failure,
  HttpError,
  identity,
  sb,
  audit,
} from "../../../../lib/server";
import { requestedBlock } from "../../../../lib/district-scope";
import { istDate } from "../../../../lib/security.mjs";
import {
  dateSections,
  makeAttendanceReport,
} from "../../../../lib/attendance-report.mjs";
import { renderReportXlsx } from "../../../../lib/report-xlsx.mjs";
import { renderReportPdf } from "../../../../lib/report-pdf.mjs";
import { makeLeaveReport } from "../../../../lib/leave-report.mjs";
import { renderLeaveReportPdf } from "../../../../lib/leave-report-pdf.mjs";
import { renderLeaveReportXlsx } from "../../../../lib/leave-report-xlsx.mjs";

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

async function rosterReportRows(token: string, blockId: string | null) {
  const rows = await allPages(
    `/rest/v1/staff_roster?deleted_at=is.null&active=eq.true&linked_profile_id=is.null${blockId ? `&block_id=eq.${blockId}` : ""}&select=id,name,phone,email,gender,assignments,block_id,active,created_at,blocks(name_en)&order=id.asc`,
    token,
  );
  return rows.map((row) => ({
    ...row,
    phone: row.phone || "",
    role: "staff",
    block: (row.blocks as { name_en: string }).name_en,
    deleted_at: null,
  }));
}

export async function GET(req: Request) {
  try {
    const { profile, token } = await identity(req);
    admin(profile);
    const query = new URL(req.url).searchParams;
    const blockId = requestedBlock(profile, query.get("block_id"));
    const blockFilter = blockId ? `&block_id=eq.${blockId}` : "";
    const selectedBlock = blockId
      ? (
          await sb(`/rest/v1/blocks?id=eq.${blockId}&select=name_en`, {}, token)
        )[0]
      : null;
    if (blockId && !selectedBlock) throw new HttpError(400, "Unknown block.");
    const format = query.get("format");
    const kind = query.get("kind") || "attendance";
    const period = query.get("period") || "day";
    if (
      !format ||
      !["xlsx", "pdf"].includes(format) ||
      !["attendance", "leave"].includes(kind) ||
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
    if (kind === "leave") {
      const yearText = query.get("year") || istDate().slice(0, 4);
      const year = Number(yearText);
      if (!/^(20\d\d|2100)$/.test(yearText))
        throw new HttpError(400, "Choose a valid leave report year.");
      const month = query.get("month") || istDate().slice(5, 7);
      if (!/^(0[1-9]|1[0-2])$/.test(month))
        throw new HttpError(400, "Choose a valid leave report month.");
      if (filters.status || filters.phase)
        throw new HttpError(
          400,
          "Attendance status filters do not apply to leave reports.",
        );
      const onlyWithLeave = query.get("leave_only") === "1";
      const first = `${year}-01-01`;
      const last = `${year}-12-31`;
      const [records, profiles, roster] = await Promise.all([
        allPages(
          `/rest/v1/attendance?date=gte.${first}&date=lte.${last}&status=eq.leave&deleted_at=is.null${blockFilter}&select=id,staff_id,date,staff_name,block,block_id,department,panchayat,position,status,leave_type,version&order=date.asc,staff_id.asc,id.asc`,
          token,
        ),
        allPages(
          "/rest/v1/profiles?role=eq.staff" +
            blockFilter +
            "&select=id,name,phone,block,block_id,assignments,gender,role,active,deleted_at&order=id.asc",
          token,
        ),
        rosterReportRows(token, blockId),
      ]);
      const summary = makeLeaveReport({
        profiles: [...profiles, ...roster],
        records,
        year,
        month,
        filters,
        onlyWithLeave,
      });
      const report = {
        ...summary,
        officeLabel: selectedBlock
          ? `Block office ${selectedBlock.name_en}, Araria District`
          : "Araria District",
      };
      if (format === "pdf" && report.rows.length > 3500)
        throw new HttpError(
          413,
          "Leave report is too large. Add staff filters.",
        );
      const output: Buffer =
        format === "xlsx"
          ? await renderLeaveReportXlsx(report)
          : await renderLeaveReportPdf(report);
      if (output.byteLength > MAX_BYTES)
        throw new HttpError(
          413,
          "Leave report exceeds 4 MB. Add staff filters.",
        );
      await audit(
        profile.id,
        "export_leave_report",
        `${year}-${month}`,
        "Report exported",
        null,
        blockId,
      );
      return new Response(new Uint8Array(output), {
        headers: {
          "Content-Type":
            format === "xlsx"
              ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              : "application/pdf",
          "Content-Disposition": `attachment; filename="araria-leave-report-${year}-${month}.${format}"`,
          "Cache-Control": "private, no-store, max-age=0",
          "X-Content-Type-Options": "nosniff",
        },
      });
    }
    const recordsPath = `/rest/v1/attendance?date=gte.${start}&date=lte.${end}&deleted_at=is.null${blockFilter}&select=id,staff_id,date,staff_name,block,block_id,department,panchayat,position,working_places,status,phase,leave_type,deputation_workplace,absence_reason,time_in,time_out,created_at,version&order=date.asc,staff_id.asc,id.asc`;
    const profilesPath =
      "/rest/v1/profiles?role=eq.staff" +
      blockFilter +
      "&select=id,name,phone,secondary_phones,email,block,block_id,assignments,role,active,created_at,deleted_at&order=id.asc";
    const [records, profiles, roster, holidays] = await Promise.all([
      allPages(recordsPath, token),
      allPages(profilesPath, token),
      rosterReportRows(token, blockId),
      sb(
        `/rest/v1/office_holidays?date=gte.${start}&date=lte.${end}${blockId ? `&or=(block_id.is.null,block_id.eq.${blockId})` : ""}&select=date,reason,block_id&order=date.asc`,
        {},
        token,
      ),
    ]);
    const report = makeAttendanceReport({
      profiles: [...profiles, ...roster],
      records,
      holidays,
      start,
      end,
      today: istDate(),
      filters,
    });
    report.officeLabel = selectedBlock
      ? `Block office ${selectedBlock.name_en}, Araria District`
      : "Araria District";
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
    await audit(
      profile.id,
      "export_attendance_report",
      `${start}:${end}`,
      "Report exported",
      null,
      blockId,
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

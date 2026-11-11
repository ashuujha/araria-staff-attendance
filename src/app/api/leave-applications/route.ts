import {
  csrf,
  identity,
  sb,
  json,
  failure,
  HttpError,
  randomUUID,
} from "../../../lib/server";
import { istDate } from "../../../lib/security.mjs";
import {
  MAX_UPLOAD_BYTES,
  readBoundedUpload,
  validateUploadBytes,
  scanIfConfigured,
  sanitizeLeaveJpeg,
} from "../../../lib/file-validation";
import { makeSignedLeavePdf } from "../../../lib/leave-decision-document";

export const runtime = "nodejs";
export const maxDuration = 60;
const fields =
  "id,staff_id,staff_name,block_id,date,panchayat,position,leave_type,leave_detail,status,created_at,decided_at,decided_by,rejection_reason,leave_path,decision_document_path,decision_method,blocks(name_en),decider:profiles!leave_applications_decided_by_fkey(name,role)";

export async function GET(req: Request) {
  try {
    const { profile, token } = await identity(req);
    const query = new URL(req.url).searchParams;
    const history = query.get("view") === "history";
    if (profile.role === "staff") {
      const [rows, leaveUsage] = await Promise.all([
        sb(
          `/rest/v1/leave_applications?staff_id=eq.${profile.id}${history ? "" : `&date=eq.${istDate()}`}&select=${fields}&order=created_at.desc&limit=${history ? 500 : 1}`,
          {},
          token,
        ),
        history
          ? sb(
              `/rest/v1/attendance?staff_id=eq.${profile.id}&status=eq.leave&date=gte.${istDate().slice(0, 4)}-01-01&deleted_at=is.null&select=date,leave_type&order=date.desc&limit=366`,
              {},
              token,
            )
          : Promise.resolve([]),
      ]);
      return json(
        history ? { history: rows, leaveUsage } : { application: rows[0] || null },
      );
    }
    if (profile.role !== "bpro" && profile.role !== "dpro")
      throw new HttpError(403, "Administrator access required.");
    if (query.get("view") === "staff") {
      const applicationId = query.get("id") || "";
      if (!/^[0-9a-f-]{36}$/.test(applicationId))
        throw new HttpError(400, "Invalid leave application.");
      const requests = await sb(
        `/rest/v1/leave_applications?id=eq.${applicationId}&select=id,staff_id,block_id`,
        {},
        token,
      );
      const selected = requests[0];
      if (
        !selected ||
        (profile.role === "bpro" && selected.block_id !== profile.block_id)
      )
        throw new HttpError(403, "This staff member is outside your block.");
      const [people, attendance, leaveHistory, balances] = await Promise.all([
        sb(
          `/rest/v1/profiles?id=eq.${selected.staff_id}&select=id,name,phone,secondary_phones,email,gender,block,block_id,assignments,active`,
          {},
          token,
        ),
        sb(
          `/rest/v1/attendance?staff_id=eq.${selected.staff_id}&deleted_at=is.null&select=date,status,phase,panchayat,position,time_in,time_out,leave_type&order=date.desc&limit=30`,
          {},
          token,
        ),
        sb(
          `/rest/v1/leave_applications?staff_id=eq.${selected.staff_id}&select=id,date,leave_type,leave_detail,status,created_at,decided_at,rejection_reason,decision_document_path&order=created_at.desc&limit=500`,
          {},
          token,
        ),
        sb(
          "/rest/v1/rpc/leave_balance_snapshot",
          { method: "POST", body: "{}" },
          token,
        ),
      ]);
      if (!people[0]) throw new HttpError(404, "Staff profile not found.");
      return json({
        staff: people[0],
        attendance,
        leaveHistory,
        leaveBalance:
          balances?.balances?.find(
            (entry: { staff_id: string }) =>
              entry.staff_id === selected.staff_id,
          ) || null,
        balanceYear: balances?.year || null,
        today: istDate(),
      });
    }
    // RLS enforces BPRO block scope even if a caller changes the URL.
    const requestedBlock = query.get("block_id") || "";
    if (requestedBlock && !/^[0-9a-f-]{36}$/.test(requestedBlock))
      throw new HttpError(400, "Invalid block.");
    const blockFilter =
      profile.role === "bpro"
        ? `&block_id=eq.${profile.block_id}`
        : history && requestedBlock
          ? `&block_id=eq.${requestedBlock}`
          : "";
    const date = query.get("date") || istDate();
    if (history && !/^\d{4}-\d{2}-\d{2}$/.test(date))
      throw new HttpError(400, "Invalid date.");
    const rows = await sb(
      `/rest/v1/leave_applications?${history ? `status=in.(approved,rejected)&date=eq.${date}` : "status=eq.pending"}${blockFilter}&select=${fields}&order=${history ? "decided_at" : "created_at"}.desc&limit=500`,
      {},
      token,
    );
    return json(history ? { history: rows } : { applications: rows });
  } catch (error) {
    return failure(error);
  }
}

export async function POST(req: Request) {
  try {
    csrf(req);
    const { profile, token } = await identity(req);
    if (profile.role !== "bpro" && profile.role !== "dpro")
      throw new HttpError(403, "Administrator access required.");
    if (
      Number(req.headers.get("content-length") || 0) >
      MAX_UPLOAD_BYTES + 1024 * 1024
    )
      throw new HttpError(413, "Decision file must be smaller than 5 MB.");
    const form = await req.formData();
    const id = String(form.get("id") || "");
    const approve = form.get("approve") === "true";
    if (
      !/^[0-9a-f-]{36}$/.test(id) ||
      !["true", "false"].includes(String(form.get("approve")))
    )
      throw new HttpError(400, "Invalid leave decision.");
    const rows = await sb(
      `/rest/v1/leave_applications?id=eq.${id}&status=eq.pending&select=id,staff_id,block_id,date,leave_type,leave_path`,
      {},
      token,
    );
    const request = rows[0];
    if (
      !request ||
      (profile.role === "bpro" && request.block_id !== profile.block_id)
    )
      throw new HttpError(
        403,
        "This leave request is outside your block or is already decided.",
      );
    const reason = String(form.get("reason") || "").trim();
    let decisionPath: string | null = null;
    let stored = false;
    try {
      if (approve) {
        const mode = String(form.get("mode") || "");
        const file = form.get("file");
        if (
          !(file instanceof File) ||
          !file.size ||
          file.size >= MAX_UPLOAD_BYTES ||
          !["drawn", "uploaded"].includes(mode)
        )
          throw new HttpError(
            400,
            "Provide a signed document or drawn signature smaller than 5 MB.",
          );
        const bytes = new Uint8Array(await file.arrayBuffer());
        let document: Uint8Array;
        let type: string;
        if (mode === "drawn") {
          if (
            file.type !== "image/png" ||
            bytes.length > 1024 * 1024 ||
            bytes[0] !== 137 ||
            bytes[1] !== 80 ||
            bytes[2] !== 78 ||
            bytes[3] !== 71
          )
            throw new HttpError(
              400,
              "Draw a valid signature before approving.",
            );
          const originalResponse = await fetch(
            `${process.env.SUPABASE_URL}/storage/v1/object/attendance-private/${request.leave_path}`,
            {
              headers: { apikey: process.env.SUPABASE_SECRET_KEY! },
              signal: AbortSignal.timeout(15000),
            },
          );
          if (!originalResponse.ok)
            throw new HttpError(404, "Original leave application is missing.");
          const original = await readBoundedUpload(originalResponse);
          document = await makeSignedLeavePdf({
            original,
            signature: bytes,
            requestId: id,
            staffId: request.staff_id,
            leaveDate: request.date,
            leaveType: request.leave_type,
            approverRole: profile.role,
            decidedAt: new Date(),
          });
          type = "application/pdf";
        } else {
          type = validateUploadBytes(bytes);
          if (file.type !== type)
            throw new HttpError(400, "Upload a valid JPEG or PDF signed copy.");
          await scanIfConfigured(bytes, type);
          document =
            type === "image/jpeg" ? await sanitizeLeaveJpeg(bytes) : bytes;
        }
        if (document.length >= MAX_UPLOAD_BYTES)
          throw new HttpError(400, "Signed document exceeds 5 MB.");
        decisionPath = `${request.block_id}/${request.staff_id}/leave-decisions/${id}/${randomUUID()}.${type === "application/pdf" ? "pdf" : "jpg"}`;
        const upload = await fetch(
          `${process.env.SUPABASE_URL}/storage/v1/object/attendance-private/${decisionPath}`,
          {
            method: "POST",
            headers: {
              apikey: process.env.SUPABASE_SECRET_KEY!,
              "Content-Type": type,
            },
            body: new Uint8Array(document).buffer,
            signal: AbortSignal.timeout(15000),
          },
        );
        if (!upload.ok)
          throw new HttpError(502, "Signed document could not be stored.");
        stored = true;
        await sb("/rest/v1/leave_decision_documents", {
          method: "POST",
          body: JSON.stringify({
            path: decisionPath,
            request_id: id,
            actor_id: profile.id,
            block_id: request.block_id,
            method: mode,
          }),
        });
      } else if (reason.length < 3 || reason.length > 1000) {
        throw new HttpError(
          400,
          "Give a rejection reason of 3 to 1000 characters.",
        );
      }
      const application = await sb(
        "/rest/v1/rpc/decide_leave_application_v2",
        {
          method: "POST",
          body: JSON.stringify({
            request_id: id,
            approve,
            decision_path: decisionPath,
            reason_text: reason || null,
          }),
        },
        token,
      );
      return json({ application });
    } catch (error) {
      if (stored && decisionPath) {
        // A timed-out RPC may already have committed. Keep the signed copy
        // unless the request is definitely still pending.
        try {
          const current = await sb(
            `/rest/v1/leave_applications?id=eq.${id}&select=status,decision_document_path`,
            {},
            token,
          );
          if (current[0]?.status === "pending")
            await Promise.allSettled([
              sb(
                `/rest/v1/leave_decision_documents?path=eq.${encodeURIComponent(decisionPath)}`,
                { method: "DELETE" },
              ),
              sb("/storage/v1/object/attendance-private", {
                method: "DELETE",
                body: JSON.stringify({ prefixes: [decisionPath] }),
              }),
            ]);
        } catch {
          /* Preserve the private file when commit status is unknown. */
        }
      }
      throw error;
    }
  } catch (error) {
    return failure(error);
  }
}

import {
  csrf,
  identity,
  sb,
  json,
  failure,
  HttpError,
  cookies,
} from "../../../lib/server";
import { istDate } from "../../../lib/security.mjs";
import {
  readBoundedUpload,
  validateUploadBytes,
  scanIfConfigured,
  sanitizeLeaveJpeg,
  sanitizeWorkplacePhoto,
  validateWorkplacePhotoBytes,
} from "../../../lib/file-validation";
import { reserveEvidenceSlot } from "../../../lib/evidence-capacity";
import { requireWorkingDay } from "../../../lib/office-server";
import { PANCHAYATI_RAJ_DEPARTMENT } from "../../../lib/district";
export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(req: Request) {
  const started = performance.now();
  try {
    const { profile, token } = await identity(req);
    const [records, applications] = await Promise.all([
      sb(
        `/rest/v1/attendance?staff_id=eq.${profile.id}&date=eq.${istDate()}&deleted_at=is.null&select=*`,
        {},
        token,
      ),
      profile.role === "staff"
        ? sb(
            `/rest/v1/leave_applications?staff_id=eq.${profile.id}&date=eq.${istDate()}&select=id,date,leave_type,leave_detail,status,created_at,decided_at,panchayat,position,rejection_reason,decision_document_path&order=created_at.desc&limit=1`,
            {},
            token,
          )
        : Promise.resolve([]),
    ]);
    return json(
      {
        records,
        application: applications[0] || null,
      },
      200,
      {
        "Server-Timing": `staff_dashboard;dur=${Math.round(performance.now() - started)}`,
      },
    );
  } catch (e) {
    return failure(e);
  }
}

export async function POST(req: Request) {
  const cleanup: string[] = [];
  let releaseEvidence: (() => void) | undefined;
  try {
    csrf(req);
    if (!req.headers.get("content-type")?.includes("application/json"))
      throw new HttpError(400, "अनुरोध अमान्य।");
    if (Number(req.headers.get("content-length") || 0) > 8192)
      throw new HttpError(413, "अनुरोध बहुत बड़ा है।");
    let body;
    try {
      body = await req.json();
    } catch {
      throw new HttpError(400, "अनुरोध अमान्य।");
    }
    if (!body || typeof body !== "object" || Array.isArray(body))
      throw new HttpError(400, "अनुरोध अमान्य।");
    if (!["save_draft", "complete", "save_status"].includes(body.action))
      throw new HttpError(400, "कार्रवाई अमान्य।");
    if (!cookies(req).araria_session)
      throw new HttpError(401, "कृपया लॉगिन करें।");
    const { profile, token } = await identity(req);
    if (profile.role !== "staff")
      throw new HttpError(403, "केवल कर्मी उपस्थिति दर्ज कर सकते हैं।");
    await requireWorkingDay(profile.block_id);
    const draft = body.action === "save_draft";
    if (body.action !== "complete") {
      for (const key of ["panchayat", "department", "position"]) {
        if (
          typeof body[key] !== "string" ||
          !body[key].trim() ||
          body[key].length > 200
        )
          throw new HttpError(400, "कार्यस्थल, विभाग या पद अमान्य।");
      }
      if (body.department !== PANCHAYATI_RAJ_DEPARTMENT)
        throw new HttpError(403, "Only Panchayati Raj attendance is allowed.");
      if (
        !profile.assignments.some(
          (a) =>
            a.panchayat === body.panchayat &&
            a.position === body.position &&
            a.department === PANCHAYATI_RAJ_DEPARTMENT &&
            (a as typeof a & { block_id?: string }).block_id ===
              profile.block_id,
        )
      )
        throw new HttpError(403, "Workspace is outside your assigned block.");
      if (
        ["deputation", "on_duty"].includes(body.status) &&
        (typeof body.deputation_workplace !== "string" ||
          body.deputation_workplace.trim().length < 2 ||
          body.deputation_workplace.length > 200)
      )
        throw new HttpError(400, "प्रतिनियुक्ति कार्यस्थल का नाम आवश्यक है।");
      if (body.status === "leave" && !["CL", "SL", "MATERNITY", "PATERNITY", "OTHER"].includes(body.leave_type))
        throw new HttpError(400, "CL या SL चुनें।");
      if (body.status === "leave" && (
        (body.leave_type === "SL" || body.leave_type === "MATERNITY") && profile.gender !== "female" ||
        body.leave_type === "PATERNITY" && profile.gender !== "male"
      )) throw new HttpError(403, "This leave type is not available for this staff account.");
      if (body.status === "leave" && ["MATERNITY", "PATERNITY", "OTHER"].includes(body.leave_type) &&
        (typeof body.leave_detail !== "string" || body.leave_detail.trim().length < 3 || body.leave_detail.length > 500))
        throw new HttpError(400, "Enter the leave type/reason (3–500 characters).");
      if (body.status === "on_duty" && (typeof body.absence_reason !== "string" || body.absence_reason.trim().length < 3 || body.absence_reason.length > 1000))
        throw new HttpError(400, "Enter the on-duty reason (3–1000 characters).");
      if (body.status === "leave" && !body.leave_upload_path)
        throw new HttpError(
          400,
          "अवकाश के लिए JPEG/PDF दस्तावेज आवश्यक है (5 MB से छोटी)।",
        );
      if (body.status !== "leave" && body.leave_type != null)
        throw new HttpError(400, "अवकाश प्रकार अमान्य।");
      if (
        !profile.assignments.some(
          (a) =>
            a.panchayat === body.panchayat &&
            a.department === body.department &&
            a.position === body.position,
        ) ||
        !body.department?.trim() ||
        !body.position?.trim()
      )
        throw new HttpError(
          400,
          "पंचायत, विभाग और पद नियुक्ति के अनुसार चुनें।",
        );
      if (
        !["present", "absent", "leave", "deputation", "on_duty"].includes(body.status) ||
        draft !== ["present", "deputation", "on_duty"].includes(body.status)
      )
        throw new HttpError(400, "स्थिति अमान्य।");
      if (draft && !body.photo_upload_path)
        throw new HttpError(
          400,
          "कार्यस्थल की JPEG/PNG फोटो आवश्यक है। / A workplace JPEG/PNG photo is required.",
        );
      if (
        body.status === "absent" &&
        (typeof body.absence_reason !== "string" ||
          body.absence_reason.trim().length < 3 ||
          body.absence_reason.trim().length > 1000)
      )
        throw new HttpError(
          400,
          "अनुपस्थिति का कारण लिखें (3–1000 अक्षर)। / Enter an absence reason (3–1000 characters).",
        );
    }
    // The camera must supply a fresh browser position for arrival drafts.
    const locationProvided =
      body.latitude != null || body.longitude != null || body.accuracy != null;
    if (draft && !locationProvided)
      throw new HttpError(400, "A fresh GPS camera location is required.");
    if (
      locationProvided &&
      (!draft ||
        ![body.latitude, body.longitude, body.accuracy].every(
          (value) => typeof value === "number" && Number.isFinite(value),
        ) ||
        Math.abs(body.latitude) > 90 ||
        Math.abs(body.longitude) > 180 ||
        body.accuracy <= 0 ||
        body.accuracy > 1_000_000)
    )
      throw new HttpError(
        400,
        "कैमरा स्थान अमान्य है। / Camera location is invalid.",
      );
    if (
      body.action === "complete" &&
      (body.leave_upload_path || body.photo_upload_path)
    )
      throw new HttpError(400, "आउट समय के लिए नया दस्तावेज आवश्यक नहीं।");
    if (body.action !== "complete") {
      if (!draft && body.photo_upload_path)
        throw new HttpError(400, "फोटो केवल कार्यस्थल उपस्थिति के लिए है।");
      if (body.status !== "leave" && body.leave_upload_path)
        throw new HttpError(400, "दस्तावेज केवल अवकाश के लिए है।");
      if (body.photo_upload_path || body.leave_upload_path)
        releaseEvidence = await reserveEvidenceSlot();
      for (const [path, isPhoto] of [
        [body.photo_upload_path, true],
        [body.leave_upload_path, false],
      ] as [unknown, boolean][]) {
        if (path == null || path === "") continue;
        if (
          typeof path !== "string" ||
          !path.startsWith(`${profile.block_id}/${profile.id}/${istDate()}/`) ||
          !/^[-a-zA-Z0-9/_.]+$/.test(path)
        )
          throw new HttpError(400, "अपलोड सत्यापन अमान्य।");
        const pending = await sb(
          `/rest/v1/pending_uploads?path=eq.${encodeURIComponent(path)}&staff_id=eq.${profile.id}&block_id=eq.${profile.block_id}&select=*`,
        );
        if (
          !pending[0] ||
          pending[0].consumed ||
          Date.now() > new Date(pending[0].expires_at).getTime()
        )
          throw new HttpError(400, "अपलोड समय सीमा समाप्त। फिर कोशिश करें।");
        cleanup.push(path);
        const stored = await fetch(
          `${process.env.SUPABASE_URL}/storage/v1/object/attendance-private/${path}`,
          {
            headers: { apikey: process.env.SUPABASE_SECRET_KEY! },
            signal: AbortSignal.timeout(15000),
          },
        );
        if (!stored.ok) throw new HttpError(400, "अपलोड पूरा नहीं हुआ।");
        const bytes = await readBoundedUpload(stored);
        const kind = isPhoto
          ? validateWorkplacePhotoBytes(bytes)
          : validateUploadBytes(bytes);
        await scanIfConfigured(bytes, kind);
        let sanitized: Uint8Array | null = null;
        if (isPhoto) sanitized = await sanitizeWorkplacePhoto(bytes);
        else if (kind === "image/jpeg") {
          sanitized = await sanitizeLeaveJpeg(bytes);
        }
        if (sanitized) {
          validateUploadBytes(sanitized, isPhoto);
          const upload = await fetch(
            `${process.env.SUPABASE_URL}/storage/v1/object/attendance-private/${path}`,
            {
              method: "POST",
              headers: {
                apikey: process.env.SUPABASE_SECRET_KEY!,
                "Content-Type": isPhoto ? "image/jpeg" : kind,
                "x-upsert": "true",
              },
              body: new Uint8Array(sanitized).buffer,
              signal: AbortSignal.timeout(15000),
            },
          );
          if (!upload.ok)
            throw new HttpError(502, "फोटो सुरक्षित नहीं हुई। फिर कोशिश करें।");
        }
      }
    }
    releaseEvidence?.();
    releaseEvidence = undefined;
    if (body.status === "leave") {
      const application = await sb(
        "/rest/v1/rpc/submit_leave_application_v2",
        {
          method: "POST",
          body: JSON.stringify({
            panchayat_name: body.panchayat,
            position_name: body.position,
            leave_kind: body.leave_type,
            leave_detail_text: body.leave_detail || null,
            document_path: body.leave_upload_path,
          }),
        },
        token,
      );
      cleanup.length = 0;
      return json({ application });
    }
    const record = await sb("/rest/v1/rpc/save_attendance_with_evidence", {
      method: "POST",
      body: JSON.stringify({
        user_id: profile.id,
        action_name: body.action,
        panchayat_name: body.panchayat ?? null,
        department_name: body.department ?? null,
        position_name: body.position ?? null,
        status_name: body.status ?? null,
        workplace_name: body.deputation_workplace ?? null,
        leave_kind: body.leave_type ?? null,
        device_hash: null,
        photo_path:
          body.action === "save_draft" ? body.photo_upload_path : null,
        leave_path: body.leave_upload_path || null,
        lat: locationProvided ? body.latitude : null,
        lng: locationProvided ? body.longitude : null,
        acc: locationProvided ? body.accuracy : null,
        capture_id: null,
        image_hash: null,
        perceptual_hash: null,
        absence_reason:
          ["absent", "on_duty"].includes(body.status) ? body.absence_reason?.trim() : null,
        request_ip:
          req.headers.get("x-vercel-forwarded-for") ||
          req.headers.get("x-forwarded-for") ||
          null,
        request_agent: req.headers.get("user-agent")?.slice(0, 500) || "",
      }),
    });
    cleanup.length = 0;
    return json({ record });
  } catch (e) {
    releaseEvidence?.();
    releaseEvidence = undefined;
    for (const path of cleanup) {
      const pending = await sb(
        `/rest/v1/pending_uploads?path=eq.${encodeURIComponent(path)}&select=consumed`,
      ).catch(() => null);
      if (pending?.[0]?.consumed === false)
        await sb("/storage/v1/object/attendance-private", {
          method: "DELETE",
          body: JSON.stringify({ prefixes: [path] }),
        }).catch(() => {});
    }
    return failure(e);
  } finally {
    releaseEvidence?.();
  }
}

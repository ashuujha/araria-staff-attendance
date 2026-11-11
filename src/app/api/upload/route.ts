import {
  csrf,
  identity,
  sb,
  json,
  failure,
  HttpError,
  randomUUID,
  cookies,
} from "../../../lib/server";
import {
  MAX_UPLOAD_BYTES,
  validateScannerConfiguration,
} from "../../../lib/file-validation";
import { istDate } from "../../../lib/security.mjs";
import { requireWorkingDay } from "../../../lib/office-server";
export async function POST(req: Request) {
  try {
    csrf(req);
    validateScannerConfiguration();
    if (!req.headers.get("content-type")?.includes("application/json"))
      throw new HttpError(400, "अनुरोध अमान्य।");
    if (Number(req.headers.get("content-length") || 0) > 1024)
      throw new HttpError(413, "अनुरोध बहुत बड़ा है।");
    const b = await req.json();
    if (!b || typeof b !== "object" || Array.isArray(b))
      throw new HttpError(400, "अनुरोध अमान्य।");
    if (
      !["workplace_photo", "departure_photo", "leave_document"].includes(
        b.purpose,
      )
    )
      throw new HttpError(
        400,
        "अपलोड प्रकार अमान्य। / Invalid upload purpose.",
      );
    const workplace =
      b.purpose === "workplace_photo" || b.purpose === "departure_photo";
    if (
      !(
        workplace
          ? ["image/jpeg", "image/png"]
          : ["image/jpeg", "application/pdf"]
      ).includes(b.type) ||
      !Number.isInteger(b.size) ||
      b.size < 20 ||
      b.size >= MAX_UPLOAD_BYTES
    )
      throw new HttpError(
        400,
        "मान्य फ़ाइल चुनें, 5 MB से कम। / Choose a valid file smaller than 5 MB.",
      );
    if (!cookies(req).araria_session)
      throw new HttpError(401, "कृपया लॉगिन करें।");
    const { profile } = await identity(req);
    if (profile.role !== "staff")
      throw new HttpError(403, "केवल कर्मी फोटो अपलोड कर सकते हैं।");
    await requireWorkingDay(profile.block_id);
    // Workplace inputs (including PNG) are normalized to a JPEG before saving.
    const path = `${profile.block_id}/${profile.id}/${istDate()}/${randomUUID()}.${!workplace && b.type === "application/pdf" ? "pdf" : "jpg"}`;
    const [, signed] = await Promise.all([
      sb("/rest/v1/pending_uploads", {
        method: "POST",
        body: JSON.stringify({
          path,
          staff_id: profile.id,
          block_id: profile.block_id,
        }),
      }),
      sb("/storage/v1/object/upload/sign/attendance-private/" + path, {
        method: "POST",
        body: "{}",
      }),
    ]);
    return json({
      path,
      url: process.env.SUPABASE_URL + "/storage/v1" + signed.url,
    });
  } catch (e) {
    return failure(e);
  }
}

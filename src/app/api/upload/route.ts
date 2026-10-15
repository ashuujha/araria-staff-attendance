import {
  csrf,
  identity,
  sb,
  json,
  failure,
  HttpError,
  randomUUID,
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
    const { profile } = await identity(req);
    if (profile.role !== "staff")
      throw new HttpError(403, "केवल कर्मी फोटो अपलोड कर सकते हैं।");
    await requireWorkingDay();
    validateScannerConfiguration();
    const b = await req.json();
    const workplace = b.purpose === "workplace_photo";
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
    // Workplace inputs (including PNG) are normalized to a JPEG before saving.
    const path = `${profile.id}/${istDate()}/${randomUUID()}.${!workplace && b.type === "application/pdf" ? "pdf" : "jpg"}`;
    await sb("/rest/v1/pending_uploads", {
      method: "POST",
      body: JSON.stringify({ path, staff_id: profile.id }),
    });
    const signed = await sb(
      "/storage/v1/object/upload/sign/attendance-private/" + path,
      { method: "POST", body: "{}" },
    );
    return json({
      path,
      url: process.env.SUPABASE_URL + "/storage/v1" + signed.url,
    });
  } catch (e) {
    return failure(e);
  }
}

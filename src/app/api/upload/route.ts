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
export async function POST(req: Request) {
  try {
    csrf(req);
    const { profile } = await identity(req);
    if (profile.role !== "staff")
      throw new HttpError(403, "केवल कर्मी फोटो अपलोड कर सकते हैं।");
    if (!process.env.UPLOAD_SCAN_URL || !process.env.UPLOAD_SCAN_TOKEN)
      throw new HttpError(503, "फ़ाइल सुरक्षा जाँच का सेटअप बाकी है।");
    const b = await req.json();
    if (
      !["image/jpeg", "image/png", "application/pdf"].includes(b.type) ||
      !Number.isInteger(b.size) ||
      b.size < 20 ||
      b.size > 5 * 1024 * 1024
    )
      throw new HttpError(400, "मान्य फ़ाइल चुनें (अधिकतम 5 MB)।");
    const path = `${profile.id}/${istDate()}/${randomUUID()}.${b.type === "application/pdf" ? "pdf" : b.type === "image/png" ? "png" : "jpg"}`;
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

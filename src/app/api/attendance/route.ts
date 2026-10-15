import {
  csrf,
  identity,
  sb,
  json,
  failure,
  HttpError,
  hash,
} from "../../../lib/server";
import { processPhoto } from "../../../lib/photo";
import { istDate, validateLocation, fileKind } from "../../../lib/security.mjs";
import { requireWorkingDay } from "../../../lib/office-server";
export const runtime = "nodejs";
export async function GET(req: Request) {
  try {
    const { profile, token } = await identity(req);
    const records = await sb(
      "/rest/v1/attendance?staff_id=eq." +
        profile.id +
        "&date=eq." +
        istDate() +
        "&deleted_at=is.null&select=*",
      {},
      token,
    );
    return json({ records });
  } catch (e) {
    return failure(e);
  }
}
export async function POST(req: Request) {
  let path: string | null = null;
  try {
    csrf(req);
    const { profile, device } = await identity(req);
    if (profile.role !== "staff")
      throw new HttpError(403, "पंच केवल कर्मी खाते से करें।");
    await requireWorkingDay();
    if (req.headers.get("content-type")?.includes("application/json")) {
      const body = await req.json();
      if (body.action !== "challenge")
        throw new HttpError(400, "अनुरोध अमान्य।");
      const challenges = await sb("/rest/v1/capture_challenges", {
        method: "POST",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify({ staff_id: profile.id, device_hash: device }),
      });
      const c = challenges[0];
      return json({
        id: c.id,
        expires_at: c.expires_at,
        server_time: c.created_at,
      });
    }
    const size = Number(req.headers.get("content-length") || 0);
    if (size > 6 * 1024 * 1024)
      throw new HttpError(413, "फ़ाइल 5 MB से छोटी रखें।");
    const f = await req.formData();
    const action = String(f.get("action"));
    const panchayat = String(f.get("panchayat"));
    if (
      !["in", "out", "leave"].includes(action) ||
      !profile.assignments.some((a) => a.panchayat === panchayat)
    )
      throw new HttpError(400, "पंचायत या कार्रवाई अमान्य है।");
    const uploadPath = String(f.get("upload_path") || "");
    if (
      !uploadPath.startsWith(profile.id + "/" + istDate() + "/") ||
      !/^[-a-zA-Z0-9/_.]+$/.test(uploadPath)
    )
      throw new HttpError(400, "अपलोड सत्यापन अमान्य।");
    const pending = await sb(
      "/rest/v1/pending_uploads?path=eq." +
        encodeURIComponent(uploadPath) +
        "&staff_id=eq." +
        profile.id +
        "&select=*",
    );
    if (
      !pending[0] ||
      pending[0].consumed ||
      Date.now() > new Date(pending[0].expires_at).getTime()
    )
      throw new HttpError(400, "अपलोड समय सीमा समाप्त। फिर कोशिश करें।");
    path = uploadPath;
    const stored = await fetch(
      process.env.SUPABASE_URL +
        "/storage/v1/object/attendance-private/" +
        path,
      {
        headers: { apikey: process.env.SUPABASE_SECRET_KEY! },
        signal: AbortSignal.timeout(15000),
      },
    );
    if (!stored.ok) throw new HttpError(400, "अपलोड पूरा नहीं हुआ।");
    const bytes = new Uint8Array(await stored.arrayBuffer());
    if (bytes.length < 20 || bytes.length > 5 * 1024 * 1024)
      throw new HttpError(400, "फ़ाइल 5 MB से छोटी रखें।");
    const kind = fileKind(bytes);
    if (!kind || (action !== "leave" && kind !== "image/jpeg"))
      throw new HttpError(400, "मान्य GPS JPEG फोटो या अवकाश PDF/JPG/PNG दें।");
    let latitude: number | null = null,
      longitude: number | null = null,
      accuracy: number | null = null,
      challenge: string | null = null;
    if (action !== "leave") {
      latitude = Number(f.get("latitude"));
      longitude = Number(f.get("longitude"));
      accuracy = Number(f.get("accuracy"));
      validateLocation(latitude, longitude, accuracy);
      challenge = String(f.get("challenge"));
      if (!/^[0-9a-f-]{36}$/.test(challenge))
        throw new HttpError(400, "ताज़ा कैमरा सत्यापन आवश्यक है।");
    }
    if (!process.env.UPLOAD_SCAN_URL || !process.env.UPLOAD_SCAN_TOKEN)
      throw new HttpError(
        503,
        "फ़ाइल सुरक्षा जाँच का सेटअप बाकी है। एडमिन से संपर्क करें।",
      );
    const scan = await fetch(process.env.UPLOAD_SCAN_URL, {
      method: "POST",
      headers: {
        Authorization: "Bearer " + process.env.UPLOAD_SCAN_TOKEN,
        "Content-Type": kind,
      },
      body: bytes,
      signal: AbortSignal.timeout(15000),
    });
    if (!scan.ok || (await scan.json()).clean !== true)
      throw new HttpError(400, "फ़ाइल की सुरक्षा जाँच सफल नहीं हुई।");
    let processed: Uint8Array = bytes;
    let perceptualHash: string | null = null;
    if (action !== "leave") {
      const image = await processPhoto(
        bytes,
        latitude!,
        longitude!,
        accuracy!,
        challenge!,
      );
      processed = image.bytes;
      perceptualHash = image.perceptualHash;
    }
    const upload = await fetch(
      `${process.env.SUPABASE_URL}/storage/v1/object/attendance-private/${path}`,
      {
        method: "POST",
        headers: {
          apikey: process.env.SUPABASE_SECRET_KEY!,
          "Content-Type": kind,
          "x-upsert": "true",
        },
        body: new Uint8Array(processed).buffer,
        signal: AbortSignal.timeout(15000),
      },
    );
    if (!upload.ok)
      throw new HttpError(502, "फोटो सुरक्षित नहीं हुई। फिर कोशिश करें।");
    const record = await sb("/rest/v1/rpc/submit_attendance", {
      method: "POST",
      body: JSON.stringify({
        user_id: profile.id,
        action_name: action,
        panchayat_name: panchayat,
        lat: latitude,
        lng: longitude,
        acc: accuracy,
        capture_id: challenge,
        device_hash: device,
        storage_path: path,
        image_hash: action === "leave" ? null : hash(bytes),
        perceptual_hash: perceptualHash,
        request_ip:
          req.headers.get("x-vercel-forwarded-for") ||
          req.headers.get("x-forwarded-for") ||
          null,
        request_agent: req.headers.get("user-agent")?.slice(0, 500) || "",
      }),
    });
    path = null;
    return json({ record });
  } catch (e) {
    if (path) {
      const uploads = await sb(
        "/rest/v1/pending_uploads?path=eq." +
          encodeURIComponent(path) +
          "&select=consumed",
      ).catch(() => null);
      if (uploads?.[0]?.consumed === false)
        await sb("/storage/v1/object/attendance-private", {
          method: "DELETE",
          body: JSON.stringify({ prefixes: [path] }),
        }).catch(() => {});
    }
    return failure(e);
  }
}

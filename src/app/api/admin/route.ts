import {
  csrf,
  identity,
  admin,
  sb,
  json,
  failure,
  HttpError,
} from "../../../lib/server";
import { istDate } from "../../../lib/security.mjs";
export async function GET(req: Request) {
  try {
    const { profile, token } = await identity(req);
    admin(profile);
    const url = new URL(req.url);
    const date = url.searchParams.get("date") || istDate();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date))
      throw new HttpError(400, "तिथि अमान्य।");
    const records = await sb(
      "/rest/v1/attendance?date=eq." +
        date +
        "&select=*,profiles(id,name,phone,assignments,block)&order=time_in.desc",
      {},
      token,
    );
    const staff = await sb(
      "/rest/v1/profiles?active=eq.true&role=eq.staff&select=id,name,phone,assignments",
      {},
      token,
    );
    return json({ records, staff });
  } catch (e) {
    return failure(e);
  }
}
export async function POST(req: Request) {
  try {
    csrf(req);
    const { profile } = await identity(req);
    admin(profile, true);
    const body = await req.json();
    const reason = String(body.reason || "").trim();
    if (reason.length < 10 || reason.length > 1000)
      throw new HttpError(400, "सुधार का स्पष्ट कारण लिखें (10–1000 अक्षर)।");
    if (body.action === "correct") {
      const result = await sb("/rest/v1/rpc/correct_attendance", {
        method: "POST",
        body: JSON.stringify({
          actor_id: profile.id,
          record_id: body.id,
          correction: body.correction,
          reason_text: reason,
        }),
      });
      return json(result);
    }
    if (body.action === "geofence") {
      if (profile.role !== "super_admin")
        throw new HttpError(403, "जियोफेंस बदलने के लिए Super Admin आवश्यक।");
      const lat = Number(body.latitude),
        lng = Number(body.longitude),
        radius = Number(body.radius);
      if (
        ![lat, lng, radius].every(Number.isFinite) ||
        Math.abs(lat) > 90 ||
        Math.abs(lng) > 180 ||
        radius < 50 ||
        radius > 5000
      )
        throw new HttpError(400, "निर्देशांक या दायरा अमान्य।");
      const result = await sb("/rest/v1/rpc/set_geofence", {
        method: "POST",
        body: JSON.stringify({
          actor_id: profile.id,
          panchayat_name: body.panchayat,
          lat,
          lng,
          radius_m: radius,
          reason_text: reason,
        }),
      });
      return json(result);
    }
    throw new HttpError(400, "कार्रवाई अमान्य।");
  } catch (e) {
    return failure(e);
  }
}

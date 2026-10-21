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
    const includeStaff = url.searchParams.get("directory") !== "0";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date))
      throw new HttpError(400, "तिथि अमान्य।");
    const [records, staff, removedStaff, leaveBalances] = await Promise.all([
      sb(
        "/rest/v1/attendance?date=eq." +
          date +
          "&deleted_at=is.null&select=id,staff_id,date,panchayat,department,position,block,staff_name,status,phase,deputation_workplace,leave_type,absence_reason,time_in,time_out,latitude,longitude,accuracy,photo_path,leave_path,working_places,profiles(id,name,phone,email,block,role,active)&order=created_at.desc",
        {},
        token,
      ),
      includeStaff
        ? sb(
            "/rest/v1/profiles?deleted_at=is.null&role=eq.staff&select=id,name,phone,email,assignments,block,role,active,gender&order=name",
            {},
            token,
          )
        : Promise.resolve(undefined),
      includeStaff
        ? sb(
            "/rest/v1/profiles?deleted_at=not.is.null&role=eq.staff&select=id,name,phone,email,assignments,block,role,active,gender,deleted_at&order=name",
            {},
            token,
          )
        : Promise.resolve(undefined),
      sb(
        "/rest/v1/rpc/leave_balance_snapshot",
        { method: "POST", body: "{}" },
        token,
      ),
    ]);
    return json({
      records,
      leaveBalances,
      ...(includeStaff ? { staff, removedStaff } : {}),
    });
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
    if (
      !body ||
      typeof body !== "object" ||
      Array.isArray(body) ||
      !["input", "delete", "correct", "geofence"].includes(body.action)
    )
      throw new HttpError(400, "कार्रवाई अमान्य।");
    const reason = {
      input: "Administrator entered attendance",
      delete: "Administrator removed attendance",
      correct: "Administrator corrected attendance",
      geofence: "Administrator updated workplace geofence",
    }[body.action as "input" | "delete" | "correct" | "geofence"];
    if (body.action === "input") {
      if (
        !/^[0-9a-f-]{36}$/.test(String(body.staff_id)) ||
        !/^\d{4}-\d{2}-\d{2}$/.test(String(body.date)) ||
        !["present", "leave"].includes(body.status)
      )
        throw new HttpError(400, "तिथि, स्थिति या कार्यस्थल अमान्य है।");
      if (body.status === "leave" && !["CL", "SL"].includes(body.leave_type))
        throw new HttpError(400, "CL या SL चुनें।");
      const result = await sb(
        "/rest/v1/rpc/admin_input_attendance_with_leave",
        {
          method: "POST",
          body: JSON.stringify({
            actor_id: profile.id,
            user_id: body.staff_id,
            attendance_date: body.date,
            panchayat_name: body.panchayat,
            status_name: body.status,
            punch_in: body.time_in || null,
            punch_out: body.time_out || null,
            reason_text: reason,
            leave_kind: body.status === "leave" ? body.leave_type : null,
          }),
        },
      );
      return json({ record: result });
    }
    if (body.action === "delete") {
      if (!/^[0-9a-f-]{36}$/.test(String(body.id)))
        throw new HttpError(400, "रिकॉर्ड नहीं मिला।");
      await sb("/rest/v1/rpc/delete_admin_attendance", {
        method: "POST",
        body: JSON.stringify({
          actor_id: profile.id,
          record_id: body.id,
          reason_text: reason,
        }),
      });
      return json({ success: true });
    }
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

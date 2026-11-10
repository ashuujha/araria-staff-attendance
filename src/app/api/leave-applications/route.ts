import {
  csrf,
  identity,
  sb,
  json,
  failure,
  HttpError,
} from "../../../lib/server";
import { istDate } from "../../../lib/security.mjs";

export async function GET(req: Request) {
  try {
    const { profile, token } = await identity(req);
    if (profile.role === "staff") {
      const rows = await sb(
        `/rest/v1/leave_applications?staff_id=eq.${profile.id}&date=eq.${istDate()}&select=id,date,leave_type,status,created_at,decided_at,panchayat,position&order=created_at.desc&limit=1`,
        {},
        token,
      );
      return json({ application: rows[0] || null });
    }
    if (profile.role !== "bpro" && profile.role !== "dpro")
      throw new HttpError(403, "Administrator access required.");
    // RLS enforces BPRO block scope even if a caller changes the URL.
    const blockFilter =
      profile.role === "bpro" ? `&block_id=eq.${profile.block_id}` : "";
    const rows = await sb(
      `/rest/v1/leave_applications?status=eq.pending${blockFilter}&select=id,staff_id,staff_name,block_id,date,panchayat,position,leave_type,created_at,leave_path,blocks(name_en)&order=created_at.desc&limit=500`,
      {},
      token,
    );
    return json({ applications: rows });
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
    const body = await req.json();
    if (
      !body ||
      typeof body !== "object" ||
      Array.isArray(body) ||
      typeof body.id !== "string" ||
      !/^[0-9a-f-]{36}$/.test(body.id) ||
      typeof body.approve !== "boolean"
    )
      throw new HttpError(400, "Invalid leave decision.");
    const application = await sb(
      "/rest/v1/rpc/decide_leave_application",
      {
        method: "POST",
        body: JSON.stringify({ request_id: body.id, approve: body.approve }),
      },
      token,
    );
    return json({ application });
  } catch (error) {
    return failure(error);
  }
}

import { identity, sb, json, failure } from "../../../lib/server";
export async function GET(req: Request) {
  try {
    const { token } = await identity(req);
    return json({
      panchayats: await sb("/rest/v1/panchayats?select=*", {}, token),
    });
  } catch (e) {
    return failure(e);
  }
}

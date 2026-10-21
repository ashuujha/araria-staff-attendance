import { cookies, failure, HttpError, json, sb } from "../../../lib/server";

export async function GET(req: Request) {
  try {
    const token = cookies(req).araria_session;
    if (!token) throw new HttpError(401, "कृपया लॉगिन करें।");
    // The RPC validates auth.uid() and returns only counters in the caller's
    // staff/block/district scope. One upstream request per probe.
    const revisions = await sb(
      "/rest/v1/rpc/portal_changes",
      { method: "POST", body: "{}" },
      token,
    );
    return json(revisions);
  } catch (error) {
    return failure(error);
  }
}

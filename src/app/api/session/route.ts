import { identity, json, failure } from "../../../lib/server";
export async function GET(req: Request) {
  try {
    const { profile } = await identity(req);
    return json({ profile });
  } catch (e) {
    return failure(e);
  }
}

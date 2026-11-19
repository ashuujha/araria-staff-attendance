import { identity, sb, json, failure } from "../../../lib/server";
export async function GET(req: Request) {
  try {
    const { token } = await identity(req);
    return json({
      districts: await sb(
        "/rest/v1/districts?select=name&order=name",
        {},
        token,
      ),
    });
  } catch (error) {
    return failure(error);
  }
}

import { identity, json, failure } from "../../../lib/server";
export async function GET(req: Request) {
  try {
    const started = performance.now();
    const { profile } = await identity(req);
    return json({ profile }, 200, {
      "Server-Timing": `session;dur=${Math.round(performance.now() - started)}`,
    });
  } catch (e) {
    return failure(e);
  }
}

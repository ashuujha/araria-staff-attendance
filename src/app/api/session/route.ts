import {
  identity,
  json,
  failure,
  cookies,
  HttpError,
} from "../../../lib/server";
import { portalBootstrap } from "../../../lib/bootstrap";
export async function GET(req: Request) {
  try {
    const token = cookies(req).araria_session;
    if (!token) throw new HttpError(401, "कृपया लॉगिन करें।");
    const started = performance.now();
    const bootstrap = await portalBootstrap(token);
    if (bootstrap)
      return json({ profile: bootstrap.profile, bootstrap }, 200, {
        "Server-Timing": `bootstrap;dur=${Math.round(performance.now() - started)}`,
      });
    const { profile } = await identity(req);
    return json({ profile });
  } catch (e) {
    return failure(e);
  }
}

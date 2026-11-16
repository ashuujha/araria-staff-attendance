import {
  csrf,
  sessionCookie,
  json,
  failure,
  identity,
  HttpError,
} from "../../../../lib/server";
import { isStaffLogoutLocked } from "../../../../lib/staff-logout-window";
export async function POST(req: Request) {
  try {
    csrf(req);
    try {
      const { profile } = await identity(req);
      if (profile.role === "staff" && isStaffLogoutLocked())
        throw new HttpError(
          403,
          "कर्मी लॉग आउट 3 बजे के बाद कर सकते हैं। / Staff logout is available after 3:00 PM IST.",
          "LOGOUT_LOCKED",
        );
    } catch (error) {
      // Expired or deactivated sessions should still be removable from this browser.
      if (!(
        error instanceof HttpError &&
        [401, 403].includes(error.status) &&
        error.code !== "LOGOUT_LOCKED"
      ))
        throw error;
    }
    return json({ success: true }, 200, {
      "Set-Cookie": sessionCookie("araria_session", "", 0),
    });
  } catch (e) {
    return failure(e);
  }
}

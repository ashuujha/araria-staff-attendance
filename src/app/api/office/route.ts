import {
  identity,
  admin,
  csrf,
  sb,
  json,
  failure,
  HttpError,
} from "../../../lib/server";
import { istDate } from "../../../lib/security.mjs";
import { validOfficeDate } from "../../../lib/office-types";
export async function GET(req: Request) {
  try {
    const { token } = await identity(req);
    const [holidays, notices] = await Promise.all([
      sb("/rest/v1/office_holidays?select=date,reason&order=date", {}, token),
      sb(
        "/rest/v1/office_notices?deleted_at=is.null&select=id,title,body,created_at&order=created_at.desc,id.desc&limit=100",
        {},
        token,
      ),
    ]);
    return json({ holidays, notices, today: istDate() });
  } catch (error) {
    return failure(error);
  }
}
export async function POST(req: Request) {
  try {
    csrf(req);
    const { profile } = await identity(req);
    admin(profile, true);
    if (!req.headers.get("content-type")?.includes("application/json"))
      throw new HttpError(400, "अनुरोध अमान्य।");
    if (Number(req.headers.get("content-length") || 0) > 16000)
      throw new HttpError(413, "अनुरोध बहुत बड़ा है।");
    const body = await req.json();
    if (!body || typeof body !== "object" || Array.isArray(body))
      throw new HttpError(400, "अनुरोध अमान्य।");
    const { action } = body;
    let payload;
    if (action === "set_holiday" || action === "remove_holiday") {
      if (!validOfficeDate(body.date))
        throw new HttpError(400, "मान्य तारीख चुनें। / Choose a valid date.");
      const reason = typeof body.reason === "string" ? body.reason.trim() : "";
      if (
        action === "set_holiday" &&
        (reason.length < 3 || reason.length > 200)
      )
        throw new HttpError(
          400,
          "अवकाश का कारण लिखें (3–200 अक्षर)। / Enter a holiday reason (3–200 characters).",
        );
      payload = { date: body.date, reason };
    } else if (action === "publish_notice") {
      const title = typeof body.title === "string" ? body.title.trim() : "";
      const text = typeof body.body === "string" ? body.body.trim() : "";
      if (
        title.length < 3 ||
        title.length > 150 ||
        text.length < 3 ||
        text.length > 4000
      )
        throw new HttpError(
          400,
          "सूचना का शीर्षक (3–150) और संदेश (3–4000 अक्षर) लिखें। / Enter a notice title and message.",
        );
      payload = { title, body: text };
    } else if (action === "remove_notice") {
      if (
        typeof body.id !== "string" ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
          body.id,
        )
      )
        throw new HttpError(400, "सूचना अमान्य। / Invalid notice.");
      payload = { id: body.id };
    } else throw new HttpError(400, "कार्रवाई अमान्य।");
    const result = await sb("/rest/v1/rpc/manage_office_board", {
      method: "POST",
      body: JSON.stringify({
        actor_id: profile.id,
        action_name: action,
        payload,
      }),
    });
    return json({ success: true, result });
  } catch (error) {
    return failure(error);
  }
}

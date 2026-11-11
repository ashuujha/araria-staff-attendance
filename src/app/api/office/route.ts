import {
  identity,
  admin,
  csrf,
  sb,
  json,
  failure,
  HttpError,
} from "../../../lib/server";
import { requestedBlock } from "../../../lib/district-scope";
import { istDate } from "../../../lib/security.mjs";
import { validOfficeDate } from "../../../lib/office-types";
export async function GET(req: Request) {
  try {
    const { token, profile } = await identity(req);
    const supplied = new URL(req.url).searchParams.get("block_id");
    if (profile.role === "staff" && supplied && supplied !== profile.block_id)
      throw new HttpError(403, "This block is outside your office.");
    const blockId =
      profile.role === "staff"
        ? profile.block_id
        : requestedBlock(profile, supplied);
    const scope = blockId
      ? `&or=(block_id.is.null,block_id.eq.${blockId})`
      : "";
    const today = istDate();
    // Staff need only today's closure. Keep the full calendar for admin views.
    const holidayWindow = profile.role === "staff" ? `&date=eq.${today}` : "";
    const noticeLimit = profile.role === "staff" ? 20 : 100;
    const [holidays, notices] = await Promise.all([
      sb(
        "/rest/v1/office_holidays?select=date,reason,block_id" +
          scope +
          holidayWindow +
          "&order=date",
        {},
        token,
      ),
      sb(
        "/rest/v1/office_notices?deleted_at=is.null" +
          scope +
          `&select=id,title,body,created_at,block_id&order=created_at.desc,id.desc&limit=${noticeLimit}`,
        {},
        token,
      ),
    ]);
    return json({ holidays, notices, today });
  } catch (error) {
    return failure(error);
  }
}
export async function POST(req: Request) {
  try {
    csrf(req);
    const { profile, token } = await identity(req);
    admin(profile, true);
    if (!req.headers.get("content-type")?.includes("application/json"))
      throw new HttpError(400, "अनुरोध अमान्य।");
    if (Number(req.headers.get("content-length") || 0) > 16000)
      throw new HttpError(413, "अनुरोध बहुत बड़ा है।");
    const body = await req.json();
    if (!body || typeof body !== "object" || Array.isArray(body))
      throw new HttpError(400, "अनुरोध अमान्य।");
    const { action } = body;
    const blockId = requestedBlock(profile, body.block_id);
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
      payload = { date: body.date, reason, block_id: blockId };
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
      payload = { title, body: text, block_id: blockId };
    } else if (action === "remove_notice") {
      if (
        typeof body.id !== "string" ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
          body.id,
        )
      )
        throw new HttpError(400, "सूचना अमान्य। / Invalid notice.");
      const rows = await sb(
        `/rest/v1/office_notices?id=eq.${body.id}&select=id,block_id`,
        {},
        token,
      );
      if (
        !rows.length ||
        (profile.role === "bpro" && rows[0].block_id !== profile.block_id)
      )
        throw new HttpError(403, "This notice is outside your block.");
      payload = { id: body.id, block_id: rows[0].block_id };
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

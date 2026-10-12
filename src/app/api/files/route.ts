import { identity, sb, json, failure, HttpError } from "../../../lib/server";
export async function GET(req: Request) {
  try {
    const { token } = await identity(req);
    const url = new URL(req.url);
    const id = url.searchParams.get("id") || "";
    const kind = url.searchParams.get("kind") || "photo_path";
    if (
      !/^[0-9a-f-]{36}$/.test(id) ||
      !["photo_path", "out_photo_path", "leave_path"].includes(kind)
    )
      throw new HttpError(400, "फ़ाइल अनुरोध अमान्य।");
    const records = await sb(
      "/rest/v1/attendance?id=eq." + id + "&select=" + kind,
      {},
      token,
    );
    const path = records?.[0]?.[kind];
    if (!path) throw new HttpError(404, "फ़ाइल नहीं मिली।");
    const signed = await sb(
      "/storage/v1/object/sign/attendance-private/" + path,
      { method: "POST", body: JSON.stringify({ expiresIn: 60 }) },
    );
    return json({
      url: process.env.SUPABASE_URL + "/storage/v1" + signed.signedURL,
      expires_in: 60,
    });
  } catch (e) {
    return failure(e);
  }
}

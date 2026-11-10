import { identity, sb, json, failure, HttpError } from "../../../lib/server";
export async function GET(req: Request) {
  try {
    const { token, profile } = await identity(req);
    const url = new URL(req.url);
    const id = url.searchParams.get("id") || "";
    const kind = url.searchParams.get("kind") || "photo_path";
    if (
      !/^[0-9a-f-]{36}$/.test(id) ||
      ![
        "photo_path",
        "out_photo_path",
        "leave_path",
        "application_leave_path",
        "decision_document_path",
      ].includes(kind)
    )
      throw new HttpError(400, "फ़ाइल अनुरोध अमान्य।");
    const applicationFile =
      kind === "application_leave_path" || kind === "decision_document_path";
    const records = await sb(
      applicationFile
        ? "/rest/v1/leave_applications?id=eq." +
            id +
            `&select=staff_id,block_id,${kind === "application_leave_path" ? "leave_path" : "decision_document_path"}`
        : "/rest/v1/attendance?id=eq." +
            id +
            "&select=staff_id,block_id," +
            kind,
      {},
      token,
    );
    const record = records?.[0];
    if (
      !record ||
      (profile.role === "bpro" && record.block_id !== profile.block_id) ||
      (profile.role === "staff" && record.staff_id !== profile.id)
    )
      throw new HttpError(403, "This file is outside your block.");
    const path =
      record[
        applicationFile && kind === "application_leave_path"
          ? "leave_path"
          : kind
      ];
    if (!path) throw new HttpError(404, "फ़ाइल नहीं मिली।");
    // Signed storage URLs keep full-size images out of function response bodies.
    if (
      typeof path !== "string" ||
      !/^[-a-zA-Z0-9/_.]+$/.test(path) ||
      path.includes("..")
    )
      throw new HttpError(400, "फ़ाइल अनुरोध अमान्य।");
    const modernPrefix = `${record.block_id}/${record.staff_id}/`;
    const legacyPrefix = `${record.staff_id}/`;
    if (!path.startsWith(modernPrefix) && !path.startsWith(legacyPrefix))
      throw new HttpError(403, "This file is outside your block.");
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

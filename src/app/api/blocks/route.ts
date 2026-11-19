import {
  identity,
  sb,
  json,
  failure,
  csrf,
  HttpError,
  audit,
  randomUUID,
} from "../../../lib/server";

export async function GET(req: Request) {
  try {
    const { token, profile } = await identity(req);
    const rows = await sb(
      "/rest/v1/blocks?active=eq.true&select=id,code,name_en,name_hi,district_name&order=name_en.asc",
      {},
      token,
    );
    return json({
      blocks:
        profile.role === "bpro" || profile.role === "staff"
          ? rows.filter((row: { id: string }) => row.id === profile.block_id)
          : rows,
    });
  } catch (error) {
    return failure(error);
  }
}

export async function POST(req: Request) {
  try {
    csrf(req);
    const { profile } = await identity(req);
    if (profile.role !== "dpro")
      throw new HttpError(403, "DPRO access required.");
    const body = await req.json();
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const district =
      typeof body.district_name === "string"
        ? body.district_name.trim()
        : "Araria";
    if (
      name.length < 2 ||
      name.length > 100 ||
      district.length < 2 ||
      district.length > 100
    )
      throw new HttpError(
        400,
        "Enter a district and block name (2–100 characters).",
      );
    await sb("/rest/v1/districts?on_conflict=name", {
      method: "POST",
      headers: { Prefer: "resolution=ignore-duplicates" },
      body: JSON.stringify({ name: district }),
    });
    const existing = await sb(
      `/rest/v1/blocks?name_en=eq.${encodeURIComponent(name)}&select=id,name_en,district_name,active`,
    );
    if (existing.length) {
      if (existing[0].district_name !== district || !existing[0].active)
        throw new HttpError(
          409,
          "This block name is already registered in another district or is inactive.",
        );
      return json({ block: existing[0] });
    }
    const rows = await sb("/rest/v1/blocks?select=id,name_en,district_name", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({
        name_en: name,
        name_hi: name,
        district_name: district,
        code: `custom-${randomUUID()}`,
        active: true,
      }),
    });
    await audit(
      profile.id,
      "add_block",
      rows[0].id,
      "DPRO added a block",
      null,
      rows[0].id,
    );
    return json({ block: rows[0] });
  } catch (error) {
    return failure(error);
  }
}

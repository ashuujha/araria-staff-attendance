import {
  identity,
  admin,
  csrf,
  sb,
  json,
  failure,
  HttpError,
  audit,
} from "../../../lib/server";
import { ownBlock } from "../../../lib/district-scope";
export async function GET(req: Request) {
  try {
    const { token } = await identity(req);
    return json({
      panchayats: await sb(
        "/rest/v1/panchayats?select=name,block,block_id&order=name",
        {},
        token,
      ),
    });
  } catch (e) {
    return failure(e);
  }
}
export async function POST(req: Request) {
  try {
    csrf(req);
    const { profile, token } = await identity(req);
    admin(profile, true);
    const body = await req.json();
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (name.length < 2 || name.length > 200)
      throw new HttpError(400, "Invalid workspace name.");
    const blockId = ownBlock(profile, body.block_id);
    const block = (
      await sb(
        `/rest/v1/blocks?id=eq.${blockId}&active=eq.true&select=id,name_en`,
        {},
        token,
      )
    )[0];
    if (!block) throw new HttpError(400, "Choose an active block.");
    const rows = await sb(
      "/rest/v1/panchayats?on_conflict=block_id,name&select=name,block,block_id",
      {
        method: "POST",
        headers: {
          Prefer: "resolution=merge-duplicates,return=representation",
        },
        body: JSON.stringify({ name, block: block.name_en, block_id: blockId }),
      },
    );
    await audit(
      profile.id,
      "add_workspace",
      name,
      "add_workspace",
      null,
      blockId,
    );
    return json({ workspace: rows[0] });
  } catch (error) {
    return failure(error);
  }
}

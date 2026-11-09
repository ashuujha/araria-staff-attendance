import { identity, sb, json, failure } from "../../../lib/server";

export async function GET(req: Request) {
  try {
    const { token, profile } = await identity(req);
    const rows = await sb(
      "/rest/v1/blocks?active=eq.true&select=id,code,name_en,name_hi&order=name_en.asc",
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

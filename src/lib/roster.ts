import { sb } from "./server";
import type { Profile } from "./types";

export async function rosterRows(
  token: string,
  blockId: string | null,
  removed = false,
): Promise<Profile[]> {
  const rows = await sb(
    `/rest/v1/staff_roster?${removed ? "deleted_at=not.is.null" : "deleted_at=is.null"}&linked_profile_id=is.null${blockId ? `&block_id=eq.${blockId}` : ""}&select=id,name,phone,email,gender,assignments,block_id,active,deleted_at,blocks(name_en)&order=name&limit=1000`,
    {},
    token,
  );
  return rows.map(
    (row: {
      id: string;
      name: string;
      phone: string | null;
      email: string | null;
      gender: Profile["gender"];
      assignments: Profile["assignments"];
      block_id: string;
      active: boolean;
      deleted_at: string | null;
      blocks: { name_en: string };
    }) => ({
      id: row.id,
      name: row.name,
      phone: row.phone || "",
      email: row.email,
      gender: row.gender,
      assignments: row.assignments,
      block_id: row.block_id,
      block: row.blocks.name_en,
      role: "staff" as const,
      active: row.active,
      deleted_at: row.deleted_at,
      roster_only: true,
    }),
  );
}

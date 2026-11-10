import { identity, sb, json, failure, HttpError } from "../../../../lib/server";
import { istDate } from "../../../../lib/security.mjs";

export async function GET(req: Request) {
  try {
    const { profile, token } = await identity(req);
    if (profile.role !== "dpro")
      throw new HttpError(403, "DPRO access required.");
    const date = new URL(req.url).searchParams.get("date") || istDate();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date))
      throw new HttpError(400, "Invalid date.");
    const [blocks, staff, roster, records] = await Promise.all([
      sb(
        "/rest/v1/blocks?active=eq.true&select=id,name_en&order=name_en",
        {},
        token,
      ),
      sb(
        "/rest/v1/profiles?role=eq.staff&active=eq.true&deleted_at=is.null&select=id,block_id&limit=1000",
        {},
        token,
      ),
      sb(
        "/rest/v1/staff_roster?active=eq.true&deleted_at=is.null&linked_profile_id=is.null&select=id,block_id&limit=1000",
        {},
        token,
      ),
      sb(
        `/rest/v1/attendance?date=eq.${date}&deleted_at=is.null&department_archived=eq.false&select=staff_id,block_id,status&limit=1000`,
        {},
        token,
      ),
    ]);
    const summary = blocks.map((block: { id: string; name_en: string }) => {
      const people = [...staff, ...roster].filter(
        (person: { block_id: string }) => person.block_id === block.id,
      );
      const ids = new Set(people.map((person: { id: string }) => person.id));
      const marked = records.filter(
        (row: { staff_id: string; block_id: string }) =>
          row.block_id === block.id && ids.has(row.staff_id),
      );
      const counts: Record<string, number> = {
        present: 0,
        absent: 0,
        leave: 0,
        deputation: 0,
      };
      for (const row of marked) if (row.status in counts) counts[row.status]++;
      return {
        block_id: block.id,
        block: block.name_en,
        staff: people.length,
        ...counts,
        not_marked: Math.max(0, people.length - marked.length),
      };
    });
    return json({ date, summary });
  } catch (error) {
    return failure(error);
  }
}

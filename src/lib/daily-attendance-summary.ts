export type DailyStaff = {
  id: string;
  name: string;
  phone?: string | null;
  block?: string | null;
  block_id: string;
  active: boolean;
  deleted_at?: string | null;
  roster_only?: boolean;
  staff_scope?: string;
  assignments?: { block_id?: string }[];
};

export type DailyRecord = {
  staff_id: string;
  date: string;
  block_id: string;
  status?: string;
  deleted_at?: string | null;
};

export const attendanceCategories = [
  "present",
  "on_duty",
  "deputation",
  "leave",
  "absent",
  "not_marked",
  "other",
] as const;
export type AttendanceCategory = (typeof attendanceCategories)[number];

export function dailyAttendanceBreakdown(
  staff: DailyStaff[],
  records: DailyRecord[],
  date: string,
  blockId?: string,
): Record<AttendanceCategory, number> {
  const people = staff.filter(
    (person) =>
      person.active &&
      !person.deleted_at &&
      (!blockId ||
        person.block_id === blockId ||
        (person.staff_scope === "district" &&
          person.assignments?.some((a) => a.block_id === blockId))),
  );
  const current = new Map(
    records
      .filter(
        (record) =>
          record.date === date &&
          !record.deleted_at &&
          (!blockId || record.block_id === blockId),
      )
      .map((record) => [record.staff_id, record.status]),
  );
  const counts = Object.fromEntries(
    attendanceCategories.map((category) => [category, 0]),
  ) as Record<AttendanceCategory, number>;
  for (const person of people) {
    const status = current.get(person.id);
    const category = !status
      ? "not_marked"
      : attendanceCategories.includes(status as AttendanceCategory) &&
          status !== "not_marked"
        ? (status as AttendanceCategory)
        : "other";
    counts[category]++;
  }
  return counts;
}

export function dailyAttendanceSummary<T extends DailyStaff>(
  staff: T[],
  records: DailyRecord[],
  date: string,
  blockId?: string,
) {
  const people = staff.filter(
    (person) =>
      person.active &&
      !person.deleted_at &&
      (!blockId ||
        person.block_id === blockId ||
        (person.staff_scope === "district" &&
          person.assignments?.some((a) => a.block_id === blockId))),
  );
  const markedIds = new Set(
    records
      .filter(
        (record) =>
          record.date === date &&
          !record.deleted_at &&
          (!blockId || record.block_id === blockId),
      )
      .map((record) => record.staff_id),
  );
  const unmarked = people.filter((person) => !markedIds.has(person.id));
  return {
    total: people.length,
    marked: people.length - unmarked.length,
    unmarked,
  };
}

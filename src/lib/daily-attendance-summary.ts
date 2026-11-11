export type DailyStaff = {
  id: string;
  name: string;
  phone?: string | null;
  block?: string | null;
  block_id: string;
  active: boolean;
  deleted_at?: string | null;
  roster_only?: boolean;
};

export type DailyRecord = {
  staff_id: string;
  date: string;
  block_id: string;
  deleted_at?: string | null;
};

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
      (!blockId || person.block_id === blockId),
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

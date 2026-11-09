export type Holiday = {
  date: string;
  reason: string;
  block_id?: string | null;
};
export type OfficeNotice = {
  id: string;
  title: string;
  body: string;
  created_at: string;
  block_id?: string | null;
};
export type OfficeFeed = {
  holidays: Holiday[];
  notices: OfficeNotice[];
  today: string;
};
export function validOfficeDate(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(value + "T00:00:00Z")) &&
    new Date(value + "T00:00:00Z").toISOString().slice(0, 10) === value
  );
}
export function officeClosure(date: string, holidays: Holiday[]) {
  const holiday = holidays.find((day) => day.date === date);
  const sunday = new Date(date + "T00:00:00Z").getUTCDay() === 0;
  if (holiday)
    return sunday ? `रविवार / Sunday • ${holiday.reason}` : holiday.reason;
  return sunday ? "रविवार / Sunday" : null;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
export const MAX_LEAVE_DATES = 366;

export function validLeaveDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return (
    !Number.isNaN(parsed.valueOf()) &&
    parsed.toISOString().slice(0, 10) === value
  );
}

export function leaveDateRange(from: string, to: string): string[] {
  if (!validLeaveDate(from) || !validLeaveDate(to) || from > to)
    throw new Error("Select a valid leave start and end date.");
  const dates: string[] = [];
  const cursor = new Date(`${from}T00:00:00.000Z`);
  while (cursor.toISOString().slice(0, 10) <= to) {
    if (dates.length === MAX_LEAVE_DATES)
      throw new Error("Choose no more than 366 calendar days per application.");
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}

export function normalizeLeaveDates(value: unknown): string[] {
  if (!Array.isArray(value) || !value.length || value.length > MAX_LEAVE_DATES)
    throw new Error("Select 1 to 366 leave dates.");
  if (value.some((item) => typeof item !== "string" || !validLeaveDate(item)))
    throw new Error("Select valid leave dates from the calendar.");
  const dates = [...new Set(value as string[])].sort();
  if (dates.length !== value.length) throw new Error("Duplicate leave date.");
  if (leaveDateRange(dates[0], dates.at(-1)!).length > MAX_LEAVE_DATES)
    throw new Error("Leave dates must be within a 366-day span.");
  return dates;
}

export function leaveDatesLabel(dates: string[] | undefined, fallback: string) {
  const selected = dates?.length ? dates : [fallback];
  if (selected.length === 1) return formatLeaveDate(selected[0]);
  const continuous = selected.every(
    (date, index) =>
      index === 0 ||
      new Date(`${selected[index - 1]}T00:00:00.000Z`).getTime() + 86400000 ===
        new Date(`${date}T00:00:00.000Z`).getTime(),
  );
  return continuous
    ? `${formatLeaveDate(selected[0])} to ${formatLeaveDate(selected.at(-1)!)} (${selected.length} calendar days)`
    : `${selected.map(formatLeaveDate).join(", ")} (${selected.length} selected dates)`;
}

export function formatLeaveDate(value: string) {
  if (!validLeaveDate(value)) return value;
  const [year, month, day] = value.split("-");
  return `${day}/${month}/${year.slice(-2)}`;
}

import { sb, HttpError } from "./server";
import { istDate } from "./security.mjs";
import { officeClosure, type Holiday } from "./office-types";

export async function requireWorkingDay(date = istDate()) {
  // Sundays never need a database lookup to reject attendance.
  const sunday = officeClosure(date, []);
  if (sunday)
    throw new HttpError(
      409,
      `अवकाश / Holiday (${sunday}). उपस्थिति दर्ज नहीं की जा सकती। / Attendance is closed.`,
    );
  const holidays: Holiday[] = await sb(
    `/rest/v1/office_holidays?date=eq.${date}&select=date,reason`,
  );
  const reason = officeClosure(date, holidays);
  if (reason)
    throw new HttpError(
      409,
      `अवकाश / Holiday (${reason}). उपस्थिति दर्ज नहीं की जा सकती। / Attendance is closed.`,
    );
}

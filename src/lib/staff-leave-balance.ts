import type { LeaveBalance, Profile } from "./types";

export type RecordedLeaveDay = { date: string; leave_type: string | null };

export function staffLeaveBalance(
  profile: Pick<Profile, "id" | "gender">,
  days: RecordedLeaveDay[],
  today: string,
): LeaveBalance {
  const currentYear = days.filter((day) =>
    day.date.startsWith(today.slice(0, 4)),
  );
  const clUsed = currentYear.filter((day) => day.leave_type === "CL").length;
  const slUsed = currentYear.filter((day) => day.leave_type === "SL").length;
  const slMonthUsed = currentYear.filter(
    (day) => day.leave_type === "SL" && day.date.startsWith(today.slice(0, 7)),
  ).length;
  return {
    staff_id: profile.id,
    gender: profile.gender || null,
    cl_used: clUsed,
    cl_left: Math.max(0, 16 - clUsed),
    sl_used: slUsed,
    sl_left: profile.gender === "female" ? Math.max(0, 24 - slUsed) : 0,
    sl_month_used: slMonthUsed,
    sl_month_left:
      profile.gender === "female" ? Math.max(0, 2 - slMonthUsed) : 0,
  };
}

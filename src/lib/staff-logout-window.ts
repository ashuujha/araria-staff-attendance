/** Staff may use the in-app logout action outside office hours (India time). */
export function isStaffLogoutLocked(now: Date = new Date()): boolean {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const hour = Number(parts.find((part) => part.type === "hour")?.value);
  const minute = Number(parts.find((part) => part.type === "minute")?.value);
  const time = hour * 60 + minute;
  return time >= 10 * 60 && time < 15 * 60;
}

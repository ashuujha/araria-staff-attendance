export function arrivalClosed(now = new Date()) {
  const hour = Number(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Kolkata",
      hour: "2-digit",
      hourCycle: "h23",
    }).format(now),
  );
  return hour >= 15;
}

export function attendanceHoursError(action: string, now = new Date()) {
  if (action === "save_draft" && arrivalClosed(now))
    return "आगमन उपस्थिति दोपहर 3 बजे बंद हो जाती है। / Arrival attendance closes at 3 PM IST.";
  if (action === "complete" && !arrivalClosed(now))
    return "आउट समय दोपहर 3 बजे से सहेज सकते हैं। / Checkout is available from 3 PM IST.";
  return null;
}

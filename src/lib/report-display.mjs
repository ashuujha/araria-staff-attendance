const STATUS = {
  P: "Present · Saved",
  PP: "Present · At workplace",
  A: "Absent",
  L: "On leave",
  O: "On duty",
  H: "Holiday",
  W: "Sunday off",
  NR: "Not recorded",
};

export function reportStaffDisplay(row, date) {
  const cell = date
    ? row.cells.find((item) => item.date === date)
    : row.cells.find((item) => item.record) || row.cells[0];
  const record = cell?.record;
  const assignment =
    row.workplaces.find((place) => place.panchayat === record?.panchayat) ||
    row.workplaces[0] ||
    {};
  const panchayat = record?.panchayat || assignment.panchayat || "";
  const block = record?.block || row.block || "";
  const department = record?.department || assignment.department || "";
  const workplace = [panchayat, block].filter(Boolean).join(", ");
  return {
    name: row.name,
    phone: row.phone,
    designation: record?.position || assignment.position || "—",
    workplace: [workplace, department].filter(Boolean).join(" · ") || "—",
    status: STATUS[cell?.code] || "—",
    inTime: reportClock(record?.time_in),
    outTime: reportClock(record?.time_out),
  };
}

function reportClock(value) {
  return value
    ? new Date(value).toLocaleTimeString("en-IN", {
        timeZone: "Asia/Kolkata",
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
      })
    : "—";
}

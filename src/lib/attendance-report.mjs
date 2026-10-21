const DAY = 86400000;

export function parseDay(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    throw new Error("Enter a valid report date.");
  const ms = Date.parse(value + "T00:00:00Z");
  if (!Number.isFinite(ms) || new Date(ms).toISOString().slice(0, 10) !== value)
    throw new Error("Enter a valid report date.");
  return ms;
}

export function dateSections(start, end) {
  const first = parseDay(start),
    last = parseDay(end);
  if (last < first || (last - first) / DAY >= 366)
    throw new Error("Choose a date range of 366 days or less.");
  const groups = [];
  for (let ms = first; ms <= last; ms += DAY) {
    const date = new Date(ms).toISOString().slice(0, 10);
    const month = date.slice(0, 7);
    if (groups.at(-1)?.month !== month) groups.push({ month, dates: [] });
    groups.at(-1).dates.push(date);
  }
  return groups;
}

export function attendanceCode(record, date, today, holidayDates) {
  if (record) {
    if (record.status === "absent") return "A";
    if (record.status === "leave") return "L";
    if (record.phase === "draft" || (record.time_in && !record.time_out))
      return "PP";
    if (record.status === "deputation") return "O";
    return "P";
  }
  if (holidayDates.has(date)) return "H";
  if (new Date(date + "T00:00:00Z").getUTCDay() === 0) return "W";
  if (date < today) return "A";
  if (date === today) return "NR";
  return "";
}

function assignments(profile) {
  return Array.isArray(profile?.assignments) ? profile.assignments : [];
}
function historicalAssignments(history) {
  const snapshot = history.find(
    (row) => Array.isArray(row.working_places) && row.working_places.length,
  );
  if (snapshot) return snapshot.working_places;
  const unique = new Map();
  for (const row of history) {
    if (!row.department && !row.panchayat && !row.position) continue;
    const place = {
      department: row.department || "",
      panchayat: row.panchayat || "",
      position: row.position || "",
    };
    unique.set(JSON.stringify(place), place);
  }
  return [...unique.values()];
}
function istDay(value) {
  return value
    ? new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Kolkata",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date(value))
    : null;
}
function serviceWindow(profile) {
  return {
    joined: istDay(profile?.created_at),
    removed: istDay(profile?.deleted_at),
  };
}
function inService(window, date) {
  return (
    (!window.joined || date >= window.joined) &&
    (!window.removed || date <= window.removed)
  );
}
function matchesText(value, query) {
  return (
    !query ||
    String(value || "")
      .toLocaleLowerCase()
      .includes(query.toLocaleLowerCase())
  );
}
function matchesStaff(profile, records, filters, dates, today, holidayDates) {
  const service = serviceWindow(profile);
  if (
    !matchesText(profile?.name, filters.search) &&
    !matchesText(profile?.phone, filters.search) &&
    !records.some((row) => matchesText(row.staff_name, filters.search))
  )
    return false;
  if (
    filters.block &&
    profile?.block !== filters.block &&
    !records.some((row) => row.block === filters.block)
  )
    return false;
  const fields = ["department", "panchayat", "position"];
  const sameWorkplace = (row) =>
    fields.every((field) => !filters[field] || row[field] === filters[field]);
  if (
    fields.some((field) => filters[field]) &&
    !assignments(profile).some(sameWorkplace) &&
    !records.some(sameWorkplace)
  )
    return false;
  if (filters.status && !records.some((row) => row.status === filters.status)) {
    if (filters.status !== "absent") return false;
    const recorded = new Set(records.map((row) => row.date));
    if (
      !dates.some(
        (date) =>
          inService(service, date) &&
          !recorded.has(date) &&
          attendanceCode(null, date, today, holidayDates) === "A",
      )
    )
      return false;
  }
  if (filters.phase && !records.some((row) => row.phase === filters.phase))
    return false;
  return true;
}

export function makeAttendanceReport({
  profiles,
  records,
  holidays,
  start,
  end,
  today,
  filters = {},
}) {
  const sections = dateSections(start, end);
  parseDay(today);
  const holidayDates = new Set(holidays.map((item) => item.date));
  const allDates = sections.flatMap((section) => section.dates);
  const byId = new Map();
  for (const row of records) {
    if (row.date < start || row.date > end || row.deleted_at) continue;
    const rows = byId.get(row.staff_id) || [];
    rows.push(row);
    byId.set(row.staff_id, rows);
  }
  const current = new Map(profiles.map((profile) => [profile.id, profile]));
  const ids = new Set([
    ...profiles
      .filter(
        (profile) =>
          profile.active && !profile.deleted_at && profile.role === "staff",
      )
      .map((profile) => profile.id),
    ...byId.keys(),
  ]);
  const staff = [...ids]
    .filter((id) => {
      const p = current.get(id);
      const rows = byId.get(id) || [];
      return matchesStaff(
        p || { name: rows[0]?.staff_name, block: rows[0]?.block },
        rows,
        filters,
        allDates,
        today,
        holidayDates,
      );
    })
    .map((id) => {
      const profile = current.get(id);
      const history = (byId.get(id) || []).sort(
        (a, b) =>
          a.date.localeCompare(b.date) ||
          String(a.created_at || "").localeCompare(String(b.created_at || "")),
      );
      const daily = new Map();
      for (const row of history) {
        const existing = daily.get(row.date);
        if (!existing || (row.version || 0) > (existing.version || 0))
          daily.set(row.date, row);
      }
      return {
        id,
        profile,
        history,
        daily,
        workplaces: assignments(profile).length
          ? assignments(profile)
          : historicalAssignments(history),
        service: serviceWindow(profile),
      };
    })
    .sort((a, b) =>
      (a.profile?.name || a.history[0]?.staff_name || "").localeCompare(
        b.profile?.name || b.history[0]?.staff_name || "",
        "hi",
      ),
    );
  return {
    start,
    end,
    today,
    officeLabel: "District Araria",
    holidays,
    sections: sections.map((section) => ({
      ...section,
      rows: staff.map(
        ({ id, profile, history, daily, workplaces, service }) => {
          const inSection = history.filter((r) =>
            section.dates.includes(r.date),
          );
          const first = inSection[0];
          const label =
            (section.dates.length === 1 && section.dates[0] === today
              ? profile?.name
              : first?.staff_name) ||
            profile?.name ||
            history[0]?.staff_name ||
            "Unknown staff";
          const block = first?.block || profile?.block || "";
          const cells = section.dates.map((date) => {
            const record = daily.get(date) || null;
            return {
              date,
              code:
                record || inService(service, date)
                  ? attendanceCode(record, date, today, holidayDates)
                  : "",
              record,
            };
          });
          return {
            id,
            name: label,
            currentName: profile?.name || label,
            phone: profile?.phone || "",
            secondaryPhones: Array.isArray(profile?.secondary_phones)
              ? profile.secondary_phones
              : [],
            email: profile?.email || "",
            block,
            workplaces,
            active: profile
              ? Boolean(profile.active && !profile.deleted_at)
              : null,
            joinedAt: profile?.created_at || "",
            removedAt: profile?.deleted_at || "",
            cells,
          };
        },
      ),
    })),
  };
}

export const STATUS_LEGEND = [
  ["P", "Present"],
  ["PP", "Partial present"],
  ["A", "Absent"],
  ["L", "Leave"],
  ["O", "On duty"],
  ["H", "Holiday"],
  ["W", "Sunday"],
  ["NR", "Not recorded yet"],
];

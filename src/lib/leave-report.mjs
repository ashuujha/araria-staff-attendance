const matches = (value, query) =>
  !query ||
  String(value || "")
    .toLocaleLowerCase()
    .includes(query.toLocaleLowerCase());

export function makeLeaveReport({
  profiles,
  records,
  year,
  month,
  filters = {},
  onlyWithLeave = false,
}) {
  const latest = new Map();
  for (const record of records) {
    if (
      record.deleted_at ||
      record.status !== "leave" ||
      !String(record.date || "").startsWith(`${year}-`)
    )
      continue;
    const key = `${record.staff_id}|${record.date}`;
    const prior = latest.get(key);
    if (!prior || Number(record.version || 0) >= Number(prior.version || 0))
      latest.set(key, record);
  }
  const byStaff = new Map();
  for (const record of latest.values()) {
    const list = byStaff.get(record.staff_id) || [];
    list.push(record);
    byStaff.set(record.staff_id, list);
  }
  const people = new Map(profiles.map((person) => [person.id, person]));
  const ids = new Set([
    ...profiles
      .filter(
        (person) =>
          person.role === "staff" && person.active && !person.deleted_at,
      )
      .map((person) => person.id),
    ...byStaff.keys(),
  ]);
  const rows = [...ids]
    .flatMap((id) => {
      const person = people.get(id);
      const leaves = byStaff.get(id) || [];
      const first = leaves[0] || {};
      const workplaces =
        Array.isArray(person?.assignments) && person.assignments.length
          ? person.assignments
          : leaves.map((record) => ({
              department: record.department,
              panchayat: record.panchayat,
              position: record.position,
            }));
      const assignments = workplaces.length ? workplaces : [{}];
      const sameAssignment = (assignment) =>
        ["department", "panchayat", "position"].every(
          (field) => !filters[field] || assignment[field] === filters[field],
        );
      const name = person?.name || first.staff_name || "Unknown staff";
      const phone = person?.phone || "";
      const block = person?.block || first.block || "";
      if (
        (!matches(name, filters.search) &&
          !matches(phone, filters.search) &&
          !leaves.some((record) =>
            matches(record.staff_name, filters.search),
          )) ||
        (filters.block &&
          block !== filters.block &&
          !leaves.some((record) => record.block === filters.block)) ||
        (!assignments.some(sameAssignment) && !leaves.some(sameAssignment)) ||
        (onlyWithLeave && !leaves.length)
      )
        return [];
      const clTaken = leaves.filter(
        (record) => record.leave_type === "CL",
      ).length;
      const slTaken = leaves.filter(
        (record) => record.leave_type === "SL",
      ).length;
      const slMonthTaken = leaves.filter(
        (record) =>
          record.leave_type === "SL" &&
          String(record.date).slice(5, 7) === String(month).padStart(2, "0"),
      ).length;
      const otherTaken = leaves.length - clTaken - slTaken;
      const gender = person?.gender || null;
      const selected = assignments.find(sameAssignment) || assignments[0];
      const designation = selected.position || first.position || "—";
      const workplace =
        [
          selected.panchayat || first.panchayat,
          selected.department || first.department,
        ]
          .filter(Boolean)
          .join(" · ") || "—";
      return [
        {
          id,
          name,
          phone,
          block,
          designation,
          workplace,
          gender,
          clGranted: 16,
          clTaken,
          clBalance: Math.max(0, 16 - clTaken),
          slGranted: gender === "female" ? 24 : null,
          slTaken,
          slBalance: gender === "female" ? Math.max(0, 24 - slTaken) : null,
          slMonthGranted: gender === "female" ? 2 : null,
          slMonthTaken,
          slMonthBalance:
            gender === "female" ? Math.max(0, 2 - slMonthTaken) : null,
          otherTaken,
        },
      ];
    })
    .sort((a, b) => a.name.localeCompare(b.name, "hi"));
  return { year, month, rows };
}

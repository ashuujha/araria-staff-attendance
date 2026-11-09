// A staff member has one daily record, shared across the assignments at submission time.
export function attendanceAssignments(record, profile) {
  if (Array.isArray(record.working_places) && record.working_places.length)
    return record.working_places;
  if (Array.isArray(profile?.assignments) && profile.assignments.length)
    return profile.assignments;
  return [{ panchayat: record.panchayat, position: "" }];
}
export function matchesWorkplace(row, place) {
  return (
    place === "all" || (row.working_places || [row.panchayat]).includes(place)
  );
}
export function makeAdminRows(records, staff) {
  const time = (value) =>
    value
      ? new Date(value).toLocaleTimeString("en-IN", {
          timeZone: "Asia/Kolkata",
          hour: "2-digit",
          minute: "2-digit",
        })
      : null;
  const active = records.filter((r) => !r.deleted_at);
  const seen = new Set(active.map((r) => r.staff_id));
  return [
    ...active.map((a) => {
      const p = a.profiles || staff.find((p) => p.id === a.staff_id) || {};
      const assignments = attendanceAssignments(a, p);
      const assignment =
        assignments.find((s) => s.panchayat === a.panchayat) || assignments[0];
      return {
        id: a.id,
        staff_id: a.staff_id,
        name: p.name || "",
        phone: p.phone || "",
        panchayat: a.panchayat,
        assignments,
        working_places: [...new Set(assignments.map((s) => s.panchayat))],
        position: assignment.position,
        time_in: time(a.time_in),
        time_out: time(a.time_out),
        raw_time_in: a.time_in,
        raw_time_out: a.time_out,
        date: a.date,
        status: a.status,
        flag:
          a.flags?.filter((flag) => flag !== "admin_entered").join(", ") ||
          null,
        accuracy: a.accuracy || 0,
        origin: a.flags?.includes("admin_entered") ? "admin" : "staff",
      };
    }),
    ...staff
      .filter((p) => p.active !== false && !p.deleted_at && !seen.has(p.id))
      .map((p) => ({
        id: "absent-" + p.id,
        staff_id: p.id,
        name: p.name,
        phone: p.phone || "",
        panchayat: p.assignments[0]?.panchayat || "",
        assignments: p.assignments,
        working_places: [...new Set(p.assignments.map((a) => a.panchayat))],
        position: p.assignments[0]?.position || "",
        time_in: null,
        time_out: null,
        status: "absent",
        flag: null,
        accuracy: 0,
        origin: "staff",
      })),
  ];
}
export function sheetRecordKey(id, place) {
  return id + "|" + place;
}
export function planSheetRows(record, profile, existingIds) {
  const assignments = record.deleted_at
    ? []
    : attendanceAssignments(record, profile);
  const used = new Set();
  let next = existingIds.length + 2;
  const writes = assignments.map((assignment, i) => {
    const key = sheetRecordKey(record.id, assignment.panchayat);
    let index = existingIds.findIndex((row) => row?.[0] === key);
    if (index < 0 && i === 0)
      index = existingIds.findIndex((row) => row?.[0] === record.id);
    const row = index < 0 ? next++ : index + 2;
    used.add(row);
    return { row, key, assignment };
  });
  const clearRows = existingIds.flatMap((row, i) => {
    const key = row?.[0] || "";
    return (key === record.id || key.startsWith(record.id + "|")) &&
      !used.has(i + 2)
      ? [i + 2]
      : [];
  });
  return { writes, clearRows };
}

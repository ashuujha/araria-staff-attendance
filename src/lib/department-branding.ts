// Government of Bihar's shared emblem, not a fabricated department-specific logo.
// Source and verification notes: docs/DEPARTMENT_BRANDING.md.
export const BIHAR_EMBLEM =
  "https://upload.wikimedia.org/wikipedia/commons/e/e9/Seal_of_Bihar.svg";
const departments = [
  ["पंचायती राज विभाग", "पंचायतीराज विभाग", "Panchayati Raj Department"],
  ["कृषि विभाग", "Agriculture Department", "Department of Agriculture"],
  ["ग्रामीण विकास विभाग", "Rural Development Department"],
  ["कल्याण विभाग", "Welfare Department"],
];
const key = (value: string) =>
  value.normalize("NFC").trim().replace(/\s+/g, " ").toLowerCase();
const governmentDepartments = new Set(departments.flat().map(key));
export function departmentBranding(
  assignments: { department: string }[],
  selected = "",
) {
  const names = [
    ...new Set(assignments.map((a) => a.department?.trim()).filter(Boolean)),
  ];
  const matched = names.find((name) => key(name) === key(selected));
  const visible = matched ? [matched] : names;
  return {
    label: visible.join(" • "),
    // A job title such as Data Entry Operator does not identify its employer.
    logo:
      visible.length &&
      visible.every((name) => governmentDepartments.has(key(name)))
        ? BIHAR_EMBLEM
        : null,
  };
}

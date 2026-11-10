import ExcelJS from "exceljs";
import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

const sources = [
  ["araria", "BPRO_ARARIA.xlsx", "Data Base", 6, [2, 3, 4, 5, 6, 7, 8, 9]],
  ["bhargama", "BPRO_BHARGAMA.xlsx", "Bhargama", 6, [2, 3, 4, 5, 6, 7, 8, 9]],
  ["jokihat", "BPRO_JOKIHAT.xlsx", "Sheet11", 3, [2, 3, 4, 5, 6, 7, 8, 9]],
  [
    "kursakanta",
    "BPRO_KURSAKANTA.xlsx",
    "staff list kursakanta",
    3,
    [2, 3, 4, 5, 6, 7, 8, 9],
  ],
  ["palasi", "BPRO_PALASI.xlsx", "Database", 4, [2, 3, 4, 5, 6, 7, 8, 9]],
  ["raniganj", "BPRO_RANIGANJ.xlsx", "RANIGANJ", 5, [2, 3, 5, 6, 7, 8, 9, 10]],
  ["sikti", "BPPRO_SIKTI.xlsx", "PRD Karmi", 3, [2, 3, 4, 5, 6, 7, 8, 9]],
];
const department = "पंचायती राज विभाग";
const blockNames = {
  araria: "अररिया",
  bhargama: "भरगामा",
  jokihat: "जोकीहाट",
  kursakanta: "कुर्साकांटा",
  palasi: "पलासी",
  raniganj: "रानीगंज",
  sikti: "सिकटी",
};
const clean = (value) =>
  String(value ?? "")
    .replace(/\s+/gu, " ")
    .trim();
const key = (value) => clean(value).toLocaleLowerCase("en-IN");
const gender = (value) => {
  const text = key(value);
  if (["female", "महिला", "स्त्री"].includes(text)) return "female";
  if (["male", "पुरूष", "पुरुष", "पुुरूष"].includes(text)) return "male";
  return null;
};
const vacancy = /^(रिक्त|vacant|vacancy|खाली|—|-|na|n\/a)$/iu;
const root = path.resolve(process.cwd(), "../STAFF DETAILS ALL BLOCK");
const rows = [];
const issues = [];
const skipped = {};
for (const [block, file, sheet, start, columns] of sources) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(path.join(root, file));
  const worksheet = workbook.getWorksheet(sheet);
  if (!worksheet) throw Error(`Missing worksheet ${sheet} in ${file}`);
  skipped[block] = { vacancy: 0, otherDepartment: 0, empty: 0 };
  for (let number = start; number <= worksheet.rowCount; number++) {
    const cells = columns.map((column) =>
      clean(worksheet.getRow(number).getCell(column).text),
    );
    const [
      sourceBlock,
      panchayat,
      position,
      dept,
      name,
      rawGender,
      rawPhone,
      email,
    ] = cells;
    if (!name && !position && !panchayat) {
      skipped[block].empty++;
      continue;
    }
    if (key(dept) !== key(department)) {
      skipped[block].otherDepartment++;
      continue;
    }
    if (!name || vacancy.test(name)) {
      skipped[block].vacancy++;
      continue;
    }
    if (key(sourceBlock) !== key(blockNames[block]))
      issues.push({
        block,
        file,
        row: number,
        type: "source_block_mismatch",
        value: sourceBlock,
      });
    const phone = rawPhone.replace(/\D/gu, "");
    if (phone && !/^[6-9]\d{9}$/.test(phone))
      issues.push({
        block,
        file,
        row: number,
        type: "invalid_phone",
        value: rawPhone,
      });
    if (!sourceBlock || !panchayat || !position)
      issues.push({ block, file, row: number, type: "missing_assignment" });
    if (!gender(rawGender))
      issues.push({
        block,
        file,
        row: number,
        type: "unknown_gender",
        value: rawGender,
      });
    rows.push({
      block,
      source_file: file,
      source_row: number,
      name,
      phone: /^[6-9]\d{9}$/.test(phone) ? phone : null,
      email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email)
        ? email.toLowerCase()
        : null,
      gender: gender(rawGender),
      panchayat,
      position,
      source_key: createHash("sha256")
        .update(`${file}:${number}`)
        .digest("hex"),
    });
  }
}
const byPerson = new Map();
for (const row of rows) {
  // Shared office phones occur in these workbooks; a phone alone is not an identity.
  const identity = `${row.block}|${key(row.name)}|${row.phone || "no-phone"}`;
  const existing = byPerson.get(identity);
  if (existing) {
    existing.assignments.push({
      panchayat: row.panchayat,
      position: row.position,
      department,
    });
    existing.source_rows.push(`${row.source_file}:${row.source_row}`);
    if (!existing.email && row.email) existing.email = row.email;
    if (!existing.gender && row.gender) existing.gender = row.gender;
  } else {
    byPerson.set(identity, {
      block: row.block,
      name: row.name,
      phone: row.phone,
      email: row.email,
      gender: row.gender,
      assignments: [
        { panchayat: row.panchayat, position: row.position, department },
      ],
      source_rows: [`${row.source_file}:${row.source_row}`],
      source_key: createHash("sha256").update(identity).digest("hex"),
    });
  }
}
const people = [...byPerson.values()].sort(
  (a, b) => a.block.localeCompare(b.block) || a.name.localeCompare(b.name),
);
const summary = Object.fromEntries(
  sources.map(([block]) => [
    block,
    {
      workbook_rows: rows.filter((row) => row.block === block).length,
      staff: people.filter((person) => person.block === block).length,
      without_phone: people.filter(
        (person) => person.block === block && !person.phone,
      ).length,
      skipped: skipped[block],
    },
  ]),
);
const output = path.resolve(process.cwd(), "private/block-roster-preview.json");
await mkdir(path.dirname(output), { recursive: true });
await writeFile(output, JSON.stringify({ summary, issues, people }, null, 2));
console.log(
  JSON.stringify(
    {
      summary,
      issue_counts:
        Object.groupBy(issues, (issue) => issue.type) &&
        Object.fromEntries(
          Object.entries(Object.groupBy(issues, (issue) => issue.type)).map(
            ([type, found]) => [type, found.length],
          ),
        ),
      output,
    },
    null,
    2,
  ),
);

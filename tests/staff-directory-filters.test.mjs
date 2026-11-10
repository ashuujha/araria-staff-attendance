import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdir } from "node:fs/promises";

await mkdir(".preview", { recursive: true });
await build({
  entryPoints: ["src/lib/staff-directory.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  outfile: ".preview/staff-directory-filters-test.mjs",
});
const { directoryChoices, filterDirectoryStaff, matchingAssignments } =
  await import("../.preview/staff-directory-filters-test.mjs");

const people = [
  {
    id: "1",
    name: "Worker One",
    phone: "9000000000",
    block: "Araria",
    assignments: [
      { panchayat: "Pokharia", position: "Auditor" },
      { panchayat: "Bairgachhi", position: "Panchayat Sachiv" },
    ],
  },
  {
    id: "2",
    name: "Worker Two",
    phone: "9000000000",
    block: "Sikti",
    assignments: [{ panchayat: "Pokharia", position: "Panchayat Sachiv" }],
  },
  {
    id: "3",
    name: "Worker Three",
    phone: "9000000001",
    block: "Araria",
    assignments: [{ panchayat: "Pokharia", position: "Panchayat Sachiv" }],
  },
];
const filters = { block: "Araria", panchayat: "Pokharia", position: "Auditor" };

test("DPRO sees all staff before filtering; block and post stay isolated even for a shared phone", () => {
  assert.equal(
    filterDirectoryStaff(people, "", { block: "", panchayat: "", position: "" })
      .length,
    3,
  );
  assert.deepEqual(
    filterDirectoryStaff(people, "9000000000", filters).map(
      (person) => person.id,
    ),
    ["1"],
  );
  assert.deepEqual(matchingAssignments(people[0], filters), [
    people[0].assignments[0],
  ]);
});

test("panchayat and position choices follow the selected block and panchayat", () => {
  const araria = directoryChoices(people, {
    block: "Araria",
    panchayat: "",
    position: "",
  });
  assert.deepEqual(araria.panchayats, ["Bairgachhi", "Pokharia"]);
  assert.deepEqual(
    directoryChoices(people, {
      block: "Araria",
      panchayat: "Bairgachhi",
      position: "",
    }).positions,
    ["Panchayat Sachiv"],
  );
  assert.deepEqual(
    directoryChoices(people, {
      block: "Sikti",
      panchayat: "Pokharia",
      position: "",
    }).positions,
    ["Panchayat Sachiv"],
  );
});

import type { Assignment, Profile } from "./types";

export type DirectoryFilters = {
  block: string;
  panchayat: string;
  position: string;
};

export function matchingAssignments(
  person: Profile,
  filters: DirectoryFilters,
): Assignment[] {
  if (filters.block && person.block !== filters.block) return [];
  return (person.assignments || []).filter(
    (assignment) =>
      (!filters.panchayat || assignment.panchayat === filters.panchayat) &&
      (!filters.position || assignment.position === filters.position),
  );
}

export function filterDirectoryStaff(
  people: Profile[],
  search: string,
  filters: DirectoryFilters,
): Profile[] {
  const query = search.trim().toLocaleLowerCase();
  return people.filter((person) => {
    if (
      query &&
      !`${person.name} ${person.phone || ""}`
        .toLocaleLowerCase()
        .includes(query)
    )
      return false;
    if (filters.block && person.block !== filters.block) return false;
    return !filters.panchayat && !filters.position
      ? true
      : matchingAssignments(person, filters).length > 0;
  });
}

export function directoryChoices(people: Profile[], filters: DirectoryFilters) {
  const assignments = people
    .filter((person) => !filters.block || person.block === filters.block)
    .flatMap((person) => person.assignments || []);
  const sorted = (values: string[]) =>
    [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b));
  return {
    panchayats: sorted(assignments.map((a) => a.panchayat)),
    positions: sorted(
      assignments
        .filter((a) => !filters.panchayat || a.panchayat === filters.panchayat)
        .map((a) => a.position),
    ),
  };
}

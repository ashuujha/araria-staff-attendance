import { readFileSync, writeFileSync } from "node:fs";

const statePath = process.env.ADMIN_SEED_TEST_STATE;
globalThis.fetch = async (input, init = {}) => {
  const state = JSON.parse(readFileSync(statePath, "utf8"));
  const url = new URL(input);
  const method = init.method || "GET";
  const body = init.body ? JSON.parse(init.body) : null;
  let result;
  if (url.pathname === "/rest/v1/blocks") result = state.blocks;
  else if (url.pathname === "/auth/v1/admin/users" && method === "GET")
    result = { users: state.users };
  else if (url.pathname === "/auth/v1/admin/users" && method === "POST") {
    result = {
      id: `00000000-0000-4000-8000-${String(state.users.length + 1).padStart(12, "0")}`,
      email: body.email,
    };
    state.users.push(result);
  } else if (
    url.pathname.startsWith("/auth/v1/admin/users/") &&
    method === "PUT"
  ) {
    state.rotations++;
    result = {};
  } else if (
    url.pathname === "/rest/v1/profiles" &&
    url.searchParams.has("role")
  )
    result = state.profiles.filter((row) => row.role === "dpro");
  else if (url.pathname === "/rest/v1/profiles" && method === "GET")
    result = state.profiles.filter(
      (row) => row.id === url.searchParams.get("id")?.slice(3),
    );
  else if (url.pathname === "/rest/v1/profiles" && method === "POST") {
    state.profiles.push(body);
    result = [body];
  } else if (url.pathname === "/rest/v1/profiles" && method === "PATCH") {
    const row = state.profiles.find(
      (item) => item.id === url.searchParams.get("id")?.slice(3),
    );
    Object.assign(row, body);
    result = [row];
  } else throw Error(`Unexpected mock ${method} ${url.pathname}`);
  writeFileSync(statePath, JSON.stringify(state));
  return Response.json(result);
};

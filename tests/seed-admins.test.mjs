import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

test("admin seeding creates one DPRO and nine BPROs and is idempotent", async () => {
  await mkdir("private", { recursive: true });
  const dir = await mkdtemp(resolve("private/seed-test-"));
  const configPath = resolve(dir, "admins.json");
  const statePath = resolve(dir, "state.json");
  const names = [
    "Araria",
    "Bhargama",
    "Forbesganj",
    "Jokihat",
    "Kursakanta",
    "Narpatganj",
    "Palasi",
    "Raniganj",
    "Sikti",
  ];
  const config = {
    dpro: {
      name: "District Admin",
      email: "district@example.invalid",
      password: "fixture-password-12345",
    },
    bpros: names.map((block) => ({
      block,
      name: `${block} Officer`,
      email: `${block.toLowerCase()}@example.invalid`,
      password: "fixture-password-12345",
    })),
  };
  const state = {
    blocks: names.map((name_en, index) => ({
      name_en,
      id: `00000000-0000-4000-8000-${String(index + 100).padStart(12, "0")}`,
    })),
    users: [],
    profiles: [],
    rotations: 0,
  };
  await writeFile(configPath, JSON.stringify(config), { mode: 0o600 });
  await writeFile(statePath, JSON.stringify(state), { mode: 0o600 });
  try {
    const args = [
      "--import",
      resolve("tests/helpers/mock-admin-seed.mjs"),
      "scripts/seed-admins.ts",
      "--apply",
      "--config",
      configPath,
    ];
    for (let i = 0; i < 2; i++) {
      const run = spawnSync(process.execPath, args, {
        encoding: "utf8",
        env: {
          ...process.env,
          SUPABASE_URL: "https://fixture.invalid",
          SUPABASE_SECRET_KEY: "fixture-key",
          ADMIN_SEED_TEST_STATE: statePath,
        },
      });
      assert.equal(run.status, 0, run.stderr);
    }
    const result = JSON.parse(await readFile(statePath, "utf8"));
    assert.equal(result.users.length, 10);
    assert.equal(result.profiles.length, 10);
    assert.equal(
      result.profiles.filter((row) => row.role === "dpro").length,
      1,
    );
    assert.equal(
      result.profiles.filter((row) => row.role === "bpro").length,
      9,
    );
    assert.equal(result.rotations, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

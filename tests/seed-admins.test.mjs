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
      password: "Valid@1234",
    },
    bpros: names.map((block) => ({
      block,
      name: `${block} Officer`,
      email: `${block.toLowerCase()}@example.invalid`,
      password: "Valid@1234",
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

test("admin seeding updates the existing DPRO login without creating a second account", async () => {
  await mkdir("private", { recursive: true });
  const dir = await mkdtemp(resolve("private/seed-test-"));
  const configPath = resolve(dir, "admins.json");
  const statePath = resolve(dir, "state.json");
  const blocks = [
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
  const dproId = "00000000-0000-4000-8000-000000000001";
  await writeFile(
    configPath,
    JSON.stringify({
      dpro: {
        name: "DPRO Araria",
        email: "new-dpro@example.invalid",
        password: "Valid@1234",
      },
      bpros: blocks.map((block) => ({
        block,
        name: `BPRO ${block}`,
        email: `${block.toLowerCase()}@example.invalid`,
        password: "Valid@1234",
      })),
    }),
    { mode: 0o600 },
  );
  await writeFile(
    statePath,
    JSON.stringify({
      blocks: blocks.map((name_en, index) => ({
        name_en,
        id: `00000000-0000-4000-8000-${String(index + 100).padStart(12, "0")}`,
      })),
      users: [{ id: dproId, email: "sfc.aditya@gmail.com" }],
      profiles: [
        {
          id: dproId,
          role: "dpro",
          login_email: "sfc.aditya@gmail.com",
          active: true,
        },
      ],
      rotations: 0,
    }),
    { mode: 0o600 },
  );
  try {
    for (let i = 0; i < 2; i++) {
      const run = spawnSync(
        process.execPath,
        [
          "--import",
          resolve("tests/helpers/mock-admin-seed.mjs"),
          "scripts/seed-admins.ts",
          "--apply",
          "--config",
          configPath,
        ],
        {
          encoding: "utf8",
          env: {
            ...process.env,
            SUPABASE_URL: "https://fixture.invalid",
            SUPABASE_SECRET_KEY: "fixture-key",
            ADMIN_SEED_TEST_STATE: statePath,
          },
        },
      );
      assert.equal(run.status, 0, run.stderr);
    }
    const result = JSON.parse(await readFile(statePath, "utf8"));
    assert.equal(result.users.length, 10);
    assert.equal(
      result.profiles.filter((row) => row.role === "dpro").length,
      1,
    );
    assert.equal(
      result.profiles.find((row) => row.id === dproId).login_email,
      "new-dpro@example.invalid",
    );
    assert.equal(result.rotations, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

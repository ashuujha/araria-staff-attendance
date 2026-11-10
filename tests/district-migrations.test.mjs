import test from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { readFile, readdir } from "node:fs/promises";

const db = new PGlite();
await db.exec(
  "create role anon;create role authenticated;create role service_role bypassrls;create schema auth;grant usage on schema auth to authenticated;create schema storage;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);",
);
await db.exec(
  (await readFile("supabase/schema.sql", "utf8")).replace(
    "create extension if not exists pgcrypto;",
    "",
  ),
);
for (const name of (await readdir("supabase/migrations")).sort()) {
  if (name.startsWith("20261109")) continue;
  await db.exec(await readFile("supabase/migrations/" + name, "utf8"));
}
const dpro = "11111111-1111-4111-8111-111111111111";
const bpro = "22222222-2222-4222-8222-222222222222";
const staff = "33333333-3333-4333-8333-333333333333";
for (const [id, role] of [
  [dpro, "super_admin"],
  [bpro, "block_admin"],
  [staff, "staff"],
]) {
  await db.query("insert into auth.users values($1)", [id]);
  await db.query(
    "insert into profiles(id,name,login_email,role) values($1,$2,$3,$4)",
    [id, id, id + "@test.invalid", role],
  );
}
await db.exec("insert into panchayats(name) values('Office');");
await db.query("update profiles set assignments=$1::jsonb where id=$2", [
  JSON.stringify([
    { panchayat: "Office", position: "Staff", department: "पंचायती राज विभाग" },
  ]),
  staff,
]);
await db.exec(
  await readFile("supabase/migrations/20261109_01_blocks_roles.sql", "utf8"),
);
await db.exec(
  await readFile(
    "supabase/migrations/20261109_02_block_visibility.sql",
    "utf8",
  ),
);
await db.exec(
  await readFile(
    "supabase/migrations/20261109_03_block_writes_office.sql",
    "utf8",
  ),
);
await db.exec(
  await readFile(
    "supabase/migrations/20261109_04_district_rpc_roles.sql",
    "utf8",
  ),
);
await db.exec(
  await readFile(
    "supabase/migrations/20261109_05_department_archive.sql",
    "utf8",
  ),
);
await db.exec(
  await readFile("supabase/migrations/20261109_06_login_limits.sql", "utf8"),
);
await db.exec(
  await readFile("supabase/migrations/20261109_07_move_staff.sql", "utf8"),
);
await db.exec(
  await readFile(
    "supabase/migrations/20261109_08_block_workspaces.sql",
    "utf8",
  ),
);

test("block catalog and historical Araria backfill", async () => {
  const blocks = (
    await db.query("select code from blocks order by code")
  ).rows.map((r) => r.code);
  assert.deepEqual(blocks, [
    "araria",
    "bhargama",
    "forbesganj",
    "jokihat",
    "kursakanta",
    "narpatganj",
    "palasi",
    "raniganj",
    "sikti",
  ]);
  const people = (
    await db.query("select role,block_id from profiles order by role")
  ).rows;
  assert.deepEqual(
    people.map((p) => p.role),
    ["bpro", "dpro", "staff"],
  );
  assert.ok(people.every((p) => p.block_id === people[0].block_id));
});

test("BPRO cannot read another block's staff or attendance through RLS", async () => {
  const other = (await db.query("select id from blocks where code='sikti'"))
    .rows[0].id;
  await db.query(
    "update profiles set block_id=$1,block='Sikti',assignments=$2::jsonb where id=$3",
    [
      other,
      JSON.stringify([
        {
          panchayat: "Office",
          position: "Staff",
          department: "पंचायती राज विभाग",
          block_id: other,
        },
      ]),
      staff,
    ],
  );
  await db.exec("set role authenticated");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [bpro]);
  try {
    assert.equal(
      (
        await db.query("select count(*)::int n from profiles where id=$1", [
          staff,
        ])
      ).rows[0].n,
      0,
    );
    assert.equal(
      (
        await db.query(
          "select count(*)::int n from panchayats where block_id=$1",
          [other],
        )
      ).rows[0].n,
      0,
    );
  } finally {
    await db.exec("reset role");
  }
  await db.exec("set role authenticated");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [dpro]);
  try {
    assert.equal(
      (
        await db.query("select count(*)::int n from profiles where id=$1", [
          staff,
        ])
      ).rows[0].n,
      1,
    );
  } finally {
    await db.exec("reset role");
  }
});

test("block and district office visibility, attendance visibility, and write denial", async () => {
  const araria = (await db.query("select id from blocks where code='araria'"))
    .rows[0].id;
  const sikti = (await db.query("select id from blocks where code='sikti'"))
    .rows[0].id;
  await db.query(
    "insert into panchayats(name,block,block_id) values('Office','Sikti',$1)",
    [sikti],
  );
  await db.query(
    "insert into attendance(staff_id,panchayat,date,status,department) values($1,'Office','2026-11-06','present','पंचायती राज विभाग')",
    [staff],
  );
  await db.query(
    "insert into office_holidays(date,reason,block_id,updated_by) values('2026-12-01','District',null,$3),('2026-12-02','Sikti',$1,$3),('2026-12-03','Araria',$2,$3)",
    [sikti, araria, dpro],
  );
  await db.query(
    "insert into office_notices(title,body,created_by,block_id) values('District','All',$1,null),('Sikti','Own',$1,$2),('Araria','Other',$1,$3)",
    [dpro, sikti, araria],
  );
  await db.exec("set role authenticated");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [bpro]);
  try {
    assert.equal(
      (
        await db.query(
          "select count(*)::int n from attendance where staff_id=$1",
          [staff],
        )
      ).rows[0].n,
      0,
    );
    assert.deepEqual(
      (
        await db.query("select reason from office_holidays order by reason")
      ).rows.map((r) => r.reason),
      ["Araria", "District"],
    );
    assert.deepEqual(
      (
        await db.query("select title from office_notices order by title")
      ).rows.map((r) => r.title),
      ["Araria", "District"],
    );
    await assert.rejects(
      db.query("update profiles set name='Tampered' where id=$1", [staff]),
    );
  } finally {
    await db.exec("reset role");
  }
  await db.exec("set role authenticated");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [dpro]);
  try {
    assert.equal(
      (
        await db.query(
          "select count(*)::int n from attendance where staff_id=$1",
          [staff],
        )
      ).rows[0].n,
      1,
    );
    assert.equal(
      (await db.query("select count(*)::int n from office_holidays")).rows[0].n,
      3,
    );
    assert.equal(
      (await db.query("select count(*)::int n from office_notices")).rows[0].n,
      3,
    );
  } finally {
    await db.exec("reset role");
  }
});

test("district migrations can be rerun without duplicating the block catalog or attendance", async () => {
  const before = (await db.query("select count(*)::int n from attendance"))
    .rows[0].n;
  for (const number of [
    "01_blocks_roles",
    "02_block_visibility",
    "03_block_writes_office",
    "04_district_rpc_roles",
    "05_department_archive",
    "06_login_limits",
    "07_move_staff",
    "08_block_workspaces",
  ])
    await db.exec(
      await readFile(`supabase/migrations/20261109_${number}.sql`, "utf8"),
    );
  assert.equal(
    (await db.query("select count(*)::int n from blocks")).rows[0].n,
    9,
  );
  assert.equal(
    (await db.query("select count(*)::int n from attendance")).rows[0].n,
    before,
  );
});

test("district RPC migration tolerates an older attendance function being absent", async () => {
  const existing = (
    await db.query(
      "select p.oid::regprocedure::text as signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='save_attendance_basic' limit 1",
    )
  ).rows[0];
  if (existing) await db.exec(`drop function ${existing.signature}`);
  await db.exec(
    await readFile(
      "supabase/migrations/20261109_04_district_rpc_roles.sql",
      "utf8",
    ),
  );
});

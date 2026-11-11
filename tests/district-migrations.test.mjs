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
  if (name.startsWith("20261109") || name.startsWith("20261110") || name.startsWith("20261111")) continue;
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
await db.exec(
  await readFile("supabase/migrations/20261109_09_block_rosters.sql", "utf8"),
);
await db.exec(
  await readFile("supabase/migrations/20261110_10_leave_approvals.sql", "utf8"),
);
await db.exec(
  await readFile(
    "supabase/migrations/20261110_11_leave_decision_documents.sql",
    "utf8",
  ),
);
await db.exec(
  await readFile("supabase/migrations/20261111_12_staff_status_leave_types.sql", "utf8"),
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

test("BPRO reads only its block roster; DPRO reads both; authenticated writes are denied", async () => {
  const araria = (await db.query("select id from blocks where code='araria'"))
    .rows[0].id;
  const sikti = (await db.query("select id from blocks where code='sikti'"))
    .rows[0].id;
  await db.query(
    "insert into staff_roster(block_id,name) values($1,'Araria Roster'),($2,'Sikti Roster')",
    [araria, sikti],
  );
  await db.exec("set role authenticated");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [bpro]);
  try {
    assert.deepEqual(
      (await db.query("select name from staff_roster order by name")).rows.map(
        (row) => row.name,
      ),
      ["Araria Roster"],
    );
    await assert.rejects(
      db.query(
        "insert into staff_roster(block_id,name) values($1,'Forbidden')",
        [sikti],
      ),
    );
  } finally {
    await db.exec("reset role");
  }
  await db.exec("set role authenticated");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [dpro]);
  try {
    assert.equal(
      (await db.query("select count(*)::int n from staff_roster")).rows[0].n,
      2,
    );
  } finally {
    await db.exec("reset role");
  }
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

test("leave requests stay pending, respect BPRO scope, and become attendance only after approval", async () => {
  const sikti = (await db.query("select id from blocks where code='sikti'"))
    .rows[0].id;
  const today = (
    await db.query(
      "select to_char(now() at time zone 'Asia/Kolkata','YYYY-MM-DD') as d",
    )
  ).rows[0].d;
  const path = `${sikti}/${staff}/${today}/leave.pdf`;
  await db.query(
    "insert into pending_uploads(path,staff_id,block_id) values($1,$2,$3)",
    [path, staff, sikti],
  );
  await db.exec("set role authenticated");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
    staff,
  ]);
  let requestId;
  try {
    const result = await db.query(
      "select submit_leave_application('Office','Staff','CL',$1) as result",
      [path],
    );
    requestId = result.rows[0].result.id;
    assert.equal(result.rows[0].result.status, "pending");
    assert.equal(
      (
        await db.query(
          "select count(*)::int n from attendance where staff_id=$1 and date=$2",
          [staff, today],
        )
      ).rows[0].n,
      0,
    );
    await assert.rejects(
      db.query("select submit_leave_application('Office','Staff','CL',$1)", [
        path,
      ]),
    );
  } finally {
    await db.exec("reset role");
  }
  await db.exec("set role authenticated");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [bpro]);
  try {
    assert.equal(
      (await db.query("select count(*)::int n from leave_applications")).rows[0]
        .n,
      0,
    );
    await assert.rejects(
      db.query("select decide_leave_application_v2($1,true,$2,null)", [
        requestId,
        `${sikti}/${staff}/leave-decisions/${requestId}/signed.pdf`,
      ]),
    );
  } finally {
    await db.exec("reset role");
  }
  await db.exec("set role authenticated");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [dpro]);
  try {
    const signedPath = `${sikti}/${staff}/leave-decisions/${requestId}/signed.pdf`;
    await db.exec("reset role");
    await db.query(
      "insert into leave_decision_documents(path,request_id,actor_id,block_id,method) values($1,$2,$3,$4,'drawn')",
      [signedPath, requestId, dpro, sikti],
    );
    await db.exec("set role authenticated");
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      dpro,
    ]);
    await assert.rejects(
      db.query("select decide_leave_application($1,true)", [requestId]),
    );
    await assert.rejects(
      db.query("select decide_leave_application_v2($1,true,null,null)", [
        requestId,
      ]),
    );
    const approved = await db.query(
      "select decide_leave_application_v2($1,true,$2,null) as result",
      [requestId, signedPath],
    );
    assert.equal(approved.rows[0].result.status, "approved");
    assert.equal(approved.rows[0].result.decision_document_path, signedPath);
    assert.equal(
      (
        await db.query(
          "select count(*)::int n from attendance where staff_id=$1 and date=$2 and status='leave'",
          [staff, today],
        )
      ).rows[0].n,
      1,
    );
    await assert.rejects(
      db.query("select decide_leave_application_v2($1,true,$2,null)", [
        requestId,
        signedPath,
      ]),
    );
  } finally {
    await db.exec("reset role");
  }
});

test("BPRO can reject then approve a corrected request in their block", async () => {
  const araria = (await db.query("select id from blocks where code='araria'"))
    .rows[0].id;
  const today = (
    await db.query(
      "select to_char(now() at time zone 'Asia/Kolkata','YYYY-MM-DD') as d",
    )
  ).rows[0].d;
  const applicant = "44444444-4444-4444-8444-444444444444";
  await db.query("insert into auth.users values($1)", [applicant]);
  await db.query(
    "insert into profiles(id,name,login_email,role,block,block_id,assignments,active) values($1,'Applicant',$2,'staff','Araria',$3,$4::jsonb,true)",
    [
      applicant,
      "applicant@test.invalid",
      araria,
      JSON.stringify([
        {
          panchayat: "Office",
          position: "Staff",
          department: "पंचायती राज विभाग",
          block_id: araria,
        },
      ]),
    ],
  );
  const first = `${araria}/${applicant}/${today}/first.pdf`;
  const second = `${araria}/${applicant}/${today}/second.pdf`;
  await db.query(
    "insert into pending_uploads(path,staff_id,block_id) values($1,$3,$4),($2,$3,$4)",
    [first, second, applicant, araria],
  );
  await db.exec("set role authenticated");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
    applicant,
  ]);
  let firstId;
  try {
    firstId = (
      await db.query(
        "select submit_leave_application('Office','Staff','CL',$1) as result",
        [first],
      )
    ).rows[0].result.id;
  } finally {
    await db.exec("reset role");
  }
  await db.exec("set role authenticated");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [bpro]);
  try {
    await assert.rejects(
      db.query("select decide_leave_application_v2($1,false,null,null)", [
        firstId,
      ]),
    );
    const rejected = await db.query(
      "select decide_leave_application_v2($1,false,null,'Document incomplete') as result",
      [firstId],
    );
    assert.equal(rejected.rows[0].result.status, "rejected");
    assert.equal(
      rejected.rows[0].result.rejection_reason,
      "Document incomplete",
    );
    assert.equal(
      (
        await db.query(
          "select count(*)::int n from attendance where staff_id=$1 and date=$2",
          [applicant, today],
        )
      ).rows[0].n,
      0,
    );
  } finally {
    await db.exec("reset role");
  }
  await db.exec("set role authenticated");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
    applicant,
  ]);
  let secondId;
  try {
    secondId = (
      await db.query(
        "select submit_leave_application('Office','Staff','CL',$1) as result",
        [second],
      )
    ).rows[0].result.id;
  } finally {
    await db.exec("reset role");
  }
  await db.exec("set role authenticated");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [bpro]);
  try {
    const signedPath = `${araria}/${applicant}/leave-decisions/${secondId}/signed.pdf`;
    await db.exec("reset role");
    await db.query(
      "insert into leave_decision_documents(path,request_id,actor_id,block_id,method) values($1,$2,$3,$4,'uploaded')",
      [signedPath, secondId, bpro, araria],
    );
    await db.exec("set role authenticated");
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      bpro,
    ]);
    const approved = await db.query(
      "select decide_leave_application_v2($1,true,$2,null) as result",
      [secondId, signedPath],
    );
    assert.equal(approved.rows[0].result.status, "approved");
    assert.equal(
      (
        await db.query(
          "select count(*)::int n from attendance where staff_id=$1 and date=$2 and status='leave'",
          [applicant, today],
        )
      ).rows[0].n,
      1,
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
    "09_block_rosters",
  ])
    await db.exec(
      await readFile(`supabase/migrations/20261109_${number}.sql`, "utf8"),
    );
  await db.exec(
    await readFile(
      "supabase/migrations/20261110_11_leave_decision_documents.sql",
      "utf8",
    ),
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
  await db.exec(await readFile("supabase/migrations/20261111_12_staff_status_leave_types.sql", "utf8"));
});

test("On Duty requires a reason and stores a GPS arrival draft", async () => {
  const actor = "66666666-6666-4666-8666-666666666666";
  const today = (await db.query("select (now() at time zone 'Asia/Kolkata')::date::text d")).rows[0].d;
  const block = (await db.query("select block_id from profiles where id=$1", [staff])).rows[0].block_id;
  await db.query("insert into auth.users values($1)", [actor]);
  await db.query("insert into profiles(id,name,phone,login_email,role,block,block_id,assignments) select $1,'On Duty Test','9000000066','duty@test.invalid','staff',block,block_id,assignments from profiles where id=$2", [actor, staff]);
  const path = `${block}/${actor}/${today}/duty.jpg`;
  await db.query("insert into pending_uploads(path,staff_id,block_id) values($1,$2,$3)", [path, actor, block]);
  await db.exec("set role authenticated");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [actor]);
  const args = [actor, "save_draft", "Office", "पंचायती राज विभाग", "Staff", "on_duty", "District office", null, null, path, null, 26, 87, 20, null, null, null, null, null];
  try {
    await assert.rejects(db.query(`select save_attendance_with_evidence(${args.map((_, i) => `$${i + 1}`).join(",")},$20)`, [...args, null]), /कारण/);
    const saved = (await db.query(`select save_attendance_with_evidence(${args.map((_, i) => `$${i + 1}`).join(",")},$20) as row`, [...args, "District review"])).rows[0].row;
    assert.equal(saved.status, "on_duty");
    assert.equal(saved.phase, "draft");
    assert.equal(saved.absence_reason, "District review");
    assert.equal(saved.deputation_workplace, "District office");
    assert.ok(saved.time_in);
  } finally { await db.exec("reset role"); }
});

test("new leave types enforce gender and preserve the supplied reason", async () => {
  const actor = "77777777-7777-4777-8777-777777777777";
  const today = (await db.query("select (now() at time zone 'Asia/Kolkata')::date::text d")).rows[0].d;
  const block = (await db.query("select block_id from profiles where id=$1", [staff])).rows[0].block_id;
  await db.query("insert into auth.users values($1)", [actor]);
  await db.query("insert into profiles(id,name,phone,login_email,role,block,block_id,assignments,gender) select $1,'Leave Test','9000000077','leave@test.invalid','staff',block,block_id,assignments,'female' from profiles where id=$2", [actor, staff]);
  const path = `${block}/${actor}/${today}/leave.pdf`;
  await db.query("insert into pending_uploads(path,staff_id,block_id) values($1,$2,$3)", [path, actor, block]);
  await db.exec("set role authenticated");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [actor]);
  try {
    await assert.rejects(db.query("select submit_leave_application_v2('Office','Staff','PATERNITY',$1,'Family care')", [path]), /Paternity/);
    await assert.rejects(db.query("select submit_leave_application_v2('Office','Staff','MATERNITY',$1,'')", [path]), /reason/);
    const saved = (await db.query("select submit_leave_application_v2('Office','Staff','MATERNITY',$1,'Maternity care') as row", [path])).rows[0].row;
    assert.equal(saved.leave_type, "MATERNITY");
    assert.equal(saved.leave_detail, "Maternity care");
    assert.equal(saved.status, "pending");
  } finally { await db.exec("reset role"); }
});

test("staff cannot retrieve remaining leave balances through the RPC", async () => {
  await db.exec("set role authenticated");
  try {
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [staff]);
    const own = (await db.query("select leave_balance_snapshot() as value")).rows[0].value;
    assert.deepEqual(own.balances, []);
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [dpro]);
    const district = (await db.query("select leave_balance_snapshot() as value")).rows[0].value;
    assert.ok(district.balances.length > 0);
  } finally { await db.exec("reset role"); }
});

test("Araria BPRO and DPRO retain access to attendance from an archived Araria staff account", async () => {
  const former = "88888888-8888-4888-8888-888888888888";
  const araria = (await db.query("select id from blocks where code='araria'")).rows[0].id;
  await db.query("insert into auth.users values($1)", [former]);
  await db.query("insert into profiles(id,name,phone,login_email,role,block,block_id,assignments) values($1,'Former Araria Staff','9000000088','former@test.invalid','staff','Araria',$2,'[]')", [former, araria]);
  await db.query("insert into attendance(staff_id,panchayat,date,status,department,block,block_id,staff_name) values($1,'Office','2026-01-06','present','पंचायती राज विभाग','Araria',$2,'Former Araria Staff')", [former, araria]);
  await db.query("update profiles set active=false,deleted_at=now() where id=$1", [former]);
  for (const viewer of [bpro, dpro]) {
    await db.exec("set role authenticated");
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [viewer]);
    try {
      const rows = (await db.query("select staff_name,block_id from attendance where staff_id=$1 and date='2026-01-06'", [former])).rows;
      assert.equal(rows.length, 1);
      assert.equal(rows[0].staff_name, "Former Araria Staff");
      assert.equal(rows[0].block_id, araria);
    } finally { await db.exec("reset role"); }
  }
});

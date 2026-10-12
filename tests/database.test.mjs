import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
const db = new PGlite();
const user = "11111111-1111-4111-8111-111111111111";
const admin = "22222222-2222-4222-8222-222222222222";
const other = "33333333-3333-4333-8333-333333333333";
await db.exec(
  `create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create schema storage;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);`,
);
await db.exec(
  (await readFile("supabase/schema.sql", "utf8")).replace(
    "create extension if not exists pgcrypto;",
    "",
  ),
);
await db.exec(
  await readFile(
    "supabase/migrations/20261012_master_data_shared_attendance.sql",
    "utf8",
  ),
);
await db.query("insert into auth.users(id) values($1),($2),($3)", [
  user,
  admin,
  other,
]);
await db.query(
  `insert into profiles(id,name,phone,login_email,role,device_hash,assignments) values($1,'Staff','9000000001','staff@example.test','staff','device', '[{"panchayat":"Test","position":"Staff","department":"Office"},{"panchayat":"Test Two","position":"Staff","department":"Office"}]'),($2,'Admin',null,'admin@example.test','super_admin',null,'[]'),($3,'Other','9000000002','other@example.test','staff','other-device','[]')`,
  [user, admin, other],
);
await db.exec(
  "insert into panchayats(name,latitude,longitude) values('Test',26.15,87.46),('Test Two',27,88);",
);
async function challenge() {
  return (
    await db.query(
      "insert into capture_challenges(staff_id,device_hash) values($1,$2) returning id",
      [user, "device"],
    )
  ).rows[0].id;
}
async function submit(action, lat, lng, acc, capture, hash = "unique-photo") {
  return db.query(
    `select submit_attendance($1,$2,'Test',$3,$4,$5,$6,'device',$7,$8,null,'test') as record`,
    [
      user,
      action,
      lat,
      lng,
      acc,
      capture,
      `${user}/${new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date())}/test.jpg`,
      hash,
    ],
  );
}
test("SQL blocks low accuracy and out-of-geofence without recording attendance", async () => {
  const c = await challenge();
  await assert.rejects(submit("in", 26.15, 87.46, 100, c), /सटीकता/);
  await assert.rejects(submit("in", 27, 88, 20, c), /दायरे/);
  assert.equal(
    (await db.query("select count(*) as n from attendance")).rows[0].n,
    0,
  );
});
test("SQL refuses stale capture and out before in", async () => {
  const c = await challenge();
  await db.query(
    "update capture_challenges set expires_at=now()-interval '1 second' where id=$1",
    [c],
  );
  await assert.rejects(submit("in", 26.15, 87.46, 10, c), /सत्यापन समाप्त/);
  await assert.rejects(submit("out", 26.15, 87.46, 10, c), /पंच आउट से पहले/);
});
test("atomic punch prevents racing duplicate punches and creates durable sync job", async () => {
  const c = await challenge();
  const results = await Promise.allSettled([
    submit("in", 26.15, 87.46, 10, c),
    submit("in", 26.15, 87.46, 10, c),
  ]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(
    (await db.query("select count(*) as n from attendance")).rows[0].n,
    1,
  );
  assert.equal(
    (await db.query("select count(*) as n from sync_jobs")).rows[0].n,
    1,
  );
});
test("photo reuse is rejected and punch out updates the same record", async () => {
  const c = await challenge();
  await assert.rejects(submit("out", 26.15, 87.46, 10, c), /फोटो का पहले/);
  await submit("out", 26.15, 87.46, 10, c, "fresh-out-photo");
  await assert.rejects(
    submit("out", 26.15, 87.46, 10, await challenge(), "third-photo"),
    /दोबारा पंच आउट/,
  );
  assert.equal(
    (await db.query("select count(*) as n from attendance")).rows[0].n,
    1,
  );
  assert.equal(
    (await db.query("select version from sync_jobs")).rows[0].version,
    2,
  );
});
test("device binding rejects a different browser", async () => {
  await assert.rejects(
    db.query("select bind_device($1,$2)", [user, "another-device"]),
    /दूसरे डिवाइस/,
  );
});
test("correction requires reason and records old/new values atomically", async () => {
  const id = (await db.query("select id from attendance")).rows[0].id;
  await assert.rejects(
    db.query("select correct_attendance($1,$2,'{}','no')", [admin, id]),
    /कारण/,
  );
  await db.query(
    "select correct_attendance($1,$2,'{}','Verified original attendance')",
    [admin, id],
  );
  assert.equal(
    (await db.query("select count(*) as n from audit_logs")).rows[0].n,
    1,
  );
});
test("RLS prevents staff reading another staff attendance or changing roles", async () => {
  await db.exec(
    `grant usage on schema auth to authenticated;set role authenticated;set request.jwt.claim.sub='${other}';`,
  );
  assert.equal(
    (await db.query("select count(*) as n from attendance")).rows[0].n,
    0,
  );
  await assert.rejects(
    db.query("update profiles set role='super_admin' where id=$1", [other]),
    /permission denied/,
  );
  await assert.rejects(
    db.query("select device_hash from profiles"),
    /permission denied/,
  );
  await assert.rejects(
    db.query("select bind_device($1,'bypass')", [other]),
    /permission denied/,
  );
  await db.exec("reset role;");
});
test("queue retry preserves pending attendance and backs off", async () => {
  const job = (await db.query("select claim_sync_job() as job")).rows[0].job;
  assert.ok(job.record_id);
  await db.query("select finish_sync_job($1,$2,'Google offline')", [
    job.record_id,
    job.version,
  ]);
  const r = (await db.query("select * from sync_jobs")).rows[0];
  assert.equal(r.state, "pending");
  assert.equal(r.attempts, 1);
  assert.equal(r.last_error, "Google offline");
  assert.equal(
    (await db.query("select count(*) as n from attendance")).rows[0].n,
    1,
  );
});

const created = "44444444-4444-4444-8444-444444444444";
const workplaces = [
  { panchayat: "Test", position: "Secretary", department: "Office" },
  { panchayat: "Test Two", position: "Secretary", department: "Office" },
];
let manualId;
const manualDate = (
  await db.query(
    "select ((now() at time zone 'Asia/Kolkata')::date-1)::text as day",
  )
).rows[0].day;
test("one staff punch snapshots all working places without duplicate daily records", async () => {
  const a = (
    await db.query("select * from attendance where staff_id=$1", [user])
  ).rows[0];
  assert.equal(a.working_places.length, 2);
  assert.equal(a.working_places[1].panchayat, "Test Two");
  assert.equal(
    (
      await db.query("select count(*) as n from attendance where staff_id=$1", [
        user,
      ])
    ).rows[0].n,
    1,
  );
});
test("admin creates master staff and rejects duplicate phones and staff-role access", async () => {
  await db.query("insert into auth.users(id) values($1)", [created]);
  await assert.rejects(
    db.query("select create_master_staff($1,$2,$3,$4,$5,$6,$7,$8,$9)", [
      other,
      created,
      "New Staff",
      "9000000003",
      "",
      "new@example.test",
      "Araria",
      JSON.stringify(workplaces),
      "Authorized master entry",
    ]),
    /अनुमति/,
  );
  const result = await db.query(
    "select create_master_staff($1,$2,$3,$4,$5,$6,$7,$8,$9) as staff",
    [
      admin,
      created,
      "New Staff",
      "9000000003",
      "",
      "new@example.test",
      "Araria",
      JSON.stringify(workplaces),
      "Authorized master entry",
    ],
  );
  assert.equal(result.rows[0].staff.assignments.length, 2);
  await assert.rejects(
    db.query("select create_master_staff($1,$2,$3,$4,$5,$6,$7,$8,$9)", [
      admin,
      created,
      "Duplicate",
      "9000000003",
      "",
      "new@example.test",
      "Araria",
      JSON.stringify(workplaces),
      "Duplicate phone test",
    ]),
    /मोबाइल पहले से/,
  );
});
test("invalid workplace assignment cannot be saved", async () => {
  await assert.rejects(
    db.query("select manage_staff($1,$2,$3,$4)", [
      admin,
      created,
      JSON.stringify({
        assignments: [
          { panchayat: "Unknown", position: "Secretary", department: "Office" },
        ],
      }),
      "Reject unrecognized place",
    ]),
    /कार्यस्थल/,
  );
  await assert.rejects(
    db.query("select manage_staff($1,$2,$3,$4)", [
      admin,
      created,
      JSON.stringify({ assignments: [workplaces[0], workplaces[0]] }),
      "Reject duplicate worksite",
    ]),
    /दो बार/,
  );
});
test("manual attendance updates one canonical record and snapshots all master places", async () => {
  const args = [
    admin,
    created,
    manualDate,
    "Test",
    "present",
    manualDate + "T09:00:00+05:30",
    manualDate + "T17:00:00+05:30",
    "Attendance entered by admin",
  ];
  const first = (
    await db.query(
      "select admin_input_attendance($1,$2,$3,$4,$5,$6,$7,$8) as record",
      args,
    )
  ).rows[0].record;
  manualId = first.id;
  assert.deepEqual(first.flags, ["admin_entered"]);
  assert.equal(first.working_places.length, 2);
  args[5] = manualDate + "T10:00:00+05:30";
  const second = (
    await db.query(
      "select admin_input_attendance($1,$2,$3,$4,$5,$6,$7,$8) as record",
      args,
    )
  ).rows[0].record;
  assert.equal(second.id, first.id);
  assert.equal(
    (
      await db.query(
        "select count(*) as n from attendance where staff_id=$1 and date=$2 and deleted_at is null",
        [created, manualDate],
      )
    ).rows[0].n,
    1,
  );
  assert.equal(
    (
      await db.query(
        "select details from audit_logs where action='admin_input_attendance' order by id desc limit 1",
      )
    ).rows[0].details.old.id,
    first.id,
  );
});
test("master edits do not rewrite historical attendance workplaces", async () => {
  await db.query("select manage_staff($1,$2,$3,$4)", [
    admin,
    created,
    JSON.stringify({ assignments: [workplaces[0]], name: "Updated Staff" }),
    "Assignment changed by admin",
  ]);
  assert.equal(
    (
      await db.query("select working_places from attendance where id=$1", [
        manualId,
      ])
    ).rows[0].working_places.length,
    2,
  );
});
test("manual attendance requires reason and rejects invalid times and staff role", async () => {
  const args = [
    admin,
    created,
    manualDate,
    "Test",
    "present",
    manualDate + "T17:00:00+05:30",
    manualDate + "T09:00:00+05:30",
    "Correcting attendance times",
  ];
  await assert.rejects(
    db.query("select admin_input_attendance($1,$2,$3,$4,$5,$6,$7,$8)", args),
    /पंच समय/,
  );
  args[5] = manualDate + "T09:00:00+05:30";
  args[7] = "short";
  await assert.rejects(
    db.query("select admin_input_attendance($1,$2,$3,$4,$5,$6,$7,$8)", args),
    /कारण/,
  );
  args[0] = other;
  args[7] = "Unauthorized staff attempt";
  await assert.rejects(
    db.query("select admin_input_attendance($1,$2,$3,$4,$5,$6,$7,$8)", args),
    /अनुमति/,
  );
});
test("attendance delete hides record, retains audit and queues removal from sheets", async () => {
  await assert.rejects(
    db.query("select delete_admin_attendance($1,$2,$3)", [
      other,
      manualId,
      "Unauthorized delete attempt",
    ]),
    /अनुमति/,
  );
  await assert.rejects(
    db.query("select delete_admin_attendance($1,$2,$3)", [
      admin,
      manualId,
      "short",
    ]),
    /कारण/,
  );
  await db.query("select delete_admin_attendance($1,$2,$3)", [
    admin,
    manualId,
    "Incorrect record removed",
  ]);
  assert.ok(
    (
      await db.query("select deleted_at from attendance where id=$1", [
        manualId,
      ])
    ).rows[0].deleted_at,
  );
  assert.equal(
    (
      await db.query("select state from sync_jobs where record_id=$1", [
        manualId,
      ])
    ).rows[0].state,
    "pending",
  );
  await db.query(
    "select admin_input_attendance($1,$2,$3,'Test','leave',null,null,'Replacement approved leave')",
    [admin, created, manualDate],
  );
  assert.equal(
    (
      await db.query(
        "select count(*) as n from attendance where staff_id=$1 and date=$2 and deleted_at is null",
        [created, manualDate],
      )
    ).rows[0].n,
    1,
  );
  assert.equal(
    (
      await db.query(
        "select count(*) as n from attendance where staff_id=$1 and date=$2",
        [created, manualDate],
      )
    ).rows[0].n,
    2,
  );
});
test("master delete disables login while retaining historical records and cannot target admins", async () => {
  await assert.rejects(
    db.query("select delete_master_staff($1,$2,$3)", [
      admin,
      admin,
      "Cannot remove administrator",
    ]),
    /अनुमति/,
  );
  await db.query("select delete_master_staff($1,$2,$3)", [
    admin,
    created,
    "Staff left the organization",
  ]);
  const p = (await db.query("select * from profiles where id=$1", [created]))
    .rows[0];
  assert.equal(p.active, false);
  assert.ok(p.deleted_at);
  assert.equal(
    (
      await db.query("select count(*) as n from attendance where staff_id=$1", [
        created,
      ])
    ).rows[0].n,
    2,
  );
  await assert.rejects(
    db.query("select bind_device($1,$2)", [created, "another-device"]),
    /खाता निष्क्रिय/,
  );
});
test("block admins cannot modify another block and viewers cannot enter or delete records", async () => {
  const blockAdmin = "55555555-5555-4555-8555-555555555555",
    viewer = "66666666-6666-4666-8666-666666666666";
  await db.query("insert into auth.users(id) values($1),($2)", [
    blockAdmin,
    viewer,
  ]);
  await db.query(
    "insert into profiles(id,name,login_email,role,block) values($1,'Other Block Admin','other-block@example.test','block_admin','Other'),($2,'Viewer','viewer@example.test','district_viewer','Araria')",
    [blockAdmin, viewer],
  );
  for (const actor of [blockAdmin, viewer]) {
    await assert.rejects(
      db.query("select delete_admin_attendance($1,$2,$3)", [
        actor,
        (await db.query("select id from attendance where staff_id=$1", [user]))
          .rows[0].id,
        "Permission boundary test",
      ]),
      /अनुमति/,
    );
    await assert.rejects(
      db.query("select manage_staff($1,$2,$3,$4)", [
        actor,
        user,
        JSON.stringify({ name: "No access" }),
        "Permission boundary test",
      ]),
      /अनुमति/,
    );
  }
  await db.exec("set role authenticated");
  await assert.rejects(
    db.query("select delete_master_staff($1,$2,$3)", [
      admin,
      user,
      "Cannot call RPC directly",
    ]),
    /permission denied/,
  );
  await db.exec("reset role");
});

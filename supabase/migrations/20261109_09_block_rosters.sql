-- Apply after 20261109_08. Directory entries have no Supabase Auth account.
-- Historical profiles and attendance are untouched by this migration.
begin;

create table if not exists public.staff_roster (
 id uuid primary key default gen_random_uuid(),
 block_id uuid not null references public.blocks(id),
 name text not null check(length(trim(name)) between 2 and 150),
 phone text check(phone is null or phone ~ '^[6-9][0-9]{9}$'),
 email text,
 gender text check(gender in ('female','male')),
 assignments jsonb not null default '[]'::jsonb check(jsonb_typeof(assignments)='array'),
 source_key text unique,
 active boolean not null default true,
 deleted_at timestamptz,
 linked_profile_id uuid unique references public.profiles(id),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create index if not exists staff_roster_block_active_idx on public.staff_roster(block_id,name) where deleted_at is null;
alter table public.staff_roster enable row level security;
drop policy if exists staff_roster_read on public.staff_roster;
create policy staff_roster_read on public.staff_roster for select to authenticated
 using(exists(select 1 from public.profiles actor where actor.id=auth.uid()
 and actor.active and actor.deleted_at is null
 and (actor.role='dpro' or (actor.role='bpro' and actor.block_id=staff_roster.block_id))));
revoke all on public.staff_roster from anon,authenticated;
grant select on public.staff_roster to authenticated;
grant all on public.staff_roster to service_role;

create or replace function public.staff_roster_revision_trigger() returns trigger
 language plpgsql security definer set search_path=public as $$
declare old_block text; new_block text;
begin
 if TG_OP <> 'INSERT' then
  select name_en into old_block from public.blocks where id=old.block_id;
  perform public.bump_portal_revision('directory:block:'||old_block);
 end if;
 if TG_OP <> 'DELETE' then
  select name_en into new_block from public.blocks where id=new.block_id;
  perform public.bump_portal_revision('directory:block:'||new_block);
 end if;
 perform public.bump_portal_revision('directory:all');
 return coalesce(new,old);
end $$;
drop trigger if exists portal_staff_roster_revision on public.staff_roster;
create trigger portal_staff_roster_revision after insert or update or delete on public.staff_roster
 for each row execute function public.staff_roster_revision_trigger();

-- Include roster-only staff in the fast login payload; RLS limits BPRO rows.
create or replace function public.portal_bootstrap() returns jsonb
language plpgsql stable security invoker set search_path=public as $$
declare p jsonb; d date=(now() at time zone 'Asia/Kolkata')::date;
 staff_rows jsonb='[]'; attendance_rows jsonb; holidays jsonb; notices jsonb;
begin
 select to_jsonb(me) into p from (
  select id,name,phone,email,assignments,role,block,block_id,active,gender
  from profiles where id=auth.uid() and active and deleted_at is null
 ) me;
 if p is null then raise exception 'PORTAL:Account inactive or incomplete'; end if;
 if p->>'role'<>'staff' then
  select coalesce(jsonb_agg(to_jsonb(s) order by s.name),'[]') into staff_rows from (
   select id,name,phone,email,assignments,role,block,block_id,active,gender,false as roster_only
   from profiles where deleted_at is null and role='staff'
   union all
   select r.id,r.name,r.phone,r.email,r.assignments,'staff'::text,b.name_en,r.block_id,r.active,r.gender,true
   from staff_roster r join blocks b on b.id=r.block_id
   where r.deleted_at is null and r.linked_profile_id is null
  ) s;
 end if;
 select coalesce(jsonb_agg(to_jsonb(r) order by r.created_at desc),'[]') into attendance_rows from (
  select a.id,a.staff_id,a.date,a.panchayat,a.department,a.position,a.block,a.block_id,
   a.staff_name,a.status,a.phase,a.deputation_workplace,a.leave_type,a.absence_reason,
   a.time_in,a.time_out,a.latitude,a.longitude,a.accuracy,a.photo_path,a.leave_path,
   a.working_places,a.created_at,
   jsonb_build_object('id',u.id,'name',u.name,'phone',u.phone,'email',u.email,
    'block',u.block,'block_id',u.block_id,'role',u.role,'active',u.active,'gender',u.gender) as profiles
  from attendance a left join profiles u on u.id=a.staff_id
  where a.date=d and a.deleted_at is null
   and (p->>'role'<>'staff' or a.staff_id=(p->>'id')::uuid)
 ) r;
 select coalesce(jsonb_agg(jsonb_build_object('date',date,'reason',reason,
  'block_id',block_id) order by date),'[]') into holidays from office_holidays;
 select coalesce(jsonb_agg(to_jsonb(n) order by n.created_at desc,n.id desc),'[]') into notices from (
  select id,title,body,created_at,block_id from office_notices
  where deleted_at is null order by created_at desc,id desc limit 100
 ) n;
 return jsonb_build_object('profile',p,'date',d,'records',attendance_rows,
  'staff',staff_rows,'office',jsonb_build_object('today',d,'holidays',holidays,
  'notices',notices),'revisions',public.portal_changes(),
  'leaveBalances',public.leave_balance_snapshot());
end $$;

notify pgrst, 'reload schema';
commit;

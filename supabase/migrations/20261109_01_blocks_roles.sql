-- Apply only after reviewing 20261109_00_district_dry_run.sql and taking a backup.
-- This migration preserves all attendance rows and all historical department values.
begin;

create table if not exists public.blocks (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name_en text not null unique,
  name_hi text not null,
  active boolean not null default true
);
insert into public.blocks(code,name_en,name_hi) values
 ('araria','Araria','अररिया'),
 ('bhargama','Bhargama','भरगामा'),
 ('forbesganj','Forbesganj','फारबिसगंज'),
 ('jokihat','Jokihat','जोकीहाट'),
 ('kursakanta','Kursakanta','कुरसाकांटा'),
 ('narpatganj','Narpatganj','नरपतगंज'),
 ('palasi','Palasi','पलासी'),
 ('raniganj','Raniganj','रानीगंज'),
 ('sikti','Sikti','सिकटी')
on conflict(code) do update set name_en=excluded.name_en,name_hi=excluded.name_hi;

alter table public.blocks enable row level security;
revoke all on public.blocks from anon,authenticated;
grant select on public.blocks to authenticated;
grant all on public.blocks to service_role;
drop policy if exists blocks_read on public.blocks;
create policy blocks_read on public.blocks for select to authenticated
using (exists(select 1 from public.profiles where id=auth.uid() and active and deleted_at is null));

-- Keep pre-conversion role values for review. Never promote a district viewer.
create table if not exists public.district_role_archive (
 profile_id uuid primary key references public.profiles(id),
 old_role text not null,
 old_block text not null,
 archived_at timestamptz not null default now()
);
revoke all on public.district_role_archive from public,anon,authenticated;
grant all on public.district_role_archive to service_role;
insert into public.district_role_archive(profile_id,old_role,old_block)
select id,role,block from public.profiles
where role in ('super_admin','block_admin','district_viewer')
on conflict(profile_id) do nothing;

alter table public.profiles add column if not exists block_id uuid;
alter table public.attendance add column if not exists block_id uuid;
alter table public.panchayats add column if not exists block_id uuid;
alter table public.pending_uploads add column if not exists block_id uuid;
alter table public.audit_logs add column if not exists block_id uuid;
alter table public.audit_logs add column if not exists actor_role text;
alter table public.office_holidays add column if not exists block_id uuid;
alter table public.office_notices add column if not exists block_id uuid;

-- The existing installation is Araria Block; preserve its attendance snapshot.
update public.profiles set block_id=(select id from public.blocks where code='araria') where block_id is null;
update public.attendance set block_id=(select id from public.blocks where code='araria') where block_id is null;
update public.panchayats set block_id=(select id from public.blocks where code='araria') where block_id is null;
update public.pending_uploads set block_id=(select id from public.blocks where code='araria') where block_id is null;
update public.audit_logs a set block_id=p.block_id,actor_role=p.role
from public.profiles p where p.id=a.actor_id and (a.block_id is null or a.actor_role is null);

alter table public.profiles alter column block_id set not null;
alter table public.attendance alter column block_id set not null;
alter table public.panchayats alter column block_id set not null;
alter table public.pending_uploads alter column block_id set not null;
alter table public.audit_logs alter column block_id set not null;

do $$ begin
 if not exists(select 1 from pg_constraint where conname='profiles_block_id_fkey') then
  alter table public.profiles add constraint profiles_block_id_fkey foreign key(block_id) references public.blocks(id);
 end if;
 if not exists(select 1 from pg_constraint where conname='attendance_block_id_fkey') then
  alter table public.attendance add constraint attendance_block_id_fkey foreign key(block_id) references public.blocks(id);
 end if;
 if not exists(select 1 from pg_constraint where conname='panchayats_block_id_fkey') then
  alter table public.panchayats add constraint panchayats_block_id_fkey foreign key(block_id) references public.blocks(id);
 end if;
 if not exists(select 1 from pg_constraint where conname='pending_uploads_block_id_fkey') then
  alter table public.pending_uploads add constraint pending_uploads_block_id_fkey foreign key(block_id) references public.blocks(id);
 end if;
 if not exists(select 1 from pg_constraint where conname='office_holidays_block_id_fkey') then
  alter table public.office_holidays add constraint office_holidays_block_id_fkey foreign key(block_id) references public.blocks(id);
 end if;
 if not exists(select 1 from pg_constraint where conname='office_notices_block_id_fkey') then
  alter table public.office_notices add constraint office_notices_block_id_fkey foreign key(block_id) references public.blocks(id);
 end if;
 if not exists(select 1 from pg_constraint where conname='audit_logs_block_id_fkey') then
  alter table public.audit_logs add constraint audit_logs_block_id_fkey foreign key(block_id) references public.blocks(id);
 end if;
end $$;

-- Existing holidays/notices become district-wide. A surrogate holiday key allows
-- separate district and block entries for the same date.
alter table public.office_holidays add column if not exists id uuid default gen_random_uuid();
update public.office_holidays set id=gen_random_uuid() where id is null;
alter table public.office_holidays alter column id set not null;
do $$ begin
 if exists(select 1 from pg_constraint where conname='office_holidays_pkey'
  and conkey=array[(select attnum from pg_attribute where attrelid='public.office_holidays'::regclass and attname='date')]::smallint[]) then
  alter table public.office_holidays drop constraint office_holidays_pkey;
 end if;
 if not exists(select 1 from pg_constraint where conname='office_holidays_pkey') then
  alter table public.office_holidays add constraint office_holidays_pkey primary key(id);
 end if;
end $$;
create unique index if not exists office_holidays_district_date_idx
on public.office_holidays(date) where block_id is null;
create unique index if not exists office_holidays_block_date_idx
on public.office_holidays(block_id,date) where block_id is not null;

-- Retain the text block snapshot for old reports while the app moves to block_id.
update public.profiles p set assignments=coalesce((
 select jsonb_agg(a.value || jsonb_build_object('block_id',p.block_id))
 from jsonb_array_elements(p.assignments) a(value)
), '[]'::jsonb)
where jsonb_typeof(p.assignments)='array'
 and exists(select 1 from jsonb_array_elements(p.assignments) a where not a ? 'block_id');
update public.attendance a set working_places=coalesce((
 select jsonb_agg(w.value || jsonb_build_object('block_id',a.block_id))
 from jsonb_array_elements(a.working_places) w(value)
), '[]'::jsonb)
where jsonb_typeof(a.working_places)='array'
 and exists(select 1 from jsonb_array_elements(a.working_places) w where not w ? 'block_id');

alter table public.profiles drop constraint if exists profiles_role_check;
update public.profiles set role='dpro' where role='super_admin';
update public.profiles set role='bpro' where role='block_admin';
update public.profiles set role='legacy_archived',active=false where role='district_viewer';
alter table public.profiles add constraint profiles_role_check
 check(role in ('staff','bpro','dpro','legacy_archived'));
create unique index if not exists one_active_dpro_idx on public.profiles((role))
where role='dpro' and active and deleted_at is null;
create unique index if not exists one_active_bpro_per_block_idx on public.profiles(block_id)
where role='bpro' and active and deleted_at is null;
create index if not exists profiles_role_block_idx on public.profiles(role,block_id) where deleted_at is null;
create index if not exists attendance_date_block_idx on public.attendance(date,block_id) where deleted_at is null;

-- Scope data and omit sensitive old audit details from future insertions.
create or replace function public.district_audit_defaults() returns trigger
language plpgsql security definer set search_path=public as $$
declare actor public.profiles;
begin
 select * into actor from public.profiles where id=new.actor_id;
 if actor.id is null then raise exception 'PORTAL:Unknown audit actor'; end if;
 new.actor_role=actor.role;
 new.block_id=coalesce(new.block_id,actor.block_id);
 new.details=null;
 new.reason=left(new.action,100);
 return new;
end $$;
drop trigger if exists district_audit_defaults on public.audit_logs;
create trigger district_audit_defaults before insert on public.audit_logs
for each row execute function public.district_audit_defaults();

notify pgrst, 'reload schema';
commit;

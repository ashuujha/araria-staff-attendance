begin;

-- Counters are updated in the same transaction as their source rows. No staff
-- data is exposed by the counter RPC, and ordinary clients cannot edit it.
create table if not exists public.portal_revisions (
  key text primary key,
  revision bigint not null default 0
);
revoke all on public.portal_revisions from public, anon, authenticated;
alter table public.portal_revisions enable row level security;

create or replace function public.bump_portal_revision(revision_key text)
returns void language sql security definer set search_path=public as $$
  insert into portal_revisions(key,revision) values(revision_key,1)
  on conflict(key) do update set revision=portal_revisions.revision+1;
$$;
revoke all on function public.bump_portal_revision(text) from public,anon,authenticated;

create or replace function public.profile_revision_trigger()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if TG_OP <> 'INSERT' then
    perform bump_portal_revision('profile:'||old.id::text);
    perform bump_portal_revision('directory:all');
    perform bump_portal_revision('directory:block:'||old.block);
  end if;
  if TG_OP <> 'DELETE' then
    perform bump_portal_revision('profile:'||new.id::text);
    perform bump_portal_revision('directory:all');
    perform bump_portal_revision('directory:block:'||new.block);
  end if;
  return coalesce(new,old);
end $$;
drop trigger if exists portal_profile_revision on public.profiles;
create trigger portal_profile_revision after insert or update or delete on public.profiles
for each row execute function public.profile_revision_trigger();

create or replace function public.attendance_revision_trigger()
returns trigger language plpgsql security definer set search_path=public as $$
declare person_block text; shard text;
begin
  if TG_OP <> 'INSERT' then
    select block into person_block from profiles where id=old.staff_id;
    shard=mod((hashtextextended(old.staff_id::text,0) & 2147483647),16)::text;
    perform bump_portal_revision('attendance:'||old.staff_id::text);
    perform bump_portal_revision('attendance:all:'||shard);
    perform bump_portal_revision('attendance:block:'||coalesce(person_block,old.block,'')||':'||shard);
  end if;
  if TG_OP <> 'DELETE' then
    select block into person_block from profiles where id=new.staff_id;
    shard=mod((hashtextextended(new.staff_id::text,0) & 2147483647),16)::text;
    perform bump_portal_revision('attendance:'||new.staff_id::text);
    perform bump_portal_revision('attendance:all:'||shard);
    perform bump_portal_revision('attendance:block:'||coalesce(person_block,new.block,'')||':'||shard);
  end if;
  return coalesce(new,old);
end $$;
drop trigger if exists portal_attendance_revision on public.attendance;
create trigger portal_attendance_revision after insert or update or delete on public.attendance
for each row execute function public.attendance_revision_trigger();

create or replace function public.office_revision_trigger()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  perform bump_portal_revision(case when TG_TABLE_NAME='office_holidays' then 'holidays' else 'notices' end);
  return coalesce(new,old);
end $$;
drop trigger if exists portal_holiday_revision on public.office_holidays;
create trigger portal_holiday_revision after insert or update or delete on public.office_holidays
for each row execute function public.office_revision_trigger();
drop trigger if exists portal_notice_revision on public.office_notices;
create trigger portal_notice_revision after insert or update or delete on public.office_notices
for each row execute function public.office_revision_trigger();

create or replace function public.portal_changes() returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare p profiles; prefix text; v jsonb;
begin
  select * into p from profiles where id=auth.uid() and active and deleted_at is null;
  if p.id is null then raise exception 'PORTAL:खाता निष्क्रिय या अपूर्ण है।'; end if;
  prefix=case when p.role='staff' then p.id::text
              when p.role='block_admin' then 'block:'||p.block else 'all' end;
  select jsonb_build_object(
    'profile', coalesce((select revision from portal_revisions where key='profile:'||p.id::text),0),
    'directory', case when p.role='staff' then 0 else coalesce((select revision from portal_revisions where key='directory:'||prefix),0) end,
    'attendance', case when p.role='staff'
      then coalesce((select revision from portal_revisions where key='attendance:'||prefix),0)
      else coalesce((select sum(revision) from portal_revisions where key like 'attendance:'||prefix||':%'),0) end,
    'holidays', coalesce((select revision from portal_revisions where key='holidays'),0),
    'notices', coalesce((select revision from portal_revisions where key='notices'),0),
    'today', (now() at time zone 'Asia/Kolkata')::date
  ) into v;
  return v;
end $$;
revoke all on function public.portal_changes() from public,anon;
grant execute on function public.portal_changes() to authenticated;

create or replace function public.portal_bootstrap() returns jsonb language plpgsql stable security invoker set search_path=public as $$
declare p jsonb; d date=(now() at time zone 'Asia/Kolkata')::date; staff_rows jsonb='[]'; attendance_rows jsonb; holidays jsonb; notices jsonb;
begin
 select to_jsonb(me) into p from (
  select id,name,phone,email,assignments,role,block,active from profiles
  where id=auth.uid() and active and deleted_at is null
 ) me;
 if p is null then raise exception 'PORTAL:खाता निष्क्रिय या अपूर्ण है।'; end if;
 if p->>'role'<>'staff' then
  select coalesce(jsonb_agg(to_jsonb(s) order by s.name),'[]') into staff_rows from (
   select id,name,phone,email,assignments,role,block,active from profiles where deleted_at is null and role='staff'
  ) s;
 end if;
 select coalesce(jsonb_agg(to_jsonb(r) order by r.created_at desc),'[]') into attendance_rows from (
  select a.id,a.staff_id,a.date,a.panchayat,a.department,a.position,a.block,a.staff_name,a.status,a.phase,a.deputation_workplace,a.leave_type,a.absence_reason,a.time_in,a.time_out,a.photo_path,a.leave_path,a.working_places,a.created_at,
   jsonb_build_object('id',u.id,'name',u.name,'phone',u.phone,'email',u.email,'block',u.block,'role',u.role,'active',u.active) as profiles
  from attendance a left join profiles u on u.id=a.staff_id
  where a.date=d and a.deleted_at is null and (p->>'role'<>'staff' or a.staff_id=(p->>'id')::uuid)
 ) r;
 select coalesce(jsonb_agg(jsonb_build_object('date',date,'reason',reason) order by date),'[]') into holidays from office_holidays;
 select coalesce(jsonb_agg(to_jsonb(n) order by n.created_at desc,n.id desc),'[]') into notices from (
  select id,title,body,created_at from office_notices where deleted_at is null order by created_at desc,id desc limit 100
 ) n;
 return jsonb_build_object('profile',p,'date',d,'records',attendance_rows,'staff',staff_rows,'office',jsonb_build_object('today',d,'holidays',holidays,'notices',notices),'revisions',public.portal_changes());
end $$;
revoke all on function public.portal_bootstrap() from public,anon;
grant execute on function public.portal_bootstrap() to authenticated;
notify pgrst, 'reload schema';
commit;

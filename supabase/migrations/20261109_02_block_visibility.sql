-- Apply after 20261109_01. All authenticated reads use the caller's database role.
begin;

create or replace function public.can_read_profile(target uuid) returns boolean
language sql stable security definer set search_path=public as $$
 select exists(
  select 1 from profiles actor join profiles subject on subject.id=target
  where actor.id=auth.uid() and actor.active and actor.deleted_at is null
   and (actor.id=target or actor.role='dpro'
    or (actor.role='bpro' and actor.block_id=subject.block_id))
 );
$$;
revoke all on function public.can_read_profile(uuid) from public,anon;
grant execute on function public.can_read_profile(uuid) to authenticated;

create or replace function public.can_read_attendance(target_staff uuid,target_block uuid)
returns boolean language sql stable security definer set search_path=public as $$
 select exists(select 1 from profiles actor where actor.id=auth.uid()
  and actor.active and actor.deleted_at is null
  and (actor.id=target_staff or actor.role='dpro'
   or (actor.role='bpro' and actor.block_id=target_block)));
$$;
revoke all on function public.can_read_attendance(uuid,uuid) from public,anon;
grant execute on function public.can_read_attendance(uuid,uuid) to authenticated;

create or replace function public.can_read_office(target_block uuid)
returns boolean language sql stable security definer set search_path=public as $$
 select exists(select 1 from profiles actor where actor.id=auth.uid()
  and actor.active and actor.deleted_at is null
  and (target_block is null or actor.role='dpro' or actor.block_id=target_block));
$$;
revoke all on function public.can_read_office(uuid) from public,anon;
grant execute on function public.can_read_office(uuid) to authenticated;

drop policy if exists profiles_read on public.profiles;
create policy profiles_read on public.profiles for select to authenticated
using(public.can_read_profile(id));
drop policy if exists attendance_read on public.attendance;
create policy attendance_read on public.attendance for select to authenticated
using(deleted_at is null and public.can_read_attendance(staff_id,block_id));
drop policy if exists panchayats_read on public.panchayats;
create policy panchayats_read on public.panchayats for select to authenticated
using(public.can_read_office(block_id));
drop policy if exists office_holidays_read on public.office_holidays;
create policy office_holidays_read on public.office_holidays for select to authenticated
using(public.can_read_office(block_id));
drop policy if exists office_notices_read on public.office_notices;
create policy office_notices_read on public.office_notices for select to authenticated
using(deleted_at is null and public.can_read_office(block_id));
drop policy if exists audit_read on public.audit_logs;
create policy audit_read on public.audit_logs for select to authenticated
using(exists(select 1 from public.profiles actor where actor.id=auth.uid()
 and actor.active and actor.deleted_at is null
 and (actor.role='dpro' or (actor.role='bpro' and actor.block_id=audit_logs.block_id))));
grant select(block_id) on public.profiles to authenticated;

-- Fast start still reads through RLS. Include block_id in all returned entities.
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
   select id,name,phone,email,assignments,role,block,block_id,active,gender
   from profiles where deleted_at is null and role='staff'
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

-- Revisions remain scoped to the actor. Existing text block shards remain
-- transitional until all clients and triggers use immutable block IDs.
create or replace function public.portal_changes() returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare p profiles; prefix text; v jsonb;
begin
 select * into p from profiles where id=auth.uid() and active and deleted_at is null;
 if p.id is null then raise exception 'PORTAL:Account inactive or incomplete'; end if;
 prefix=case when p.role='staff' then p.id::text
  when p.role='bpro' then 'block:'||p.block else 'all' end;
 select jsonb_build_object(
  'profile',coalesce((select revision from portal_revisions where key='profile:'||p.id::text),0),
  'directory',case when p.role='staff' then 0 else coalesce((select revision from portal_revisions where key='directory:'||prefix),0) end,
  'attendance',case when p.role='staff'
   then coalesce((select revision from portal_revisions where key='attendance:'||prefix),0)
   else coalesce((select sum(revision) from portal_revisions where key like 'attendance:'||prefix||':%'),0) end,
  'holidays',coalesce((select revision from portal_revisions where key='holidays'),0),
  'notices',coalesce((select revision from portal_revisions where key='notices'),0),
  'today',(now() at time zone 'Asia/Kolkata')::date
 ) into v;
 return v;
end $$;

-- Leave balances are derived from block-scoped rows, never a shared cache.
create or replace function public.leave_balance_snapshot() returns jsonb
language sql stable security invoker set search_path=public as $$
 with calendar as (select (now() at time zone 'Asia/Kolkata')::date as today),
 usage as (
  select p.id as staff_id,p.block_id,p.gender,
   count(a.id) filter(where a.status='leave' and a.leave_type='CL')::integer as cl_used,
   count(a.id) filter(where a.status='leave' and a.leave_type='SL')::integer as sl_used,
   count(a.id) filter(where a.status='leave' and a.leave_type='SL'
    and date_trunc('month',a.date::timestamp)=date_trunc('month',c.today::timestamp))::integer as sl_month_used
  from profiles p cross join calendar c
  left join attendance a on a.staff_id=p.id and a.deleted_at is null
   and a.date>=date_trunc('year',c.today::timestamp)::date
   and a.date<(date_trunc('year',c.today::timestamp)+interval '1 year')::date
  where p.role='staff' and p.deleted_at is null
  group by p.id,p.block_id,p.gender
 )
 select jsonb_build_object('year',extract(year from c.today)::integer,
  'month',extract(month from c.today)::integer,
  'balances',coalesce(jsonb_agg(jsonb_build_object(
   'staff_id',u.staff_id,'block_id',u.block_id,'gender',u.gender,
   'cl_used',u.cl_used,'cl_left',greatest(0,16-u.cl_used),
   'sl_used',u.sl_used,'sl_left',case when u.gender='female' then greatest(0,24-u.sl_used) else 0 end,
   'sl_month_used',u.sl_month_used,'sl_month_left',case when u.gender='female' then greatest(0,2-u.sl_month_used) else 0 end
  ) order by u.staff_id) filter(where u.staff_id is not null),'[]'::jsonb))
 from calendar c left join usage u on true group by c.today
$$;

notify pgrst, 'reload schema';
commit;

begin;

alter table public.profiles add column if not exists gender text;
alter table public.profiles drop constraint if exists profiles_gender_check;
alter table public.profiles add constraint profiles_gender_check check (gender in ('female','male'));
grant select(gender) on public.profiles to authenticated;

-- Count saved, non-deleted CL/SL records. A balance is derived rather than
-- stored, so an admin's correction or removal immediately restores a day.
create or replace function public.leave_balance_snapshot() returns jsonb
language sql stable security invoker set search_path=public as $$
 with calendar as (
  select (now() at time zone 'Asia/Kolkata')::date as today
 ), usage as (
  select p.id as staff_id,p.gender,
   count(a.id) filter(where a.status='leave' and a.leave_type='CL')::integer as cl_used,
   count(a.id) filter(where a.status='leave' and a.leave_type='SL')::integer as sl_used,
   count(a.id) filter(where a.status='leave' and a.leave_type='SL' and date_trunc('month',a.date::timestamp)=date_trunc('month',c.today::timestamp))::integer as sl_month_used
  from profiles p cross join calendar c
  left join attendance a on a.staff_id=p.id and a.deleted_at is null
   and a.date>=date_trunc('year',c.today::timestamp)::date
   and a.date<(date_trunc('year',c.today::timestamp)+interval '1 year')::date
  where p.role='staff' and p.deleted_at is null
  group by p.id,p.gender
 )
 select jsonb_build_object(
  'year',extract(year from c.today)::integer,
  'month',extract(month from c.today)::integer,
  'balances',coalesce(jsonb_agg(jsonb_build_object(
   'staff_id',u.staff_id,'gender',u.gender,
   'cl_used',u.cl_used,'cl_left',greatest(0,16-u.cl_used),
   'sl_used',u.sl_used,'sl_left',case when u.gender='female' then greatest(0,24-u.sl_used) else 0 end,
   'sl_month_used',u.sl_month_used,'sl_month_left',case when u.gender='female' then greatest(0,2-u.sl_month_used) else 0 end
  ) order by u.staff_id) filter (where u.staff_id is not null),'[]'::jsonb)
 ) from calendar c left join usage u on true
 group by c.today
$$;
revoke all on function public.leave_balance_snapshot() from public,anon;
grant execute on function public.leave_balance_snapshot() to authenticated,service_role;

-- The year lock prevents two submissions on different dates from consuming
-- the same final allowance concurrently. Updates exclude their own row.
create or replace function public.enforce_leave_quota() returns trigger
language plpgsql security definer set search_path=public as $$
declare g text; used_count integer;
begin
 perform pg_advisory_xact_lock(hashtextextended('leave:'||new.staff_id::text||':'||extract(year from new.date)::integer::text,0));
 if new.deleted_at is not null or new.status<>'leave' then return new; end if;
 if new.leave_type is null then
  if current_setting('portal.allow_untyped_leave',true)='on' then return new; end if;
  raise exception 'PORTAL:CL या SL चुनें।';
 end if;
 select gender into g from profiles where id=new.staff_id;
 if new.leave_type='SL' and g is distinct from 'female' then
  raise exception 'PORTAL:SL केवल महिला कर्मियों के लिए है। एडमिन से लिंग विवरण जाँचें।';
 end if;
 select count(*) into used_count from attendance a
 where a.staff_id=new.staff_id and a.id is distinct from new.id
  and a.deleted_at is null and a.status='leave' and a.leave_type=new.leave_type
  and a.date>=date_trunc('year',new.date::timestamp)::date
  and a.date<(date_trunc('year',new.date::timestamp)+interval '1 year')::date;
 if new.leave_type='CL' and used_count>=16 then
  raise exception 'PORTAL:इस वर्ष की सभी 16 CL उपयोग हो चुकी हैं।';
 end if;
 if new.leave_type='SL' then
  if used_count>=24 then raise exception 'PORTAL:इस वर्ष की सभी 24 SL उपयोग हो चुकी हैं।'; end if;
  select count(*) into used_count from attendance a
  where a.staff_id=new.staff_id and a.id is distinct from new.id
   and a.deleted_at is null and a.status='leave' and a.leave_type='SL'
   and a.date>=date_trunc('month',new.date::timestamp)::date
   and a.date<(date_trunc('month',new.date::timestamp)+interval '1 month')::date;
  if used_count>=2 then raise exception 'PORTAL:इस महीने की दोनों SL उपयोग हो चुकी हैं।'; end if;
 end if;
 return new;
end $$;
drop trigger if exists attendance_leave_quota on public.attendance;
create trigger attendance_leave_quota before insert or update of staff_id,date,status,leave_type,deleted_at
on public.attendance for each row execute function public.enforce_leave_quota();

-- Preserve the existing staff-management RPCs and add gender atomically.
create or replace function public.create_master_staff_with_gender(actor_id uuid,user_id uuid,staff_name text,staff_phone text,staff_email text,auth_email text,block_name text,workplaces jsonb,reason_text text,gender_name text) returns jsonb
language plpgsql security definer set search_path=public as $$
declare result jsonb;
begin
 if gender_name not in ('female','male') or gender_name is null then raise exception 'PORTAL:कर्मी का लिंग चुनें।'; end if;
 result:=public.create_master_staff(actor_id,user_id,staff_name,staff_phone,staff_email,auth_email,block_name,workplaces,reason_text);
 update profiles set gender=gender_name where id=user_id;
 return result||jsonb_build_object('gender',gender_name);
end $$;
revoke all on function public.create_master_staff_with_gender(uuid,uuid,text,text,text,text,text,jsonb,text,text) from public,anon,authenticated;
grant execute on function public.create_master_staff_with_gender(uuid,uuid,text,text,text,text,text,jsonb,text,text) to service_role;

create or replace function public.manage_staff_with_gender(actor_id uuid,target_id uuid,changes jsonb,reason_text text) returns jsonb
language plpgsql security definer set search_path=public as $$
declare result jsonb; gender_name text;
begin
 if changes is null or jsonb_typeof(changes)<>'object' then raise exception 'PORTAL:कर्मी विवरण अमान्य है।'; end if;
 if changes?'gender' then
  gender_name:=changes->>'gender';
  if gender_name not in ('female','male') or gender_name is null then raise exception 'PORTAL:कर्मी का लिंग चुनें।'; end if;
 end if;
 result:=public.manage_staff(actor_id,target_id,changes-'gender',reason_text);
 if changes?'gender' then
  update profiles set gender=gender_name where id=target_id;
  result:=result||jsonb_build_object('gender',gender_name);
 end if;
 return result;
end $$;
revoke all on function public.manage_staff_with_gender(uuid,uuid,jsonb,text) from public,anon,authenticated;
grant execute on function public.manage_staff_with_gender(uuid,uuid,jsonb,text) to service_role;

-- Manual admin leave must also be typed, so it cannot silently bypass quotas.
create or replace function public.admin_input_attendance_with_leave(actor_id uuid,user_id uuid,attendance_date date,panchayat_name text,status_name text,punch_in timestamptz,punch_out timestamptz,reason_text text,leave_kind text default null) returns jsonb
language plpgsql security definer set search_path=public as $$
declare result jsonb;
begin
 if status_name='leave' and leave_kind not in ('CL','SL') then raise exception 'PORTAL:CL या SL चुनें।'; end if;
 if status_name<>'leave' and leave_kind is not null then raise exception 'PORTAL:अवकाश प्रकार अमान्य।'; end if;
 -- The legacy RPC inserts leave without a type; assign it in this same
 -- transaction so the quota trigger checks the final record.
 if status_name='leave' then
  -- Use the original RPC for its scope/date checks, but it must be allowed to
  -- insert a temporary untyped row before this wrapper sets the type.
  perform set_config('portal.allow_untyped_leave','on',true);
 end if;
 result:=public.admin_input_attendance(actor_id,user_id,attendance_date,panchayat_name,status_name,punch_in,punch_out,reason_text);
 if status_name='leave' then
  update attendance set leave_type=leave_kind where id=(result->>'id')::uuid returning to_jsonb(attendance) into result;
 end if;
 return result;
end $$;
revoke all on function public.admin_input_attendance_with_leave(uuid,uuid,date,text,text,timestamptz,timestamptz,text,text) from public,anon,authenticated;
grant execute on function public.admin_input_attendance_with_leave(uuid,uuid,date,text,text,timestamptz,timestamptz,text,text) to service_role;

create or replace function public.portal_bootstrap() returns jsonb language plpgsql stable security invoker set search_path=public as $$
declare p jsonb; d date=(now() at time zone 'Asia/Kolkata')::date; staff_rows jsonb='[]'; attendance_rows jsonb; holidays jsonb; notices jsonb;
begin
 select to_jsonb(me) into p from (
  select id,name,phone,email,assignments,role,block,active,gender from profiles
  where id=auth.uid() and active and deleted_at is null
 ) me;
 if p is null then raise exception 'PORTAL:खाता निष्क्रिय या अपूर्ण है।'; end if;
 if p->>'role'<>'staff' then
  select coalesce(jsonb_agg(to_jsonb(s) order by s.name),'[]') into staff_rows from (
   select id,name,phone,email,assignments,role,block,active,gender from profiles where deleted_at is null and role='staff'
  ) s;
 end if;
 select coalesce(jsonb_agg(to_jsonb(r) order by r.created_at desc),'[]') into attendance_rows from (
  select a.id,a.staff_id,a.date,a.panchayat,a.department,a.position,a.block,a.staff_name,a.status,a.phase,a.deputation_workplace,a.leave_type,a.absence_reason,a.time_in,a.time_out,a.latitude,a.longitude,a.accuracy,a.photo_path,a.leave_path,a.working_places,a.created_at,
   jsonb_build_object('id',u.id,'name',u.name,'phone',u.phone,'email',u.email,'block',u.block,'role',u.role,'active',u.active,'gender',u.gender) as profiles
  from attendance a left join profiles u on u.id=a.staff_id
  where a.date=d and a.deleted_at is null and (p->>'role'<>'staff' or a.staff_id=(p->>'id')::uuid)
 ) r;
 select coalesce(jsonb_agg(jsonb_build_object('date',date,'reason',reason) order by date),'[]') into holidays from office_holidays;
 select coalesce(jsonb_agg(to_jsonb(n) order by n.created_at desc,n.id desc),'[]') into notices from (
  select id,title,body,created_at from office_notices where deleted_at is null order by created_at desc,id desc limit 100
 ) n;
 return jsonb_build_object('profile',p,'date',d,'records',attendance_rows,'staff',staff_rows,'office',jsonb_build_object('today',d,'holidays',holidays,'notices',notices),'revisions',public.portal_changes(),'leaveBalances',public.leave_balance_snapshot());
end $$;

notify pgrst, 'reload schema';
commit;

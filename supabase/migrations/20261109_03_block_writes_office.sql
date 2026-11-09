-- Apply after 20261109_02. Scope service-role writes and block calendars.
begin;

create or replace function public.district_profile_guard() returns trigger
language plpgsql security definer set search_path=public as $$
declare expected uuid; a jsonb;
begin
 select id into expected from blocks where name_en=new.block and active;
 if expected is null then raise exception 'PORTAL:Unknown block'; end if;
 if new.block_id is null then new.block_id=expected; end if;
 if new.block_id<>expected then raise exception 'PORTAL:Block mismatch'; end if;
 if new.role='bpro' and new.block_id is null then raise exception 'PORTAL:BPRO must have one block'; end if;
 if new.role='staff' then
  if jsonb_typeof(new.assignments)<>'array' then raise exception 'PORTAL:Invalid assignments'; end if;
  for a in select value from jsonb_array_elements(new.assignments) loop
   if a->>'department'<>'पंचायती राज विभाग'
    or coalesce(a->>'block_id','')<>new.block_id::text then
    raise exception 'PORTAL:Only this block and Panchayati Raj are allowed';
   end if;
  end loop;
 end if;
 return new;
end $$;
drop trigger if exists district_profile_guard on public.profiles;
create trigger district_profile_guard before insert or update of block,block_id,assignments,role
on public.profiles for each row execute function public.district_profile_guard();

create or replace function public.district_panchayat_guard() returns trigger
language plpgsql security definer set search_path=public as $$
declare expected uuid;
begin
 select id into expected from blocks where name_en=new.block and active;
 if expected is null then raise exception 'PORTAL:Unknown block'; end if;
 if new.block_id is null then new.block_id=expected; end if;
 if new.block_id<>expected then raise exception 'PORTAL:Block mismatch'; end if;
 return new;
end $$;
drop trigger if exists district_panchayat_guard on public.panchayats;
create trigger district_panchayat_guard before insert or update of block,block_id
on public.panchayats for each row execute function public.district_panchayat_guard();

create or replace function public.district_attendance_guard() returns trigger
language plpgsql security definer set search_path=public as $$
declare staff_block uuid;
begin
 if TG_OP='INSERT' then
  select block_id into staff_block from profiles where id=new.staff_id;
  if staff_block is null then raise exception 'PORTAL:Unknown staff block'; end if;
  if new.block_id is not null and new.block_id<>staff_block then raise exception 'PORTAL:Attendance block mismatch'; end if;
  new.block_id=staff_block;
  if new.department is null then new.department='पंचायती राज विभाग'; end if;
 elsif new.block_id<>old.block_id or new.staff_id<>old.staff_id then
  raise exception 'PORTAL:Historical attendance block cannot move';
 end if;
 if new.department is distinct from 'पंचायती राज विभाग' and new.deleted_at is null then
  raise exception 'PORTAL:Only Panchayati Raj attendance is allowed';
 end if;
 return new;
end $$;
drop trigger if exists district_attendance_guard on public.attendance;
create trigger district_attendance_guard before insert or update of block_id,staff_id,department,deleted_at
on public.attendance for each row execute function public.district_attendance_guard();

create or replace function public.district_upload_guard() returns trigger
language plpgsql security definer set search_path=public as $$
declare staff_block uuid;
begin
 select block_id into staff_block from profiles where id=new.staff_id;
 if staff_block is null or new.block_id<>staff_block
  or new.path not like new.block_id::text||'/'||new.staff_id::text||'/%' then
  raise exception 'PORTAL:Upload owner or block mismatch';
 end if;
 return new;
end $$;
drop trigger if exists district_upload_guard on public.pending_uploads;
create trigger district_upload_guard before insert or update of path,staff_id,block_id
on public.pending_uploads for each row execute function public.district_upload_guard();

create or replace function public.manage_office_board(actor_id uuid,action_name text,payload jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare actor profiles; target_block uuid; day date; reason_text text;
 item office_notices; holiday office_holidays;
begin
 select * into actor from profiles where id=actor_id and active and deleted_at is null;
 if actor.id is null or actor.role not in ('dpro','bpro') then
  raise exception 'PORTAL:Administrator access required'; end if;
 target_block=nullif(payload->>'block_id','')::uuid;
 if actor.role='bpro' and target_block is distinct from actor.block_id then
  raise exception 'PORTAL:This block is outside your office'; end if;
 if target_block is not null and not exists(select 1 from blocks where id=target_block and active) then
  raise exception 'PORTAL:Unknown block'; end if;
 if action_name in ('set_holiday','remove_holiday') then
  if coalesce(payload->>'date','') !~ '^\d{4}-\d{2}-\d{2}$' then
   raise exception 'PORTAL:Invalid date'; end if;
  day=(payload->>'date')::date;
  perform pg_advisory_xact_lock(hashtextextended('office-day:'||day::text,0));
  perform pg_advisory_xact_lock(hashtextextended('office-day:'||day::text||':'||coalesce(target_block::text,'district'),0));
  select * into holiday from office_holidays where date=day and block_id is not distinct from target_block for update;
  if action_name='set_holiday' then
   reason_text=trim(payload->>'reason');
   if coalesce(length(reason_text),0) not between 3 and 200 then raise exception 'PORTAL:Holiday reason required'; end if;
   if holiday.id is null then
    insert into office_holidays(date,reason,updated_by,block_id)
    values(day,reason_text,actor_id,target_block);
   else
    update office_holidays set reason=reason_text,updated_by=actor_id,updated_at=now()
    where id=holiday.id;
   end if;
  elsif holiday.id is not null then
   delete from office_holidays where id=holiday.id;
  end if;
  insert into audit_logs(actor_id,action,target_id,reason,block_id)
  values(actor_id,action_name,day::text,action_name,coalesce(target_block,actor.block_id));
  return jsonb_build_object('date',day,'block_id',target_block);
 elsif action_name='publish_notice' then
  if coalesce(length(trim(payload->>'title')),0) not between 3 and 150
   or coalesce(length(trim(payload->>'body')),0) not between 3 and 4000 then
   raise exception 'PORTAL:Notice title and message required'; end if;
  insert into office_notices(title,body,created_by,block_id)
  values(trim(payload->>'title'),trim(payload->>'body'),actor_id,target_block)
  returning * into item;
  insert into audit_logs(actor_id,action,target_id,reason,block_id)
  values(actor_id,action_name,item.id::text,action_name,coalesce(target_block,actor.block_id));
  return to_jsonb(item);
 elsif action_name='remove_notice' then
  select * into item from office_notices where id=(payload->>'id')::uuid and deleted_at is null for update;
  if item.id is null or (actor.role='bpro' and item.block_id is distinct from actor.block_id) then
   raise exception 'PORTAL:This notice is outside your block'; end if;
  update office_notices set deleted_at=now() where id=item.id;
  insert into audit_logs(actor_id,action,target_id,reason,block_id)
  values(actor_id,action_name,item.id::text,action_name,coalesce(item.block_id,actor.block_id));
  return jsonb_build_object('id',item.id);
 end if;
 raise exception 'PORTAL:Invalid office action';
end $$;
revoke all on function public.manage_office_board(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.manage_office_board(uuid,text,jsonb) to service_role;

create or replace function public.enforce_working_day() returns trigger
language plpgsql security definer set search_path=public as $$
declare holiday_reason text; sunday boolean;
begin
 if new.deleted_at is not null then return new; end if;
 if TG_OP='UPDATE' and new.date is not distinct from old.date
  and new.time_in is not distinct from old.time_in
  and new.time_out is not distinct from old.time_out
  and new.status is not distinct from old.status
  and new.phase is not distinct from old.phase then return new; end if;
 perform pg_advisory_xact_lock_shared(hashtextextended('office-day:'||new.date::text,0));
 sunday=extract(dow from new.date)=0;
 select string_agg(reason,' • ' order by block_id nulls first) into holiday_reason
 from office_holidays where date=new.date and (block_id is null or block_id=new.block_id);
 if sunday or holiday_reason is not null then
  raise exception 'PORTAL:Holiday (%). Attendance is closed.',
   concat_ws(' • ',case when sunday then 'Sunday' end,holiday_reason);
 end if;
 return new;
end $$;

notify pgrst, 'reload schema';
commit;

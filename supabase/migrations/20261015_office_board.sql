begin;
create table if not exists public.office_holidays (
 date date primary key,
 reason text not null check(length(trim(reason)) between 3 and 200),
 updated_by uuid not null references public.profiles(id),
 updated_at timestamptz not null default now()
);
create table if not exists public.office_notices (
 id uuid primary key default gen_random_uuid(),
 title text not null check(length(trim(title)) between 3 and 150),
 body text not null check(length(trim(body)) between 3 and 4000),
 created_by uuid not null references public.profiles(id),
 created_at timestamptz not null default now(),
 deleted_at timestamptz
);
create index if not exists office_notices_visible_idx on public.office_notices(created_at desc) where deleted_at is null;
alter table public.office_holidays enable row level security;
alter table public.office_notices enable row level security;
revoke all on public.office_holidays,public.office_notices from anon,authenticated;
grant select on public.office_holidays,public.office_notices to authenticated;
grant all on public.office_holidays,public.office_notices to service_role;
drop policy if exists office_holidays_read on public.office_holidays;
create policy office_holidays_read on public.office_holidays for select to authenticated using(exists(select 1 from public.profiles where id=auth.uid() and active and deleted_at is null));
drop policy if exists office_notices_read on public.office_notices;
create policy office_notices_read on public.office_notices for select to authenticated using(deleted_at is null and exists(select 1 from public.profiles where id=auth.uid() and active and deleted_at is null));

create or replace function public.manage_office_board(actor_id uuid, action_name text, payload jsonb) returns jsonb language plpgsql security definer set search_path=public as $$
declare actor profiles; day date; reason_text text; item office_notices; previous jsonb;
begin
 select * into actor from profiles where id=actor_id;
 if not found or not actor.active or actor.deleted_at is not null or actor.role not in ('super_admin','block_admin') then raise exception 'PORTAL:यह कार्रवाई केवल अधिकृत एडमिन के लिए है।'; end if;
 if action_name in ('set_holiday','remove_holiday') then
  if coalesce(payload->>'date','') !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'PORTAL:मान्य तारीख चुनें।'; end if;
  day=(payload->>'date')::date;
  perform pg_advisory_xact_lock(hashtextextended('office-day:'||day::text,0));
  select to_jsonb(h) into previous from office_holidays h where date=day;
  if action_name='set_holiday' then
   reason_text=trim(payload->>'reason');
   if coalesce(length(reason_text),0) not between 3 and 200 then raise exception 'PORTAL:अवकाश का कारण आवश्यक है (3–200 अक्षर)।'; end if;
   insert into office_holidays(date,reason,updated_by) values(day,reason_text,actor_id) on conflict(date) do update set reason=excluded.reason,updated_by=excluded.updated_by,updated_at=now();
  else
   delete from office_holidays where date=day;
  end if;
  insert into audit_logs(actor_id,action,target_id,reason,details) values(actor_id,action_name,day::text,coalesce(reason_text,'Holiday removed'),jsonb_build_object('previous',previous,'new',payload));
  return jsonb_build_object('date',day);
 elsif action_name='publish_notice' then
  if coalesce(length(trim(payload->>'title')),0) not between 3 and 150 or coalesce(length(trim(payload->>'body')),0) not between 3 and 4000 then raise exception 'PORTAL:सूचना का शीर्षक और संदेश आवश्यक है।'; end if;
  insert into office_notices(title,body,created_by) values(trim(payload->>'title'),trim(payload->>'body'),actor_id) returning * into item;
  insert into audit_logs(actor_id,action,target_id,reason,details) values(actor_id,action_name,item.id::text,'Notice published',to_jsonb(item));
  return to_jsonb(item);
 elsif action_name='remove_notice' then
  select * into item from office_notices where id=(payload->>'id')::uuid and deleted_at is null for update;
  if not found then raise exception 'PORTAL:सूचना नहीं मिली।'; end if;
  update office_notices set deleted_at=now() where id=item.id;
  insert into audit_logs(actor_id,action,target_id,reason,details) values(actor_id,action_name,item.id::text,'Notice removed',to_jsonb(item));
  return jsonb_build_object('id',item.id);
 end if;
 raise exception 'PORTAL:कार्रवाई अमान्य।';
end $$;
revoke all on function public.manage_office_board(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.manage_office_board(uuid,text,jsonb) to service_role;

create or replace function public.enforce_working_day() returns trigger language plpgsql security definer set search_path=public as $$
declare holiday_reason text; sunday boolean;
begin
 -- Preserve historical data and allow audited soft-deletion. Every new record,
 -- changed date or new arrival/departure/status must obey the calendar.
 if new.deleted_at is not null then return new; end if;
 if TG_OP='UPDATE' then
  if new.date is not distinct from old.date and new.time_in is not distinct from old.time_in and new.time_out is not distinct from old.time_out and new.status is not distinct from old.status and new.phase is not distinct from old.phase then return new; end if;
 end if;
 perform pg_advisory_xact_lock_shared(hashtextextended('office-day:'||new.date::text,0));
 sunday=extract(dow from new.date)=0;
 select reason into holiday_reason from office_holidays where date=new.date;
 if sunday or holiday_reason is not null then
  raise exception 'PORTAL:अवकाश / Holiday (%). उपस्थिति दर्ज नहीं की जा सकती। / Attendance is closed.',concat_ws(' • ',case when sunday then 'रविवार / Sunday' end,holiday_reason);
 end if;
 return new;
end $$;
drop trigger if exists attendance_working_day on public.attendance;
create trigger attendance_working_day before insert or update on public.attendance for each row execute function public.enforce_working_day();
NOTIFY pgrst, 'reload schema';
commit;

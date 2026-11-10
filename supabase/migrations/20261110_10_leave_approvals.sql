-- Apply after 20261109_09. Existing attendance and approved leave remain unchanged.
-- Staff applications are separate from attendance until an authorized admin approves.
begin;

create table if not exists public.leave_applications (
 id uuid primary key default gen_random_uuid(),
 staff_id uuid not null references public.profiles(id),
 block_id uuid not null references public.blocks(id),
 staff_name text not null,
 date date not null,
 panchayat text not null,
 position text not null,
 department text not null default 'पंचायती राज विभाग'
  check(department='पंचायती राज विभाग'),
 assignments jsonb not null default '[]'::jsonb,
 leave_type text not null check(leave_type in ('CL','SL')),
 leave_path text not null,
 status text not null default 'pending' check(status in ('pending','approved','rejected')),
 decided_by uuid references public.profiles(id),
 decided_at timestamptz,
 attendance_id uuid references public.attendance(id),
 created_at timestamptz not null default now(),
 check((status='pending' and decided_by is null and decided_at is null and attendance_id is null)
    or (status='rejected' and decided_by is not null and decided_at is not null and attendance_id is null)
    or (status='approved' and decided_by is not null and decided_at is not null and attendance_id is not null))
);
create unique index if not exists leave_applications_one_pending_day
 on public.leave_applications(staff_id,date) where status='pending';
create index if not exists leave_applications_block_pending
 on public.leave_applications(block_id,created_at desc) where status='pending';
create index if not exists leave_applications_staff_day
 on public.leave_applications(staff_id,date,created_at desc);

alter table public.leave_applications enable row level security;
drop policy if exists leave_applications_read on public.leave_applications;
create policy leave_applications_read on public.leave_applications for select to authenticated
 using(staff_id=auth.uid() or exists (
  select 1 from public.profiles actor where actor.id=auth.uid()
   and actor.active and actor.deleted_at is null
   and (actor.role='dpro' or (actor.role='bpro' and actor.block_id=leave_applications.block_id))
 ));
revoke all on public.leave_applications from public,anon,authenticated;
grant select on public.leave_applications to authenticated;
grant all on public.leave_applications to service_role;

-- A pending application reserves today's attendance slot. Approval is the
-- only path that can turn that application into an attendance leave record.
create or replace function public.guard_pending_leave_attendance() returns trigger
language plpgsql security definer set search_path=public as $$
begin
 if current_setting('portal.approving_leave',true)='on' then return new; end if;
 if exists(select 1 from leave_applications r where r.staff_id=new.staff_id
   and r.date=new.date and r.status='pending') then
  raise exception 'PORTAL:अवकाश आवेदन लंबित है। पहले निर्णय आवश्यक है।';
 end if;
 return new;
end $$;
drop trigger if exists attendance_pending_leave_guard on public.attendance;
create trigger attendance_pending_leave_guard before insert on public.attendance
 for each row execute function public.guard_pending_leave_attendance();

create or replace function public.submit_leave_application(
 panchayat_name text, position_name text, leave_kind text, document_path text
) returns jsonb language plpgsql security definer set search_path=public as $$
declare actor public.profiles; upload public.pending_uploads;
 request_row public.leave_applications;
 today date=(now() at time zone 'Asia/Kolkata')::date;
begin
 select * into actor from public.profiles where id=auth.uid();
 if actor.id is null or not actor.active or actor.deleted_at is not null or actor.role<>'staff' then
  raise exception 'PORTAL:केवल सक्रिय कर्मी अवकाश आवेदन कर सकते हैं।';
 end if;
 perform pg_advisory_xact_lock(hashtextextended(actor.id::text||today::text,0));
 if extract(isodow from today)=7 or exists(select 1 from public.office_holidays h
  where h.date=today and (h.block_id is null or h.block_id=actor.block_id)) then
  raise exception 'PORTAL:अवकाश के दिन उपस्थिति या आवेदन नहीं हो सकता।';
 end if;
 if leave_kind not in ('CL','SL') or leave_kind is null then
  raise exception 'PORTAL:CL या SL चुनें।';
 end if;
 if leave_kind='SL' and actor.gender is distinct from 'female' then
  raise exception 'PORTAL:SL केवल महिला कर्मियों के लिए है।';
 end if;
 if not exists(select 1 from jsonb_array_elements(actor.assignments) a
  where a->>'panchayat'=panchayat_name and a->>'position'=position_name
   and a->>'department'='पंचायती राज विभाग'
   and a->>'block_id'=actor.block_id::text) then
  raise exception 'PORTAL:नियुक्त कार्यस्थल या पद अमान्य है।';
 end if;
 if exists(select 1 from public.attendance a where a.staff_id=actor.id
  and a.date=today and a.deleted_at is null) or exists(
   select 1 from public.leave_applications r where r.staff_id=actor.id
    and r.date=today and r.status='pending') then
  raise exception 'PORTAL:आज की उपस्थिति या अवकाश आवेदन पहले से दर्ज है।';
 end if;
 if document_path is null or document_path !~ '^[A-Za-z0-9/_.-]+$'
  or position('..' in document_path)>0
  or document_path not like actor.block_id::text||'/'||actor.id::text||'/'||today::text||'/%' then
  raise exception 'PORTAL:अवकाश दस्तावेज अमान्य है।';
 end if;
 select * into upload from public.pending_uploads u where u.path=document_path
  and u.staff_id=actor.id and u.block_id=actor.block_id for update;
 if upload.path is null or upload.consumed or upload.expires_at<now() then
  raise exception 'PORTAL:अपलोड समय सीमा समाप्त है। फिर से दस्तावेज भेजें।';
 end if;
 insert into public.leave_applications(staff_id,block_id,staff_name,date,
  panchayat,position,assignments,leave_type,leave_path)
 values(actor.id,actor.block_id,actor.name,today,panchayat_name,position_name,
  actor.assignments,leave_kind,document_path) returning * into request_row;
 update public.pending_uploads set consumed=true where path=document_path;
 insert into public.audit_logs(actor_id,action,target_id,reason,block_id)
 values(actor.id,'submit_leave_application',request_row.id::text,
  'Staff submitted leave application',actor.block_id);
 return to_jsonb(request_row);
end $$;
revoke all on function public.submit_leave_application(text,text,text,text)
 from public,anon,authenticated;
grant execute on function public.submit_leave_application(text,text,text,text)
 to authenticated;

create or replace function public.decide_leave_application(
 request_id uuid, approve boolean
) returns jsonb language plpgsql security definer set search_path=public as $$
declare actor public.profiles; staff public.profiles;
 request_row public.leave_applications; saved public.attendance;
begin
 select * into actor from public.profiles where id=auth.uid();
 if actor.id is null or not actor.active or actor.deleted_at is not null
  or actor.role not in ('bpro','dpro') then
  raise exception 'PORTAL:केवल प्रशासक अवकाश का निर्णय कर सकते हैं।';
 end if;
 if approve is null then raise exception 'PORTAL:निर्णय अमान्य है।'; end if;
 select * into request_row from public.leave_applications where id=request_id for update;
 if request_row.id is null or (actor.role='bpro' and actor.block_id<>request_row.block_id) then
  raise exception 'PORTAL:यह आवेदन आपके प्रखंड का नहीं है।';
 end if;
 if request_row.status<>'pending' then
  raise exception 'PORTAL:इस आवेदन पर पहले ही निर्णय हो चुका है।';
 end if;
 perform pg_advisory_xact_lock(hashtextextended(
  request_row.staff_id::text||request_row.date::text,0));
 if approve then
  select * into staff from public.profiles where id=request_row.staff_id;
  if staff.id is null or not staff.active or staff.deleted_at is not null
   or staff.block_id<>request_row.block_id then
   raise exception 'PORTAL:कर्मी का प्रखंड या खाता बदल गया है।';
  end if;
  if exists(select 1 from public.attendance a where a.staff_id=request_row.staff_id
   and a.date=request_row.date and a.deleted_at is null) then
   raise exception 'PORTAL:इस दिन की उपस्थिति पहले से दर्ज है।';
  end if;
  perform set_config('portal.approving_leave','on',true);
  insert into public.attendance(staff_id,date,panchayat,department,position,
   block,block_id,staff_name,status,phase,leave_type,leave_path,working_places,flags)
  values(request_row.staff_id,request_row.date,request_row.panchayat,
   request_row.department,request_row.position,staff.block,request_row.block_id,
   request_row.staff_name,'leave','submitted',request_row.leave_type,
   request_row.leave_path,request_row.assignments,'{}')
  returning * into saved;
  update public.leave_applications set status='approved',decided_by=actor.id,
   decided_at=now(),attendance_id=saved.id where id=request_id
   returning * into request_row;
 else
  update public.leave_applications set status='rejected',decided_by=actor.id,
   decided_at=now() where id=request_id returning * into request_row;
 end if;
 insert into public.audit_logs(actor_id,action,target_id,reason,block_id)
 values(actor.id,case when approve then 'approve_leave_application'
  else 'reject_leave_application' end,request_row.id::text,
  'Administrator decided leave application',request_row.block_id);
 return to_jsonb(request_row);
end $$;
revoke all on function public.decide_leave_application(uuid,boolean)
 from public,anon,authenticated;
grant execute on function public.decide_leave_application(uuid,boolean)
 to authenticated;

notify pgrst, 'reload schema';
commit;

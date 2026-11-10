-- Apply after 20261110_10. Preserve all existing applications and attendance.
begin;

alter table public.leave_applications add column if not exists decision_document_path text;
alter table public.leave_applications add column if not exists decision_method text;
alter table public.leave_applications add column if not exists rejection_reason text;
alter table public.leave_applications drop constraint if exists leave_applications_decision_method_check;
alter table public.leave_applications add constraint leave_applications_decision_method_check
 check (decision_method is null or decision_method in ('drawn','uploaded'));
create index if not exists leave_applications_decided_at
 on public.leave_applications(decided_at desc) where decided_at is not null;

-- Only the server can register a document that has been checked and stored.
create table if not exists public.leave_decision_documents (
 path text primary key,
 request_id uuid not null references public.leave_applications(id),
 actor_id uuid not null references public.profiles(id),
 block_id uuid not null references public.blocks(id),
 method text not null check(method in ('drawn','uploaded')),
 consumed boolean not null default false,
 created_at timestamptz not null default now()
);
alter table public.leave_decision_documents enable row level security;
revoke all on public.leave_decision_documents from public,anon,authenticated;
grant all on public.leave_decision_documents to service_role;

-- Retire the earlier decision entry point so an approved application always
-- receives a signed copy, and a rejected application always has a reason.
revoke execute on function public.decide_leave_application(uuid,boolean)
 from public,anon,authenticated,service_role;

create or replace function public.decide_leave_application_v2(
 request_id uuid, approve boolean, decision_path text, reason_text text
) returns jsonb language plpgsql security definer set search_path=public as $$
declare actor public.profiles; staff public.profiles;
 request_row public.leave_applications; saved public.attendance;
 document_row public.leave_decision_documents; clean_reason text;
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
 clean_reason:=nullif(btrim(reason_text),'');
 if approve then
  if decision_path is null or decision_path !~ '^[A-Za-z0-9/_.-]+$'
   or position('..' in decision_path)>0
   or decision_path not like request_row.block_id::text||'/'||request_row.staff_id::text
       ||'/leave-decisions/'||request_row.id::text||'/%' then
   raise exception 'PORTAL:हस्ताक्षरित दस्तावेज आवश्यक है।';
  end if;
  select * into document_row from public.leave_decision_documents d
   where d.path=decision_path and d.request_id=request_row.id and d.actor_id=actor.id
    and d.block_id=request_row.block_id and not d.consumed for update;
  if document_row.path is null then
   raise exception 'PORTAL:हस्ताक्षरित दस्तावेज मान्य नहीं है।';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(
   request_row.staff_id::text||request_row.date::text,0));
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
  update public.leave_decision_documents set consumed=true where path=decision_path;
  update public.leave_applications set status='approved',decided_by=actor.id,
   decided_at=now(),attendance_id=saved.id,decision_document_path=decision_path,
   decision_method=document_row.method,rejection_reason=null
   where id=request_id returning * into request_row;
 else
  if clean_reason is null or length(clean_reason)<3 or length(clean_reason)>1000 then
   raise exception 'PORTAL:अस्वीकृति का कारण 3 से 1000 अक्षरों में लिखें।';
  end if;
  update public.leave_applications set status='rejected',decided_by=actor.id,
   decided_at=now(),rejection_reason=clean_reason
   where id=request_id returning * into request_row;
 end if;
 insert into public.audit_logs(actor_id,action,target_id,reason,block_id)
 values(actor.id,case when approve then 'approve_leave_application'
  else 'reject_leave_application' end,request_row.id::text,
  'Administrator decided leave application',request_row.block_id);
 return to_jsonb(request_row);
end $$;
revoke all on function public.decide_leave_application_v2(uuid,boolean,text,text)
 from public,anon,authenticated;
grant execute on function public.decide_leave_application_v2(uuid,boolean,text,text)
 to authenticated;

notify pgrst, 'reload schema';
commit;

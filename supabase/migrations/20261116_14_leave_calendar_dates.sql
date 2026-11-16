-- Add calendar dates to leave requests without changing historical attendance.
-- Existing single-day applications become one-element date arrays.
begin;

alter table public.leave_applications add column if not exists leave_dates date[];
update public.leave_applications set leave_dates=array[date]
 where leave_dates is null or cardinality(leave_dates)=0;
alter table public.leave_applications alter column leave_dates set not null;
alter table public.leave_applications drop constraint if exists leave_applications_dates_valid;
alter table public.leave_applications add constraint leave_applications_dates_valid
 check(cardinality(leave_dates) between 1 and 366 and array_position(leave_dates,null) is null);
create index if not exists leave_applications_pending_dates
 on public.leave_applications using gin(leave_dates) where status='pending';

-- A pending multi-day request reserves every selected date, not only its first date.
create or replace function public.guard_pending_leave_attendance() returns trigger
language plpgsql security definer set search_path=public as $$
begin
 if current_setting('portal.approving_leave',true)='on' then return new; end if;
 if exists(select 1 from public.leave_applications r where r.staff_id=new.staff_id
  and new.date=any(r.leave_dates) and r.status='pending') then
  raise exception 'PORTAL:अवकाश आवेदन लंबित है। पहले निर्णय आवश्यक है।';
 end if;
 return new;
end $$;

-- The server passes a sorted calendar selection. All checks are repeated here
-- because callers can invoke an authenticated RPC without the web form.
create or replace function public.submit_leave_application_v3(
 panchayat_name text, position_name text, leave_kind text,
 document_path text, leave_detail_text text, requested_dates date[]
) returns jsonb language plpgsql security definer set search_path=public as $$
declare actor public.profiles; upload public.pending_uploads;
 request_row public.leave_applications; dates date[]; work_dates date[];
 today date=(now() at time zone 'Asia/Kolkata')::date;
begin
 select * into actor from public.profiles where id=auth.uid();
 if actor.id is null or not actor.active or actor.deleted_at is not null or actor.role<>'staff' then
  raise exception 'PORTAL:केवल सक्रिय कर्मी अवकाश आवेदन कर सकते हैं।';
 end if;
 if requested_dates is null or cardinality(requested_dates) not between 1 and 366
  or array_position(requested_dates,null) is not null then
  raise exception 'PORTAL:अवकाश की 1 से 366 तारीखें चुनें।';
 end if;
 select array_agg(d order by d) into dates from (select distinct unnest(requested_dates) as d) x;
 if cardinality(dates)<>cardinality(requested_dates)
  or dates[cardinality(dates)]-dates[1]>365 then
  raise exception 'PORTAL:तारीखें दोहराई गई हैं या 366 दिन से अधिक फैली हैं।';
 end if;
 perform pg_advisory_xact_lock(hashtextextended('leave-request:'||actor.id::text,0));
 if leave_kind not in ('CL','SL','MATERNITY','PATERNITY','OTHER') or leave_kind is null then
  raise exception 'PORTAL:अवकाश प्रकार चुनें।';
 end if;
 if leave_kind in ('SL','MATERNITY') and actor.gender is distinct from 'female' then
  raise exception 'PORTAL:यह अवकाश केवल महिला कर्मियों के लिए है।';
 end if;
 if leave_kind='PATERNITY' and actor.gender is distinct from 'male' then
  raise exception 'PORTAL:Paternity leave only for male staff.';
 end if;
 if leave_kind in ('MATERNITY','PATERNITY','OTHER') and
  (coalesce(length(btrim(leave_detail_text)),0)<3 or length(leave_detail_text)>500) then
  raise exception 'PORTAL:Leave type/reason required.';
 end if;
 if not exists(select 1 from jsonb_array_elements(actor.assignments) a
  where a->>'panchayat'=panchayat_name and a->>'position'=position_name
   and a->>'department'='पंचायती राज विभाग'
   and a->>'block_id'=actor.block_id::text) then
  raise exception 'PORTAL:नियुक्त कार्यस्थल या पद अमान्य है।';
 end if;
 select array_agg(d order by d) into work_dates from unnest(dates) d
  where extract(isodow from d)<>7
   and not exists(select 1 from public.office_holidays h where h.date=d
    and (h.block_id is null or h.block_id=actor.block_id));
 if coalesce(cardinality(work_dates),0)=0 then
  raise exception 'PORTAL:चुनी गई सभी तारीखें रविवार या छुट्टी हैं।';
 end if;
 if exists(select 1 from public.attendance a where a.staff_id=actor.id
  and a.date=any(work_dates) and a.deleted_at is null) or exists(
   select 1 from public.leave_applications r where r.staff_id=actor.id
    and r.status='pending' and r.leave_dates && dates) then
  raise exception 'PORTAL:किसी चुनी गई तारीख पर उपस्थिति या आवेदन पहले से दर्ज है।';
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
 insert into public.leave_applications(staff_id,block_id,staff_name,date,leave_dates,
  panchayat,position,assignments,leave_type,leave_path,leave_detail)
 values(actor.id,actor.block_id,actor.name,dates[1],dates,panchayat_name,position_name,
  actor.assignments,leave_kind,document_path,nullif(btrim(leave_detail_text),''))
 returning * into request_row;
 update public.pending_uploads set consumed=true where path=document_path;
 insert into public.audit_logs(actor_id,action,target_id,reason,block_id)
 values(actor.id,'submit_leave_application',request_row.id::text,
  'Staff submitted leave application',actor.block_id);
 return to_jsonb(request_row);
end $$;
revoke all on function public.submit_leave_application_v3(text,text,text,text,text,date[])
 from public,anon,authenticated;
grant execute on function public.submit_leave_application_v3(text,text,text,text,text,date[])
 to authenticated;
revoke execute on function public.submit_leave_application_v2(text,text,text,text,text)
 from public,anon,authenticated,service_role;
revoke execute on function public.submit_leave_application(text,text,text,text)
 from public,anon,authenticated,service_role;

-- One approval makes one attendance row per working date. Quota triggers run
-- on each row, and PostgreSQL rolls back the entire decision if one fails.
create or replace function public.decide_leave_application_v2(
 request_id uuid, approve boolean, decision_path text, reason_text text
) returns jsonb language plpgsql security definer set search_path=public as $$
declare actor public.profiles; staff public.profiles;
 request_row public.leave_applications; saved public.attendance;
 document_row public.leave_decision_documents; clean_reason text;
 selected_date date; first_attendance_id uuid; work_count integer:=0;
begin
 select * into actor from public.profiles where id=auth.uid();
 if actor.id is null or not actor.active or actor.deleted_at is not null
  or actor.role not in ('bpro','dpro') then
  raise exception 'PORTAL:केवल प्रशासक अवकाश का निर्णय कर सकते हैं।';
 end if;
 if approve is null then raise exception 'PORTAL:निर्णय अमान्य है।'; end if;
 select * into request_row from public.leave_applications where id=request_id;
 if request_row.id is null or (actor.role='bpro' and actor.block_id<>request_row.block_id) then
  raise exception 'PORTAL:यह आवेदन आपके प्रखंड का नहीं है।';
 end if;
 if request_row.status<>'pending' then
  raise exception 'PORTAL:इस आवेदन पर पहले ही निर्णय हो चुका है।';
 end if;
 perform pg_advisory_xact_lock(hashtextextended('leave-request:'||request_row.staff_id::text,0));
 select * into request_row from public.leave_applications where id=request_id for update;
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
  select * into staff from public.profiles where id=request_row.staff_id;
  if staff.id is null or not staff.active or staff.deleted_at is not null
   or staff.block_id<>request_row.block_id then
   raise exception 'PORTAL:कर्मी का प्रखंड या खाता बदल गया है।';
  end if;
  perform set_config('portal.approving_leave','on',true);
  for selected_date in select distinct unnest(request_row.leave_dates) order by 1 loop
   if extract(isodow from selected_date)=7 or exists(
    select 1 from public.office_holidays h where h.date=selected_date
     and (h.block_id is null or h.block_id=request_row.block_id)) then
    continue;
   end if;
   if exists(select 1 from public.attendance a where a.staff_id=request_row.staff_id
    and a.date=selected_date and a.deleted_at is null) then
    raise exception 'PORTAL:किसी चुनी गई तारीख पर उपस्थिति पहले से दर्ज है।';
   end if;
   insert into public.attendance(staff_id,date,panchayat,department,position,
    block,block_id,staff_name,status,phase,leave_type,leave_path,working_places,flags)
   values(request_row.staff_id,selected_date,request_row.panchayat,
    request_row.department,request_row.position,staff.block,request_row.block_id,
    request_row.staff_name,'leave','submitted',request_row.leave_type,
    request_row.leave_path,request_row.assignments,'{}') returning * into saved;
   first_attendance_id:=coalesce(first_attendance_id,saved.id);
   work_count:=work_count+1;
  end loop;
  if work_count=0 then
   raise exception 'PORTAL:चुनी गई सभी तारीखें रविवार या छुट्टी हैं।';
  end if;
  update public.leave_decision_documents set consumed=true where path=decision_path;
  update public.leave_applications set status='approved',decided_by=actor.id,
   decided_at=now(),attendance_id=first_attendance_id,decision_document_path=decision_path,
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

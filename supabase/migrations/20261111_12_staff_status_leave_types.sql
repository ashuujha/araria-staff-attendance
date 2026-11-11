-- Apply after 20261110_11. Preserve historical attendance and leave applications.
begin;
alter table public.attendance drop constraint if exists attendance_status_check;
alter table public.attendance add constraint attendance_status_check check(status in ('present','absent','leave','deputation','on_duty'));
alter table public.attendance drop constraint if exists attendance_leave_type_check;
alter table public.attendance add constraint attendance_leave_type_check check(leave_type is null or leave_type in ('CL','SL','MATERNITY','PATERNITY','OTHER'));
alter table public.leave_applications drop constraint if exists leave_applications_leave_type_check;
alter table public.leave_applications add constraint leave_applications_leave_type_check check(leave_type in ('CL','SL','MATERNITY','PATERNITY','OTHER'));
alter table public.leave_applications add column if not exists leave_detail text;
create or replace function public.save_attendance_with_evidence(user_id uuid,action_name text,panchayat_name text,department_name text,position_name text,status_name text,workplace_name text,leave_kind text,device_hash text,photo_path text default null,leave_path text default null,lat double precision default null,lng double precision default null,acc double precision default null,capture_id uuid default null,image_hash text default null,perceptual_hash text default null,request_ip text default null,request_agent text default null,absence_reason text default null) returns jsonb language plpgsql security definer set search_path=public as $$
declare p profiles; r attendance; upload pending_uploads; upload_path text; f text[]='{}'; d date=(now() at time zone 'Asia/Kolkata')::date;
begin
 if auth.uid() is distinct from user_id then raise exception 'PORTAL:कर्मी की पहचान अमान्य है।'; end if;
 perform pg_advisory_xact_lock(hashtextextended(user_id::text||d::text,0));
 select * into p from profiles where id=user_id;
 if not found or not p.active or p.deleted_at is not null or p.role<>'staff' then raise exception 'PORTAL:खाता मान्य नहीं है।'; end if;
 if capture_id is not null or image_hash is not null or perceptual_hash is not null then raise exception 'PORTAL:कैमरा सत्यापन विवरण अमान्य है।'; end if;
 if lat is not null or lng is not null or acc is not null then
  if action_name<>'save_draft' or lat is null or lng is null or acc is null or lat not between -90 and 90 or lng not between -180 and 180 or acc<=0 or acc>1000000 or lat='NaN'::float8 or lng='NaN'::float8 or acc='NaN'::float8 then raise exception 'PORTAL:कैमरा स्थान अमान्य है।'; end if;
 end if;
 select * into r from attendance where staff_id=user_id and date=d and deleted_at is null for update;
 if action_name='complete' then
  if r.id is null or r.phase<>'draft' or r.status not in ('present','deputation','on_duty') or r.time_in is null or r.time_out is not null then raise exception 'PORTAL:आज का कार्यस्थल प्रवेश ड्राफ्ट आवश्यक है।'; end if;
  update attendance set time_out=clock_timestamp(),phase='submitted',version=version+1 where id=r.id returning * into r;
  return to_jsonb(r);
 end if;
 if action_name is null or status_name is null or action_name not in ('save_draft','save_status') or status_name not in ('present','absent','leave','deputation','on_duty') or (action_name='save_draft')<>(status_name in ('present','deputation','on_duty')) then raise exception 'PORTAL:स्थिति या कार्रवाई अमान्य है।'; end if;
 if r.id is not null then raise exception 'PORTAL:आज की उपस्थिति पहले से दर्ज है।'; end if;
 if coalesce(length(trim(department_name)),0)=0 or coalesce(length(trim(position_name)),0)=0 or not exists(select 1 from jsonb_array_elements(p.assignments) a where a->>'panchayat'=panchayat_name and a->>'department'=department_name and a->>'position'=position_name) then raise exception 'PORTAL:पंचायत, विभाग या पद नियुक्ति मान्य नहीं है।'; end if;
 if status_name in ('deputation','on_duty') and (coalesce(length(trim(workplace_name)),0)<2 or length(workplace_name)>200) then raise exception 'PORTAL:प्रतिनियुक्ति कार्यस्थल का नाम आवश्यक है।'; end if;
 if status_name in ('present','deputation','on_duty') and coalesce(length(trim(save_attendance_with_evidence.photo_path)),0)=0 then raise exception 'PORTAL:कार्यस्थल की JPEG/PNG फोटो आवश्यक है।'; end if;
 if status_name in ('absent','on_duty') and (coalesce(length(trim(absence_reason)),0)<3 or length(trim(absence_reason))>1000) then raise exception 'PORTAL:अनुपस्थिति का कारण आवश्यक है (3–1000 अक्षर)।'; end if;
 if status_name='leave' and (leave_kind is null or leave_kind not in ('CL','SL')) then raise exception 'PORTAL:CL या SL चुनें।'; end if;
 if status_name='leave' and coalesce(length(trim(save_attendance_with_evidence.leave_path)),0)=0 then raise exception 'PORTAL:अवकाश के लिए JPEG/PDF दस्तावेज आवश्यक है।'; end if;
 if status_name<>'leave' and (leave_kind is not null or save_attendance_with_evidence.leave_path is not null) then raise exception 'PORTAL:अवकाश दस्तावेज केवल अवकाश के लिए है।'; end if;
 if status_name not in ('present','deputation','on_duty') and save_attendance_with_evidence.photo_path is not null then raise exception 'PORTAL:फोटो केवल कार्यस्थल उपस्थिति के लिए है।'; end if;
 foreach upload_path in array ARRAY[save_attendance_with_evidence.photo_path,save_attendance_with_evidence.leave_path] loop
  if upload_path is null then continue; end if;
  if upload_path not like p.block_id::text||'/'||user_id::text||'/'||d::text||'/%' then raise exception 'PORTAL:फ़ाइल का स्वामी अमान्य है।'; end if;
  select * into upload from pending_uploads where pending_uploads.path=upload_path and staff_id=user_id for update;
  if not found or upload.consumed or upload.expires_at<now() then raise exception 'PORTAL:अपलोड समय सीमा समाप्त या अमान्य।'; end if;
 end loop;
 insert into attendance(staff_id,date,panchayat,department,position,block,staff_name,status,phase,deputation_workplace,leave_type,time_in,latitude,longitude,accuracy,photo_path,photo_hash,leave_path,working_places,flags,request_ip,request_agent,absence_reason)
 values(user_id,d,panchayat_name,department_name,position_name,p.block,p.name,status_name,case when action_name='save_draft' then 'draft' else 'submitted' end,case when status_name in ('deputation','on_duty') then trim(workplace_name) end,case when status_name='leave' then leave_kind end,case when action_name='save_draft' then clock_timestamp() end,case when action_name='save_draft' then lat end,case when action_name='save_draft' then lng end,case when action_name='save_draft' then acc end,save_attendance_with_evidence.photo_path,image_hash,save_attendance_with_evidence.leave_path,p.assignments,f,save_attendance_with_evidence.request_ip,save_attendance_with_evidence.request_agent,case when status_name in ('absent','on_duty') then trim(absence_reason) end) returning * into r;
 update pending_uploads set consumed=true where pending_uploads.path in (save_attendance_with_evidence.photo_path,save_attendance_with_evidence.leave_path);
 return to_jsonb(r);
end $$;
revoke all on function public.save_attendance_with_evidence(uuid,text,text,text,text,text,text,text,text,text,text,double precision,double precision,double precision,uuid,text,text,text,text,text) from public,anon;
grant execute on function public.save_attendance_with_evidence(uuid,text,text,text,text,text,text,text,text,text,text,double precision,double precision,double precision,uuid,text,text,text,text,text) to authenticated;
create or replace function public.submit_leave_application_v2(
 panchayat_name text, position_name text, leave_kind text, document_path text, leave_detail_text text
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
 if leave_kind not in ('CL','SL','MATERNITY','PATERNITY','OTHER') or leave_kind is null then
  raise exception 'PORTAL:CL या SL चुनें।';
 end if;
 if leave_kind in ('SL','MATERNITY') and actor.gender is distinct from 'female' then
  raise exception 'PORTAL:SL केवल महिला कर्मियों के लिए है।';
 end if;
 if leave_kind='PATERNITY' and actor.gender is distinct from 'male' then raise exception 'PORTAL:Paternity leave only for male staff.'; end if;
 if leave_kind in ('MATERNITY','PATERNITY','OTHER') and (coalesce(length(btrim(leave_detail_text)),0)<3 or length(leave_detail_text)>500) then raise exception 'PORTAL:Leave type/reason required.'; end if;
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
  panchayat,position,assignments,leave_type,leave_path,leave_detail)
 values(actor.id,actor.block_id,actor.name,today,panchayat_name,position_name,
  actor.assignments,leave_kind,document_path,nullif(btrim(leave_detail_text),'')) returning * into request_row;
 update public.pending_uploads set consumed=true where path=document_path;
 insert into public.audit_logs(actor_id,action,target_id,reason,block_id)
 values(actor.id,'submit_leave_application',request_row.id::text,
  'Staff submitted leave application',actor.block_id);
 return to_jsonb(request_row);
end $$;
revoke all on function public.submit_leave_application_v2(text,text,text,text,text) from public,anon,authenticated;
grant execute on function public.submit_leave_application_v2(text,text,text,text,text) to authenticated;
-- Staff see approved dates in their history, while remaining allowances stay admin-only.
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
  where p.role='staff' and p.deleted_at is null and exists (
   select 1 from profiles actor where actor.id=auth.uid()
    and actor.role in ('bpro','dpro') and actor.active and actor.deleted_at is null
  )
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

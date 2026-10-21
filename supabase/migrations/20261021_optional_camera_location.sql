begin;

-- Camera coordinates are optional device reports. Gallery uploads continue to
-- work without location; no geofence or 50 m accuracy requirement is restored.
create or replace function public.save_attendance_with_evidence(user_id uuid,action_name text,panchayat_name text,department_name text,position_name text,status_name text,workplace_name text,leave_kind text,device_hash text,photo_path text default null,leave_path text default null,lat double precision default null,lng double precision default null,acc double precision default null,capture_id uuid default null,image_hash text default null,perceptual_hash text default null,request_ip text default null,request_agent text default null,absence_reason text default null) returns jsonb language plpgsql security definer set search_path=public as $$
declare p profiles; r attendance; upload pending_uploads; upload_path text; f text[]='{}'; d date=(now() at time zone 'Asia/Kolkata')::date;
begin
 perform pg_advisory_xact_lock(hashtextextended(user_id::text||d::text,0));
 select * into p from profiles where id=user_id;
 if not found or not p.active or p.deleted_at is not null or p.role<>'staff' then raise exception 'PORTAL:खाता मान्य नहीं है।'; end if;
 if capture_id is not null or image_hash is not null or perceptual_hash is not null then raise exception 'PORTAL:कैमरा सत्यापन विवरण अमान्य है।'; end if;
 if lat is not null or lng is not null or acc is not null then
  if action_name<>'save_draft' or lat is null or lng is null or acc is null or lat not between -90 and 90 or lng not between -180 and 180 or acc<=0 or acc>1000000 or lat='NaN'::float8 or lng='NaN'::float8 or acc='NaN'::float8 then raise exception 'PORTAL:कैमरा स्थान अमान्य है।'; end if;
 end if;
 select * into r from attendance where staff_id=user_id and date=d and deleted_at is null for update;
 if action_name='complete' then
  if r.id is null or r.phase<>'draft' or r.status not in ('present','deputation') or r.time_in is null or r.time_out is not null then raise exception 'PORTAL:आज का कार्यस्थल प्रवेश ड्राफ्ट आवश्यक है।'; end if;
  update attendance set time_out=clock_timestamp(),phase='submitted',version=version+1 where id=r.id returning * into r;
  return to_jsonb(r);
 end if;
 if action_name is null or status_name is null or action_name not in ('save_draft','save_status') or status_name not in ('present','absent','leave','deputation') or (action_name='save_draft')<>(status_name in ('present','deputation')) then raise exception 'PORTAL:स्थिति या कार्रवाई अमान्य है।'; end if;
 if r.id is not null then raise exception 'PORTAL:आज की उपस्थिति पहले से दर्ज है।'; end if;
 if coalesce(length(trim(department_name)),0)=0 or coalesce(length(trim(position_name)),0)=0 or not exists(select 1 from jsonb_array_elements(p.assignments) a where a->>'panchayat'=panchayat_name and a->>'department'=department_name and a->>'position'=position_name) then raise exception 'PORTAL:पंचायत, विभाग या पद नियुक्ति मान्य नहीं है।'; end if;
 if status_name='deputation' and (coalesce(length(trim(workplace_name)),0)<2 or length(workplace_name)>200) then raise exception 'PORTAL:प्रतिनियुक्ति कार्यस्थल का नाम आवश्यक है।'; end if;
 if status_name in ('present','deputation') and coalesce(length(trim(save_attendance_with_evidence.photo_path)),0)=0 then raise exception 'PORTAL:कार्यस्थल की JPEG/PNG फोटो आवश्यक है।'; end if;
 if status_name='absent' and (coalesce(length(trim(absence_reason)),0)<3 or length(trim(absence_reason))>1000) then raise exception 'PORTAL:अनुपस्थिति का कारण आवश्यक है (3–1000 अक्षर)।'; end if;
 if status_name='leave' and (leave_kind is null or leave_kind not in ('CL','SL')) then raise exception 'PORTAL:CL या SL चुनें।'; end if;
 if status_name='leave' and coalesce(length(trim(save_attendance_with_evidence.leave_path)),0)=0 then raise exception 'PORTAL:अवकाश के लिए JPEG/PDF दस्तावेज आवश्यक है।'; end if;
 if status_name<>'leave' and (leave_kind is not null or save_attendance_with_evidence.leave_path is not null) then raise exception 'PORTAL:अवकाश दस्तावेज केवल अवकाश के लिए है।'; end if;
 if status_name not in ('present','deputation') and save_attendance_with_evidence.photo_path is not null then raise exception 'PORTAL:फोटो केवल कार्यस्थल उपस्थिति के लिए है।'; end if;
 foreach upload_path in array ARRAY[save_attendance_with_evidence.photo_path,save_attendance_with_evidence.leave_path] loop
  if upload_path is null then continue; end if;
  if upload_path not like user_id::text||'/'||d::text||'/%' then raise exception 'PORTAL:फ़ाइल का स्वामी अमान्य है।'; end if;
  select * into upload from pending_uploads where pending_uploads.path=upload_path and staff_id=user_id for update;
  if not found or upload.consumed or upload.expires_at<now() then raise exception 'PORTAL:अपलोड समय सीमा समाप्त या अमान्य।'; end if;
 end loop;
 insert into attendance(staff_id,date,panchayat,department,position,block,staff_name,status,phase,deputation_workplace,leave_type,time_in,latitude,longitude,accuracy,photo_path,photo_hash,leave_path,working_places,flags,request_ip,request_agent,absence_reason)
 values(user_id,d,panchayat_name,department_name,position_name,p.block,p.name,status_name,case when action_name='save_draft' then 'draft' else 'submitted' end,case when status_name='deputation' then trim(workplace_name) end,case when status_name='leave' then leave_kind end,case when action_name='save_draft' then clock_timestamp() end,case when action_name='save_draft' then lat end,case when action_name='save_draft' then lng end,case when action_name='save_draft' then acc end,save_attendance_with_evidence.photo_path,image_hash,save_attendance_with_evidence.leave_path,p.assignments,f,save_attendance_with_evidence.request_ip,save_attendance_with_evidence.request_agent,case when status_name='absent' then trim(absence_reason) end) returning * into r;
 update pending_uploads set consumed=true where pending_uploads.path in (save_attendance_with_evidence.photo_path,save_attendance_with_evidence.leave_path);
 return to_jsonb(r);
end $$;

-- Initial dashboard data needs the same optional coordinates as later refreshes.
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
  select a.id,a.staff_id,a.date,a.panchayat,a.department,a.position,a.block,a.staff_name,a.status,a.phase,a.deputation_workplace,a.leave_type,a.absence_reason,a.time_in,a.time_out,a.latitude,a.longitude,a.accuracy,a.photo_path,a.leave_path,a.working_places,a.created_at,
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
notify pgrst, 'reload schema';
commit;

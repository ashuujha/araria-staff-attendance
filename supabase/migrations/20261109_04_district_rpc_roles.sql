-- Re-declare the existing trusted RPCs with district roles. No historical rows are changed.

begin;

create or replace function public.create_master_staff(actor_id uuid,user_id uuid,staff_name text,staff_phone text,staff_email text,auth_email text,block_name text,workplaces jsonb,reason_text text) returns jsonb language plpgsql security definer set search_path=public as $$
declare actor profiles; result profiles;
begin
 select * into actor from profiles where id=actor_id;
 if actor.id is null or not actor.active or actor.deleted_at is not null or actor.role not in ('dpro','bpro') or (actor.role='bpro' and actor.block<>block_name) then raise exception 'PORTAL:कर्मी प्रबंधन की अनुमति नहीं।'; end if;
 if length(trim(reason_text))<10 or length(reason_text)>1000 or coalesce(length(trim(staff_name)),0)<2 or length(staff_name)>150 or staff_phone !~ '^[6-9][0-9]{9}$' then raise exception 'PORTAL:कर्मी विवरण या कारण अमान्य है।'; end if;
 perform validate_master_assignments(workplaces,block_name);
 if exists(select 1 from profiles where phone=staff_phone) then raise exception 'PORTAL:यह मोबाइल पहले से दर्ज है।'; end if;
 insert into profiles(id,name,phone,email,login_email,block,assignments,role,active) values(user_id,trim(staff_name),staff_phone,nullif(staff_email,''),auth_email,block_name,workplaces,'staff',true) returning * into result;
 insert into audit_logs(actor_id,action,target_id,reason,details) values(actor_id,'create_staff',user_id::text,reason_text,jsonb_build_object('new',to_jsonb(result)-'device_hash'-'login_email'));
 return to_jsonb(result)-'device_hash'-'login_email';
end $$;

create or replace function public.manage_staff(actor_id uuid,target_id uuid,changes jsonb,reason_text text) returns jsonb language plpgsql security definer set search_path=public as $$
declare actor profiles; before_row profiles; after_row profiles;
begin
 select * into actor from profiles where id=actor_id;
 select * into before_row from profiles where id=target_id for update;
 if actor.id is null or not actor.active or actor.deleted_at is not null or actor.role not in ('dpro','bpro') or before_row.id is null or before_row.role<>'staff' or before_row.deleted_at is not null or (actor.role='bpro' and actor.block<>before_row.block) then raise exception 'PORTAL:कर्मी प्रबंधन की अनुमति नहीं।'; end if;
 if coalesce(length(trim(reason_text)),0)<10 or length(reason_text)>1000 or changes is null or jsonb_typeof(changes)<>'object' or changes-ARRAY['name','phone','email','active','assignments','reset_device']<>'{}'::jsonb then raise exception 'PORTAL:सुधार या कारण अमान्य।'; end if;
 if changes?'name' and coalesce(length(trim(changes->>'name')),0)<2 then raise exception 'PORTAL:नाम आवश्यक।'; end if;
 if changes?'phone' and coalesce(changes->>'phone','') !~ '^[6-9][0-9]{9}$' then raise exception 'PORTAL:फोन अमान्य।'; end if;
 if changes?'assignments' then perform validate_master_assignments(changes->'assignments',before_row.block); end if;
 update profiles set name=coalesce(changes->>'name',name),phone=coalesce(changes->>'phone',phone),email=case when changes?'email' then nullif(changes->>'email','') else email end,active=coalesce((changes->>'active')::boolean,active),assignments=coalesce(changes->'assignments',assignments),device_hash=case when coalesce((changes->>'reset_device')::boolean,false) then null else device_hash end where id=target_id returning * into after_row;
 insert into audit_logs(actor_id,action,target_id,reason,details) values(actor_id,'manage_staff',manage_staff.target_id::text,reason_text,jsonb_build_object('old',to_jsonb(before_row)-'device_hash','new',to_jsonb(after_row)-'device_hash'));
 return to_jsonb(after_row)-'device_hash'-'login_email';
end $$;

create or replace function public.delete_master_staff(actor_id uuid,target_id uuid,reason_text text) returns void language plpgsql security definer set search_path=public as $$
declare actor profiles; target profiles;
begin
 select * into actor from profiles where id=actor_id;
 select * into target from profiles where id=target_id for update;
 if actor.id is null or not actor.active or actor.deleted_at is not null or actor.role not in ('dpro','bpro') or target.id is null or target.role<>'staff' or (actor.role='bpro' and actor.block<>target.block) then raise exception 'PORTAL:कर्मी हटाने की अनुमति नहीं।'; end if;
 if coalesce(length(trim(reason_text)),0)<10 or length(reason_text)>1000 then raise exception 'PORTAL:हटाने का कारण आवश्यक है।'; end if;
 if target.deleted_at is not null then raise exception 'PORTAL:कर्मी पहले से हटाया गया है।'; end if;
 update profiles set deleted_at=now(),active=false,device_hash=null where id=target_id;
 insert into audit_logs(actor_id,action,target_id,reason,details) values(actor_id,'delete_staff',delete_master_staff.target_id::text,reason_text,jsonb_build_object('old',to_jsonb(target)-'device_hash','deleted_at',now()));
end $$;

create or replace function public.admin_input_attendance(actor_id uuid,user_id uuid,attendance_date date,panchayat_name text,status_name text,punch_in timestamptz,punch_out timestamptz,reason_text text) returns jsonb language plpgsql security definer set search_path=public as $$
declare actor profiles; target profiles; old_record attendance; result attendance;
begin
 perform pg_advisory_xact_lock(hashtextextended(user_id::text||attendance_date::text,0));
 select * into actor from profiles where id=actor_id;
 select * into target from profiles where id=user_id;
 if actor.id is null or not actor.active or actor.deleted_at is not null or actor.role not in ('dpro','bpro') or target.id is null or not target.active or target.deleted_at is not null or target.role<>'staff' or (actor.role='bpro' and actor.block<>target.block) then raise exception 'PORTAL:उपस्थिति दर्ज करने की अनुमति नहीं।'; end if;
 if coalesce(length(trim(reason_text)),0)<10 or length(reason_text)>1000 then raise exception 'PORTAL:उपस्थिति दर्ज करने का कारण आवश्यक है।'; end if;
 if attendance_date is null or attendance_date>(now() at time zone 'Asia/Kolkata')::date or status_name not in ('present','leave') or not exists(select 1 from jsonb_array_elements(target.assignments) a where a->>'panchayat'=panchayat_name) then raise exception 'PORTAL:तिथि, स्थिति या कार्यस्थल अमान्य है।'; end if;
 if status_name='present' and (punch_in is null or (punch_in at time zone 'Asia/Kolkata')::date<>attendance_date or (punch_out is not null and (punch_out<punch_in or (punch_out at time zone 'Asia/Kolkata')::date<>attendance_date))) then raise exception 'PORTAL:पंच समय और तिथि जाँचें।'; end if;
 select * into old_record from attendance where staff_id=user_id and date=attendance_date and deleted_at is null for update;
 insert into attendance(staff_id,date,panchayat,status,time_in,time_out,working_places,flags) values(user_id,attendance_date,panchayat_name,status_name,case when status_name='present' then punch_in end,case when status_name='present' then punch_out end,target.assignments,ARRAY['admin_entered'])
 on conflict(staff_id,date) where deleted_at is null do update set panchayat=excluded.panchayat,status=excluded.status,time_in=excluded.time_in,time_out=excluded.time_out,working_places=excluded.working_places,flags=excluded.flags,photo_path=null,out_photo_path=null,leave_path=null,latitude=null,longitude=null,accuracy=null,photo_hash=null,out_photo_hash=null,out_location=null,version=attendance.version+1 returning * into result;
 insert into audit_logs(actor_id,action,target_id,reason,details) values(actor_id,'admin_input_attendance',result.id::text,reason_text,jsonb_build_object('old',case when old_record.id is null then null else to_jsonb(old_record) end,'new',to_jsonb(result)));
 return to_jsonb(result);
end $$;

create or replace function public.delete_admin_attendance(actor_id uuid,record_id uuid,reason_text text) returns void language plpgsql security definer set search_path=public as $$
declare actor profiles; target profiles; old_record attendance;
begin
 select * into actor from profiles where id=actor_id;
 select * into old_record from attendance where id=record_id;
 if old_record.id is null then raise exception 'PORTAL:रिकॉर्ड नहीं मिला।'; end if;
 perform pg_advisory_xact_lock(hashtextextended(old_record.staff_id::text||old_record.date::text,0));
 select * into old_record from attendance where id=record_id for update;
 select * into target from profiles where id=old_record.staff_id;
 if actor.id is null or not actor.active or actor.deleted_at is not null or actor.role not in ('dpro','bpro') or (actor.role='bpro' and actor.block<>target.block) then raise exception 'PORTAL:उपस्थिति हटाने की अनुमति नहीं।'; end if;
 if coalesce(length(trim(reason_text)),0)<10 or length(reason_text)>1000 then raise exception 'PORTAL:हटाने का कारण आवश्यक है।'; end if;
 if old_record.deleted_at is not null then raise exception 'PORTAL:रिकॉर्ड पहले से हटाया गया है।'; end if;
 update attendance set deleted_at=now(),version=version+1 where id=record_id;
 insert into audit_logs(actor_id,action,target_id,reason,details) values(actor_id,'delete_attendance',record_id::text,reason_text,jsonb_build_object('old',to_jsonb(old_record),'deleted_at',now()));
end $$;

create or replace function public.correct_attendance(actor_id uuid,record_id uuid,correction jsonb,reason_text text) returns jsonb language plpgsql security definer set search_path=public as $$
declare actor profiles; target profiles; old_record attendance; new_record attendance;
begin
 select * into actor from profiles where id=actor_id;
 select * into old_record from attendance where id=record_id for update;
 if old_record.id is null or old_record.deleted_at is not null then raise exception 'PORTAL:रिकॉर्ड नहीं मिला।'; end if;
 select * into target from profiles where id=old_record.staff_id;
 if actor.id is null or not actor.active or actor.role not in ('dpro','bpro') or (actor.role='bpro' and actor.block<>target.block) then raise exception 'PORTAL:सुधार की अनुमति नहीं है।'; end if;
 if length(trim(reason_text))<10 or length(reason_text)>1000 then raise exception 'PORTAL:सुधार का कारण आवश्यक है।'; end if;
 if correction-ARRAY['time_in','time_out']<>'{}'::jsonb then raise exception 'PORTAL:केवल पंच समय सुधारे जा सकते हैं।'; end if;
 update attendance set time_in=case when correction?'time_in' then (correction->>'time_in')::timestamptz else time_in end,time_out=case when correction?'time_out' then (correction->>'time_out')::timestamptz else time_out end,version=version+1 where id=record_id returning * into new_record;
 insert into audit_logs(actor_id,action,target_id,reason,details) values(actor_id,'correct_attendance',record_id::text,reason_text,jsonb_build_object('old',to_jsonb(old_record),'new',to_jsonb(new_record)));
 return to_jsonb(new_record);
end $$;

create or replace function public.set_geofence(actor_id uuid,panchayat_name text,lat double precision,lng double precision,radius_m integer,reason_text text) returns jsonb language plpgsql security definer set search_path=public as $$
declare before_row panchayats; after_row panchayats;
begin
 if not exists(select 1 from profiles where id=actor_id and active and role='dpro') or length(trim(reason_text))<10 then raise exception 'PORTAL:अनुमति या सुधार कारण अमान्य।'; end if;
 if lat not between -90 and 90 or lng not between -180 and 180 or lat='NaN'::float8 or lng='NaN'::float8 or radius_m not between 50 and 5000 then raise exception 'PORTAL:जियोफेंस अमान्य।'; end if;
 select * into before_row from panchayats where name=panchayat_name for update;
 update panchayats set latitude=lat,longitude=lng,radius=radius_m where name=panchayat_name returning * into after_row;
 if not found then raise exception 'PORTAL:पंचायत नहीं मिली।'; end if;
 insert into audit_logs(actor_id,action,target_id,reason,details) values(actor_id,'set_geofence',panchayat_name,reason_text,jsonb_build_object('old',to_jsonb(before_row),'new',to_jsonb(after_row)));
 return to_jsonb(after_row);
end $$;

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
  if upload_path not like p.block_id::text||'/'||user_id::text||'/'||d::text||'/%' then raise exception 'PORTAL:फ़ाइल का स्वामी अमान्य है।'; end if;
  select * into upload from pending_uploads where pending_uploads.path=upload_path and staff_id=user_id for update;
  if not found or upload.consumed or upload.expires_at<now() then raise exception 'PORTAL:अपलोड समय सीमा समाप्त या अमान्य।'; end if;
 end loop;
 insert into attendance(staff_id,date,panchayat,department,position,block,staff_name,status,phase,deputation_workplace,leave_type,time_in,latitude,longitude,accuracy,photo_path,photo_hash,leave_path,working_places,flags,request_ip,request_agent,absence_reason)
 values(user_id,d,panchayat_name,department_name,position_name,p.block,p.name,status_name,case when action_name='save_draft' then 'draft' else 'submitted' end,case when status_name='deputation' then trim(workplace_name) end,case when status_name='leave' then leave_kind end,case when action_name='save_draft' then clock_timestamp() end,case when action_name='save_draft' then lat end,case when action_name='save_draft' then lng end,case when action_name='save_draft' then acc end,save_attendance_with_evidence.photo_path,image_hash,save_attendance_with_evidence.leave_path,p.assignments,f,save_attendance_with_evidence.request_ip,save_attendance_with_evidence.request_agent,case when status_name='absent' then trim(absence_reason) end) returning * into r;
 update pending_uploads set consumed=true where pending_uploads.path in (save_attendance_with_evidence.photo_path,save_attendance_with_evidence.leave_path);
 return to_jsonb(r);
end $$;

-- Retire only entry points that actually exist in this installation.
-- Older deployments have different overloads, or may lack one altogether.
do $$
declare old_entry record;
begin
 for old_entry in
  select p.oid::regprocedure as signature
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname in
    ('save_attendance_basic','save_attendance_workflow','submit_attendance')
 loop
  execute format('revoke execute on function %s from service_role',old_entry.signature);
 end loop;
end $$;

notify pgrst, 'reload schema';

commit;

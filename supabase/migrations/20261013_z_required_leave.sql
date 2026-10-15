begin;
create or replace function public.save_attendance_workflow(user_id uuid,action_name text,panchayat_name text,department_name text,position_name text,status_name text,workplace_name text,leave_kind text,device_hash text,photo_path text default null,leave_path text default null,lat double precision default null,lng double precision default null,acc double precision default null,capture_id uuid default null,image_hash text default null,perceptual_hash text default null,request_ip text default null,request_agent text default null) returns jsonb language plpgsql security definer set search_path=public as $$
declare p profiles; r attendance; fence panchayats; ch capture_challenges; upload pending_uploads; upload_path text; f text[]='{}'; d date=(now() at time zone 'Asia/Kolkata')::date; n integer;
begin
 perform pg_advisory_xact_lock(hashtextextended(user_id::text||d::text,0));
 select * into p from profiles where id=user_id;
 if not found or not p.active or p.deleted_at is not null or p.role<>'staff' or p.device_hash is null or p.device_hash is distinct from save_attendance_workflow.device_hash then raise exception 'PORTAL:खाता या डिवाइस मान्य नहीं है।'; end if;
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
 if status_name='leave' and (leave_kind is null or leave_kind not in ('CL','SL')) then raise exception 'PORTAL:CL या SL चुनें।'; end if;
 if status_name='leave' and coalesce(length(trim(save_attendance_workflow.leave_path)),0)=0 then raise exception 'PORTAL:अवकाश के लिए JPEG/PDF दस्तावेज आवश्यक है।'; end if;
 if status_name<>'leave' and (leave_kind is not null or save_attendance_workflow.leave_path is not null) then raise exception 'PORTAL:अवकाश दस्तावेज केवल अवकाश के लिए है।'; end if;
 if status_name not in ('present','deputation') and save_attendance_workflow.photo_path is not null then raise exception 'PORTAL:इस स्थिति में GPS फोटो आवश्यक नहीं।'; end if;
 foreach upload_path in array ARRAY[save_attendance_workflow.photo_path,save_attendance_workflow.leave_path] loop
  if upload_path is null then continue; end if;
  if upload_path not like user_id::text||'/'||d::text||'/%' then raise exception 'PORTAL:फ़ाइल का स्वामी अमान्य है।'; end if;
  select * into upload from pending_uploads where pending_uploads.path=upload_path and staff_id=user_id for update;
  if not found or upload.consumed or upload.expires_at<now() then raise exception 'PORTAL:अपलोड समय सीमा समाप्त या अमान्य।'; end if;
 end loop;
 if status_name in ('present','deputation') then
  if lat is null or lng is null or acc is null or lat not between -90 and 90 or lng not between -180 and 180 or acc<=0 or acc>50 or lat='NaN'::float8 or lng='NaN'::float8 or acc='NaN'::float8 then raise exception 'PORTAL:GPS सटीकता 50 मीटर से कम आवश्यक है।'; end if;
  if save_attendance_workflow.photo_path is null or image_hash is null or perceptual_hash is null then raise exception 'PORTAL:ताज़ा GPS फोटो आवश्यक है।'; end if;
  select * into ch from capture_challenges where id=capture_id and staff_id=user_id for update;
  if not found or ch.used or ch.expires_at<now() or ch.device_hash<>save_attendance_workflow.device_hash then raise exception 'PORTAL:कैमरा सत्यापन समाप्त या अमान्य है।'; end if;
  select * into fence from panchayats where name=panchayat_name;
  if fence.latitude is null or fence.longitude is null then f=array_append(f,'geofence_unconfigured');
  elsif distance_m(lat,lng,fence.latitude,fence.longitude)>fence.radius then
   if status_name='present' and fence.mode='block' then raise exception 'PORTAL:आप नियुक्त कार्यस्थल के दायरे से बाहर हैं।'; end if;
   f=array_append(f,case when status_name='deputation' then 'deputation_location_recorded' else 'outside_geofence' end);
  end if;
  if exists(select 1 from photo_registry where photo_registry.perceptual_hash=save_attendance_workflow.perceptual_hash::bit(64)) then raise exception 'PORTAL:फोटो का पहले उपयोग हो चुका है।'; end if;
  insert into photo_registry(hash,staff_id,perceptual_hash) values(image_hash,user_id,save_attendance_workflow.perceptual_hash::bit(64)) on conflict do nothing;
  get diagnostics n=row_count;
  if n=0 then raise exception 'PORTAL:फोटो का पहले उपयोग हो चुका है।'; end if;
  update capture_challenges set used=true where id=capture_id;
 end if;
 insert into attendance(staff_id,date,panchayat,department,position,block,staff_name,status,phase,deputation_workplace,leave_type,time_in,latitude,longitude,accuracy,photo_path,photo_hash,leave_path,working_places,flags,request_ip,request_agent)
 values(user_id,d,panchayat_name,department_name,position_name,p.block,p.name,status_name,case when action_name='save_draft' then 'draft' else 'submitted' end,case when status_name='deputation' then trim(workplace_name) end,case when status_name='leave' then leave_kind end,case when action_name='save_draft' then clock_timestamp() end,case when action_name='save_draft' then lat end,case when action_name='save_draft' then lng end,case when action_name='save_draft' then acc end,save_attendance_workflow.photo_path,image_hash,save_attendance_workflow.leave_path,p.assignments,f,save_attendance_workflow.request_ip,save_attendance_workflow.request_agent) returning * into r;
 update pending_uploads set consumed=true where pending_uploads.path in (save_attendance_workflow.photo_path,save_attendance_workflow.leave_path);
 return to_jsonb(r);
end $$;
revoke all on function public.save_attendance_workflow(uuid,text,text,text,text,text,text,text,text,text,text,double precision,double precision,double precision,uuid,text,text,text,text) from public,anon,authenticated;
grant execute on function public.save_attendance_workflow(uuid,text,text,text,text,text,text,text,text,text,text,double precision,double precision,double precision,uuid,text,text,text,text) to service_role;
NOTIFY pgrst, 'reload schema';
commit;

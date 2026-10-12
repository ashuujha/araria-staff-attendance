begin;
alter table public.profiles add column if not exists deleted_at timestamptz;
alter table public.attendance add column if not exists deleted_at timestamptz;
alter table public.attendance add column if not exists working_places jsonb not null default '[]';
update public.attendance a set working_places=p.assignments from public.profiles p where p.id=a.staff_id and a.working_places='[]'::jsonb;
alter table public.attendance drop constraint if exists attendance_staff_id_date_key;
create unique index if not exists attendance_active_day_idx on public.attendance(staff_id,date) where deleted_at is null;
-- Snapshot assignments once; punch-out/time corrections preserve the original worksite list.
create or replace function public.snapshot_workplaces() returns trigger language plpgsql security definer set search_path=public as $$
begin
 if new.working_places='[]'::jsonb then select assignments into new.working_places from profiles where id=new.staff_id; end if;
 return new;
end $$;
drop trigger if exists attendance_workplace_snapshot on public.attendance;
create trigger attendance_workplace_snapshot before insert on public.attendance for each row execute function public.snapshot_workplaces();
revoke all on function public.snapshot_workplaces() from public,anon,authenticated;

create or replace function public.validate_master_assignments(workplaces jsonb,block_name text) returns void language plpgsql security definer set search_path=public as $$
begin
 if workplaces is null or jsonb_typeof(workplaces)<>'array' then raise exception 'PORTAL:कम से कम एक कार्यस्थल चुनें।'; end if;
 if jsonb_array_length(workplaces)=0 or jsonb_array_length(workplaces)>31 then raise exception 'PORTAL:कम से कम एक कार्यस्थल चुनें।'; end if;
 if exists(select 1 from jsonb_array_elements(workplaces) a where jsonb_typeof(a)<>'object' or coalesce(length(trim(a->>'position')),0)<2 or coalesce(length(trim(a->>'department')),0)<2 or not exists(select 1 from panchayats where name=a->>'panchayat' and block=block_name)) then raise exception 'PORTAL:कार्यस्थल, पद या विभाग अमान्य है।'; end if;
 if (select count(*) from jsonb_array_elements(workplaces))<>(select count(distinct a->>'panchayat') from jsonb_array_elements(workplaces) a) then raise exception 'PORTAL:एक कार्यस्थल दो बार नहीं चुन सकते।'; end if;
end $$;
revoke all on function public.validate_master_assignments(jsonb,text) from public,anon,authenticated;

create or replace function public.create_master_staff(actor_id uuid,user_id uuid,staff_name text,staff_phone text,staff_email text,auth_email text,block_name text,workplaces jsonb,reason_text text) returns jsonb language plpgsql security definer set search_path=public as $$
declare actor profiles; result profiles;
begin
 select * into actor from profiles where id=actor_id;
 if actor.id is null or not actor.active or actor.deleted_at is not null or actor.role not in ('super_admin','block_admin') or (actor.role='block_admin' and actor.block<>block_name) then raise exception 'PORTAL:कर्मी प्रबंधन की अनुमति नहीं।'; end if;
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
 if actor.id is null or not actor.active or actor.deleted_at is not null or actor.role not in ('super_admin','block_admin') or before_row.id is null or before_row.role<>'staff' or before_row.deleted_at is not null or (actor.role='block_admin' and actor.block<>before_row.block) then raise exception 'PORTAL:कर्मी प्रबंधन की अनुमति नहीं।'; end if;
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
 if actor.id is null or not actor.active or actor.deleted_at is not null or actor.role not in ('super_admin','block_admin') or target.id is null or target.role<>'staff' or (actor.role='block_admin' and actor.block<>target.block) then raise exception 'PORTAL:कर्मी हटाने की अनुमति नहीं।'; end if;
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
 if actor.id is null or not actor.active or actor.deleted_at is not null or actor.role not in ('super_admin','block_admin') or target.id is null or not target.active or target.deleted_at is not null or target.role<>'staff' or (actor.role='block_admin' and actor.block<>target.block) then raise exception 'PORTAL:उपस्थिति दर्ज करने की अनुमति नहीं।'; end if;
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
 if actor.id is null or not actor.active or actor.deleted_at is not null or actor.role not in ('super_admin','block_admin') or (actor.role='block_admin' and actor.block<>target.block) then raise exception 'PORTAL:उपस्थिति हटाने की अनुमति नहीं।'; end if;
 if coalesce(length(trim(reason_text)),0)<10 or length(reason_text)>1000 then raise exception 'PORTAL:हटाने का कारण आवश्यक है।'; end if;
 if old_record.deleted_at is not null then raise exception 'PORTAL:रिकॉर्ड पहले से हटाया गया है।'; end if;
 update attendance set deleted_at=now(),version=version+1 where id=record_id;
 insert into audit_logs(actor_id,action,target_id,reason,details) values(actor_id,'delete_attendance',record_id::text,reason_text,jsonb_build_object('old',to_jsonb(old_record),'deleted_at',now()));
end $$;
revoke all on function public.create_master_staff(uuid,uuid,text,text,text,text,text,jsonb,text),public.manage_staff(uuid,uuid,jsonb,text),public.delete_master_staff(uuid,uuid,text),public.admin_input_attendance(uuid,uuid,date,text,text,timestamptz,timestamptz,text),public.delete_admin_attendance(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.create_master_staff(uuid,uuid,text,text,text,text,text,jsonb,text),public.manage_staff(uuid,uuid,jsonb,text),public.delete_master_staff(uuid,uuid,text),public.admin_input_attendance(uuid,uuid,date,text,text,timestamptz,timestamptz,text),public.delete_admin_attendance(uuid,uuid,text) to service_role;
create or replace function public.submit_attendance(user_id uuid,action_name text,panchayat_name text,lat double precision,lng double precision,acc double precision,capture_id uuid,device_hash text,storage_path text,image_hash text,request_ip text,request_agent text,perceptual_hash text default null) returns jsonb language plpgsql security definer set search_path=public as $$
declare p profiles; fence panchayats; current_record attendance; previous_record attendance; ch capture_challenges; f text[]='{}'; d date=(now() at time zone 'Asia/Kolkata')::date; travel_time double precision; n integer;
begin
 perform pg_advisory_xact_lock(hashtextextended(user_id::text||d::text,0));
 select * into p from profiles where id=user_id;
 if not found or not p.active or p.role<>'staff' or p.device_hash is distinct from submit_attendance.device_hash then raise exception 'PORTAL:खाता या डिवाइस मान्य नहीं है।'; end if;
 if not exists(select 1 from jsonb_array_elements(p.assignments) a where a->>'panchayat'=panchayat_name) then raise exception 'PORTAL:पंचायत नियुक्ति मान्य नहीं है।'; end if;
 if action_name not in ('in','out','leave') then raise exception 'PORTAL:कार्रवाई अमान्य है।'; end if;
 if storage_path not like user_id::text||'/'||d::text||'/%' then raise exception 'PORTAL:फ़ाइल का स्वामी अमान्य है।'; end if;
 select * into current_record from attendance where staff_id=user_id and date=d and deleted_at is null for update;
 if action_name in ('in','leave') and current_record.id is not null then raise exception 'PORTAL:आज की उपस्थिति पहले से दर्ज है।'; end if;
 if action_name='out' and (current_record.time_in is null or current_record.time_out is not null or current_record.status='leave') then raise exception 'PORTAL:पंच आउट से पहले पंच इन आवश्यक है; दोबारा पंच आउट नहीं हो सकता।'; end if;
 if action_name='out' and current_record.panchayat<>panchayat_name then raise exception 'PORTAL:पंच आउट उसी पंचायत से करें जहाँ पंच इन किया था।'; end if;
 if action_name<>'leave' then
  if lat is null or lng is null or acc is null or lat not between -90 and 90 or lng not between -180 and 180 or acc<=0 or acc>50 or lat='NaN'::float8 or lng='NaN'::float8 or acc='NaN'::float8 then raise exception 'PORTAL:लोकेशन चालू करें। GPS सटीकता 50 मीटर से कम आवश्यक है।'; end if;
  select * into ch from capture_challenges where id=capture_id and staff_id=user_id for update;
  if not found or ch.used or ch.expires_at<now() or ch.device_hash<>submit_attendance.device_hash then raise exception 'PORTAL:कैमरा सत्यापन समाप्त या अमान्य है। नई फोटो लें।'; end if;
  select * into fence from panchayats where name=panchayat_name;
  if fence.latitude is null or fence.longitude is null then raise exception 'PORTAL:पंचायत का जियोफेंस सेटअप बाकी है।'; end if;
  if distance_m(lat,lng,fence.latitude,fence.longitude)>fence.radius then
   if fence.mode='block' then raise exception 'PORTAL:आप नियुक्त कार्यस्थल के दायरे से बाहर हैं।'; end if;
   f=array_append(f,'outside_geofence');
  end if;
  if image_hash is null then raise exception 'PORTAL:ताज़ा GPS फोटो आवश्यक है।'; end if;
  if perceptual_hash is not null and exists(select 1 from photo_registry where photo_registry.perceptual_hash=submit_attendance.perceptual_hash::bit(64)) then raise exception 'PORTAL:फोटो मिलती-जुलती है। दोबारा कैमरे से नई फोटो लें।'; end if;
  insert into photo_registry(hash,staff_id,perceptual_hash) values(image_hash,user_id,submit_attendance.perceptual_hash::bit(64)) on conflict do nothing;
  get diagnostics n=row_count;
  if n=0 then raise exception 'PORTAL:इस फोटो का पहले उपयोग हो चुका है। नई फोटो लें।'; end if;
  select * into previous_record from attendance where staff_id=user_id and deleted_at is null and time_in is not null order by coalesce(time_out,time_in) desc limit 1;
  if previous_record.id is not null then
   travel_time=extract(epoch from now()-coalesce(previous_record.time_out,previous_record.time_in));
   if travel_time>0 and distance_m(lat,lng,coalesce((previous_record.out_location->>'latitude')::float8,previous_record.latitude),coalesce((previous_record.out_location->>'longitude')::float8,previous_record.longitude))/travel_time>50 then raise exception 'PORTAL:स्थान में असामान्य बदलाव है। एडमिन से संपर्क करें।'; end if;
  end if;
  if (select count(*) from attendance where date=d and deleted_at is null and staff_id<>user_id and abs(latitude-lat)<0.000001 and abs(longitude-lng)<0.000001)>=5 then f=array_append(f,'identical_coordinates'); end if;
  if extract(hour from now() at time zone 'Asia/Kolkata')<7 or extract(hour from now() at time zone 'Asia/Kolkata')>=20 then f=array_append(f,'odd_punch_time'); end if;
  update capture_challenges set used=true where id=capture_id;
 end if;
 if action_name='in' then
  insert into attendance(staff_id,date,panchayat,status,time_in,latitude,longitude,accuracy,photo_path,photo_hash,flags,request_ip,request_agent) values(user_id,d,panchayat_name,'present',now(),lat,lng,acc,storage_path,image_hash,f,submit_attendance.request_ip,submit_attendance.request_agent) returning * into current_record;
 elsif action_name='leave' then
  insert into attendance(staff_id,date,panchayat,status,leave_path,request_ip,request_agent) values(user_id,d,panchayat_name,'leave',storage_path,submit_attendance.request_ip,submit_attendance.request_agent) returning * into current_record;
 else
  update attendance set time_out=now(),out_photo_path=storage_path,out_photo_hash=image_hash,out_location=jsonb_build_object('latitude',lat,'longitude',lng,'accuracy',acc),flags=flags||f,version=version+1 where id=current_record.id returning * into current_record;
 end if;
 update pending_uploads set consumed=true where path=storage_path;
 return to_jsonb(current_record);
end $$;
grant select(deleted_at) on public.profiles to authenticated;
drop policy attendance_read on public.attendance;
create policy attendance_read on public.attendance for select to authenticated using(deleted_at is null and public.can_read_profile(staff_id));
create or replace function public.correct_attendance(actor_id uuid,record_id uuid,correction jsonb,reason_text text) returns jsonb language plpgsql security definer set search_path=public as $$
declare actor profiles; target profiles; old_record attendance; new_record attendance;
begin
 select * into actor from profiles where id=actor_id;
 select * into old_record from attendance where id=record_id for update;
 if old_record.id is null or old_record.deleted_at is not null then raise exception 'PORTAL:रिकॉर्ड नहीं मिला।'; end if;
 select * into target from profiles where id=old_record.staff_id;
 if actor.id is null or not actor.active or actor.role not in ('super_admin','block_admin') or (actor.role='block_admin' and actor.block<>target.block) then raise exception 'PORTAL:सुधार की अनुमति नहीं है।'; end if;
 if length(trim(reason_text))<10 or length(reason_text)>1000 then raise exception 'PORTAL:सुधार का कारण आवश्यक है।'; end if;
 if correction-ARRAY['time_in','time_out']<>'{}'::jsonb then raise exception 'PORTAL:केवल पंच समय सुधारे जा सकते हैं।'; end if;
 update attendance set time_in=case when correction?'time_in' then (correction->>'time_in')::timestamptz else time_in end,time_out=case when correction?'time_out' then (correction->>'time_out')::timestamptz else time_out end,version=version+1 where id=record_id returning * into new_record;
 insert into audit_logs(actor_id,action,target_id,reason,details) values(actor_id,'correct_attendance',record_id::text,reason_text,jsonb_build_object('old',to_jsonb(old_record),'new',to_jsonb(new_record)));
 return to_jsonb(new_record);
end $$;
commit;

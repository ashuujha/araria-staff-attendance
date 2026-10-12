-- Apply once in Supabase SQL Editor. All writes go through trusted server RPCs.
begin;
create extension if not exists pgcrypto;
create table public.profiles (
 id uuid primary key references auth.users(id) on delete cascade,
 name text not null, phone text unique, secondary_phones text[] not null default '{}', email text,
 login_email text not null unique, role text not null default 'staff' check(role in ('staff','super_admin','district_viewer','block_admin')),
 block text not null default 'Araria', assignments jsonb not null default '[]', active boolean not null default true,
 device_hash text, created_at timestamptz not null default now()
);
create table public.panchayats (name text primary key,block text not null default 'Araria',latitude double precision,longitude double precision,radius integer not null default 300 check(radius between 50 and 5000),mode text not null default 'block' check(mode in ('block','flag')));
create table public.attendance (
 id uuid primary key default gen_random_uuid(), staff_id uuid not null references public.profiles(id), date date not null default (now() at time zone 'Asia/Kolkata')::date,
 panchayat text not null references public.panchayats(name), status text not null check(status in ('present','leave')),
 time_in timestamptz,time_out timestamptz,latitude double precision,longitude double precision,accuracy double precision,
 photo_path text,leave_path text,out_photo_path text,photo_hash text,out_photo_hash text,out_location jsonb,
 flags text[] not null default '{}', request_ip text,request_agent text, version integer not null default 1,
 created_at timestamptz not null default now(), unique(staff_id,date), check(time_out is null or (time_in is not null and time_out>=time_in))
);
create index attendance_date_idx on public.attendance(date,panchayat);
create index attendance_staff_idx on public.attendance(staff_id,time_in desc);
create table public.capture_challenges(id uuid primary key default gen_random_uuid(),staff_id uuid not null references public.profiles(id),device_hash text not null,created_at timestamptz not null default now(),expires_at timestamptz not null default now()+interval '120 seconds',used boolean not null default false);
create table public.photo_registry(hash text primary key,staff_id uuid not null,perceptual_hash bit(64),created_at timestamptz not null default now());
create unique index photo_perceptual_hash_idx on public.photo_registry(perceptual_hash) where perceptual_hash is not null;
create table public.pending_uploads(path text primary key,staff_id uuid not null references public.profiles(id),consumed boolean not null default false,expires_at timestamptz not null default now()+interval '10 minutes');
create table public.audit_logs(id bigint generated always as identity primary key,actor_id uuid not null references public.profiles(id),action text not null,target_id text not null,reason text not null,details jsonb,created_at timestamptz not null default now());
create table public.login_attempts(key text primary key,attempts integer not null default 1,started_at timestamptz not null default now());
create table public.sync_jobs(record_id uuid primary key references public.attendance(id),version integer not null,state text not null default 'pending',attempts integer not null default 0,last_error text,available_at timestamptz not null default now(),lease_until timestamptz,updated_at timestamptz not null default now());
create table public.sync_lock(id integer primary key check(id=1),lease_until timestamptz not null default now());
insert into public.sync_lock(id) values(1);

create function public.can_read_profile(target uuid) returns boolean language sql stable security definer set search_path=public as $$
 select exists(select 1 from profiles actor join profiles subject on subject.id=target where actor.id=auth.uid() and actor.active and (actor.id=target or actor.role in ('super_admin','district_viewer') or (actor.role='block_admin' and actor.block=subject.block)))
$$;
revoke all on function public.can_read_profile(uuid) from public;
grant execute on function public.can_read_profile(uuid) to authenticated;
alter table public.profiles enable row level security;
alter table public.attendance enable row level security;
alter table public.panchayats enable row level security;
alter table public.capture_challenges enable row level security;
alter table public.photo_registry enable row level security;
alter table public.pending_uploads enable row level security;
alter table public.audit_logs enable row level security;
alter table public.login_attempts enable row level security;
alter table public.sync_jobs enable row level security;
alter table public.sync_lock enable row level security;
revoke all on all tables in schema public from anon,authenticated;
grant select(id,name,phone,email,secondary_phones,assignments,role,block,active,created_at) on public.profiles to authenticated;
grant select on public.attendance,public.panchayats,public.audit_logs to authenticated;
create policy profiles_read on public.profiles for select to authenticated using(public.can_read_profile(id));
create policy attendance_read on public.attendance for select to authenticated using(public.can_read_profile(staff_id));
create policy panchayats_read on public.panchayats for select to authenticated using(exists(select 1 from public.profiles where id=auth.uid() and active));
create policy audit_read on public.audit_logs for select to authenticated using(exists(select 1 from public.profiles where id=auth.uid() and active and role='super_admin'));

create function public.consume_login_attempt(attempt_key text) returns boolean language plpgsql security definer set search_path=public as $$
declare n integer;
begin
 insert into login_attempts(key) values(attempt_key) on conflict(key) do update set attempts=case when login_attempts.started_at<now()-interval '15 minutes' then 1 else login_attempts.attempts+1 end,started_at=case when login_attempts.started_at<now()-interval '15 minutes' then now() else login_attempts.started_at end returning attempts into n;
 return n<=5;
end $$;
create function public.bind_device(user_id uuid,device_hash text) returns void language plpgsql security definer set search_path=public as $$
declare p profiles;
begin
 select * into p from profiles where id=user_id for update;
 if not found or not p.active then raise exception 'PORTAL:खाता निष्क्रिय है।'; end if;
 if p.device_hash is not null and p.device_hash<>bind_device.device_hash then raise exception 'PORTAL:यह खाता दूसरे डिवाइस से जुड़ा है। एडमिन से रीसेट करवाएँ।'; end if;
 update profiles set device_hash=bind_device.device_hash where id=user_id;
end $$;
create function public.distance_m(lat1 double precision,lng1 double precision,lat2 double precision,lng2 double precision) returns double precision language sql immutable as $$
 select 6371000*2*asin(sqrt(least(1.0,power(sin(radians(lat2-lat1)/2),2)+cos(radians(lat1))*cos(radians(lat2))*power(sin(radians(lng2-lng1)/2),2))))
$$;
create function public.submit_attendance(user_id uuid,action_name text,panchayat_name text,lat double precision,lng double precision,acc double precision,capture_id uuid,device_hash text,storage_path text,image_hash text,request_ip text,request_agent text,perceptual_hash text default null) returns jsonb language plpgsql security definer set search_path=public as $$
declare p profiles; fence panchayats; current_record attendance; previous_record attendance; ch capture_challenges; f text[]='{}'; d date=(now() at time zone 'Asia/Kolkata')::date; travel_time double precision; n integer;
begin
 perform pg_advisory_xact_lock(hashtextextended(user_id::text||d::text,0));
 select * into p from profiles where id=user_id;
 if not found or not p.active or p.role<>'staff' or p.device_hash is distinct from submit_attendance.device_hash then raise exception 'PORTAL:खाता या डिवाइस मान्य नहीं है।'; end if;
 if not exists(select 1 from jsonb_array_elements(p.assignments) a where a->>'panchayat'=panchayat_name) then raise exception 'PORTAL:पंचायत नियुक्ति मान्य नहीं है।'; end if;
 if action_name not in ('in','out','leave') then raise exception 'PORTAL:कार्रवाई अमान्य है।'; end if;
 if storage_path not like user_id::text||'/'||d::text||'/%' then raise exception 'PORTAL:फ़ाइल का स्वामी अमान्य है।'; end if;
 select * into current_record from attendance where staff_id=user_id and date=d for update;
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
  select * into previous_record from attendance where staff_id=user_id and time_in is not null order by coalesce(time_out,time_in) desc limit 1;
  if previous_record.id is not null then
   travel_time=extract(epoch from now()-coalesce(previous_record.time_out,previous_record.time_in));
   if travel_time>0 and distance_m(lat,lng,coalesce((previous_record.out_location->>'latitude')::float8,previous_record.latitude),coalesce((previous_record.out_location->>'longitude')::float8,previous_record.longitude))/travel_time>50 then raise exception 'PORTAL:स्थान में असामान्य बदलाव है। एडमिन से संपर्क करें।'; end if;
  end if;
  if (select count(*) from attendance where date=d and staff_id<>user_id and abs(latitude-lat)<0.000001 and abs(longitude-lng)<0.000001)>=5 then f=array_append(f,'identical_coordinates'); end if;
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

create function public.enqueue_sync() returns trigger language plpgsql security definer set search_path=public as $$
begin
 insert into sync_jobs(record_id,version) values(new.id,new.version) on conflict(record_id) do update set version=excluded.version,state='pending',available_at=now(),updated_at=now(); return new;
end $$;
create trigger attendance_sync after insert or update on public.attendance for each row execute function public.enqueue_sync();
create function public.claim_sync_job() returns jsonb language plpgsql security definer set search_path=public as $$
declare j sync_jobs;
begin
 update sync_lock set lease_until=now()+interval '3 minutes' where id=1 and lease_until<now();
 if not found then return null; end if;
 select * into j from sync_jobs where state<>'done' and available_at<=now() and (lease_until is null or lease_until<now()) order by updated_at for update skip locked limit 1;
 if not found then update sync_lock set lease_until=now() where id=1; return null; end if;
 update sync_jobs set state='processing',lease_until=now()+interval '3 minutes' where record_id=j.record_id;
 return to_jsonb(j);
end $$;
create function public.finish_sync_job(job_id uuid,job_version integer,error_text text default null) returns void language plpgsql security definer set search_path=public as $$
begin
 update sync_jobs set state=case when error_text is null and version=job_version then 'done' else 'pending' end,attempts=attempts+1,last_error=left(error_text,1000),lease_until=null,available_at=case when error_text is null then now() else now()+make_interval(secs=>least(3600,30*power(2,least(attempts,7))::integer)) end,updated_at=now() where record_id=job_id;
 update sync_lock set lease_until=now() where id=1;
end $$;
create function public.correct_attendance(actor_id uuid,record_id uuid,correction jsonb,reason_text text) returns jsonb language plpgsql security definer set search_path=public as $$
declare actor profiles; target profiles; old_record attendance; new_record attendance;
begin
 select * into actor from profiles where id=actor_id;
 select * into old_record from attendance where id=record_id for update;
 if old_record.id is null then raise exception 'PORTAL:रिकॉर्ड नहीं मिला।'; end if;
 select * into target from profiles where id=old_record.staff_id;
 if actor.id is null or not actor.active or actor.role not in ('super_admin','block_admin') or (actor.role='block_admin' and actor.block<>target.block) then raise exception 'PORTAL:सुधार की अनुमति नहीं है।'; end if;
 if length(trim(reason_text))<10 or length(reason_text)>1000 then raise exception 'PORTAL:सुधार का कारण आवश्यक है।'; end if;
 if correction-ARRAY['time_in','time_out']<>'{}'::jsonb then raise exception 'PORTAL:केवल पंच समय सुधारे जा सकते हैं।'; end if;
 update attendance set time_in=case when correction?'time_in' then (correction->>'time_in')::timestamptz else time_in end,time_out=case when correction?'time_out' then (correction->>'time_out')::timestamptz else time_out end,version=version+1 where id=record_id returning * into new_record;
 insert into audit_logs(actor_id,action,target_id,reason,details) values(actor_id,'correct_attendance',record_id::text,reason_text,jsonb_build_object('old',to_jsonb(old_record),'new',to_jsonb(new_record)));
 return to_jsonb(new_record);
end $$;
create function public.set_geofence(actor_id uuid,panchayat_name text,lat double precision,lng double precision,radius_m integer,reason_text text) returns jsonb language plpgsql security definer set search_path=public as $$
declare before_row panchayats; after_row panchayats;
begin
 if not exists(select 1 from profiles where id=actor_id and active and role='super_admin') or length(trim(reason_text))<10 then raise exception 'PORTAL:अनुमति या सुधार कारण अमान्य।'; end if;
 if lat not between -90 and 90 or lng not between -180 and 180 or lat='NaN'::float8 or lng='NaN'::float8 or radius_m not between 50 and 5000 then raise exception 'PORTAL:जियोफेंस अमान्य।'; end if;
 select * into before_row from panchayats where name=panchayat_name for update;
 update panchayats set latitude=lat,longitude=lng,radius=radius_m where name=panchayat_name returning * into after_row;
 if not found then raise exception 'PORTAL:पंचायत नहीं मिली।'; end if;
 insert into audit_logs(actor_id,action,target_id,reason,details) values(actor_id,'set_geofence',panchayat_name,reason_text,jsonb_build_object('old',to_jsonb(before_row),'new',to_jsonb(after_row)));
 return to_jsonb(after_row);
end $$;

create function public.manage_staff(actor_id uuid,target_id uuid,changes jsonb,reason_text text) returns jsonb language plpgsql security definer set search_path=public as $$
declare actor profiles; before_row profiles; after_row profiles;
begin
 select * into actor from profiles where id=actor_id;
 select * into before_row from profiles where id=target_id for update;
 if not actor.active or actor.role not in ('super_admin','block_admin') or before_row.id is null or before_row.role<>'staff' or (actor.role='block_admin' and actor.block<>before_row.block) then raise exception 'PORTAL:कर्मी प्रबंधन की अनुमति नहीं।'; end if;
 if length(trim(reason_text))<10 or changes-ARRAY['name','phone','email','active','assignments','reset_device']<>'{}'::jsonb then raise exception 'PORTAL:सुधार या कारण अमान्य।'; end if;
 if changes?'name' and length(trim(changes->>'name'))<2 then raise exception 'PORTAL:नाम आवश्यक।'; end if;
 if changes?'phone' and (changes->>'phone') !~ '^[6-9][0-9]{9}$' then raise exception 'PORTAL:फोन अमान्य।'; end if;
 if changes?'assignments' then
  if jsonb_typeof(changes->'assignments')<>'array' or jsonb_array_length(changes->'assignments')=0 or exists(select 1 from jsonb_array_elements(changes->'assignments') a where not exists(select 1 from panchayats where name=a->>'panchayat') or length(a->>'position')<2 or length(a->>'department')<2) then raise exception 'PORTAL:पंचायत नियुक्ति अमान्य।'; end if;
 end if;
 update profiles set name=coalesce(changes->>'name',name),phone=coalesce(changes->>'phone',phone),email=case when changes?'email' then changes->>'email' else email end,active=coalesce((changes->>'active')::boolean,active),assignments=coalesce(changes->'assignments',assignments),device_hash=case when coalesce((changes->>'reset_device')::boolean,false) then null else device_hash end where id=target_id returning * into after_row;
 insert into audit_logs(actor_id,action,target_id,reason,details) values(actor_id,'manage_staff',manage_staff.target_id::text,reason_text,jsonb_build_object('old',to_jsonb(before_row)-'device_hash','new',to_jsonb(after_row)-'device_hash'));
 return to_jsonb(after_row)-'device_hash'-'login_email';
end $$;
revoke all on function public.manage_staff(uuid,uuid,jsonb,text) from public,anon,authenticated;
grant execute on function public.manage_staff(uuid,uuid,jsonb,text) to service_role;

-- Mutating SECURITY DEFINER RPCs must NEVER be executable with a publishable key.
revoke all on function public.consume_login_attempt(text),public.bind_device(uuid,text),public.submit_attendance(uuid,text,text,double precision,double precision,double precision,uuid,text,text,text,text,text,text),public.enqueue_sync(),public.claim_sync_job(),public.finish_sync_job(uuid,integer,text),public.correct_attendance(uuid,uuid,jsonb,text),public.set_geofence(uuid,text,double precision,double precision,integer,text) from public,anon,authenticated;
grant execute on function public.consume_login_attempt(text),public.bind_device(uuid,text),public.submit_attendance(uuid,text,text,double precision,double precision,double precision,uuid,text,text,text,text,text,text),public.claim_sync_job(),public.finish_sync_job(uuid,integer,text),public.correct_attendance(uuid,uuid,jsonb,text),public.set_geofence(uuid,text,double precision,double precision,integer,text) to service_role;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('attendance-private','attendance-private',false,5242880,ARRAY['image/jpeg','image/png','application/pdf']);
-- No client policies on storage.objects: all uploads and signed links are server-mediated.
commit;

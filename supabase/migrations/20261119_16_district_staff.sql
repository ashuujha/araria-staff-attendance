-- District staff keep a primary administrative block for storage and history.
-- Their attendance is recorded against the selected assigned workspace block.
begin;
create table if not exists public.districts(name text primary key check(length(trim(name)) between 2 and 100));
insert into public.districts values('Araria') on conflict do nothing;
alter table public.districts enable row level security;
revoke all on public.districts from public,anon,authenticated;
grant select on public.districts to authenticated;
grant all on public.districts to service_role;
drop policy if exists districts_read on public.districts;
create policy districts_read on public.districts for select to authenticated using(auth.uid() is not null);
alter table public.blocks add column if not exists district_name text not null default 'Araria' references public.districts(name);
alter table public.profiles add column if not exists staff_scope text not null default 'block' check(staff_scope in ('block','district'));
alter table public.profiles add column if not exists district_name text not null default 'Araria' references public.districts(name);
grant select(staff_scope,district_name) on public.profiles to authenticated;
alter table public.attendance add column if not exists evidence_block_id uuid references public.blocks(id);
update public.attendance a set evidence_block_id=coalesce(
 (select b.id from blocks b where b.id::text=split_part(coalesce(a.photo_path,a.out_photo_path,a.leave_path,''),'/',1)),
 (select p.block_id from profiles p where p.id=a.staff_id)) where evidence_block_id is null;

create or replace function public.district_profile_guard() returns trigger
language plpgsql security definer set search_path=public as $$
declare expected uuid; a jsonb;
begin
 select id into expected from blocks where name_en=new.block and active and district_name=new.district_name;
 if expected is null or new.block_id is distinct from expected then raise exception 'PORTAL:Block mismatch'; end if;
 if new.staff_scope='district' and new.role<>'staff' then raise exception 'PORTAL:District scope is for staff accounts only'; end if;
 if new.role='staff' then
  if jsonb_typeof(new.assignments)<>'array' or jsonb_array_length(new.assignments)<1 then raise exception 'PORTAL:Assignments required'; end if;
  for a in select value from jsonb_array_elements(new.assignments) loop
   if a->>'department' is distinct from 'पंचायती राज विभाग' or
      (a?'block' and not exists(select 1 from blocks b where b.id::text=a->>'block_id' and b.name_en=a->>'block')) or
      not exists(select 1 from blocks b where b.id::text=a->>'block_id' and b.active and b.district_name=new.district_name) or
      (new.staff_scope='block' and a->>'block_id' is distinct from new.block_id::text) or
      not exists(select 1 from panchayats w where w.block_id::text=a->>'block_id' and w.name=a->>'panchayat') then
    raise exception 'PORTAL:Invalid assigned district, block or panchayat';
   end if;
  end loop;
 end if;
 return new;
end $$;
drop trigger if exists district_profile_guard on public.profiles;
create trigger district_profile_guard before insert or update of block,block_id,assignments,role,staff_scope,district_name
on public.profiles for each row execute function public.district_profile_guard();

create or replace function public.can_read_profile(target uuid) returns boolean
language sql stable security definer set search_path=public as $$
 select exists(select 1 from profiles actor join profiles subject on subject.id=target
 where actor.id=auth.uid() and actor.active and actor.deleted_at is null and
 (actor.id=target or actor.role='dpro' or (actor.role='bpro' and
  ((subject.staff_scope='block' and actor.block_id=subject.block_id) or
   (subject.staff_scope='district' and exists(select 1 from jsonb_array_elements(subject.assignments) a where a->>'block_id'=actor.block_id::text))))));
$$;
create or replace function public.district_attendance_guard() returns trigger
language plpgsql security definer set search_path=public as $$
declare person profiles;
begin
 if TG_OP='INSERT' then
  select * into person from profiles where id=new.staff_id;
  if person.id is null then raise exception 'PORTAL:Unknown staff'; end if;
  if new.block_id is null then new.block_id=person.block_id; end if;
  if person.staff_scope='block' and new.block_id<>person.block_id then raise exception 'PORTAL:Attendance block mismatch'; end if;
  if person.staff_scope='district' and not exists(select 1 from jsonb_array_elements(person.assignments) a
   where a->>'block_id'=new.block_id::text and a->>'panchayat'=new.panchayat and a->>'position'=new.position) then
   raise exception 'PORTAL:Workspace is outside assigned blocks'; end if;
  new.evidence_block_id=person.block_id;
  select name_en into new.block from blocks where id=new.block_id;
  if new.department is null then new.department='पंचायती राज विभाग'; end if;
 elsif new.block_id<>old.block_id or new.staff_id<>old.staff_id then raise exception 'PORTAL:Historical attendance block cannot move'; end if;
 if new.department is distinct from 'पंचायती राज विभाग' and new.deleted_at is null then raise exception 'PORTAL:Only Panchayati Raj attendance is allowed'; end if;
 return new;
end $$;

-- An assigned BPRO may view district attendance but may not manage district staff.
create or replace function public.guard_district_staff_management() returns trigger
language plpgsql security definer set search_path=public as $$
declare actor profiles;
begin
 select * into actor from profiles where id=auth.uid();
 if actor.role='bpro' and (old.staff_scope='district' or new.staff_scope='district') then
  raise exception 'PORTAL:District staff are managed by DPRO only'; end if;
 return new;
end $$;
drop trigger if exists guard_district_staff_management on public.profiles;
create trigger guard_district_staff_management before update on public.profiles
for each row execute function public.guard_district_staff_management();

create or replace function public.manage_district_staff(actor_id uuid,target_id uuid,changes jsonb) returns jsonb
language plpgsql security definer set search_path=public as $$
declare actor profiles; target profiles; result profiles; destination blocks;
begin
 select * into actor from profiles where id=actor_id;
 if actor.role is distinct from 'dpro' or not actor.active or actor.deleted_at is not null then raise exception 'PORTAL:DPRO access required'; end if;
 select * into target from profiles where id=target_id and role='staff' and deleted_at is null for update;
 if target.id is null then raise exception 'PORTAL:Staff not found'; end if;
 if changes-ARRAY['name','phone','email','gender','active','assignments','block_id','staff_scope','district_name']<>'{}'::jsonb then raise exception 'PORTAL:Invalid staff changes'; end if;
 select * into destination from blocks where id=coalesce(nullif(changes->>'block_id','')::uuid,target.block_id) and active;
 if destination.id is null then raise exception 'PORTAL:Choose an active block'; end if;
 update profiles set name=coalesce(changes->>'name',name),phone=coalesce(changes->>'phone',phone),
 email=case when changes?'email' then nullif(changes->>'email','') else email end,
 gender=case when changes?'gender' then nullif(changes->>'gender','') else gender end,
 active=coalesce((changes->>'active')::boolean,active),block=destination.name_en,block_id=destination.id,
 staff_scope=coalesce(changes->>'staff_scope',staff_scope),district_name=coalesce(changes->>'district_name',district_name),
 assignments=coalesce(changes->'assignments',assignments)
 where id=target_id returning * into result;
 insert into audit_logs(actor_id,actor_role,action,target_id,block_id,reason)
 values(actor_id,'dpro','manage_district_staff',target_id::text,result.block_id,'DPRO updated district staff assignments');
 return to_jsonb(result)-'login_email'-'device_hash';
end $$;
revoke all on function public.manage_district_staff(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.manage_district_staff(uuid,uuid,jsonb) to service_role;

-- District leave requests are private to their staff member and DPRO.
drop policy if exists leave_applications_read on public.leave_applications;
create policy leave_applications_read on public.leave_applications for select to authenticated using(
 staff_id=auth.uid() or exists(select 1 from profiles actor join profiles person on person.id=leave_applications.staff_id
 where actor.id=auth.uid() and actor.active and actor.deleted_at is null and
 (actor.role='dpro' or (actor.role='bpro' and person.staff_scope='block' and actor.block_id=leave_applications.block_id))));

create or replace function public.save_staff_attendance_in_block(user_id uuid,action_name text,panchayat_name text,department_name text,position_name text,status_name text,workplace_name text,leave_kind text,device_hash text,photo_path text default null,leave_path text default null,lat double precision default null,lng double precision default null,acc double precision default null,capture_id uuid default null,image_hash text default null,perceptual_hash text default null,request_ip text default null,request_agent text default null,absence_reason text default null,workspace_block_id uuid default null) returns jsonb language plpgsql security definer set search_path=public as $$
declare p profiles; r attendance; upload pending_uploads; upload_path text; f text[]='{}'; d date=(now() at time zone 'Asia/Kolkata')::date;
begin
 if auth.uid() is distinct from user_id then raise exception 'PORTAL:कर्मी की पहचान अमान्य है।'; end if;
 perform pg_advisory_xact_lock(hashtextextended(user_id::text||d::text,0));
 select * into p from profiles where id=user_id;
 if not found or not p.active or p.deleted_at is not null or p.role<>'staff' then raise exception 'PORTAL:खाता मान्य नहीं है।'; end if;
 if p.staff_scope<>'district' or not exists(select 1 from jsonb_array_elements(p.assignments) a
 where a->>'block_id'=workspace_block_id::text and a->>'panchayat'=panchayat_name and a->>'position'=position_name) then
 raise exception 'PORTAL:Invalid district workspace'; end if;
 if action_name='save_draft' and (clock_timestamp() at time zone 'Asia/Kolkata')::time>='15:00' then raise exception 'PORTAL:Arrival closes at 3 PM IST'; end if;
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
 if status_name in ('present','deputation','on_duty') and coalesce(length(trim(save_staff_attendance_in_block.photo_path)),0)=0 then raise exception 'PORTAL:कार्यस्थल की JPEG/PNG फोटो आवश्यक है।'; end if;
 if status_name in ('absent','on_duty') and (coalesce(length(trim(absence_reason)),0)<3 or length(trim(absence_reason))>1000) then raise exception 'PORTAL:अनुपस्थिति का कारण आवश्यक है (3–1000 अक्षर)।'; end if;
 if status_name='leave' and (leave_kind is null or leave_kind not in ('CL','SL')) then raise exception 'PORTAL:CL या SL चुनें।'; end if;
 if status_name='leave' and coalesce(length(trim(save_staff_attendance_in_block.leave_path)),0)=0 then raise exception 'PORTAL:अवकाश के लिए JPEG/PDF दस्तावेज आवश्यक है।'; end if;
 if status_name<>'leave' and (leave_kind is not null or save_staff_attendance_in_block.leave_path is not null) then raise exception 'PORTAL:अवकाश दस्तावेज केवल अवकाश के लिए है।'; end if;
 if status_name not in ('present','deputation','on_duty') and save_staff_attendance_in_block.photo_path is not null then raise exception 'PORTAL:फोटो केवल कार्यस्थल उपस्थिति के लिए है।'; end if;
 foreach upload_path in array ARRAY[save_staff_attendance_in_block.photo_path,save_staff_attendance_in_block.leave_path] loop
  if upload_path is null then continue; end if;
  if upload_path not like p.block_id::text||'/'||user_id::text||'/'||d::text||'/%' then raise exception 'PORTAL:फ़ाइल का स्वामी अमान्य है।'; end if;
  select * into upload from pending_uploads where pending_uploads.path=upload_path and staff_id=user_id for update;
  if not found or upload.consumed or upload.expires_at<now() then raise exception 'PORTAL:अपलोड समय सीमा समाप्त या अमान्य।'; end if;
 end loop;
 insert into attendance(block_id,staff_id,date,panchayat,department,position,block,staff_name,status,phase,deputation_workplace,leave_type,time_in,latitude,longitude,accuracy,photo_path,photo_hash,leave_path,working_places,flags,request_ip,request_agent,absence_reason)
 values(workspace_block_id,user_id,d,panchayat_name,department_name,position_name,p.block,p.name,status_name,case when action_name='save_draft' then 'draft' else 'submitted' end,case when status_name in ('deputation','on_duty') then trim(workplace_name) end,case when status_name='leave' then leave_kind end,case when action_name='save_draft' then clock_timestamp() end,case when action_name='save_draft' then lat end,case when action_name='save_draft' then lng end,case when action_name='save_draft' then acc end,save_staff_attendance_in_block.photo_path,image_hash,save_staff_attendance_in_block.leave_path,p.assignments,f,save_staff_attendance_in_block.request_ip,save_staff_attendance_in_block.request_agent,case when status_name in ('absent','on_duty') then trim(absence_reason) end) returning * into r;
 update pending_uploads set consumed=true where pending_uploads.path in (save_staff_attendance_in_block.photo_path,save_staff_attendance_in_block.leave_path);
 return to_jsonb(r);
end $$;
revoke all on function public.save_staff_attendance_in_block(uuid,text,text,text,text,text,text,text,text,text,text,double precision,double precision,double precision,uuid,text,text,text,text,text,uuid) from public,anon;
grant execute on function public.save_staff_attendance_in_block(uuid,text,text,text,text,text,text,text,text,text,text,double precision,double precision,double precision,uuid,text,text,text,text,text,uuid) to authenticated;

create or replace function public.submit_district_leave_application(
 panchayat_name text, position_name text, leave_kind text,
 document_path text, leave_detail_text text, requested_dates date[], workspace_block_id uuid
) returns jsonb language plpgsql security definer set search_path=public as $$
declare actor public.profiles; upload public.pending_uploads;
 request_row public.leave_applications; dates date[]; work_dates date[];
 today date=(now() at time zone 'Asia/Kolkata')::date;
begin
 select * into actor from public.profiles where id=auth.uid();
 if actor.staff_scope is distinct from 'district' then raise exception 'PORTAL:District staff only'; end if;
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
   and a->>'block_id'=workspace_block_id::text) then
  raise exception 'PORTAL:नियुक्त कार्यस्थल या पद अमान्य है।';
 end if;
 select array_agg(d order by d) into work_dates from unnest(dates) d
  where extract(isodow from d)<>7
   and not exists(select 1 from public.office_holidays h where h.date=d
    and (h.block_id is null or h.block_id=workspace_block_id));
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
 values(actor.id,workspace_block_id,actor.name,dates[1],dates,panchayat_name,position_name,
  actor.assignments,leave_kind,document_path,nullif(btrim(leave_detail_text),''))
 returning * into request_row;
 update public.pending_uploads set consumed=true where path=document_path;
 insert into public.audit_logs(actor_id,action,target_id,reason,block_id)
 values(actor.id,'submit_leave_application',request_row.id::text,
  'Staff submitted leave application',workspace_block_id);
 return to_jsonb(request_row);
end $$;
revoke all on function public.submit_district_leave_application(text,text,text,text,text,date[],uuid) from public,anon;
grant execute on function public.submit_district_leave_application(text,text,text,text,text,date[],uuid) to authenticated;

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
 if request_row.id is null or (actor.role='bpro' and (actor.block_id<>request_row.block_id or exists(select 1 from profiles p where p.id=request_row.staff_id and p.staff_scope='district'))) then
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
   or (staff.staff_scope='block' and staff.block_id<>request_row.block_id) then
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


create or replace function public.complete_attendance_with_out_photo(
  user_id uuid, photo_path text, lat double precision,
  lng double precision, acc double precision
) returns jsonb language plpgsql security definer set search_path=public as $$
declare
  actor public.profiles;
  current_record public.attendance;
  upload public.pending_uploads;
  today date=(now() at time zone 'Asia/Kolkata')::date;
begin
  if auth.uid() is distinct from user_id then
    raise exception 'PORTAL:कर्मी की पहचान अमान्य है।';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(user_id::text||today::text,0));
  select * into actor from public.profiles
    where id=user_id and role='staff' and active and deleted_at is null;
  if not found or actor.block_id is null then
    raise exception 'PORTAL:खाता मान्य नहीं है।';
  end if;
  if lat is null or lng is null or acc is null or
     lat not between -90 and 90 or lng not between -180 and 180 or
     acc<=0 or acc>1000000 or
     lat='NaN'::float8 or lng='NaN'::float8 or acc='NaN'::float8 then
    raise exception 'PORTAL:ताज़ा GPS स्थान आवश्यक है।';
  end if;
  if photo_path is null or
     photo_path not like actor.block_id::text||'/'||user_id::text||'/'||today::text||'/%' or
     photo_path !~ '^[a-zA-Z0-9/_-]+[.]jpg$' then
    raise exception 'PORTAL:आउट समय की GPS फोटो आवश्यक है।';
  end if;
  select * into current_record from public.attendance
    where staff_id=user_id and date=today and deleted_at is null for update;
  if not found or (actor.staff_scope='block' and current_record.block_id is distinct from actor.block_id) or
     current_record.phase<>'draft' or
     current_record.status not in ('present','deputation','on_duty') or
     current_record.time_in is null or current_record.time_out is not null then
    raise exception 'PORTAL:आज का कार्यस्थल प्रवेश ड्राफ्ट आवश्यक है।';
  end if;
  select * into upload from public.pending_uploads
    where pending_uploads.path=complete_attendance_with_out_photo.photo_path
      and staff_id=user_id and block_id=actor.block_id
    for update;
  if not found or upload.consumed or upload.expires_at<now() then
    raise exception 'PORTAL:अपलोड समय सीमा समाप्त या अमान्य।';
  end if;
  update public.attendance set
    time_out=clock_timestamp(), phase='submitted',
    out_photo_path=complete_attendance_with_out_photo.photo_path,
    out_location=jsonb_build_object('latitude',lat,'longitude',lng,'accuracy',acc),
    version=version+1
    where id=current_record.id returning * into current_record;
  update public.pending_uploads set consumed=true
    where pending_uploads.path=complete_attendance_with_out_photo.photo_path;
  return to_jsonb(current_record);
end $$;
revoke all on function public.complete_attendance_with_out_photo(uuid,text,double precision,double precision,double precision) from public,anon,authenticated;
grant execute on function public.complete_attendance_with_out_photo(uuid,text,double precision,double precision,double precision) to authenticated;

do $$
declare fn regprocedure; definition text;
begin
 foreach fn in array array['public.delete_master_staff(uuid,uuid,text)'::regprocedure,
 'public.manage_staff_with_gender(uuid,uuid,jsonb,text)'::regprocedure] loop
  definition=pg_get_functiondef(fn);
  if position('District staff are managed by DPRO only' in definition)=0 then
  definition=replace(definition,'begin', $guard$begin
 if exists(select 1 from profiles a join profiles s on s.id=target_id
 where a.id=actor_id and a.role='bpro' and s.staff_scope='district') then
 raise exception 'PORTAL:District staff are managed by DPRO only'; end if;$guard$);
  execute definition;
  end if;
 end loop;
end $$;
-- Assigned district staff can read the workspace catalog and office notices in their blocks.
create or replace function public.can_read_office(target_block uuid) returns boolean
language sql stable security definer set search_path=public as $$
 select exists(select 1 from profiles actor where actor.id=auth.uid() and actor.active and actor.deleted_at is null and
 (target_block is null or actor.role='dpro' or actor.block_id=target_block or
 (actor.role='staff' and actor.staff_scope='district' and exists(select 1 from jsonb_array_elements(actor.assignments) a where a->>'block_id'=target_block::text))));
$$;
-- Block admins cannot use manual attendance or corrections to manage district staff.
do $$ declare definition text;
begin
 definition=pg_get_functiondef('public.admin_input_attendance(uuid,uuid,date,text,text,timestamptz,timestamptz,text)'::regprocedure);
 if position('DPRO access required for district staff' in definition)=0 then
 definition=replace(definition,'begin', $g$begin
 if exists(select 1 from profiles a join profiles s on s.id=user_id where a.id=actor_id and a.role='bpro' and s.staff_scope='district') then raise exception 'PORTAL:DPRO access required for district staff'; end if;$g$);
 execute definition;
 end if;
 definition=pg_get_functiondef('public.correct_attendance(uuid,uuid,jsonb,text)'::regprocedure);
 if position('DPRO access required for district staff' in definition)=0 then
 definition=replace(definition,'begin', $g$begin
 if exists(select 1 from profiles a join attendance r on r.id=record_id join profiles s on s.id=r.staff_id where a.id=actor_id and a.role='bpro' and s.staff_scope='district') then raise exception 'PORTAL:DPRO access required for district staff'; end if;$g$);
 execute definition;
 end if;
end $$;
do $$ declare definition text; fn regprocedure;
begin
 foreach fn in array array['public.admin_input_attendance_with_leave(uuid,uuid,date,text,text,timestamptz,timestamptz,text,text)'::regprocedure,'public.delete_admin_attendance(uuid,uuid,text)'::regprocedure] loop
 definition=pg_get_functiondef(fn);
 if position('District records require DPRO' in definition)=0 then
  if fn::text like '%delete_admin_attendance%' then
   definition=replace(definition,'begin',$g$begin
    if exists(select 1 from profiles a join attendance r on r.id=record_id join profiles s on s.id=r.staff_id where a.id=actor_id and a.role='bpro' and s.staff_scope='district') then raise exception 'PORTAL:District records require DPRO'; end if;$g$);
  else
   definition=replace(definition,'begin',$g$begin
    if exists(select 1 from profiles a join profiles s on s.id=user_id where a.id=actor_id and a.role='bpro' and s.staff_scope='district') then raise exception 'PORTAL:District records require DPRO'; end if;$g$);
  end if;
  execute definition;
 end if;
 end loop;
end $$;
-- Enrich the existing bootstrap without changing its other return values.
do $$ begin
 if to_regprocedure('public.portal_bootstrap_before_district_staff()') is null then
  alter function public.portal_bootstrap() rename to portal_bootstrap_before_district_staff;
 end if;
end $$;
create or replace function public.portal_bootstrap() returns jsonb language plpgsql stable security invoker set search_path=public as $$
declare result jsonb;
begin
 result=public.portal_bootstrap_before_district_staff();
 if jsonb_typeof(result->'staff')='array' then
 result=jsonb_set(result,'{staff}',coalesce((select jsonb_agg(entry || coalesce((select jsonb_build_object('staff_scope',p.staff_scope,'district_name',p.district_name) from profiles p where p.id=(entry->>'id')::uuid),'{}'::jsonb)) from jsonb_array_elements(result->'staff') entry),'[]'::jsonb));
 end if;
 return jsonb_set(result,'{profile}',(result->'profile') ||
 (select jsonb_build_object('staff_scope',staff_scope,'district_name',district_name) from profiles where id=auth.uid()));
end $$;
grant execute on function public.portal_bootstrap() to authenticated;
notify pgrst,'reload schema';
commit;

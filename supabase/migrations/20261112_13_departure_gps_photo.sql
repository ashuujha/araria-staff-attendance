-- Apply after 20261111_12. Existing attendance and photos are preserved.
begin;
alter table public.attendance add column if not exists out_photo_path text;
alter table public.attendance add column if not exists out_location jsonb;

-- The older attendance RPC still accepts a "complete" action. Guard every
-- staff-originated transition so it cannot bypass the new evidence requirement.
create or replace function public.require_staff_departure_photo()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if auth.uid() is not distinct from new.staff_id and
     old.time_out is null and new.time_out is not null and
     new.status in ('present','deputation','on_duty') and
     (new.out_photo_path is null or new.out_location is null) then
    raise exception 'PORTAL:आउट समय की GPS फोटो आवश्यक है।';
  end if;
  return new;
end $$;
drop trigger if exists attendance_staff_departure_photo on public.attendance;
create trigger attendance_staff_departure_photo
before update of time_out,out_photo_path on public.attendance
for each row execute function public.require_staff_departure_photo();
revoke all on function public.require_staff_departure_photo() from public,anon,authenticated;

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
  if not found or current_record.block_id is distinct from actor.block_id or
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
notify pgrst, 'reload schema';
commit;

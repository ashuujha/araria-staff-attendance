begin;
-- Runs as the authenticated caller. Existing RLS still controls every row.
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
  select a.id,a.staff_id,a.date,a.panchayat,a.department,a.position,a.block,a.staff_name,a.status,a.phase,a.deputation_workplace,a.leave_type,a.absence_reason,a.time_in,a.time_out,a.photo_path,a.leave_path,a.working_places,a.created_at,
   jsonb_build_object('id',u.id,'name',u.name,'phone',u.phone,'email',u.email,'block',u.block,'role',u.role,'active',u.active) as profiles
  from attendance a left join profiles u on u.id=a.staff_id
  where a.date=d and a.deleted_at is null and (p->>'role'<>'staff' or a.staff_id=(p->>'id')::uuid)
 ) r;
 select coalesce(jsonb_agg(jsonb_build_object('date',date,'reason',reason) order by date),'[]') into holidays from office_holidays;
 select coalesce(jsonb_agg(to_jsonb(n) order by n.created_at desc,n.id desc),'[]') into notices from (
  select id,title,body,created_at from office_notices where deleted_at is null order by created_at desc,id desc limit 100
 ) n;
 return jsonb_build_object('profile',p,'date',d,'records',attendance_rows,'staff',staff_rows,'office',jsonb_build_object('today',d,'holidays',holidays,'notices',notices));
end $$;
revoke all on function public.portal_bootstrap() from public,anon;
grant execute on function public.portal_bootstrap() to authenticated;
create index if not exists staff_directory_name_idx on public.profiles(name) where role='staff' and deleted_at is null;
NOTIFY pgrst, 'reload schema';
commit;

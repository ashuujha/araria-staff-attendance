-- Reserve CL/SL allowance for pending applications as well as approved leave.
-- Existing attendance and applications are not changed.
begin;
create or replace function public.guard_leave_request_allowance() returns trigger
language plpgsql security definer set search_path=public as $$
declare calendar_year integer; calendar_month integer; used integer; person profiles;
begin
 if new.status<>'pending' or new.leave_type not in ('CL','SL') then return new; end if;
 perform pg_advisory_xact_lock(hashtextextended('leave-quota:'||new.staff_id::text,0));
 select * into person from profiles where id=new.staff_id;
 if new.leave_type='SL' and person.gender is distinct from 'female' then raise exception 'PORTAL:SL is available only to female staff'; end if;
 for calendar_year in select distinct extract(year from d)::integer from unnest(new.leave_dates) d loop
  with reserved as (
   select a.date as day from attendance a where a.staff_id=new.staff_id and a.deleted_at is null and a.status='leave' and a.leave_type=new.leave_type
   union
   select d from leave_applications r cross join lateral unnest(r.leave_dates) d
    where r.staff_id=new.staff_id and r.status='pending' and r.leave_type=new.leave_type and r.id<>new.id
    and extract(isodow from d)<>7 and not exists(select 1 from office_holidays h where h.date=d and (h.block_id is null or h.block_id=r.block_id))
   union
   select d from unnest(new.leave_dates) d where extract(isodow from d)<>7
    and not exists(select 1 from office_holidays h where h.date=d and (h.block_id is null or h.block_id=new.block_id))
  ) select count(*) into used from reserved where extract(year from day)=calendar_year;
  if used>(case when new.leave_type='CL' then 16 else 24 end) then
   raise exception 'PORTAL:% allowance exceeded for %. Approved and pending leave are included.',new.leave_type,calendar_year;
  end if;
  if new.leave_type='SL' then
   for calendar_month in select distinct extract(month from d)::integer from unnest(new.leave_dates) d where extract(year from d)=calendar_year loop
    with reserved as (
     select a.date as day from attendance a where a.staff_id=new.staff_id and a.deleted_at is null and a.status='leave' and a.leave_type='SL'
     union
     select d from leave_applications r cross join lateral unnest(r.leave_dates) d
      where r.staff_id=new.staff_id and r.status='pending' and r.leave_type='SL' and r.id<>new.id
      and extract(isodow from d)<>7 and not exists(select 1 from office_holidays h where h.date=d and (h.block_id is null or h.block_id=r.block_id))
     union
     select d from unnest(new.leave_dates) d where extract(isodow from d)<>7
      and not exists(select 1 from office_holidays h where h.date=d and (h.block_id is null or h.block_id=new.block_id))
    ) select count(*) into used from reserved where extract(year from day)=calendar_year and extract(month from day)=calendar_month;
    if used>2 then raise exception 'PORTAL:SL monthly allowance exceeded (2 days per month). Approved and pending leave are included.'; end if;
   end loop;
  end if;
 end loop;
 return new;
end $$;
drop trigger if exists guard_leave_request_allowance on public.leave_applications;
create trigger guard_leave_request_allowance before insert on public.leave_applications
for each row execute function public.guard_leave_request_allowance();
revoke all on function public.guard_leave_request_allowance() from public,anon,authenticated;
notify pgrst,'reload schema';
commit;

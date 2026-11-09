-- READ ONLY. Run before the district conversion. Keep the output with the change record.
-- This file intentionally contains no BEGIN/COMMIT or DDL.
select 'profiles_by_role_block' as section, role, block,
       count(*) as rows, count(*) filter (where active and deleted_at is null) as active_rows
from public.profiles group by role, block order by role, block;

select 'non_panchayati_assignments' as section,
       count(distinct p.id) as affected_profiles,
       count(*) as assignments
from public.profiles p cross join lateral jsonb_array_elements(p.assignments) a
where coalesce(a->>'department','') not in
 ('पंचायती राज विभाग','पंचायतीराज विभाग','Panchayati Raj Department');

select 'historical_attendance_by_department' as section,
       coalesce(department,'<NULL>') as department,
       count(*) as rows,
       count(*) filter (where deleted_at is null) as active_rows
from public.attendance group by department order by rows desc;

select 'staff_to_soft_archive_without_panchayati_assignment' as section,
       count(*) as affected_staff
from public.profiles p where p.role='staff' and p.active and p.deleted_at is null
 and not exists (select 1 from jsonb_array_elements(coalesce(p.assignments,'[]'::jsonb)) a
   where a->>'department' in ('पंचायती राज विभाग','पंचायतीराज विभाग','Panchayati Raj Department'));

select 'historical_attendance_by_block' as section,
       coalesce(block,'<NULL>') as block, count(*) as rows
from public.attendance group by block order by rows desc;

select 'office_holidays' as section, count(*) as rows from public.office_holidays;
select 'office_notices' as section, count(*) as rows from public.office_notices;
select 'pending_uploads' as section, count(*) as rows,
       count(*) filter (where not consumed) as unconsumed
from public.pending_uploads;

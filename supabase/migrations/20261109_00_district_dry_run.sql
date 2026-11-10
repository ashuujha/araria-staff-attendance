-- READ ONLY. Run before the district conversion. Save the entire result table.
-- One SELECT returns all counts together in the Supabase SQL Editor.
-- related_count means active profiles/attendance, affected profiles, or
-- unconsumed uploads according to the section. NULL means not applicable.
with report as (
  select 'profiles_by_role_block'::text as section,
         role || ' / ' || coalesce(block, '<NULL>') as detail,
         count(*) as total_count,
         count(*) filter (where active and deleted_at is null) as related_count
  from public.profiles group by role, block

  union all
  select 'non_panchayati_assignments', 'assignments / affected profiles',
         count(*), count(distinct p.id)
  from public.profiles p
  cross join lateral jsonb_array_elements(coalesce(p.assignments, '[]'::jsonb)) a
  where coalesce(a->>'department','') not in
    ('पंचायती राज विभाग','पंचायतीराज विभाग','Panchayati Raj Department')

  union all
  select 'historical_attendance_by_department', coalesce(department, '<NULL>'),
         count(*), count(*) filter (where deleted_at is null)
  from public.attendance group by department

  union all
  select 'staff_to_soft_archive_without_panchayati_assignment', 'active staff',
         count(*), null::bigint
  from public.profiles p
  where p.role = 'staff' and p.active and p.deleted_at is null
    and not exists (
      select 1 from jsonb_array_elements(coalesce(p.assignments, '[]'::jsonb)) a
      where a->>'department' in
        ('पंचायती राज विभाग','पंचायतीराज विभाग','Panchayati Raj Department')
    )

  union all
  select 'historical_attendance_by_block', coalesce(block, '<NULL>'),
         count(*), null::bigint
  from public.attendance group by block

  union all
  select 'office_holidays', 'all', count(*), null::bigint
  from public.office_holidays

  union all
  select 'office_notices', 'all', count(*), null::bigint
  from public.office_notices

  union all
  select 'pending_uploads', 'all / unconsumed',
         count(*), count(*) filter (where not consumed)
  from public.pending_uploads
)
select section, detail, total_count, related_count
from report
order by section, detail;

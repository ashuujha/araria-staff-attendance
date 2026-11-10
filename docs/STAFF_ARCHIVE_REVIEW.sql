-- READ ONLY. Review these active accounts before department archive step 05.
-- This query lists staff who would lose login because they have no
-- Panchayati Raj assignment. It does not update or delete anything.
select p.name,
       p.phone,
       p.block,
       coalesce((
         select string_agg(distinct coalesce(a->>'department', '<blank>'), ', ')
         from jsonb_array_elements(coalesce(p.assignments, '[]'::jsonb)) a
       ), '<no assignment>') as current_departments,
       (select count(*) from public.attendance t where t.staff_id = p.id) as attendance_records
from public.profiles p
where p.role = 'staff' and p.active and p.deleted_at is null
  and not exists (
    select 1 from jsonb_array_elements(coalesce(p.assignments, '[]'::jsonb)) a
    where a->>'department' in
      ('पंचायती राज विभाग', 'पंचायतीराज विभाग', 'Panchayati Raj Department')
  )
order by p.name, p.phone;

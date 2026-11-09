-- DATA-CHANGING MIGRATION: do not run without reviewing the dry-run counts,
-- a backup, and explicit approval. Historical attendance is retained in place.
begin;

create table if not exists public.department_archive (
 profile_id uuid primary key references public.profiles(id),
 original_assignments jsonb not null,
 original_active boolean not null,
 original_deleted_at timestamptz,
 archived_at timestamptz not null default now()
);
revoke all on public.department_archive from public,anon,authenticated;
grant all on public.department_archive to service_role;
alter table public.department_archive enable row level security;

alter table public.attendance add column if not exists department_archived boolean not null default false;

insert into public.department_archive(profile_id,original_assignments,original_active,original_deleted_at)
select p.id,p.assignments,p.active,p.deleted_at from public.profiles p
where p.role='staff' and exists(select 1 from jsonb_array_elements(p.assignments) a
 where coalesce(a->>'department','') not in
 ('पंचायती राज विभाग','पंचायतीराज विभाग','Panchayati Raj Department'))
on conflict(profile_id) do nothing;

update public.profiles p set assignments=coalesce((
 select jsonb_agg(jsonb_build_object('panchayat',a->>'panchayat',
  'position',a->>'position','department','पंचायती राज विभाग','block_id',p.block_id))
 from jsonb_array_elements(p.assignments) a
 where a->>'department' in
 ('पंचायती राज विभाग','पंचायतीराज विभाग','Panchayati Raj Department')
), '[]'::jsonb)
where p.role='staff';

-- Accounts with no Panchayati Raj assignment remain archived and cannot sign in.
update public.profiles set active=false,deleted_at=coalesce(deleted_at,now())
where role='staff' and jsonb_array_length(assignments)=0;

update public.attendance set department_archived=true
where department is distinct from 'पंचायती राज विभाग'
 and coalesce(department,'') not in ('पंचायतीराज विभाग','Panchayati Raj Department');
update public.attendance set department='पंचायती राज विभाग'
where not department_archived and department in
 ('पंचायतीराज विभाग','Panchayati Raj Department');

alter table public.attendance drop constraint if exists attendance_single_department_check;
alter table public.attendance add constraint attendance_single_department_check
check(department_archived or department='पंचायती राज विभाग');
drop policy if exists attendance_read on public.attendance;
create policy attendance_read on public.attendance for select to authenticated
using(deleted_at is null and not department_archived
 and public.can_read_attendance(staff_id,block_id));

notify pgrst, 'reload schema';
commit;

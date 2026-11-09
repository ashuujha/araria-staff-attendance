-- The same panchayat name may occur in more than one block.
begin;
alter table public.attendance drop constraint if exists attendance_panchayat_fkey;
do $$ begin
 if not exists(select 1 from pg_constraint where conname='panchayats_pkey' and
   conkey=array[(select attnum from pg_attribute where attrelid='public.panchayats'::regclass and attname='block_id'),
                (select attnum from pg_attribute where attrelid='public.panchayats'::regclass and attname='name')]::smallint[]) then
  alter table public.panchayats drop constraint if exists panchayats_pkey;
  alter table public.panchayats add constraint panchayats_pkey primary key(block_id,name);
 end if;
 if not exists(select 1 from pg_constraint where conname='attendance_workspace_fkey') then
  alter table public.attendance add constraint attendance_workspace_fkey
   foreign key(block_id,panchayat) references public.panchayats(block_id,name);
 end if;
end $$;
create index if not exists panchayats_block_name_idx on public.panchayats(block_id,name);
notify pgrst, 'reload schema';
commit;

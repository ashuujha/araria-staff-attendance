-- Keep historical attendance and leave foreign keys, but retire staff login
-- identifiers so a deleted mobile number can be assigned to a new account.
-- This migration does not delete historical records or active staff.
begin;

create or replace function public.delete_master_staff(actor_id uuid,target_id uuid,reason_text text)
returns void language plpgsql security definer set search_path=public as $$
declare actor public.profiles; target public.profiles;
begin
 select * into actor from public.profiles where id=actor_id;
 select * into target from public.profiles where id=target_id for update;
 if actor.id is null or not actor.active or actor.deleted_at is not null
    or actor.role not in ('dpro','bpro') or target.id is null
    or target.role <> 'staff' or target.deleted_at is not null
    or (actor.role='bpro' and actor.block_id <> target.block_id) then
   raise exception 'PORTAL:कर्मी हटाने की अनुमति नहीं।';
 end if;
 -- The roster is a current directory entry, not an attendance history row.
 delete from public.staff_roster where linked_profile_id=target_id;
 update public.profiles set
   deleted_at=now(), active=false, phone=null, secondary_phones='{}',
   email=null, login_email='retired-' || target_id::text || '@staff.araria.invalid',
   device_hash=null
 where id=target_id;
 insert into public.audit_logs(actor_id,action,target_id,reason,details)
 values(actor_id,'delete_staff',target_id::text,reason_text,
        jsonb_build_object('block_id',target.block_id,'retired_at',now()));
end $$;

-- Apply the same identifier cleanup to accounts that were removed earlier.
update public.staff_roster r set linked_profile_id=null
 from public.profiles p
 where r.linked_profile_id=p.id and p.role='staff' and p.deleted_at is not null;
update public.profiles set
 phone=null, secondary_phones='{}', email=null,
 login_email='retired-' || id::text || '@staff.araria.invalid',
 device_hash=null, active=false
 where role='staff' and deleted_at is not null;

notify pgrst, 'reload schema';
commit;

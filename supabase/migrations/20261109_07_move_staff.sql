-- DPRO-only transfer of a staff account. Historical attendance retains its original block_id.
create or replace function public.move_staff_block(actor_id uuid, target_id uuid, destination_id uuid, changes jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare actor public.profiles; target public.profiles; destination public.blocks; result public.profiles;
begin
  select * into actor from public.profiles where id=actor_id;
  if actor.id is null or actor.role<>'dpro' or not actor.active or actor.deleted_at is not null then
    raise exception 'PORTAL:DPRO access required';
  end if;
  select * into destination from public.blocks where id=destination_id and active;
  if destination.id is null then raise exception 'PORTAL:Choose an active block'; end if;
  select * into target from public.profiles where id=target_id and role='staff' and deleted_at is null for update;
  if target.id is null then raise exception 'PORTAL:Staff not found'; end if;
  if jsonb_typeof(changes->'assignments')<>'array' or jsonb_array_length(changes->'assignments')<1 or
    exists(select 1 from jsonb_array_elements(changes->'assignments') a
      where a->>'block_id' is distinct from destination_id::text or
        a->>'department' is distinct from 'पंचायती राज विभाग' or
        nullif(trim(a->>'panchayat'),'') is null or nullif(trim(a->>'position'),'') is null) then
    raise exception 'PORTAL:Invalid workplace';
  end if;
  if (changes-ARRAY['name','phone','email','gender','active','assignments','block_id'])<>'{}'::jsonb then
    raise exception 'PORTAL:Invalid changes';
  end if;
  perform public.manage_staff_with_gender(actor_id,target_id,changes-'assignments'-'block_id','Administrator updated staff details');
  update public.profiles set block_id=destination_id,block=destination.name_en,assignments=changes->'assignments'
    where id=target_id returning * into result;
  insert into public.audit_logs(actor_id,actor_role,action,target_id,block_id,reason)
    values(actor_id,'dpro','move_staff',target_id::text,destination_id,'move_staff');
  return to_jsonb(result)-'device_hash'-'login_email';
end $$;
revoke all on function public.move_staff_block(uuid,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.move_staff_block(uuid,uuid,uuid,jsonb) to service_role;

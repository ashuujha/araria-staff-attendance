-- Shared account/IP lockouts for all three sign-in pages. Keys are keyed hashes,
-- never email, phone, password, IP address or token values.
begin;
create table if not exists public.district_login_limits (
 key text primary key check(key ~ '^[0-9a-f]{64}$'),
 attempts integer not null default 0,
 locked_until timestamptz,
 updated_at timestamptz not null default now()
);
alter table public.district_login_limits enable row level security;
revoke all on public.district_login_limits from public,anon,authenticated;
grant select,insert,update,delete on public.district_login_limits to service_role;

create or replace function public.login_limit_status(account_key text,ip_key text)
returns boolean language sql security definer set search_path=public as $$
 select not exists(select 1 from district_login_limits
  where key in (account_key,ip_key) and locked_until>now());
$$;
revoke all on function public.login_limit_status(text,text) from public,anon,authenticated;
grant execute on function public.login_limit_status(text,text) to service_role;

create or replace function public.record_login_failure(account_key text,ip_key text)
returns void language plpgsql security definer set search_path=public as $$
declare k text;
begin
 foreach k in array array[account_key,ip_key] loop
  if k is null then continue; end if;
  if k !~ '^[0-9a-f]{64}$' then raise exception 'PORTAL:Invalid login key'; end if;
  insert into district_login_limits(key,attempts,updated_at)
  values(k,1,now())
  on conflict(key) do update set
   attempts=case when district_login_limits.updated_at<now()-interval '15 minutes'
    then 1 else district_login_limits.attempts+1 end,
   updated_at=now(),
   locked_until=case when district_login_limits.updated_at<now()-interval '15 minutes'
    then null when district_login_limits.attempts+1>=5
    then now()+interval '15 minutes' else district_login_limits.locked_until end;
 end loop;
end $$;
revoke all on function public.record_login_failure(text,text) from public,anon,authenticated;
grant execute on function public.record_login_failure(text,text) to service_role;

create or replace function public.clear_login_account(account_key text)
returns void language sql security definer set search_path=public as $$
 delete from district_login_limits where key=account_key;
$$;
revoke all on function public.clear_login_account(text) from public,anon,authenticated;
grant execute on function public.clear_login_account(text) to service_role;

create index if not exists district_login_limits_updated_idx on public.district_login_limits(updated_at);
notify pgrst, 'reload schema';
commit;

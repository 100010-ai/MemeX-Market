create or replace function public.consume_rate_limit_pair_v0795(
  p_actor_key text,
  p_actor_ip_key text,
  p_limit integer,
  p_window_seconds integer
)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_actor_allowed boolean;
  v_actor_ip_allowed boolean;
begin
  v_actor_allowed := public.consume_rate_limit(p_actor_key, p_limit, p_window_seconds);
  v_actor_ip_allowed := public.consume_rate_limit(p_actor_ip_key, p_limit, p_window_seconds);
  return v_actor_allowed and v_actor_ip_allowed;
end;
$function$;

revoke all on function public.consume_rate_limit_pair_v0795(text,text,integer,integer) from public;
revoke all on function public.consume_rate_limit_pair_v0795(text,text,integer,integer) from anon;
revoke all on function public.consume_rate_limit_pair_v0795(text,text,integer,integer) from authenticated;
grant execute on function public.consume_rate_limit_pair_v0795(text,text,integer,integer) to service_role;

comment on function public.consume_rate_limit_pair_v0795(text,text,integer,integer) is
  'Atomically consumes actor and actor+IP rate-limit buckets in one service-role-only PostgREST request.';

begin;

-- MXM v0.41: games are temporarily removed from the product surface.
-- Historical game_rounds data is intentionally preserved for audit/rollback compatibility.
update public.missions
set active=false, updated_at=now()
where key='daily_game_3';

-- Disable both historical RPC signatures as well. The UI/API routes are gone,
-- and service_role cannot settle a game until a future migration explicitly re-enables it.
do $$
begin
  if to_regprocedure('public.play_virtual_game(uuid,text,numeric,text)') is not null then
    execute 'revoke execute on function public.play_virtual_game(uuid,text,numeric,text) from public,anon,authenticated,service_role';
  end if;
  if to_regprocedure('public.play_virtual_game(uuid,text,numeric,text,text)') is not null then
    execute 'revoke execute on function public.play_virtual_game(uuid,text,numeric,text,text) from public,anon,authenticated,service_role';
  end if;
end;
$$;

commit;

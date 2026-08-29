-- MemeX Market v2.23: canonical-name protection for known Telegram Gift collections.
-- A collection name is not proof of origin. TON contains many unrelated collections
-- copying names such as Plush Pepes / Durov's Caps. For the maintained bootstrap
-- registry we know the exact chain address, so any other address using that exact
-- normalized name is an impersonator.

create table if not exists public.tonapi_gift_canonical_collections_v223 (
  address text primary key,
  normalized_name text not null unique,
  display_name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.tonapi_gift_canonical_collections_v223 enable row level security;
revoke all on table public.tonapi_gift_canonical_collections_v223 from public, anon, authenticated;
grant all on table public.tonapi_gift_canonical_collections_v223 to service_role;

insert into public.tonapi_gift_canonical_collections_v223(address,normalized_name,display_name) values
  ('0:46fa0e9a864014196a5e7d66f1f83ffdb10f2859bbf2ea9baeabbf14d9ce0d50','plush pepes','Plush Pepes'),
  ('0:fd8a466aeb13e02a3ce67411b41b44bcd11bd42636f0807acf6570ca73fc2c13','durov''s caps','Durov''s Caps'),
  ('0:b85c4ba5c5bd392dee6017a7ac32d0d64f95d9ead97394c05018db2a7dfc6974','heart lockets','Heart Lockets'),
  ('0:d1adfc39a60202e1ee8d69f500c79d99f589baab5936eb1c5a5d1feac742ca24','light swords','Light Swords'),
  ('0:9e4d224e3d73ff492bce8c82d8fa4ba2e1b187526b1af94ed35cfe038d400d4e','jolly chimps','Jolly Chimps'),
  ('0:13b9419dbeb8cbbd3584e69a5514e542a94d9d9422d49ca4ecbb49f52589bd95','scared cats','Scared Cats'),
  ('0:8db26a47a91498fc3c67ca1e8fd0c30eef370005ff2c56f1b4c2bdb8e690733b','voodoo dolls','Voodoo Dolls'),
  ('0:fa987f5bc1b9fa4b733fb424563afa80216f0cdf8911c1b234d678862d13de0c','spy agarics','Spy Agarics'),
  ('0:388b9f22b92f4351846d519f7bb19a399a791b898501a565d039eddd11409c3f','precious peaches','Precious Peaches'),
  ('0:3f931d963b27575b361460ed433fcd1a1e5e328652c6621c633c0b513cd8cc81','tama gadgets','Tama Gadgets'),
  ('0:b200c91be9b37236528f1f4b496ee6e4d55563012ab2abdb19c2427c01bc4c93','trapped hearts','Trapped Hearts')
on conflict(address) do update set
  normalized_name=excluded.normalized_name,
  display_name=excluded.display_name,
  updated_at=now();

-- Every rejection, including ones created later by the importer, immediately
-- deactivates that source and withdraws system-owned listings. User-owned gifts
-- and trade history are intentionally untouched.
create or replace function public.enforce_tonapi_gift_rejection_v223()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.tonapi_gift_collections
  set active=false,
      last_error=left(new.reason,1000),
      updated_at=now()
  where address=new.address;

  update public.virtual_gifts vg
  set status='owned',
      listing_price=null,
      listed_at=null,
      listing_updated_at=now(),
      listing_expires_at=null,
      updated_at=now()
  from public.gift_assets ga, public.profiles owner
  where vg.asset_id=ga.id
    and vg.owner_profile_id=owner.id
    and owner.is_system=true
    and vg.status='listed'
    and ga.chain_collection_address=new.address;

  return new;
end;
$$;

revoke all on function public.enforce_tonapi_gift_rejection_v223() from public, anon, authenticated;

drop trigger if exists tonapi_gift_rejection_enforce_v223 on public.tonapi_gift_collection_rejections_v221;
create trigger tonapi_gift_rejection_enforce_v223
after insert or update of reason
on public.tonapi_gift_collection_rejections_v221
for each row execute function public.enforce_tonapi_gift_rejection_v223();

-- Extend the collection guard: exact canonical names are address-bound. Keep the
-- semantic negative rules from v2.21 as a second line of defense for unknown names.
create or replace function public.guard_tonapi_gift_collection_v221()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_text text := lower(coalesce(new.name,'') || E'\n' || coalesce(new.description,''));
  v_name text := replace(lower(btrim(coalesce(new.name,''))),'’','''');
  v_reason text;
  v_canonical_address text;
begin
  select r.reason into v_reason
  from public.tonapi_gift_collection_rejections_v221 r
  where r.address = new.address;

  if v_reason is null and v_name <> '' then
    select c.address into v_canonical_address
    from public.tonapi_gift_canonical_collections_v223 c
    where c.normalized_name=v_name;

    if v_canonical_address is not null and new.address<>v_canonical_address then
      v_reason := 'Impersonates canonical Telegram Gift collection name; address mismatch';
    end if;
  end if;

  if v_reason is null and (
       lower(coalesce(new.name,'')) like '%[staging]%'
       or v_text ~ '(hope.{0,120}soon|will be able to|convert.{0,160}(telegram )?gifts?|tribute to telegram gifts?|inspired by telegram.{0,80}gifts?|for our app.{0,120}(telegram|status)|our application.{0,120}(telegram|status))'
  ) then
    v_reason := 'Rejected by Telegram Gift semantic guard';
  end if;

  if v_reason is not null then
    new.active := false;
    new.last_error := left(v_reason,1000);
  end if;
  return new;
end;
$$;

revoke all on function public.guard_tonapi_gift_collection_v221() from public, anon, authenticated;

-- Backfill already-discovered raw-address impersonators. Friendly aliases were
-- registered by v2.22 already, so preserve their more precise rejection reason.
insert into public.tonapi_gift_collection_rejections_v221(address,reason)
select c.address,'Impersonates canonical Telegram Gift collection name; address mismatch'
from public.tonapi_gift_collections c
join public.tonapi_gift_canonical_collections_v223 k
  on replace(lower(btrim(c.name)),'’','''')=k.normalized_name
 and c.address<>k.address
where not exists (
  select 1 from public.tonapi_gift_collection_rejections_v221 r where r.address=c.address
)
on conflict(address) do nothing;

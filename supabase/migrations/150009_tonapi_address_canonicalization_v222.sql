-- MemeX Market v2.22: keep one canonical TON address per bootstrap gift collection.
-- TonAPI discovery uses raw workchain addresses (0:...), while older bootstrap rows
-- used user-friendly EQ... addresses. Both encode the same account, so leaving both
-- active creates duplicate collection identities and duplicate sync work.
-- Asset IDs, ownership and trade rows are preserved; only address metadata changes.

create temporary table mxm_tonapi_address_aliases_v222 (
  friendly text primary key,
  raw text not null unique,
  canonical_name text not null
) on commit drop;

insert into mxm_tonapi_address_aliases_v222(friendly,raw,canonical_name) values
  ('EQBG-g6ahkAUGWpefWbx-D_9sQ8oWbvy6puuq78U2c4NUDFS','0:46fa0e9a864014196a5e7d66f1f83ffdb10f2859bbf2ea9baeabbf14d9ce0d50','Plush Pepes'),
  ('EQD9ikZq6xPgKjzmdBG0G0S80RvUJjbwgHrPZXDKc_wsE84w','0:fd8a466aeb13e02a3ce67411b41b44bcd11bd42636f0807acf6570ca73fc2c13','Durov''s Caps'),
  ('EQC4XEulxb05Le5gF6esMtDWT5XZ6tlzlMBQGNsqffxpdC5U','0:b85c4ba5c5bd392dee6017a7ac32d0d64f95d9ead97394c05018db2a7dfc6974','Heart Lockets'),
  ('EQDRrfw5pgIC4e6NafUAx52Z9Ym6q1k26xxaXR_qx0LKJJ7D','0:d1adfc39a60202e1ee8d69f500c79d99f589baab5936eb1c5a5d1feac742ca24','Light Swords'),
  ('EQCeTSJOPXP_SSvOjILY-kui4bGHUmsa-U7TXP4DjUANTl4s','0:9e4d224e3d73ff492bce8c82d8fa4ba2e1b187526b1af94ed35cfe038d400d4e','Jolly Chimps'),
  ('EQATuUGdvrjLvTWE5ppVFOVCqU2dlCLUnKTsu0n1JYm9la10','0:13b9419dbeb8cbbd3584e69a5514e542a94d9d9422d49ca4ecbb49f52589bd95','Scared Cats'),
  ('EQCNsmpHqRSY_Dxnyh6P0MMO7zcABf8sVvG0wr245pBzO3B3','0:8db26a47a91498fc3c67ca1e8fd0c30eef370005ff2c56f1b4c2bdb8e690733b','Voodoo Dolls'),
  ('EQD6mH9bwbn6S3M_tCRWOvqAIW8M34kRwbI01niGLRPeDPsl','0:fa987f5bc1b9fa4b733fb424563afa80216f0cdf8911c1b234d678862d13de0c','Spy Agarics'),
  ('EQA4i58iuS9DUYRtUZ97sZo5mnkbiYUBpWXQOe3dEUCcP1W8','0:388b9f22b92f4351846d519f7bb19a399a791b898501a565d039eddd11409c3f','Precious Peaches'),
  ('EQA_kx2WOydXWzYUYO1DP80aHl4yhlLGYhxjPAtRPNjMgfYM','0:3f931d963b27575b361460ed433fcd1a1e5e328652c6621c633c0b513cd8cc81','Tama Gadgets'),
  ('EQCyAMkb6bNyNlKPH0tJbubk1VVjASqyq9sZwkJ8AbxMkxxU','0:b200c91be9b37236528f1f4b496ee6e4d55563012ab2abdb19c2427c01bc4c93','Trapped Hearts');

-- Ensure the canonical raw row exists. When TonAPI discovery already created it,
-- keep its richer metadata and furthest pagination position. When only the old
-- friendly bootstrap exists, copy its state to the raw address.
insert into public.tonapi_gift_collections(
  address,name,description,total_hint,next_offset,active,verified_at,last_synced_at,last_error,created_at,updated_at
)
select
  a.raw,
  coalesce(nullif(c.name,''),a.canonical_name),
  c.description,
  c.total_hint,
  c.next_offset,
  true,
  c.verified_at,
  c.last_synced_at,
  null,
  c.created_at,
  now()
from mxm_tonapi_address_aliases_v222 a
left join public.tonapi_gift_collections c on c.address=a.friendly
on conflict(address) do update set
  name=case when coalesce(public.tonapi_gift_collections.name,'')='' then excluded.name else public.tonapi_gift_collections.name end,
  description=coalesce(public.tonapi_gift_collections.description,excluded.description),
  total_hint=case
    when public.tonapi_gift_collections.total_hint is null or public.tonapi_gift_collections.total_hint < 0
      then coalesce(excluded.total_hint,public.tonapi_gift_collections.total_hint)
    else public.tonapi_gift_collections.total_hint
  end,
  next_offset=greatest(public.tonapi_gift_collections.next_offset,excluded.next_offset),
  active=true,
  verified_at=coalesce(public.tonapi_gift_collections.verified_at,excluded.verified_at),
  last_synced_at=case
    when public.tonapi_gift_collections.last_synced_at is null then excluded.last_synced_at
    when excluded.last_synced_at is null then public.tonapi_gift_collections.last_synced_at
    else greatest(public.tonapi_gift_collections.last_synced_at,excluded.last_synced_at)
  end,
  last_error=null,
  updated_at=now();

-- Canonicalize the source on the asset itself. virtual_gifts and gift_trades refer
-- to asset IDs, not collection-address strings, so ownership/history stays intact.
update public.gift_assets ga
set chain_collection_address=a.raw,
    source_reference=case
      when ga.source_reference='tonapi:'||a.friendly then 'tonapi:'||a.raw
      else ga.source_reference
    end,
    updated_at=now()
from mxm_tonapi_address_aliases_v222 a
where ga.chain_collection_address=a.friendly;

-- Mark friendly aliases as permanently non-canonical. The v2.21 trigger reads this
-- registry, preventing an older application bundle from turning them active again.
insert into public.tonapi_gift_collection_rejections_v221(address,reason)
select friendly,'Non-canonical friendly TON alias; use canonical raw workchain address'
from mxm_tonapi_address_aliases_v222
on conflict(address) do update
set reason=excluded.reason,updated_at=now();

update public.tonapi_gift_collections c
set active=false,
    last_error='Non-canonical friendly TON alias; use canonical raw workchain address',
    updated_at=now()
from mxm_tonapi_address_aliases_v222 a
where c.address=a.friendly;

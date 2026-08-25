begin;

-- Preserve real collection content discovered in TonAPI metadata. These exact
-- hosts are handled by the validating media proxy; arbitrary metadata hosts
-- remain excluded.

with media as (
  select
    ga.id,
    case
      when coalesce(ga.chain_metadata->>'image', '') ~* '^https://(nft\.fragment\.com|s\.getgems\.io|cache\.tonapi\.io|ipfs\.io|headgun\.org|chat-mafia\.com)/'
        then ga.chain_metadata->>'image'
      when coalesce(ga.chain_metadata->>'image_url', '') ~* '^https://(nft\.fragment\.com|s\.getgems\.io|cache\.tonapi\.io|ipfs\.io|headgun\.org|chat-mafia\.com)/'
        then ga.chain_metadata->>'image_url'
      when coalesce(ga.chain_metadata->>'preview', '') ~* '^https://(nft\.fragment\.com|s\.getgems\.io|cache\.tonapi\.io|ipfs\.io|headgun\.org|chat-mafia\.com)/'
        then ga.chain_metadata->>'preview'
      else null
    end as preview_url,
    case
      when coalesce(ga.chain_metadata->>'content_url', '') ~* '^https://(nft\.fragment\.com|s\.getgems\.io|cache\.tonapi\.io|ipfs\.io|chat-mafia\.com)/'
        then ga.chain_metadata->>'content_url'
      when coalesce(ga.chain_metadata->>'animation_url', '') ~* '^https://(nft\.fragment\.com|s\.getgems\.io|cache\.tonapi\.io|ipfs\.io|chat-mafia\.com)/'
        then ga.chain_metadata->>'animation_url'
      when coalesce(ga.chain_metadata->>'animation', '') ~* '^https://(nft\.fragment\.com|s\.getgems\.io|cache\.tonapi\.io|ipfs\.io|chat-mafia\.com)/'
        then ga.chain_metadata->>'animation'
      when coalesce(ga.chain_metadata->>'video_url', '') ~* '^https://(nft\.fragment\.com|s\.getgems\.io|cache\.tonapi\.io|ipfs\.io|chat-mafia\.com)/'
        then ga.chain_metadata->>'video_url'
      else null
    end as content_url
  from public.gift_assets ga
  where ga.catalog_source='tonapi'
), normalized as (
  select
    id,
    preview_url,
    content_url,
    coalesce(content_url,'') ~* '\.(json|tgs)([?#].*)?$' as is_animated,
    coalesce(content_url,'') ~* '\.(mp4|webm|mov|m4v|ogv)([?#].*)?$' as is_video
  from media
)
update public.gift_assets ga
set
  model_preview_url=coalesce(n.preview_url,ga.model_preview_url),
  model_media_url=coalesce(n.content_url,n.preview_url,ga.model_media_url),
  model_is_animated=n.is_animated,
  model_is_video=n.is_video,
  updated_at=now()
from normalized n
where n.id=ga.id
  and (
    ga.model_is_animated is distinct from n.is_animated
    or ga.model_is_video is distinct from n.is_video
    or (n.preview_url is not null and ga.model_preview_url is distinct from n.preview_url)
    or (n.content_url is not null and ga.model_media_url is distinct from n.content_url)
  );

commit;

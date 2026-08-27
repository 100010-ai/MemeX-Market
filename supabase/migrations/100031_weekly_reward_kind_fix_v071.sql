begin;

update public.season_rewards sr
set reward_kind='energy'
from public.seasons s
where sr.season_id=s.id
  and s.week_number is not null
  and sr.track='premium'
  and sr.level=9
  and sr.reward_label='150 энергии';

commit;

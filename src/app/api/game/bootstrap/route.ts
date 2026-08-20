import { createServerSupabase } from '@/lib/supabase/server';
import { noStoreJson } from '@/lib/security/http';
export const runtime='nodejs';
export async function GET(){
  const s=createServerSupabase();
  const [cars,opponents,settings]=await Promise.all([
    s.from('game_cars_v11').select('id,name,image_path,price,power,tier,category,flavor,sort_order').eq('active',true).order('sort_order').order('id'),
    s.from('game_opponents_v11').select('*').eq('active',true).order('sort_order').order('key'),
    s.from('game_settings_v11').select('key,value')
  ]);
  if(cars.error||opponents.error||settings.error) return noStoreJson({ok:false,error:'game content unavailable'},503);
  return noStoreJson({
    ok:true,
    cars:(cars.data??[]).map((c: any)=>({id:c.id,name:c.name,image:c.image_path,price:c.price,power:c.power,tier:c.tier,cat:c.category,flavor:c.flavor})),
    opponents:(opponents.data??[]).map((o: any)=>({id:o.key,name:o.name,power:o.power,reward:o.reward,unlockLevel:o.unlock_level,car:o.car_name,rating:o.rating,style:o.style,favoriteTracks:o.favorite_tracks,wins:o.wins,losses:o.losses,avatar:o.avatar,taunt:o.taunt,preLines:o.pre_lines,winLine:o.win_line,loseLine:o.lose_line,boss:o.boss})),
    settings:Object.fromEntries((settings.data??[]).map((s: any)=>[s.key,s.value]))
  });
}

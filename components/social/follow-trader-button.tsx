"use client";

import { useEffect, useState } from "react";
import { UserCheck, UserPlus } from "lucide-react";
import { apiFetch } from "@/lib/api";

export function FollowTraderButton({ profileId }: { profileId: string }) {
  const [following, setFollowing] = useState(false);
  const [followers, setFollowers] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    void apiFetch<{ following: boolean; followers: number }>(`/api/social/follow?profileId=${encodeURIComponent(profileId)}`, { cacheMs: 10_000, signal: controller.signal })
      .then((result) => { setFollowing(result.following); setFollowers(result.followers); }).catch(() => undefined);
    return () => controller.abort();
  }, [profileId]);
  async function toggle() {
    if (busy) return;
    const next = !following; setBusy(true); setFollowing(next); setFollowers((value) => value == null ? value : Math.max(0,value+(next?1:-1)));
    try { await apiFetch("/api/social/follow", { method: "POST", body: JSON.stringify({ profileId, enabled: next }) }); }
    catch { setFollowing(!next); setFollowers((value) => value == null ? value : Math.max(0,value+(next?-1:1))); }
    finally { setBusy(false); }
  }
  return <button type="button" disabled={busy} onClick={() => void toggle()} className={`inline-flex min-h-10 items-center justify-center gap-1.5 rounded-[14px] px-3 text-[10px] font-medium ${following?"bg-[var(--panel-2)] text-white":"bg-white text-black"}`}>
    {following?<UserCheck size={13}/>:<UserPlus size={13}/>} {following?"Вы подписаны":"Подписаться"}{followers!=null?<span className="opacity-60">· {followers}</span>:null}
  </button>;
}

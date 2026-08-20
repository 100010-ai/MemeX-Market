"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Boxes, Coins, Gift, Search, UserRound, X } from "lucide-react";
import { apiFetch } from "@/lib/api";

type SearchPayload = {
  gifts: Array<{ virtualGiftId: string; baseName: string; number: number; modelName?: string }>;
  coins: Array<{ id: string; name: string; symbol: string }>;
  collections: Array<{ baseName: string; listedCount: number; floorPrice: number | null }>;
  users: Array<{ id: string; name: string }>;
};

type Result = { key: string; label: string; meta: string; href: string; icon: "gift" | "coin" | "collection" | "user" };

const staticResults: Result[] = [
  { key: "nav-market", label: "Маркет", meta: "Gifts и мемкоины", href: "/market", icon: "collection" },
  { key: "nav-vault", label: "Портфель", meta: "Активы и PnL", href: "/vault", icon: "collection" },
  { key: "nav-orders", label: "Ордера", meta: "Листинги и офферы", href: "/orders", icon: "collection" },
  { key: "nav-watchlist", label: "Избранное", meta: "Watchlist и price alerts", href: "/watchlist", icon: "collection" },
  { key: "nav-profile", label: "Профиль", meta: "Аккаунт и настройки", href: "/profile", icon: "user" },
];

function ResultIcon({ kind }: { kind: Result["icon"] }) {
  const Icon = kind === "gift" ? Gift : kind === "coin" ? Coins : kind === "user" ? UserRound : Boxes;
  return <span className="grid h-8 w-8 shrink-0 place-items-center rounded-[10px] bg-white/[.045] text-[var(--muted)]"><Icon size={14} /></span>;
}

export function CommandPalette() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [remote, setRemote] = useState<SearchPayload | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen((value) => !value);
      } else if (event.key === "Escape") {
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => inputRef.current?.focus(), 30);
    return () => window.clearTimeout(timer);
  }, [open]);

  useEffect(() => {
    if (!open || query.trim().length < 2) {
      setRemote(null);
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setLoading(true);
      try {
        const payload = await apiFetch<SearchPayload>(`/api/market/search?q=${encodeURIComponent(query.trim())}`, { signal: controller.signal });
        setRemote(payload);
      } catch (error) {
        if (!controller.signal.aborted) console.error("command search", error);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 180);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [open, query]);

  const results = useMemo<Result[]>(() => {
    const q = query.trim().toLowerCase();
    if (!q) return staticResults;
    const items: Result[] = [];
    if (remote) {
      items.push(...remote.gifts.slice(0, 6).map((gift) => ({ key: `gift:${gift.virtualGiftId}`, label: `${gift.baseName} #${gift.number}`, meta: gift.modelName || "Gift", href: `/gifts/${gift.virtualGiftId}`, icon: "gift" as const })));
      items.push(...remote.collections.slice(0, 5).map((collection) => ({ key: `collection:${collection.baseName}`, label: collection.baseName, meta: `${collection.listedCount} лотов`, href: `/collections/${encodeURIComponent(collection.baseName)}`, icon: "collection" as const })));
      items.push(...remote.coins.slice(0, 5).map((coin) => ({ key: `coin:${coin.id}`, label: coin.name, meta: `$${coin.symbol}`, href: `/coin/${coin.id}`, icon: "coin" as const })));
      items.push(...remote.users.slice(0, 5).map((user) => ({ key: `user:${user.id}`, label: user.name, meta: "Профиль", href: `/u/${user.id}`, icon: "user" as const })));
    }
    items.push(...staticResults.filter((item) => `${item.label} ${item.meta}`.toLowerCase().includes(q)));
    return items.slice(0, 16);
  }, [query, remote]);

  function go(href: string) {
    setOpen(false);
    setQuery("");
    setRemote(null);
    router.push(href);
  }

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[90] flex items-start justify-center bg-black/60 px-3 pt-[max(12vh,env(safe-area-inset-top))] backdrop-blur-[2px]" onMouseDown={(event) => { if (event.currentTarget === event.target) setOpen(false); }}>
      <section role="dialog" aria-modal="true" aria-label="Быстрый поиск" className="w-full max-w-[560px] overflow-hidden rounded-[20px] border border-white/[.10] bg-[#111318] shadow-2xl">
        <div className="flex items-center gap-2 border-b border-white/[.07] px-3">
          <Search size={16} className="shrink-0 text-[var(--muted)]" />
          <input ref={inputRef} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Gift, коллекция, @user, $COIN или раздел" className="h-12 min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-[var(--muted-2)]" />
          <button type="button" onClick={() => setOpen(false)} aria-label="Закрыть" className="grid h-8 w-8 place-items-center rounded-[10px] text-[var(--muted)] hover:bg-white/[.05]"><X size={15} /></button>
        </div>
        <div className="max-h-[min(62vh,520px)] overflow-y-auto p-2">
          {loading ? <p className="px-2 py-3 text-[10px] text-[var(--muted)]">Ищем…</p> : null}
          {!loading && !results.length ? <p className="px-2 py-8 text-center text-[11px] text-[var(--muted)]">Ничего не найдено</p> : null}
          {results.map((item) => <button type="button" key={item.key} onClick={() => go(item.href)} className="flex w-full items-center gap-2.5 rounded-[13px] px-2 py-2 text-left hover:bg-white/[.045]"><ResultIcon kind={item.icon} /><span className="min-w-0"><span className="block truncate text-[11px] font-medium">{item.label}</span><span className="mt-0.5 block truncate text-[9px] text-[var(--muted)]">{item.meta}</span></span></button>)}
        </div>
        <div className="hidden items-center justify-between border-t border-white/[.06] px-3 py-2 text-[9px] text-[var(--muted-2)] sm:flex"><span>Ctrl / ⌘ + K</span><span>Esc — закрыть</span></div>
      </section>
    </div>
  );
}

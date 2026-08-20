"use client";

import { useCallback, useEffect, useState } from "react";
import { Gem, PackageOpen, RefreshCw } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { money } from "@/lib/format";

type InventoryItem = {
  assetId: string;
  virtualGiftId: string;
  telegramName: string;
  baseName: string;
  giftNumber: number;
  modelName: string;
  modelRarity: string | null;
  backdropName: string;
  backdropCenterColor: number;
  backdropEdgeColor: number;
  estimatedValue: number | null;
  createdAt: string;
};

type SyncOutcome = { telegramId: number; assetsUpserted?: number; error?: string };

function hex(color: number) {
  return `#${color.toString(16).padStart(6, "0")}`;
}

export function AdminCatalogPanel() {
  const [items, setItems] = useState<InventoryItem[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncOutcomes, setSyncOutcomes] = useState<SyncOutcome[] | null>(null);
  const [prices, setPrices] = useState<Record<string, string>>({});
  const [releasing, setReleasing] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiFetch<{ items: InventoryItem[] }>("/api/admin/inventory");
      setItems(data.items);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось загрузить инвентарь каталога");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void apiFetch<{ items: InventoryItem[] }>("/api/admin/inventory")
      .then((data) => { if (!cancelled) setItems(data.items); })
      .catch((cause) => { if (!cancelled) setError(cause instanceof Error ? cause.message : "Не удалось загрузить инвентарь каталога"); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const runSync = useCallback(async () => {
    setSyncing(true);
    setError(null);
    try {
      const data = await apiFetch<{ results: SyncOutcome[] }>("/api/admin/catalog-sync", { method: "POST" });
      setSyncOutcomes(data.results);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Синхронизация каталога не выполнена");
    } finally {
      setSyncing(false);
    }
  }, [load]);

  const release = useCallback(
    async (virtualGiftId: string) => {
      const price = Number(prices[virtualGiftId]);
      if (!Number.isFinite(price) || price <= 0) {
        setError("Укажите цену больше нуля перед публикацией");
        return;
      }
      setReleasing(virtualGiftId);
      setError(null);
      try {
        await apiFetch(`/api/admin/inventory/${virtualGiftId}/release`, { method: "POST", body: JSON.stringify({ price }) });
        setItems((prev) => (prev ? prev.filter((item) => item.virtualGiftId !== virtualGiftId) : prev));
      } catch (e) {
        setError(e instanceof Error ? e.message : "Не удалось опубликовать подарок");
      } finally {
        setReleasing(null);
      }
    },
    [prices],
  );

  return (
    <section className="mt-3 overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--panel)]">
      <div className="flex items-center justify-between gap-3 border-b border-[var(--border-soft)] px-3 py-3">
        <div className="min-w-0">
          <p className="text-xs font-medium">Каталог и дропы</p>
          <p className="mt-0.5 text-[10px] text-[var(--muted)]">Импорт реальных Telegram Gifts из источников, настроенных в локальном MXM Control. Без MTProto/user session.</p>
        </div>
        <button onClick={() => void runSync()} disabled={syncing} className="header-action shrink-0">
          <RefreshCw size={15} className={syncing ? "animate-spin" : ""} />
        </button>
      </div>

      {error ? <div className="mx-3 mt-3 rounded-2xl border border-[#5a3035] bg-[#25191b] px-3 py-3 text-xs text-[#ff9aa4]">{error}</div> : null}

      {syncOutcomes ? (
        <div className="mxm-hscroll flex flex-nowrap gap-1.5 px-3 py-2">
          {syncOutcomes.map((outcome) => (
            <span
              key={outcome.telegramId}
              className={`shrink-0 whitespace-nowrap rounded-xl px-2 py-1 text-[9px] uppercase ${
                !outcome.error ? "bg-[#153322] text-[var(--positive)]" : "bg-[#351a1e] text-[var(--negative)]"
              }`}
            >
              {outcome.telegramId}: {!outcome.error ? `+${outcome.assetsUpserted ?? 0}` : "ошибка"}
            </span>
          ))}
        </div>
      ) : null}

      {!items ? (
        loading ? <div className="mxm-skeleton m-3 h-24 rounded-2xl" /> : null
      ) : items.length ? (
        <div className="divide-y divide-[var(--border-soft)]">
          {items.map((item) => (
            <div key={item.virtualGiftId} className="flex items-center gap-3 p-3">
              <div
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-[9px] font-semibold text-[var(--text)]"
                style={{ background: `linear-gradient(135deg, ${hex(item.backdropCenterColor)}, ${hex(item.backdropEdgeColor)})` }}
              >
                #{item.giftNumber}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-medium">{item.baseName}</p>
                <p className="mt-0.5 truncate text-[10px] text-[var(--muted)]">
                  {item.modelName} · {item.backdropName}
                  {item.estimatedValue != null ? (
                    <>
                      {" "}
                      · ориентир {money(item.estimatedValue)}
                    </>
                  ) : null}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                <div className="flex items-center gap-1 rounded-xl bg-[var(--panel-2)] px-2 py-1.5">
                  <Gem size={11} className="shrink-0 text-[#d9dde2]" fill="currentColor" />
                  <input
                    type="number"
                    min="0.01"
                    step="0.01"
                    placeholder="Цена"
                    value={prices[item.virtualGiftId] ?? ""}
                    onChange={(e) => setPrices((prev) => ({ ...prev, [item.virtualGiftId]: e.target.value }))}
                    className="w-16 bg-transparent text-[11px] outline-none placeholder:text-[var(--muted)]"
                  />
                </div>
                <button
                  onClick={() => void release(item.virtualGiftId)}
                  disabled={releasing === item.virtualGiftId}
                  className="shrink-0 rounded-xl bg-[var(--accent)] px-2.5 py-1.5 text-[11px] font-medium text-[#151515] disabled:opacity-50"
                >
                  Опубликовать
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="flex flex-col items-center gap-2 p-8 text-center text-xs text-[var(--muted)]">
          <PackageOpen size={20} />
          Системный инвентарь пуст. Запустите синхронизацию каталога.
        </div>
      )}
    </section>
  );
}

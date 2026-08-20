"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowLeft, BadgeCheck, RefreshCw, ShieldCheck } from "lucide-react";

type Confirmation = {
  id: string;
  user: string;
  reward: number;
  unit: "virtual_ton";
  provider: string;
  verifiedBy: string;
  claimedAt: string;
};

type Payload = {
  available: boolean;
  generatedAt: string;
  disclaimer: string;
  confirmations: Confirmation[];
};

function formatDate(value: string) {
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

export default function RewardConfirmationsPage() {
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      const response = await fetch("/api/public/reward-confirmations", { cache: "no-store" });
      setData(await response.json() as Payload);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  return (
    <main className="mx-auto min-h-[100dvh] max-w-2xl px-4 py-6 md:py-10">
      <div className="mb-5 flex items-center gap-3">
        <Link href="/about" className="grid h-9 w-9 place-items-center rounded-[14px] border border-[var(--border)] bg-[var(--panel)] text-[var(--muted)]" aria-label="Назад">
          <ArrowLeft size={15} />
        </Link>
        <div className="min-w-0 flex-1">
          <h1 className="text-[17px] font-semibold tracking-[-.025em]">Подтверждения рекламных наград</h1>
          <p className="mt-0.5 text-[10px] text-[var(--muted)]">Публичная история серверно подтверждённых начислений</p>
        </div>
        <button type="button" onClick={() => void load()} disabled={loading} className="grid h-9 w-9 place-items-center rounded-[14px] border border-[var(--border)] bg-[var(--panel)] text-[var(--muted)]" aria-label="Обновить">
          <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
        </button>
      </div>

      <section className="mxm-card p-4">
        <div className="flex items-start gap-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[14px] bg-[var(--panel-2)] text-[var(--accent)]"><ShieldCheck size={15} /></span>
          <div>
            <p className="text-[11px] font-semibold">Что подтверждает эта страница</p>
            <p className="mt-1 text-[9px] leading-4 text-[var(--muted)]">
              Здесь отображаются только награды, которые были подтверждены серверным callback AdsGram. Пользователь получает награду за полный просмотр; клик по рекламе не требуется.
            </p>
            <p className="mt-2 text-[9px] leading-4 text-[var(--muted)]">
              Внутриигровой TON MXM — виртуальная единица учёта. Это не Toncoin, она не выводится в блокчейн и не имеет денежной стоимости.
            </p>
          </div>
        </div>
      </section>

      <section className="mxm-card mt-3 overflow-hidden">
        <div className="flex items-center justify-between border-b border-[var(--border-soft)] px-4 py-3">
          <div>
            <p className="text-[11px] font-semibold">Последние подтверждения</p>
            <p className="mt-0.5 text-[9px] text-[var(--muted)]">До 50 последних серверных событий</p>
          </div>
          <BadgeCheck size={16} className="text-[var(--accent)]" />
        </div>

        {loading && !data ? (
          <div className="p-4 text-[10px] text-[var(--muted)]">Загрузка…</div>
        ) : data?.confirmations?.length ? (
          <div className="divide-y divide-[var(--border-soft)]">
            {data.confirmations.map((item) => (
              <div key={`${item.id}-${item.claimedAt}`} className="grid grid-cols-[1fr_auto] gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="truncate text-[10px] font-medium">{item.user}</p>
                  <p className="mt-0.5 text-[8px] text-[var(--muted)]">{formatDate(item.claimedAt)} · AdsGram server callback</p>
                </div>
                <p className="text-[10px] font-semibold">+{item.reward} игровой TON</p>
              </div>
            ))}
          </div>
        ) : (
          <div className="p-4">
            <p className="text-[10px] font-medium">Подтверждённых начислений пока нет</p>
            <p className="mt-1 text-[9px] leading-4 text-[var(--muted)]">После первого реального серверно подтверждённого rewarded-показа запись появится здесь автоматически. Тестовые записи не подделываются.</p>
          </div>
        )}
      </section>

      <p className="mt-3 text-[8px] leading-4 text-[var(--muted-2)]">{data?.disclaimer || "Денежных выплат и переводов Toncoin в MXM нет."}</p>
    </main>
  );
}

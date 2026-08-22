import Link from "next/link";
import { BadgeCheck, Bot, ExternalLink, Eye, ShieldCheck } from "lucide-react";

export const dynamic = "force-dynamic";

export default function ModerationPage() {
  const bot = String(process.env.NEXT_PUBLIC_BOT_USERNAME || "MemeXMarketBot").replace(/^@/, "");
  const appUrl = String(process.env.NEXT_PUBLIC_APP_URL || "https://meme-x-market.vercel.app").replace(/\/$/, "");
  const botUrl = `https://t.me/${bot}`;

  const points = [
    [Eye, "Добровольный показ", "Rewarded-реклама запускается только по отдельной кнопке пользователя. Отказ от просмотра не ограничивает маркет, портфель, торговлю или профиль."],
    [BadgeCheck, "Без требования клика", "Награда зависит от завершённого просмотра и серверного подтверждения AdsGram. Нажатие по рекламному объявлению не требуется."],
    [ShieldCheck, "Умеренная внутренняя награда", "За подтверждённый просмотр начисляется 1 внутриигровой TON MXM, максимум 3 раза в сутки, с интервалом 30 минут. Это не Toncoin и не денежная выплата."],
  ] as const;

  return (
    <main className="mx-auto min-h-[100dvh] max-w-2xl px-4 py-6 md:py-10">
      <div className="mb-5">
        <p className="text-[10px] font-black tracking-[-.055em]">MXM · ADS MODERATION</p>
        <h1 className="mt-2 text-[20px] font-semibold tracking-[-.03em]">Информация для модерации рекламной площадки</h1>
        <p className="mt-2 text-[10px] leading-5 text-[var(--muted)]">MXM — симулятор рынка цифровых коллекционных предметов Telegram. Реклама является отдельной необязательной механикой.</p>
      </div>

      <div className="space-y-2">
        {points.map(([Icon, title, text]) => (
          <section key={title} className="mxm-card p-4">
            <div className="flex items-start gap-3">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[14px] bg-[var(--panel-2)] text-[var(--accent)]"><Icon size={15} /></span>
              <div><h2 className="text-[11px] font-semibold">{title}</h2><p className="mt-1 text-[9px] leading-4 text-[var(--muted)]">{text}</p></div>
            </div>
          </section>
        ))}
      </div>

      <section className="mxm-card mt-3 p-4">
        <p className="text-[11px] font-semibold">Проверяемые ссылки</p>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <a href={botUrl} target="_blank" rel="noreferrer" className="flex items-center justify-between rounded-[14px] border border-[var(--border)] bg-[var(--panel-2)] px-3 py-2.5 text-[10px] font-medium"><span className="flex items-center gap-2"><Bot size={14} />@{bot}</span><ExternalLink size={12} /></a>
          <Link href="/reward-confirmations" className="flex items-center justify-between rounded-[14px] border border-[var(--border)] bg-[var(--panel-2)] px-3 py-2.5 text-[10px] font-medium"><span>Подтверждения наград</span><ExternalLink size={12} /></Link>
          <Link href="/about" className="flex items-center justify-between rounded-[14px] border border-[var(--border)] bg-[var(--panel-2)] px-3 py-2.5 text-[10px] font-medium"><span>Правила MXM</span><ExternalLink size={12} /></Link>
          {appUrl ? <a href={appUrl} className="flex items-center justify-between rounded-[14px] border border-[var(--border)] bg-[var(--panel-2)] px-3 py-2.5 text-[10px] font-medium"><span>Production Web App</span><ExternalLink size={12} /></a> : null}
        </div>
      </section>

      <p className="mt-4 text-[8px] leading-4 text-[var(--muted-2)]">Сторонние задания, требующие подписок или искусственного увеличения рекламной/социальной статистики, отключены в режиме модерации.</p>
    </main>
  );
}

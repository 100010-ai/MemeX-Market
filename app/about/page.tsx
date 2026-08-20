import Link from "next/link";
import { ArrowLeft, BadgeCheck, CircleDollarSign, Eye, ShieldCheck } from "lucide-react";

const items = [
  {
    icon: CircleDollarSign,
    title: "Внутренняя валюта",
    text: "TON внутри MXM — игровая единица учёта. Это не Toncoin, она не выводится в блокчейн, не обменивается на деньги и не имеет гарантированной денежной стоимости.",
  },
  {
    icon: Eye,
    title: "Реклама только по желанию",
    text: "Показ rewarded-рекламы запускается только после явного нажатия пользователя. Отказ от просмотра не блокирует рынок, портфель, торговлю, профиль или другие основные функции MXM.",
  },
  {
    icon: BadgeCheck,
    title: "Награда за просмотр, не за клик",
    text: "Награда начисляется только после завершённого показа и серверного подтверждения рекламной сети. Переход по рекламному объявлению не является условием получения награды.",
  },
  {
    icon: ShieldCheck,
    title: "Прозрачные начисления",
    text: "Денежных выплат в MXM нет. Серверно подтверждённые рекламные начисления публикуются в отдельной обезличенной истории; рекламные бонусы используются только внутри продукта.",
  },
];

export default function AboutPage() {
  return (
    <div className="mx-auto min-h-[100dvh] max-w-2xl px-4 py-6 md:py-10">
      <div className="mb-4 flex items-center gap-3">
        <Link href="/profile" className="grid h-9 w-9 place-items-center rounded-[14px] border border-[var(--border)] bg-[var(--panel)] text-[var(--muted)]" aria-label="Назад">
          <ArrowLeft size={15} />
        </Link>
        <div>
          <h1 className="text-[17px] font-semibold tracking-[-.025em]">О MXM</h1>
          <p className="mt-0.5 text-[10px] text-[var(--muted)]">Правила продукта и рекламных наград</p>
        </div>
      </div>

      <section className="mxm-card p-4">
        <p className="text-[12px] font-semibold">MXM — симулятор рынка цифровых коллекционных предметов</p>
        <p className="mt-2 text-[10px] leading-5 text-[var(--muted)]">
          Пользователь может изучать коллекции, собирать виртуальный портфель, совершать внутриигровые сделки и использовать дополнительные необязательные механики. Реклама не является условием доступа к основному функционалу.
        </p>
      </section>

      <div className="mt-3 space-y-2">
        {items.map(({ icon: Icon, title, text }) => (
          <section key={title} className="mxm-card p-4">
            <div className="flex items-start gap-3">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[14px] bg-[var(--panel-2)] text-[var(--accent)]"><Icon size={15} /></span>
              <div>
                <h2 className="text-[11px] font-semibold">{title}</h2>
                <p className="mt-1 text-[9px] leading-4 text-[var(--muted)]">{text}</p>
              </div>
            </div>
          </section>
        ))}
      </div>

      <section className="mxm-card mt-3 p-4">
        <p className="text-[11px] font-semibold">Публичная проверка</p>
        <div className="mt-2 flex flex-wrap gap-2">
          <Link href="/reward-confirmations" className="rounded-[12px] border border-[var(--border)] bg-[var(--panel-2)] px-3 py-2 text-[9px] font-medium">Подтверждения наград</Link>
          <Link href="/moderation" className="rounded-[12px] border border-[var(--border)] bg-[var(--panel-2)] px-3 py-2 text-[9px] font-medium">Информация для модерации</Link>
        </div>
      </section>
    </div>
  );
}

import Link from "next/link";
import { ArrowLeft, BadgeCheck, CircleDollarSign, Scale, ShieldCheck } from "lucide-react";

const items = [
  {
    icon: CircleDollarSign,
    title: "Внутренняя валюта",
    text: "TON внутри MXM — игровая единица учёта. Это не Toncoin, она не выводится в блокчейн, не обменивается на деньги и не имеет гарантированной денежной стоимости.",
  },
  {
    icon: Scale,
    title: "Рыночная симуляция",
    text: "Цены, сделки, мемкоины и коллекционные предметы существуют внутри приложения. Они не являются инвестиционным продуктом и не обещают доход в реальной валюте.",
  },
  {
    icon: BadgeCheck,
    title: "Честная торговля",
    text: "Манипуляции объёмом, круговые сделки, автоматизированный фарм и использование нескольких аккаунтов для обхода лимитов могут привести к ограничению аккаунта.",
  },
  {
    icon: ShieldCheck,
    title: "Защита аккаунта",
    text: "Вход подтверждается данными Telegram Mini App. Никому не передавайте коды, токены бота или данные своей Telegram-сессии; команда MXM не запрашивает их в личных сообщениях.",
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
          <p className="mt-0.5 text-[10px] text-[var(--muted)]">Виртуальная экономика и правила продукта</p>
        </div>
      </div>

      <section className="mxm-card p-4">
        <p className="text-[12px] font-semibold">MXM — симулятор рынка цифровых коллекционных предметов</p>
        <p className="mt-2 text-[10px] leading-5 text-[var(--muted)]">
          Пользователь может изучать коллекции, собирать виртуальный портфель и совершать внутриигровые сделки. Все активы и расчётные показатели MXM относятся только к игровой экономике приложения.
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
    </div>
  );
}

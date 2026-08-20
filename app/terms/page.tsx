import Link from "next/link";

export default function TermsPage() {
  return <main className="mx-auto min-h-[100dvh] max-w-2xl px-4 py-8 text-[11px] leading-5 text-[var(--muted)]">
    <h1 className="text-xl font-semibold text-white">Условия цифровых покупок MXM</h1>
    <p className="mt-4">MemeX Market — игровая Telegram Mini App с виртуальной экономикой. Виртуальные TON, MXM Coins, мемкоины, Gifts, кейсы, пропуски и косметические предметы существуют только внутри MXM. Их нельзя вывести, погасить, обменять на деньги или настоящий Toncoin.</p>
    <p className="mt-3">Telegram Stars используются только для цифровых товаров и возможностей, явно описанных перед оплатой. Цена, срок действия и содержимое отображаются в MXM Store. Для кейсов до покупки показываются вероятности; награды не имеют денежной стоимости.</p>
    <p className="mt-3">Оплаченный товар выдаётся после получения сервером события <span className="text-white">successful_payment</span> от Telegram. Сохраняйте Telegram-чек. Если выдача задержалась или нужна помощь с возвратом, обратитесь в <Link href="/paysupport" className="text-[var(--accent)]">поддержку платежей</Link>.</p>
    <p className="mt-3">Используя MXM, пользователь соглашается не автоматизировать фарм, не накручивать объём, не манипулировать рынком и не обходить лимиты. Подозрительные операции могут быть ограничены для защиты виртуальной экономики.</p>
    <Link href="/store" className="mt-6 inline-block text-white underline decoration-white/30 underline-offset-4">Вернуться в MXM Store</Link>
  </main>;
}

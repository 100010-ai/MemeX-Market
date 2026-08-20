import Link from "next/link";
import { getHumanSupportUsername, humanSupportTelegramUrl } from "@/lib/support";

export default function PaymentSupportPage() {
  const support = getHumanSupportUsername();
  return <main className="mx-auto min-h-[100dvh] max-w-2xl px-4 py-8 text-[11px] leading-5 text-[var(--muted)]">
    <h1 className="text-xl font-semibold text-white">Поддержка покупок MXM</h1>
    <p className="mt-4">По вопросам оплаты Stars и выдачи цифровых товаров напишите {support ? <a href={humanSupportTelegramUrl(support)} target="_blank" rel="noreferrer" className="text-white underline decoration-white/30 underline-offset-4">@{support}</a> : <span className="text-white">в службу поддержки MXM</span>}. Укажите товар, дату операции и Telegram payment charge ID из чека — не отправляйте токен бота, пароль или код входа.</p>
    <p className="mt-3">Если Telegram уже показал статус Paid, но товар ещё не появился, подождите несколько секунд и заново откройте MXM Store. Повторный webhook безопасен: одна покупка исполняется только один раз.</p>
    <div className="mt-6 flex gap-4"><Link href="/store" className="text-white underline decoration-white/30 underline-offset-4">MXM Store</Link><Link href="/terms" className="text-white underline decoration-white/30 underline-offset-4">Условия</Link></div>
  </main>;
}

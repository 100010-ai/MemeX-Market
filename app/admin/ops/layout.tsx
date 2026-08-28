"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { RefreshCw, ShieldCheck } from "lucide-react";
import { useTelegramProfile } from "@/components/telegram-provider";

type AccessState = "idle" | "checking" | "allowed" | "denied" | "error";

export default function AdminOpsLayout({ children }: { children: React.ReactNode }) {
  const { profile, loading, error: authError, retryAuth } = useTelegramProfile();
  const [access, setAccess] = useState<AccessState>("idle");
  const [accessError, setAccessError] = useState<string | null>(null);
  const botUsername = process.env.NEXT_PUBLIC_BOT_USERNAME?.replace(/^@/, "") || "MemeXMarketBot";
  const telegramHref = `https://t.me/${botUsername}?startapp=admin_ops`;

  const checkAccess = useCallback(async () => {
    if (!profile) {
      setAccess("idle");
      return;
    }
    setAccess("checking");
    setAccessError(null);
    try {
      const response = await fetch("/api/admin/access", {
        cache: "no-store",
        credentials: "same-origin",
      });
      if (response.ok) {
        setAccess("allowed");
        return;
      }
      const body = await response.json().catch(() => ({}));
      if (response.status === 403) {
        setAccess("denied");
        setAccessError(typeof body.error === "string" ? body.error : "У этого Telegram-аккаунта нет доступа к Ops");
        return;
      }
      setAccess("error");
      setAccessError(typeof body.error === "string" ? body.error : `Проверка доступа вернула ${response.status}`);
    } catch (cause) {
      setAccess("error");
      setAccessError(cause instanceof Error ? cause.message : "Не удалось проверить доступ к Ops");
    }
  }, [profile]);

  useEffect(() => {
    void checkAccess();
  }, [checkAccess]);

  if (loading && !profile) {
    return <OpsGate
      title="Авторизация через Telegram"
      detail="Проверяю сессию и права администратора."
      busy
    />;
  }

  if (!profile) {
    return <OpsGate
      title="Ops открывается через Telegram"
      detail={authError || "В обычной вкладке браузера нет подписанной Telegram-сессии. Откройте Mini App под админским аккаунтом."}
      primaryHref={telegramHref}
      primaryLabel="Открыть Mini App"
      secondaryLabel="Повторить авторизацию"
      onSecondary={retryAuth}
    />;
  }

  if (access === "idle" || access === "checking") {
    return <OpsGate
      title="Проверяю права Ops"
      detail={`Telegram ID ${profile.telegramId}`}
      busy
    />;
  }

  if (access === "denied") {
    return <OpsGate
      title="Нет доступа к Ops"
      detail={`${accessError || "Этот аккаунт не входит в список администраторов."} Текущий Telegram ID: ${profile.telegramId}.`}
      secondaryLabel="Проверить снова"
      onSecondary={() => void checkAccess()}
    />;
  }

  if (access === "error") {
    return <OpsGate
      title="Ops временно недоступен"
      detail={accessError || "Не удалось проверить права администратора."}
      secondaryLabel="Повторить проверку"
      onSecondary={() => void checkAccess()}
    />;
  }

  return <>
    {children}
    <nav className="fixed bottom-4 right-4 z-[90] flex items-center gap-1 rounded-2xl border border-white/10 bg-[#0b0f14]/95 p-1.5 shadow-2xl backdrop-blur-xl">
      <Link href="/admin/ops" className="rounded-xl px-3 py-2 text-[9px] font-medium text-white/65 transition hover:bg-white/[.06] hover:text-white">Ops</Link>
      <Link href="/admin/ops/advanced" className="rounded-xl bg-white/[.06] px-3 py-2 text-[9px] font-medium text-white transition hover:bg-white/[.09]">Advanced</Link>
    </nav>
  </>;
}

function OpsGate({
  title,
  detail,
  busy = false,
  primaryHref,
  primaryLabel,
  secondaryLabel,
  onSecondary,
}: {
  title: string;
  detail: string;
  busy?: boolean;
  primaryHref?: string;
  primaryLabel?: string;
  secondaryLabel?: string;
  onSecondary?: () => void;
}) {
  return <main className="flex min-h-[100dvh] items-center justify-center bg-[#080b0f] px-5 text-white">
    <section className="w-full max-w-[460px] rounded-[26px] border border-white/10 bg-white/[.035] p-6 shadow-2xl shadow-black/30">
      <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-white/[.07]">
        {busy ? <RefreshCw size={18} className="animate-spin text-white/70" /> : <ShieldCheck size={18} className="text-white/80" />}
      </div>
      <h1 className="mt-5 text-[20px] font-semibold tracking-[-.035em]">{title}</h1>
      <p className="mt-2 text-[12px] leading-5 text-white/50">{detail}</p>
      {(primaryHref || onSecondary) ? <div className="mt-6 flex flex-wrap gap-2">
        {primaryHref && primaryLabel ? <a href={primaryHref} className="rounded-xl bg-white px-4 py-2.5 text-[11px] font-semibold text-black transition hover:bg-white/90">{primaryLabel}</a> : null}
        {onSecondary && secondaryLabel ? <button type="button" onClick={onSecondary} className="rounded-xl border border-white/10 bg-white/[.04] px-4 py-2.5 text-[11px] font-medium text-white/80 transition hover:bg-white/[.08]">{secondaryLabel}</button> : null}
      </div> : null}
    </section>
  </main>;
}

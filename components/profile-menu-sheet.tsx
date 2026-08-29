"use client";

import Link from "next/link";
import { useEffect } from "react";
import { ChevronRight, CircleHelpRound, Palette, Settings2, UserRound, X } from "lucide-react";
import { ProfileAvatar } from "@/components/profile-avatar";

export function ProfileMenuSheet({
  open,
  onClose,
  profile,
}: {
  open: boolean;
  onClose: () => void;
  profile: {
    firstName: string;
    username?: string | null;
    photoUrl: string | null;
    equippedFrame: string | null;
    level: number;
  };
}) {
  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.documentElement.style.overflow;
    document.documentElement.style.overflow = "hidden";
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.documentElement.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open, onClose]);

  if (!open) return null;

  const items = [
    { href: "/profile", label: "Настройки", note: "Профиль, аккаунт и параметры", icon: Settings2 },
    { href: "/profile/customize", label: "Оформление", note: "Рамки, значки и внешний вид", icon: Palette },
    { href: "/support", label: "Помощь", note: "Поддержка и ответы по MXM", icon: CircleHelpRound },
  ] as const;

  return <div
    className="mxm-profile-menu-overlay fixed inset-0 z-[95] flex items-end bg-black/70 lg:hidden"
    role="presentation"
    onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}
  >
    <section
      role="dialog"
      aria-modal="true"
      aria-label="Меню профиля"
      className="mxm-menu-sheet mxm-profile-menu-sheet w-full"
    >
      <div className="mxm-profile-menu-grabber" aria-hidden="true" />
      <header className="mxm-profile-menu-head">
        <div className="flex min-w-0 items-center gap-3">
          <ProfileAvatar photoUrl={profile.photoUrl} name={profile.firstName} equippedFrame={profile.equippedFrame} size="regular" />
          <div className="min-w-0">
            <p className="truncate text-[14px] font-semibold tracking-[-.02em]">{profile.username ? `@${profile.username}` : profile.firstName}</p>
            <p className="mt-0.5 flex items-center gap-1 text-[9px] text-[var(--muted)]"><UserRound size={10} />Уровень {profile.level}</p>
          </div>
        </div>
        <button type="button" onClick={onClose} className="mxm-profile-menu-close" aria-label="Закрыть меню"><X size={18} /></button>
      </header>

      <div className="mxm-profile-menu-body">
        <p className="mb-2 px-1 text-[8px] font-semibold uppercase tracking-[.16em] text-[var(--muted-2)]">Аккаунт MXM</p>
        <nav className="space-y-1.5">
          {items.map((item) => {
            const Icon = item.icon;
            return <Link key={item.href} href={item.href} onClick={onClose} className="mxm-profile-menu-item">
              <span className="mxm-profile-menu-icon"><Icon size={18} /></span>
              <span className="min-w-0 flex-1"><b>{item.label}</b><small>{item.note}</small></span>
              <ChevronRight size={18} className="shrink-0 text-[var(--muted-2)]" />
            </Link>;
          })}
        </nav>
      </div>

      <footer className="mxm-profile-menu-foot">
        <span>MEMEX MARKET</span>
        <small>Профиль и оформление</small>
      </footer>
    </section>
  </div>;
}

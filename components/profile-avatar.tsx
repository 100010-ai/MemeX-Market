import Image from "next/image";
import { Award, Sparkles, UserRound } from "lucide-react";
import type { ProfileBadge } from "@/lib/types";
import { telegramAvatarProxyUrl } from "@/lib/avatar";

const FRAME_TITLES: Record<string, string> = {
  neon_frame: "Neon Frame",
};

export function ProfileAvatar({
  photoUrl,
  name,
  equippedFrame,
  size = "regular",
}: {
  photoUrl: string | null;
  name: string;
  equippedFrame: string | null;
  size?: "regular" | "large";
}) {
  const framed = Boolean(equippedFrame);
  const frameTitle = equippedFrame ? FRAME_TITLES[equippedFrame] || equippedFrame.replaceAll("_", " ") : null;
  const sizeClass = size === "large" ? "h-14 w-14" : "h-13 w-13";
  const frameClass = equippedFrame === "neon_frame"
    ? "mxm-profile-frame-neon p-[2px]"
    : framed ? "bg-[var(--accent)] p-[2px] shadow-[0_0_14px_rgba(139,164,255,.22)]" : "border border-[var(--border)] bg-[var(--panel-2)]";
  const avatarSrc = telegramAvatarProxyUrl(photoUrl);

  return <span
    data-profile-frame={equippedFrame || undefined}
    title={frameTitle ? `Рамка профиля: ${frameTitle}` : undefined}
    className={`relative grid ${sizeClass} shrink-0 place-items-center rounded-[20px] ${frameClass}`}
  >
    {avatarSrc
      ? <Image unoptimized fill sizes={size === "large" ? "56px" : "52px"} src={avatarSrc} alt={`Профиль ${name}`} className="rounded-[18px] bg-[var(--panel-2)] object-cover" />
      : <span className="grid h-full w-full place-items-center rounded-[18px] bg-[var(--panel-2)] text-[var(--muted)]">{name ? <span className="text-base font-semibold">{name.slice(0, 1).toUpperCase()}</span> : <UserRound size={21} />}</span>}
    {framed ? <span aria-label={frameTitle || "Рамка профиля"} className="absolute -bottom-1 -right-1 grid h-5 w-5 place-items-center rounded-full border border-white/20 bg-[#19162b] text-[#80f5ff] shadow-md"><Sparkles size={10} /></span> : null}
  </span>;
}

const BADGE_RARITY_CLASS: Record<string, string> = {
  common: "text-[var(--muted)]",
  rare: "text-[#73c7ff]",
  epic: "text-[#b79cff]",
  legendary: "text-[#f5c451]",
};

export function ProfileBadgeList({ badges }: { badges: ProfileBadge[] }) {
  return <div className="flex flex-wrap gap-1.5">{badges.map((badge) => <span
    key={badge.key}
    title={`${badge.title} · ${badge.rarity}`}
    className={`inline-flex items-center gap-1 rounded-[10px] bg-white/[.04] px-2 py-1 text-[9px] ring-1 ring-white/[.06] ${BADGE_RARITY_CLASS[badge.rarity] || BADGE_RARITY_CLASS.common}`}
  ><Award size={10} />{badge.title}</span>)}</div>;
}

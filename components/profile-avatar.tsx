import Image from "next/image";
import { Award, Sparkles, UserRound } from "lucide-react";
import type { ProfileBadge } from "@/lib/types";
import { telegramAvatarProxyUrl } from "@/lib/avatar";
import { rarityLabel } from "@/lib/ui-copy";
import { getProfileFrameClass, getProfileFrameDefinition } from "@/lib/profile-frames";

export function ProfileAvatar({
  photoUrl,
  name,
  equippedFrame,
  size = "regular",
}: {
  photoUrl: string | null;
  name: string;
  equippedFrame: string | null;
  size?: "small" | "regular" | "large";
}) {
  const frame = getProfileFrameDefinition(equippedFrame);
  const framed = Boolean(equippedFrame);
  const frameTitle = frame?.title || (equippedFrame ? equippedFrame.replaceAll("_", " ") : null);
  const sizeClass = size === "large" ? "h-14 w-14" : size === "small" ? "h-8 w-8" : "h-13 w-13";
  const radiusClass = size === "large" ? "rounded-[19px]" : size === "small" ? "rounded-[10px]" : "rounded-[18px]";
  const frameClass = framed ? getProfileFrameClass(equippedFrame) : "border border-[var(--border)] bg-[var(--panel-2)] p-[1px]";
  const avatarSrc = telegramAvatarProxyUrl(photoUrl);

  return <span
    data-profile-frame={equippedFrame || undefined}
    data-profile-frame-size={size}
    title={frameTitle ? `Рамка профиля: ${frameTitle}` : undefined}
    className={`mxm-profile-frame relative grid ${sizeClass} shrink-0 place-items-center rounded-[21px] ${frameClass}`}
  >
    <span className={`relative z-[1] block h-full w-full overflow-hidden ${radiusClass} bg-[var(--panel-2)]`}>
      {avatarSrc
        ? <Image unoptimized fill sizes={size === "large" ? "56px" : size === "small" ? "32px" : "52px"} src={avatarSrc} alt={`Профиль ${name}`} className="object-cover" />
        : <span className="grid h-full w-full place-items-center bg-[var(--panel-2)] text-[var(--muted)]">{name ? <span className={size === "small" ? "text-[11px] font-semibold" : "text-base font-semibold"}>{name.slice(0, 1).toUpperCase()}</span> : <UserRound size={size === "small" ? 14 : 21} />}</span>}
    </span>
    {frame?.assetSrc ? <Image aria-hidden="true" unoptimized src={frame.assetSrc} alt="" width={128} height={128} className={`mxm-profile-frame-art is-${frame.motion || "drift"}`} /> : null}
    {framed && !frame?.assetSrc ? <><span aria-hidden="true" className="mxm-profile-frame-orbit-dot" /><span aria-label={frameTitle || "Рамка профиля"} className="mxm-profile-frame-mark"><Sparkles size={8} /></span></> : null}
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
    title={`${badge.title} · ${rarityLabel(badge.rarity)}`}
    className={`inline-flex items-center gap-1 rounded-[10px] bg-white/[.04] px-2 py-1 text-[9px] ring-1 ring-white/[.06] ${BADGE_RARITY_CLASS[badge.rarity] || BADGE_RARITY_CLASS.common}`}
  ><Award size={10} />{badge.title}</span>)}</div>;
}

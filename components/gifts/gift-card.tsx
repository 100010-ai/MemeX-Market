"use client";

import Link from "next/link";
import { Gem, MessageSquareMore, ShoppingCart } from "lucide-react";
import type { GiftAsset } from "@/lib/types";
import { money } from "@/lib/format";
import { GiftMedia } from "@/components/gifts/gift-media";

export function GiftCard({ gift, showOwner = false, inCart = false, cartBusy = false, onCart }: { gift: GiftAsset; showOwner?: boolean; inCart?: boolean; cartBusy?: boolean; onCart?: (gift: GiftAsset, enabled: boolean) => void }) {
  const isListed = gift.status === "listed";
  const displayValue = isListed ? gift.listingPrice : gift.estimatedValue;
  const valueLabel = isListed ? "" : "≈ ";
  const rarestPermille = Math.min(gift.modelRarityPerMille, gift.symbolRarityPerMille, gift.backdropRarityPerMille);
  const rarityLabel = rarestPermille < 10 ? `${(rarestPermille / 10).toFixed(1)}%` : `${Math.round(rarestPermille / 10)}%`;

  return (
    <article className="mxm-gift-card group relative min-w-0 overflow-hidden rounded-[17px] border border-[var(--border)] bg-[var(--panel)] shadow-[inset_0_1px_0_rgba(255,255,255,.02)] transition-transform duration-150 ease-out active:scale-[.992]">
      <Link href={`/gifts/${gift.virtualGiftId}`} className="block">
        <GiftMedia gift={gift} compact className="aspect-square w-full" />
        <div className="px-2.5 pt-2.5">
          <div className="truncate text-xs font-medium text-white">{gift.baseName}</div>
          <div className="mt-0.5 flex items-center justify-between gap-2 text-[10px] text-[var(--muted)]">
            <span>#{gift.number}</span>
            {showOwner ? <span className="truncate">{gift.ownerName}</span> : gift.offerCount > 0 ? <span className="flex items-center gap-1"><MessageSquareMore size={10} />{gift.offerCount}</span> : <span title="Самый редкий trait">редк. {rarityLabel}</span>}
          </div>
        </div>
      </Link>
      <div className="flex items-center gap-1.5 p-2.5 pt-2">
        <Link href={`/gifts/${gift.virtualGiftId}`} className="flex h-8 min-w-0 flex-1 items-center rounded-[14px] bg-[var(--panel-2)] px-2.5 text-[11px] font-semibold">
          {displayValue == null ? <span className="truncate text-[var(--muted)]">Без цены</span> : <><Gem size={11} className="mr-1 shrink-0 text-[#d9dde2]" fill="currentColor" /><span className="truncate">{valueLabel}{money(displayValue)}</span></>}
        </Link>
        {isListed && onCart ? <button type="button" disabled={cartBusy} onClick={() => onCart?.(gift, !inCart)} aria-label={inCart ? "Убрать из корзины" : "Добавить в корзину"} className={`grid h-8 w-8 shrink-0 place-items-center rounded-[14px] border transition ${inCart ? "border-[rgba(198,170,88,.36)] bg-[rgba(198,170,88,.12)] text-[var(--accent)]" : "border-transparent bg-[var(--panel-2)] text-[var(--muted)] active:text-white"}`}><ShoppingCart size={14} fill={inCart ? "currentColor" : "none"} /></button> : null}
      </div>
    </article>
  );
}

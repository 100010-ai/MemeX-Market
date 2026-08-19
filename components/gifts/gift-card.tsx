"use client";

import Link from "next/link";
import { Gem, MessageSquareMore, ShoppingCart } from "lucide-react";
import type { GiftAsset } from "@/lib/types";
import { money } from "@/lib/format";
import { GiftMedia } from "@/components/gifts/gift-media";

export function GiftCard({ gift, showOwner = false, inCart = false, cartBusy = false, priority = false, onCart }: { gift: GiftAsset; showOwner?: boolean; inCart?: boolean; cartBusy?: boolean; priority?: boolean; onCart?: (gift: GiftAsset, enabled: boolean) => void }) {
  const isListed = gift.status === "listed";
  const displayValue = isListed ? gift.listingPrice : (gift.externalListingPrice ?? gift.lastSalePrice ?? gift.referencePrice);
  const valueLabel = isListed ? "" : gift.externalListingPrice != null ? "ext " : gift.lastSalePrice != null ? "last " : "ref ";
  const floorDelta = isListed && gift.listingPrice != null && gift.collectionFloor != null && gift.collectionFloor > 0 ? ((gift.listingPrice / gift.collectionFloor) - 1) * 100 : null;
  const rarestPermille = Math.min(gift.modelRarityPerMille, gift.symbolRarityPerMille, gift.backdropRarityPerMille);
  const rarityLabel = rarestPermille < 10 ? `${(rarestPermille / 10).toFixed(1)}%` : `${Math.round(rarestPermille / 10)}%`;

  return (
    <article className="mxm-gift-card group relative min-w-0 overflow-hidden rounded-[20px] border border-[var(--border)] bg-[var(--panel)] transition duration-150 active:scale-[.992] sm:hover:-translate-y-[1px] sm:hover:border-[#343d47]">
      <Link href={`/gifts/${gift.virtualGiftId}`} className="block">
        <div className="relative overflow-hidden bg-[var(--surface)]">
          <GiftMedia gift={gift} compact priority={priority} className="aspect-square w-full" />
          <span className="absolute left-2 top-2 rounded-[10px] bg-black/55 px-1.5 py-1 text-[8px] font-medium text-white/85">#{gift.number}</span>
        </div>
        <div className="px-2.5 pt-2.5">
          <div className="truncate text-[11px] font-semibold tracking-[-.01em] text-white">{gift.baseName}</div>
          <div className="mt-1 flex items-center justify-between gap-2 text-[9px] text-[var(--muted)]">
            <span className="truncate">{gift.modelName || "Collectible"}</span>
            {showOwner ? <span className="truncate">{gift.ownerName}</span> : gift.offerCount > 0 ? <span className="flex shrink-0 items-center gap-1"><MessageSquareMore size={9} />{gift.offerCount}</span> : floorDelta != null ? <span className={`shrink-0 ${floorDelta <= 0 ? "text-[var(--positive)]" : ""}`}>{floorDelta >= 0 ? "+" : ""}{floorDelta.toFixed(0)}% floor</span> : <span className="shrink-0">редк. {rarityLabel}</span>}
          </div>
        </div>
      </Link>
      <div className="flex items-center gap-1.5 p-2.5 pt-2">
        <Link href={`/gifts/${gift.virtualGiftId}`} className="flex h-8 min-w-0 flex-1 items-center rounded-[12px] bg-[var(--panel-2)] px-2.5 text-[10px] font-semibold ring-1 ring-white/[.025]">
          {displayValue == null ? <span className="truncate text-[var(--muted)]">Без цены</span> : <><Gem size={10} className="mr-1 shrink-0 text-[var(--accent)]" fill="currentColor" /><span className="truncate">{valueLabel}{money(displayValue)}</span></>}
        </Link>
        {isListed && onCart ? <button type="button" disabled={cartBusy} onClick={() => onCart?.(gift, !inCart)} aria-label={inCart ? "Убрать из корзины" : "Добавить в корзину"} className={`grid h-8 w-8 shrink-0 place-items-center rounded-[12px] border transition ${inCart ? "border-[rgba(139,164,255,.32)] bg-[rgba(139,164,255,.12)] text-[var(--accent)]" : "border-[var(--border-soft)] bg-[var(--panel-2)] text-[var(--muted)] active:text-white"}`}><ShoppingCart size={13} fill={inCart ? "currentColor" : "none"} /></button> : null}
      </div>
    </article>
  );
}

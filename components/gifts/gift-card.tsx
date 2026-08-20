"use client";

import Link from "next/link";
import { memo } from "react";
import { Gem, MessageSquareMore, ShoppingCart } from "lucide-react";
import type { GiftAsset } from "@/lib/types";
import { money } from "@/lib/format";
import { GiftMedia } from "@/components/gifts/gift-media";

export const GiftCard = memo(function GiftCard({ gift, showOwner = false, inCart = false, cartBusy = false, priority = false, onCart }: { gift: GiftAsset; showOwner?: boolean; inCart?: boolean; cartBusy?: boolean; priority?: boolean; onCart?: (gift: GiftAsset, enabled: boolean) => void }) {
  const isListed = gift.status === "listed";
  const displayValue = isListed ? gift.listingPrice : (gift.externalListingPrice ?? gift.lastSalePrice ?? gift.referencePrice);
  const valueLabel = isListed ? "" : gift.externalListingPrice != null ? "Рынок · " : gift.lastSalePrice != null ? "Продажа · " : "Оценка · ";
  const floorDelta = isListed && gift.listingPrice != null && gift.collectionFloor != null && gift.collectionFloor > 0 ? ((gift.listingPrice / gift.collectionFloor) - 1) * 100 : null;
  const rarestPermille = Math.min(gift.modelRarityPerMille, gift.symbolRarityPerMille, gift.backdropRarityPerMille);
  const rarityLabel = rarestPermille < 10 ? `${(rarestPermille / 10).toFixed(1)}%` : `${Math.round(rarestPermille / 10)}%`;

  return (
    <article className="mxm-gift-card group relative min-w-0 overflow-hidden rounded-[22px] border border-white/[.06] bg-white/[.025] p-2 contain-content content-visibility-auto transition duration-150 will-change-transform hover:border-white/[.12] active:scale-[.992]">
      <Link href={`/gifts/${gift.virtualGiftId}`} className="block min-w-0">
        <div className="mxm-gift-cover relative overflow-hidden rounded-2xl bg-black/20">
          <GiftMedia gift={gift} compact priority={priority} className="aspect-square w-full" />
          <span className="mxm-gift-number">#{gift.number}</span>
          {gift.offerCount > 0 ? <span className="mxm-gift-offers"><MessageSquareMore size={10} />{gift.offerCount}</span> : null}
        </div>
        <div className="px-0.5 pt-2.5">
          <div className="flex min-w-0 items-baseline justify-between gap-2">
            <p className="truncate text-[12px] font-semibold tracking-[-.018em] text-white">{gift.baseName}</p>
            <span className="shrink-0 text-[9px] text-[var(--muted)]">{floorDelta != null ? `${floorDelta >= 0 ? "+" : ""}${floorDelta.toFixed(0)}% к флору` : `редкость ${rarityLabel}`}</span>
          </div>
          <div className="mt-1 flex min-w-0 items-center justify-between gap-2 text-[9px] text-[var(--muted)]">
            <span className="truncate">{gift.modelName || "Коллекционный"}</span>
            {showOwner ? <span className="truncate">{gift.ownerName}</span> : null}
          </div>
        </div>
      </Link>
      <div className="mt-2 flex min-h-8 items-center gap-2 px-0.5">
        <Link href={`/gifts/${gift.virtualGiftId}`} className="flex min-w-0 flex-1 items-center text-[11px] font-semibold text-[#f0f3f6]">
          {displayValue == null ? <span className="truncate font-medium text-[var(--muted)]">Без цены</span> : <><Gem size={11} className="mr-1.5 shrink-0 text-[var(--accent)]" fill="currentColor" /><span className="truncate">{valueLabel}{money(displayValue)}</span></>}
        </Link>
        {isListed && onCart ? (
          <button type="button" disabled={cartBusy} onClick={() => onCart?.(gift, !inCart)} aria-label={inCart ? "Убрать из корзины" : "Добавить в корзину"} className={`mxm-gift-cart ${inCart ? "is-active" : ""}`}>
            <ShoppingCart size={14} fill={inCart ? "currentColor" : "none"} />
          </button>
        ) : null}
      </div>
    </article>
  );
});

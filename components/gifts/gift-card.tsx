"use client";

import Link from "next/link";
import { Gem, MessageSquareMore, ShoppingCart } from "lucide-react";
import type { GiftAsset } from "@/lib/types";
import { money } from "@/lib/format";
import { GiftMedia } from "@/components/gifts/gift-media";

export function GiftCard({ gift, showOwner = false }: { gift: GiftAsset; showOwner?: boolean }) {
  const isListed = gift.status === "listed";
  const displayValue = isListed ? gift.listingPrice : gift.estimatedValue;
  const valueLabel = isListed ? "" : "≈ ";

  return (
    <Link href={`/gifts/${gift.virtualGiftId}`} className="group min-w-0 overflow-hidden rounded-[18px] border border-[var(--border)] bg-[var(--panel)] shadow-[inset_0_1px_0_rgba(255,255,255,.02)] transition active:scale-[.99]">
      <GiftMedia gift={gift} compact className="aspect-square w-full" />
      <div className="p-2.5">
        <div className="truncate text-xs font-medium text-white">{gift.baseName}</div>
        <div className="mt-0.5 flex items-center justify-between gap-2 text-[10px] text-[var(--muted)]">
          <span>#{gift.number}</span>
          {showOwner ? <span className="truncate">{gift.ownerName}</span> : gift.offerCount > 0 ? <span className="flex items-center gap-1"><MessageSquareMore size={10} />{gift.offerCount}</span> : null}
        </div>
        <div className="mt-2.5 flex items-center gap-1.5">
          <span className="flex h-8 min-w-0 flex-1 items-center rounded-[18px] bg-[var(--panel-2)] px-2.5 text-xs font-medium">
            {displayValue == null ? <span className="truncate text-[var(--muted)]">Без цены</span> : <><Gem size={12} className="mr-1 shrink-0 text-[#d9dde2]" fill="currentColor" /><span className="truncate">{valueLabel}{money(displayValue)}</span></>}
          </span>
          {isListed ? <span className="grid h-8 w-8 shrink-0 place-items-center rounded-[18px] bg-[var(--panel-2)] text-[var(--muted)] group-active:text-white"><ShoppingCart size={15} /></span> : null}
        </div>
      </div>
    </Link>
  );
}

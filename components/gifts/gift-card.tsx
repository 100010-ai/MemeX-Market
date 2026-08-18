"use client";

import Link from "next/link";
import { Gem, ShoppingCart } from "lucide-react";
import type { GiftAsset } from "@/lib/types";
import { money } from "@/lib/format";
import { GiftMedia } from "@/components/gifts/gift-media";

export function GiftCard({ gift, showOwner = false }: { gift: GiftAsset; showOwner?: boolean }) {
  const shownPrice = gift.listingPrice ?? gift.estimatedValue;
  return (
    <Link href={`/gifts/${gift.virtualGiftId}`} className="group min-w-0 overflow-hidden rounded-[9px] border border-[var(--border)] bg-[var(--panel)] transition active:scale-[.995]">
      <GiftMedia gift={gift} compact className="aspect-square w-full" />
      <div className="p-2">
        <div className="truncate text-[13px] font-medium text-white">{gift.baseName}</div>
        <div className="mt-0.5 flex items-center justify-between gap-2 text-[10px] text-[var(--muted)]"><span>#{gift.number}</span>{showOwner ? <span className="truncate">{gift.ownerName}</span> : null}</div>
        <div className="mt-2 flex items-center gap-1.5">
          <span className="flex h-8 min-w-0 flex-1 items-center rounded-md bg-[var(--panel-2)] px-2 text-xs font-medium">
            {shownPrice == null ? <span className="truncate text-[var(--muted)]">No price</span> : <><Gem size={12} className="mr-1 shrink-0 text-[#d9dde2]" fill="currentColor" /><span className="truncate">{money(shownPrice).replace("$", "")}</span></>}
          </span>
          {gift.status === "listed" ? <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-[var(--panel-2)] text-[var(--muted)] group-active:text-white"><ShoppingCart size={15} /></span> : null}
        </div>
      </div>
    </Link>
  );
}

"use client";

import Link from "next/link";
import { ShoppingCart } from "lucide-react";
import type { GiftAsset } from "@/lib/types";
import { money } from "@/lib/format";
import { GiftMedia } from "@/components/gifts/gift-media";

export function GiftCard({ gift }: { gift: GiftAsset }) {
  const shownPrice = gift.listingPrice ?? gift.lastSalePrice ?? gift.referencePrice;
  return (
    <Link href={`/gifts/${gift.virtualGiftId}`} className="min-w-0 overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--panel)] transition hover:border-[#3b3e43]">
      <GiftMedia gift={gift} compact className="aspect-square w-full" />
      <div className="p-2.5">
        <div className="truncate text-sm font-medium">{gift.baseName}</div>
        <div className="mt-0.5 text-[11px] text-[var(--muted)]">#{gift.number}</div>
        <div className="mt-2 flex items-center gap-1.5">
          <span className="min-w-0 flex-1 rounded-md bg-[var(--panel-2)] px-2 py-2 text-xs font-medium"><span className="mr-1 text-[var(--accent)]">◆</span>{money(shownPrice).replace("$", "")}</span>
          <span className="grid h-8 w-8 place-items-center rounded-md bg-[var(--panel-2)] text-[var(--muted)]"><ShoppingCart size={15} /></span>
        </div>
      </div>
    </Link>
  );
}

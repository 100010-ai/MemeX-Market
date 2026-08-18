"use client";

import Link from "next/link";
import { ShoppingCart } from "lucide-react";
import type { GiftAsset } from "@/lib/types";
import { money } from "@/lib/format";
import { GiftMedia } from "@/components/gifts/gift-media";

export function GiftCard({ gift, showOwner = false }: { gift: GiftAsset; showOwner?: boolean }) {
  const shownPrice = gift.listingPrice ?? gift.estimatedValue;
  return (
    <Link href={`/gifts/${gift.virtualGiftId}`} className="group min-w-0 overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--panel)] transition hover:border-[#45484f]">
      <GiftMedia gift={gift} compact className="aspect-square w-full" />
      <div className="p-2.5">
        <div className="truncate text-sm font-medium">{gift.baseName}</div>
        <div className="mt-0.5 flex items-center justify-between gap-2 text-[11px] text-[var(--muted)]"><span>#{gift.number}</span>{showOwner ? <span className="truncate">{gift.ownerName}</span> : null}</div>
        <div className="mt-2 flex items-center gap-1.5">
          <span className="min-w-0 flex-1 rounded-lg bg-[var(--panel-2)] px-2 py-2 text-xs font-medium">
            {shownPrice == null ? <span className="text-[var(--muted)]">No market price</span> : <><span className="mr-1 text-[var(--accent)]">◆</span>{money(shownPrice).replace("$", "")}</>}
          </span>
          {gift.status === "listed" ? <span className="grid h-8 w-8 place-items-center rounded-lg bg-[var(--panel-2)] text-[var(--muted)] group-hover:text-white"><ShoppingCart size={15} /></span> : null}
        </div>
      </div>
    </Link>
  );
}

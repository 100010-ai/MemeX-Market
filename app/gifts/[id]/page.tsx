"use client";

import Link from "next/link";
import { Handshake } from "lucide-react";
import { useParams } from "next/navigation";
import { GiftDetail } from "@/components/gifts/gift-detail";
import { MXMScoreCard } from "@/components/gifts/mxm-score-card";

export default function GiftPage() {
  const { id } = useParams<{ id: string }>();
  return <div className="mx-auto max-w-5xl">
    <MXMScoreCard giftId={id} />
    <Link href={`/trades?requestedGiftId=${encodeURIComponent(id)}`} className="mxm-secondary-action mb-3 min-h-11 w-full justify-center"><Handshake size={14} />Предложить обмен</Link>
    <GiftDetail id={id} />
  </div>;
}

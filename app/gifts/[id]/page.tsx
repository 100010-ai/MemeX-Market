"use client";

import { useParams } from "next/navigation";
import { GiftDetail } from "@/components/gifts/gift-detail";
import { MXMScoreCard } from "@/components/gifts/mxm-score-card";

export default function GiftPage() {
  const { id } = useParams<{ id: string }>();
  return <div className="mx-auto max-w-5xl"><MXMScoreCard giftId={id} /><GiftDetail id={id} /></div>;
}

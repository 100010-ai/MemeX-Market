"use client";

import { useParams } from "next/navigation";
import { GiftDetail } from "@/components/gifts/gift-detail";

export default function GiftPage() {
  const { id } = useParams<{ id: string }>();
  return (
    <div className="mx-auto max-w-5xl">
      <GiftDetail id={id} />
    </div>
  );
}

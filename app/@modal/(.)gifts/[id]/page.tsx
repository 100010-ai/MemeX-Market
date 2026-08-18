"use client";

import { useParams, useRouter } from "next/navigation";
import { GiftDetail } from "@/components/gifts/gift-detail";
import { RouteModal } from "@/components/modal/route-modal";

// Intercepts in-app navigation to /gifts/[id] and renders it as a bottom
// sheet over the current page instead of a full navigation. Direct links,
// refreshes, or shares still resolve to the real page at app/gifts/[id].
export default function GiftModal() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  return (
    <RouteModal>
      <GiftDetail id={id} onClose={() => router.back()} />
    </RouteModal>
  );
}

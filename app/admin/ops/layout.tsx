import Link from "next/link";

export default function AdminOpsLayout({ children }: { children: React.ReactNode }) {
  return <>
    {children}
    <nav className="fixed bottom-4 right-4 z-[90] flex items-center gap-1 rounded-2xl border border-white/10 bg-[#0b0f14]/95 p-1.5 shadow-2xl backdrop-blur-xl">
      <Link href="/admin/ops" className="rounded-xl px-3 py-2 text-[9px] font-medium text-white/65 transition hover:bg-white/[.06] hover:text-white">Ops</Link>
      <Link href="/admin/ops/advanced" className="rounded-xl bg-white/[.06] px-3 py-2 text-[9px] font-medium text-white transition hover:bg-white/[.09]">Advanced</Link>
    </nav>
  </>;
}

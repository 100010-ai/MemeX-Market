import { AdminAccessGate } from "@/components/admin/admin-access-gate";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <AdminAccessGate>{children}</AdminAccessGate>;
}

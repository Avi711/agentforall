import { requireAdminSession } from "@/lib/auth/admin";
import { AdminDashboard } from "./AdminDashboard";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const session = await requireAdminSession();
  return <AdminDashboard adminEmail={session.user.email} />;
}

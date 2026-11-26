import { Suspense } from "react";
import { requireRole } from "@/lib/authz";

async function AdminHome() {
  const user = await requireRole("admin");
  return (
    <div className="space-y-2">
      <h1 className="text-2xl font-semibold">Panel</h1>
      <p>
        Hola, {user.name} ({user.role}).
      </p>
    </div>
  );
}

export default function AdminPage() {
  return (
    <div className="mx-auto max-w-4xl">
      <Suspense fallback={<p className="text-foreground/60">Cargando…</p>}>
        <AdminHome />
      </Suspense>
    </div>
  );
}

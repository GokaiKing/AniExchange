import Link from "next/link";
import { Suspense } from "react";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireRole } from "@/lib/authz";
import { hasRole } from "@/lib/roles";

async function AdminHome() {
  const user = await requireRole("admin");
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Panel</h1>
      <div className="grid gap-4 sm:grid-cols-2">
        {hasRole(user.role, "superadmin") && (
          <Link href="/admin/events">
            <Card className="transition-colors hover:bg-muted/50">
              <CardHeader>
                <CardTitle>Ediciones</CardTitle>
                <CardDescription>Crear ediciones, editar fechas y reglas de cada fase.</CardDescription>
              </CardHeader>
            </Card>
          </Link>
        )}
      </div>
    </div>
  );
}

export default function AdminPage() {
  return (
    <div className="mx-auto max-w-4xl">
      <Suspense fallback={<p className="text-muted-foreground">Cargando…</p>}>
        <AdminHome />
      </Suspense>
    </div>
  );
}

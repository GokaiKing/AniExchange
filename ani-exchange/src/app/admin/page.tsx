import Link from "next/link";
import { Suspense } from "react";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getDb } from "@/db";
import { requireRole } from "@/lib/authz";
import { hasRole } from "@/lib/roles";
import { getCurrentEvent } from "@/server/participants";

function PanelCard({ href, title, description }: { href: string; title: string; description: string }) {
  return (
    <Link href={href}>
      <Card className="h-full transition-colors hover:bg-muted/50">
        <CardHeader>
          <CardTitle>{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
      </Card>
    </Link>
  );
}

async function AdminHome() {
  const user = await requireRole("admin");
  const current = await getCurrentEvent(getDb());
  const isSuperadmin = hasRole(user.role, "superadmin");

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Panel</h1>
      <div className="grid gap-4 sm:grid-cols-2">
        {current && (
          <PanelCard
            href={`/admin/events/${current.event.id}/participants`}
            title="Participantes"
            description={`${current.event.name}: estado de cada quien, DMs fallidos y "no participó".`}
          />
        )}
        {isSuperadmin && (
          <PanelCard href="/admin/events" title="Ediciones" description="Crear ediciones, fechas, reglas, sorteo, DMs y emparejamientos." />
        )}
        {isSuperadmin && (
          <PanelCard href="/admin/audit" title="Auditoría" description="Todo lo que cambió, quién y cuándo." />
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

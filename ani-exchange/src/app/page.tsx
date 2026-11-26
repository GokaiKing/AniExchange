import Link from "next/link";
import { Suspense } from "react";
import { CurrentEventCard } from "@/components/current-event-card";
import { ReviewFeed } from "@/components/review-feed";
import { buttonVariants } from "@/components/ui/button";
import { getSessionUser } from "@/lib/authz";
import { hasRole } from "@/lib/roles";

const MESSAGES = {
  required: "Inicia sesión con Discord para continuar.",
  forbidden: "No tienes permiso para ver esa página.",
} as const;

async function Notice({ searchParams }: { searchParams: PageProps<"/">["searchParams"] }) {
  const params = await searchParams;
  const key =
    params.error === "forbidden" ? "forbidden" : params.login === "required" ? "required" : null;
  if (!key) return null;
  return (
    <p className="rounded-md border border-festive-red/40 bg-accent text-accent-foreground px-4 py-2 text-sm">
      {MESSAGES[key]}
    </p>
  );
}

async function AdminShortcut() {
  const user = await getSessionUser();
  if (!user || !hasRole(user.role, "admin")) return null;
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border px-4 py-3">
      <span className="text-sm text-muted-foreground">Tienes acceso de {user.role}.</span>
      {hasRole(user.role, "superadmin") && (
        <Link href="/admin/events" className={buttonVariants({ size: "sm" })}>
          Editar ediciones y fases
        </Link>
      )}
      <Link href="/admin" className={buttonVariants({ variant: "outline", size: "sm" })}>
        Ir al panel
      </Link>
    </div>
  );
}

export default function Home({ searchParams }: PageProps<"/">) {
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <Suspense>
        <Notice searchParams={searchParams} />
      </Suspense>
      <h1 className="text-2xl font-semibold text-festive-red">Intercambio de Anime</h1>
      <Suspense fallback={<div className="h-28 rounded-xl border" />}>
        <CurrentEventCard />
      </Suspense>
      <Suspense>
        <AdminShortcut />
      </Suspense>
      <Suspense fallback={<p className="text-sm text-muted-foreground">Cargando reviews…</p>}>
        <ReviewFeed />
      </Suspense>
    </div>
  );
}

import Link from "next/link";
import { Suspense } from "react";
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
    <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-4 py-2 text-sm">
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
      <h1 className="text-2xl font-semibold">Intercambio de Anime</h1>
      <p className="text-foreground/70">
        Aquí aparecerán la inscripción, tu asignación y el feed de reviews.
      </p>
      <Suspense>
        <AdminShortcut />
      </Suspense>
    </div>
  );
}

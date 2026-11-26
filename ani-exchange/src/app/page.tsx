import { Suspense } from "react";

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
    </div>
  );
}

import { Lock } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { z } from "zod";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getDb } from "@/db";
import { requireRole } from "@/lib/authz";
import { pairingsForSuperadmin, PairingsHiddenError } from "@/server/reveal";

async function PairingsContent({ params }: { params: PageProps<"/admin/events/[id]/pairings">["params"] }) {
  const user = await requireRole("superadmin");
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();

  let pairs;
  try {
    // Cada visita queda registrada en la auditoría.
    pairs = await pairingsForSuperadmin(getDb(), user.id, id);
  } catch (error) {
    if (!(error instanceof PairingsHiddenError)) throw error;
    return (
      <div className="space-y-3">
        <Link href={`/admin/events/${id}`} className="text-sm text-muted-foreground hover:underline">
          ← Edición
        </Link>
        <p className="text-muted-foreground">
          Los emparejamientos están ocultos. Actívalos desde la edición con &ldquo;Mostrar emparejamientos&rdquo;.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Link href={`/admin/events/${id}`} className="text-sm text-muted-foreground hover:underline">
        ← Edición
      </Link>
      <h1 className="text-2xl font-bold">Emparejamientos</h1>
      <p className="rounded-md border border-festive-red/40 bg-accent px-3 py-2 text-sm text-accent-foreground">
        <Lock className="inline size-[1em] shrink-0 align-[-0.125em]" /> Información secreta hasta el reveal. Esta consulta quedó registrada en la auditoría.
      </p>
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Giver</TableHead>
              <TableHead>Receptor</TableHead>
              <TableHead>Anime elegido</TableHead>
              <TableHead>Review</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {pairs.map((p) => (
              <TableRow key={p.assignmentId}>
                <TableCell className="font-medium">{p.giver.name}</TableCell>
                <TableCell>{p.receiver.name}</TableCell>
                <TableCell>{p.anime?.title ?? <span className="text-muted-foreground">—</span>}</TableCell>
                <TableCell>{p.hasReview ? (p.rating !== null ? `${p.rating}/10` : "sí") : "—"}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

export default function PairingsPage({ params }: PageProps<"/admin/events/[id]/pairings">) {
  return (
    <div className="mx-auto max-w-4xl">
      <Suspense fallback={<p className="text-muted-foreground">Cargando…</p>}>
        <PairingsContent params={params} />
      </Suspense>
    </div>
  );
}

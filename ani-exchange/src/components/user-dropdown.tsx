"use client";

import { ChevronDown, LogOut, ShieldCheck } from "lucide-react";
import { useRouter } from "next/navigation";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { authClient } from "@/lib/auth-client";

type Props = {
  name: string;
  image: string | null;
  /** Etiqueta del rol ("admin", "superadmin") o null para usuarios normales. */
  roleLabel: string | null;
  canOpenPanel: boolean;
};

/** Cada opción: misma altura, ícono y texto alineados, resaltado claro. */
const ITEM = "gap-2.5 px-2.5 py-2 focus:bg-white/10 data-[variant=destructive]:focus:bg-destructive/15";

/** Avatar + nombre en el header; al hacer clic abre Panel (admins) y Salir. */
export function UserDropdown({ name, image, roleLabel, canOpenPanel }: Props) {
  const router = useRouter();

  const signOut = async () => {
    await authClient.signOut();
    router.push("/");
    router.refresh();
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={`Menú de ${name}`}
        className="flex items-center gap-2 rounded-lg px-1.5 py-1 text-sm font-medium outline-none hover:bg-white/10 focus-visible:ring-3 focus-visible:ring-ring/50 data-popup-open:bg-white/10"
      >
        {image && (
          // eslint-disable-next-line @next/next/no-img-element -- avatar externo de Discord
          <img src={image} alt="" width={28} height={28} className="rounded-full" />
        )}
        <span className="max-w-40 truncate">{name}</span>
        <ChevronDown className="size-4 opacity-70" />
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" sideOffset={8} className="glass w-56 border border-border p-1.5">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="flex items-center justify-between gap-2 px-2.5 py-1.5">
            <span className="truncate">{name}</span>
            {roleLabel && (
              <span className="rounded bg-secondary px-1.5 py-0.5 text-[0.65rem] text-secondary-foreground">
                {roleLabel}
              </span>
            )}
          </DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        {canOpenPanel && (
          <>
            <DropdownMenuItem className={ITEM} onClick={() => router.push("/admin")}>
              <ShieldCheck className="size-4 text-gold" />
              Panel
            </DropdownMenuItem>
            <DropdownMenuSeparator className="my-1" />
          </>
        )}
        <DropdownMenuItem variant="destructive" className={ITEM} onClick={signOut}>
          <LogOut className="size-4" />
          Salir
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

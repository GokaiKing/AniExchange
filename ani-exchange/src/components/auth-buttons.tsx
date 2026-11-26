"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { authClient } from "@/lib/auth-client";

export function SignInButton() {
  const [pending, startTransition] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          await authClient.signIn.social({ provider: "discord", callbackURL: "/" });
        })
      }
      className="rounded-md bg-[#5865F2] px-3 py-1.5 text-sm font-medium text-white hover:bg-[#4752c4] disabled:opacity-60"
    >
      {pending ? "Redirigiendo…" : "Entrar con Discord"}
    </button>
  );
}

export function SignOutButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          await authClient.signOut();
          router.refresh();
        })
      }
      className="rounded-md border border-foreground/20 px-3 py-1.5 text-sm hover:bg-foreground/5 disabled:opacity-60"
    >
      Salir
    </button>
  );
}

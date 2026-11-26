"use client";

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

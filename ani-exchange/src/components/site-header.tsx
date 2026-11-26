import { Gift, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";
import { SignInButton, SignOutButton } from "@/components/auth-buttons";
import { buttonVariants } from "@/components/ui/button";
import { getSessionUser } from "@/lib/authz";
import { hasRole } from "@/lib/roles";

const ROLE_LABEL = { user: null, admin: "admin", superadmin: "superadmin" } as const;

async function UserMenu() {
  const user = await getSessionUser();
  if (!user) return <SignInButton />;

  const roleLabel = ROLE_LABEL[user.role];
  return (
    <div className="flex items-center gap-3">
      <Link href="/assignment" className={buttonVariants({ size: "sm" })}>
        <Gift data-icon="inline-start" />
        Mi asignación
      </Link>
      {hasRole(user.role, "admin") && (
        <Link href="/admin" className={buttonVariants({ variant: "festive", size: "sm" })}>
          <ShieldCheck data-icon="inline-start" />
          Panel
        </Link>
      )}
      {user.image && (
        // eslint-disable-next-line @next/next/no-img-element -- avatar externo de Discord
        <img src={user.image} alt="" width={28} height={28} className="rounded-full" />
      )}
      <span className="text-sm font-medium">{user.name}</span>
      {roleLabel && (
        <span className="rounded bg-secondary px-1.5 py-0.5 text-xs text-secondary-foreground">{roleLabel}</span>
      )}
      <SignOutButton />
    </div>
  );
}

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background/55 shadow-[inset_0_-1px_0_0_var(--glass-highlight)] backdrop-blur-xl">
      <div className="festive-stripe h-1.5" aria-hidden />
      <div className="flex items-center justify-between px-6 py-3">
        <Link href="/" aria-label="AniExchange: inicio" className="inline-flex shrink-0 flex-col items-end leading-none">
          <span className="bg-linear-to-b from-white to-ice bg-clip-text text-xl font-extrabold tracking-tight text-transparent drop-shadow-[0_0_8px_oklch(0.86_0.09_212/0.35)] sm:text-2xl">
            AniExchange
          </span>
          <span className="mt-0.5 flex items-center gap-0.5 text-[0.55rem] font-medium text-muted-foreground">
            by
            {/* eslint-disable-next-line @next/next/no-img-element -- PNG local de 24 KB; sin pasar por la optimización de Vercel */}
            <img
              src="/logo-header.png"
              alt="chajatable"
              width={1592}
              height={264}
              className="h-2.5 w-auto drop-shadow-[0_0_4px_oklch(1_0_0/0.25)] sm:h-3"
            />
          </span>
        </Link>
        <Suspense fallback={<div className="h-8 w-32" />}>
          <UserMenu />
        </Suspense>
      </div>
    </header>
  );
}

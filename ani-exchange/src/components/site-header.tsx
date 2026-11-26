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
      {hasRole(user.role, "admin") && (
        <Link href="/admin" className={buttonVariants({ variant: "outline", size: "sm" })}>
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
    <header className="border-b border-foreground/10">
      <div className="festive-stripe h-1.5" aria-hidden />
      <div className="flex items-center justify-between px-6 py-3">
        <Link href="/" className="font-semibold text-festive-red">
          Intercambio de Anime
        </Link>
        <Suspense fallback={<div className="h-8 w-32" />}>
          <UserMenu />
        </Suspense>
      </div>
    </header>
  );
}

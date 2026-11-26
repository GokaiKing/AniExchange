import { Gift } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";
import { SignInButton } from "@/components/auth-buttons";
import { buttonVariants } from "@/components/ui/button";
import { UserDropdown } from "@/components/user-dropdown";
import { getSessionUser } from "@/lib/authz";
import { hasRole } from "@/lib/roles";

const ROLE_LABEL = { user: null, admin: "admin", superadmin: "superadmin" } as const;

async function UserMenu() {
  const user = await getSessionUser();
  if (!user) return <SignInButton />;

  return (
    <div className="flex items-center gap-2 sm:gap-3">
      <Link href="/assignment" className={buttonVariants({ size: "sm" })}>
        <Gift data-icon="inline-start" />
        Mi asignación
      </Link>
      <UserDropdown
        name={user.name}
        image={user.image}
        roleLabel={ROLE_LABEL[user.role]}
        canOpenPanel={hasRole(user.role, "admin")}
      />
    </div>
  );
}

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-black/40 bg-linear-to-b from-brick/95 to-brick-deep/95 shadow-[inset_0_1px_0_0_oklch(1_0_0/0.04),0_6px_18px_-6px_oklch(0_0_0/0.7)] backdrop-blur-xl">
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

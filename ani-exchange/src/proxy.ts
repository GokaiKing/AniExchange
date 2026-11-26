import { getSessionCookie } from "better-auth/cookies";
import { type NextRequest, NextResponse } from "next/server";

// Redirección optimista: solo revisa que exista la cookie de sesión.
// La verificación real (sesión válida y rol) se hace en el servidor con
// requireRole / assertRole.
export function proxy(request: NextRequest) {
  if (!getSessionCookie(request)) {
    return NextResponse.redirect(new URL("/?login=required", request.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/admin/:path*"],
};

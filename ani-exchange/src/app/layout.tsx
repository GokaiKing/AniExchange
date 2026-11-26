import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { BackgroundMusic } from "@/components/background-music";
import { SiteHeader } from "@/components/site-header";
import { Snowfall } from "@/components/snowfall";
import { Toaster } from "@/components/ui/sonner";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "AniExchange",
  description: "Intercambio anual de anime del grupo de Discord",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="es"
      className={`${geistSans.variable} ${geistMono.variable} dark h-full antialiased`}
    >
      <body className="relative isolate min-h-full flex flex-col">
        <Snowfall />
        <SiteHeader />
        <main className="flex-1 px-6 py-8">{children}</main>
        <Toaster position="top-right" offset={{ top: 88, right: 16 }} />
        {/* eslint-disable-next-line @next/next/no-img-element -- decoración local, sin optimización de Vercel */}
        <img
          src="/mascot.png"
          alt=""
          aria-hidden
          width={400}
          height={436}
          className="pointer-events-none fixed right-2 bottom-[max(0.25rem,env(safe-area-inset-bottom))] z-30 w-32 select-none drop-shadow-[0_4px_12px_oklch(0_0_0/0.5)] sm:w-48"
        />
        <BackgroundMusic />
      </body>
    </html>
  );
}

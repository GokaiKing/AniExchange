import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { BackgroundMusic } from "@/components/background-music";
import { BokehLights } from "@/components/bokeh-lights";
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
        <BokehLights />
        <Snowfall />
        <SiteHeader />
        <main className="flex-1 px-6 py-8">{children}</main>
        <Toaster position="bottom-right" />
        <BackgroundMusic />
      </body>
    </html>
  );
}

import type { Metadata, Viewport } from "next";
import { Suspense } from "react";
import { Inter } from "next/font/google";
import { Header } from "@/components/Header";
import { ServiceWorker } from "@/components/ServiceWorker";
import "./globals.css";

const inter = Inter({ variable: "--font-inter", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "U1 Maker Hub",
  description: "Browse MakerWorld, re-slice for the Snapmaker U1, and print.",
  applicationName: "U1 Maker Hub",
  appleWebApp: { capable: true, title: "Maker Hub", statusBarStyle: "default" },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#ffffff",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={inter.variable}>
      <head>
        {/* Added by hand rather than through metadata: the app sits behind an auth gateway, so the manifest request must carry cookies. */}
        <link rel="manifest" href="/manifest.webmanifest" crossOrigin="use-credentials" />
        {/* Open the connection to MakerWorld's image CDN before the first image is requested. */}
        <link rel="preconnect" href="https://makerworld.bblmw.com" />
        <link rel="dns-prefetch" href="https://makerworld.bblmw.com" />
      </head>
      <body>
        <Suspense fallback={<header className="header" style={{ height: 65 }} />}>
          <Header />
        </Suspense>
        {children}
        <footer className="footer">
          Models come from MakerWorld and keep their creators&apos; licenses. Personal use only.
        </footer>
        <ServiceWorker />
      </body>
    </html>
  );
}

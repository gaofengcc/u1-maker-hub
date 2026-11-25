import type { Metadata, Viewport } from "next";
import { Suspense } from "react";
import { connection } from "next/server";
import { Inter } from "next/font/google";
import { Header } from "@/components/Header";
import { ServiceWorker } from "@/components/ServiceWorker";
import "./globals.css";

const inter = Inter({ variable: "--font-inter", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "U1 模型工坊",
  description: "浏览 MakerWorld 模型，重新切片给 Snapmaker U1 打印。",
  applicationName: "U1 模型工坊",
  appleWebApp: { capable: true, title: "U1 模型工坊", statusBarStyle: "default" },
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
    <html lang="zh-CN" className={inter.variable}>
      <head>
        {/* Added by hand rather than through metadata: the app sits behind an auth gateway, so the manifest request must carry cookies. */}
        <link rel="manifest" href="/manifest.webmanifest" crossOrigin="use-credentials" />
        {/* Open the connection to MakerWorld's image CDN before the first image is requested. */}
        <link rel="preconnect" href="https://makerworld.bblmw.com" />
        <link rel="dns-prefetch" href="https://makerworld.bblmw.com" />
        <link rel="preconnect" href="https://makerworld.bblmw.cn" />
        <link rel="dns-prefetch" href="https://makerworld.bblmw.cn" />
      </head>
      <body>
        <Suspense fallback={null}><DemoBanner /></Suspense>
        <Suspense fallback={<header className="header" style={{ height: 65 }} />}>
          <Header />
        </Suspense>
        {children}
        <footer className="footer">
          MakerWorld 和 Snapmaker Space 模型的版权归原作者所有，仅供个人使用。
        </footer>
        <ServiceWorker />
      </body>
    </html>
  );
}

async function DemoBanner() {
  await connection();
  return process.env.DEMO_MODE === "1" ? <div className="demo-banner">演示模式：数据是内置示例，不会连接 MakerWorld 或打印机</div> : null;
}

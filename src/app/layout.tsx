import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "宇宙浏览器 · Universe Explorer",
  description: "在浏览器中漫游宇宙：太阳系真实轨道、12 万恒星的银河系、引力透镜黑洞——三大 Three.js 沉浸式场景，全程序化材质。",
  keywords: ["太阳系", "银河系", "黑洞", "Three.js", "WebGL", "天文", "宇宙", "solar system", "black hole"],
  authors: [{ name: "Lihongbo-Learn" }],
  icons: {
    icon: "/logo.svg",
  },
  openGraph: {
    title: "宇宙浏览器 · Universe Explorer",
    description: "太阳系 / 银河系 / 黑洞 —— Three.js 沉浸式宇宙探索",
    siteName: "Universe Explorer",
    type: "website",
  },
  twitter: {
    card: "summary",
    title: "宇宙浏览器 · Universe Explorer",
    description: "太阳系 / 银河系 / 黑洞 —— Three.js 沉浸式宇宙探索",
  },
};

/* F44 — portrait adaptation: viewport-fit=cover exposes env(safe-area-inset-*)
   on notched phones so the UI can pad itself away from the notch / home bar. */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#020208",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        {children}
        <Toaster />
      </body>
    </html>
  );
}

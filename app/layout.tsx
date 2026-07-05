import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "CRM מימון רכבים",
  description: "דשבורד CRM עתידני לסוכני מימון רכבים",
  icons: {
    icon: [
      { url: "/icons/app-icon.png", sizes: "1024x1024", type: "image/png" },
      { url: "/icons/app-icon.png", sizes: "512x512", type: "image/png" },
      { url: "/icons/app-icon.png", sizes: "192x192", type: "image/png" },
    ],
    apple: [{ url: "/icons/app-icon.png", sizes: "180x180", type: "image/png" }],
    shortcut: ["/icons/app-icon.png"],
  },
  appleWebApp: {
    capable: true,
    title: "CRM מימון רכבים",
    statusBarStyle: "black-translucent",
  },
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="he" dir="rtl" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}

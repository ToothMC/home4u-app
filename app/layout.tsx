import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, Cormorant_Garamond } from "next/font/google";
import "./globals.css";
import { getT } from "@/lib/i18n/server";
import { LangProvider } from "@/lib/i18n/provider";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const cormorant = Cormorant_Garamond({
  variable: "--font-serif",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Home4U — Schreib Sophie. Sie findet dein Zuhause.",
  description:
    "KI-gestützte Immobilienplattform mit Double-Match-Prinzip. Sophie chattet mit dir und findet, was wirklich passt.",
  icons: {
    icon: [
      { url: "/favicon.svg", type: "image/svg+xml" },
      { url: "/favicon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/favicon-128.png", sizes: "128x128", type: "image/png" },
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "512x512" }],
  },
};

export const viewport: Viewport = {
  themeColor: "#f7f5f1",
  colorScheme: "light",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const { lang } = await getT();
  return (
    <html
      lang={lang}
      className={`${geistSans.variable} ${geistMono.variable} ${cormorant.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-[var(--background)] text-[var(--foreground)]">
        <LangProvider lang={lang}>{children}</LangProvider>
      </body>
    </html>
  );
}

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

const SITE_URL = (
  process.env.NEXT_PUBLIC_BASE_URL ?? "https://home4u.ai"
).replace(/\/$/, "");

const SITE_TITLE = "Home4U — Schreib Sophie. Sie findet dein Zuhause.";
const SITE_DESCRIPTION =
  "KI-gestützte Immobilienplattform für Zypern mit Double-Match-Prinzip. Sophie chattet mit dir und findet, was wirklich passt.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: SITE_TITLE,
  description: SITE_DESCRIPTION,
  applicationName: "Home4U",
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    siteName: "Home4U",
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    url: SITE_URL,
    locale: "de_DE",
    alternateLocale: ["en_GB", "ru_RU", "el_GR", "zh_CN"],
    images: [
      {
        url: "/hero/home4u-hero.png",
        width: 1600,
        height: 900,
        alt: "Home4U — Immobilien für Zypern",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    images: ["/hero/home4u-hero.png"],
  },
  verification: {
    google: process.env.NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION,
    other: process.env.NEXT_PUBLIC_BING_SITE_VERIFICATION
      ? { "msvalidate.01": process.env.NEXT_PUBLIC_BING_SITE_VERIFICATION }
      : undefined,
  },
  icons: {
    icon: [
      { url: "/favicon.svg", type: "image/svg+xml" },
      { url: "/favicon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/favicon-128.png", sizes: "128x128", type: "image/png" },
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "512x512" }],
  },
};

const ORGANIZATION_JSONLD = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Organization",
      "@id": `${SITE_URL}/#organization`,
      name: "Home4U",
      url: SITE_URL,
      logo: `${SITE_URL}/favicon-128.png`,
      description: SITE_DESCRIPTION,
      areaServed: { "@type": "Country", name: "Cyprus" },
    },
    {
      "@type": "WebSite",
      "@id": `${SITE_URL}/#website`,
      url: SITE_URL,
      name: "Home4U",
      publisher: { "@id": `${SITE_URL}/#organization` },
      inLanguage: ["de", "en", "ru", "el", "zh"],
      potentialAction: {
        "@type": "SearchAction",
        target: {
          "@type": "EntryPoint",
          urlTemplate: `${SITE_URL}/matches?q={search_term_string}`,
        },
        "query-input": "required name=search_term_string",
      },
    },
  ],
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
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify(ORGANIZATION_JSONLD),
          }}
        />
        <LangProvider lang={lang}>{children}</LangProvider>
      </body>
    </html>
  );
}

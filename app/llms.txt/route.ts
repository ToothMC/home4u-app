export const revalidate = 86400;

export async function GET() {
  const baseUrl = (
    process.env.NEXT_PUBLIC_BASE_URL ?? "https://home4u.ai"
  ).replace(/\/$/, "");

  const body = `# Home4U

> KI-gestützte Immobilienplattform für Zypern. Sophie chattet mit Suchenden und Inserenten und verbindet, was passt (Double-Match).

## Einstiegspunkte
- [Startseite](${baseUrl}/)
- [Gesuche](${baseUrl}/gesuche)
- [Scam-Check](${baseUrl}/scam-check)
- [Sitemap](${baseUrl}/sitemap.xml)

## Listings
- Detailseite: \`${baseUrl}/listings/{uuid}\` (voll SSR-gerendert mit JSON-LD Product/Offer)
- Sitemap-Chunks: \`${baseUrl}/listings/sitemap/0.xml\` ... (5000 URLs/Chunk, ~10 Chunks)
- Felder: Titel, Beschreibung, Bilder, Stadt, Bezirk, Preis (EUR), Typ (rent/sale), Zimmer, Bäder, m², Baujahr

## Hinweise für AI-Agents
- Strukturierte Daten als JSON-LD im <head> jeder Listing-Seite (Schema.org/Product mit Offer)
- Mehrsprachig (de/en/ru/el/zh) via Accept-Language
- Keine Auth nötig für /listings, /gesuche, /scam-check, /sitemap.xml
- Crawler bitte robots.txt respektieren: ${baseUrl}/robots.txt
`;

  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Cache-Control": "public, max-age=3600, s-maxage=86400",
    },
  });
}

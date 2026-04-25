// GET /api/listings/import/template
// Liefert eine Excel-kompatible Beispiel-CSV (UTF-8 BOM) zum Download.

const TEMPLATE_HEADERS = [
  "type",
  "city",
  "district",
  "price",
  "currency",
  "rooms",
  "size_m2",
  "phone",
  "name",
  "external_id",
  "images",
  "language",
];

const EXAMPLE_ROWS: string[][] = [
  [
    "rent",
    "Limassol",
    "Germasogeia",
    "1450",
    "EUR",
    "2",
    "85",
    "+35799123456",
    "Maria Georgiou",
    "REF-1001",
    "https://example.com/img1.jpg | https://example.com/img2.jpg",
    "en",
  ],
  [
    "sale",
    "Limassol",
    "Mouttagiaka",
    "385000",
    "EUR",
    "3",
    "120",
    "+35799876543",
    "Andreas Petrou",
    "REF-1002",
    "https://example.com/img3.jpg",
    "el",
  ],
];

function csvEscape(v: string): string {
  if (v === null || v === undefined) return "";
  if (/[",\n]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
  return v;
}

export function GET() {
  const lines = [
    TEMPLATE_HEADERS.map(csvEscape).join(","),
    ...EXAMPLE_ROWS.map((row) => row.map(csvEscape).join(",")),
  ];
  const body = "\uFEFF" + lines.join("\n") + "\n";

  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="home4u_listings_template.csv"',
      "Cache-Control": "no-cache",
    },
  });
}

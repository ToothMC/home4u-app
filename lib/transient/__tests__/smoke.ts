/**
 * Smoke-Test gegen echte Bazaraki-Search-URL.
 *
 *   npx tsx lib/transient/__tests__/smoke.ts
 *
 * Prüft:
 *   1. URL-Builder: bekannte Stadt → URL, unbekannte → null
 *   2. Profile-Hash: deterministisch (gleicher Input → gleicher Hash)
 *   3. Live-Fetch (Network!) gegen Limassol/rent → ≥ 1 Kandidat oder
 *      sauberes rate_limited/error-Result
 *
 * Hinweis: macht echte HTTP-Calls. Bei Rate-Limit → status="rate_limited"
 * statt Crash.
 */
import {
  buildSearchUrl,
  fetchTransientBazaraki,
} from "../bazaraki-search";
import { computeProfileHash } from "../lookup";

async function main() {
  // 1) URL-Builder
  const url = buildSearchUrl({
    city: "Limassol",
    type: "rent",
    rooms: 2,
    price_min: 800,
    price_max: 2000,
  });
  console.log("URL:", url);
  if (!url || !url.includes("lemesos-district-limassol")) {
    console.error("✗ URL-Build fehlgeschlagen");
    process.exit(1);
  }

  const noUrl = buildSearchUrl({ city: "Atlantis", type: "rent" });
  if (noUrl !== null) {
    console.error("✗ unbekannte Stadt sollte null returnen, war:", noUrl);
    process.exit(1);
  }
  console.log("✓ URL-Builder");

  // 2) Profile-Hash deterministisch
  const h1 = computeProfileHash({
    city: "Limassol", type: "rent", rooms: 2, price_min: 800, price_max: 2000,
  });
  const h2 = computeProfileHash({
    city: "limassol", type: "rent", rooms: 2, price_min: 800, price_max: 2000,
  });
  const h3 = computeProfileHash({
    city: "Limassol", type: "rent", rooms: 3, price_min: 800, price_max: 2000,
  });
  console.log("hash same case-fold:", h1 === h2 ? "✓" : "✗", `${h1.slice(0,8)} == ${h2.slice(0,8)}`);
  console.log("hash diff rooms:    ", h1 !== h3 ? "✓" : "✗", `${h1.slice(0,8)} != ${h3.slice(0,8)}`);
  if (h1 !== h2 || h1 === h3) process.exit(1);

  // 3) Live-Fetch
  console.log("\n→ live fetch Limassol/rent/2BR/800-2000…");
  const result = await fetchTransientBazaraki(
    { city: "Limassol", type: "rent", rooms: 2, price_min: 800, price_max: 2000 },
    5,
  );
  console.log("status:", result.status);
  if (result.status === "ok") {
    console.log(`candidates: ${result.candidates.length}`);
    for (const c of result.candidates.slice(0, 3)) {
      console.log(
        `  - ${c.external_id}: ${c.rooms ?? "?"}BR · ${c.price} EUR · ${c.title?.slice(0, 60) ?? "(no title)"}`,
      );
      console.log(`    ${c.detail_url}`);
      if (c.media[0]) console.log(`    cover: ${c.media[0].slice(0, 80)}`);
    }
    if (result.candidates.length === 0) {
      console.warn("⚠ 0 candidates — Bazaraki HTML-Pattern könnte sich geändert haben");
    } else {
      console.log("✓ Live-Fetch Ergebnis");
    }
  } else {
    console.warn(`⚠ Live-Fetch ${result.status}: ${result.reason} — kein Hard-Fail (Spec §5.5)`);
  }

  console.log("\n✓ Smoke abgeschlossen");
}

main().catch((err) => {
  console.error("smoke crashed:", err);
  process.exit(1);
});

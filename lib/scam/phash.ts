/**
 * Perceptual Hash für Bilder (Indexer-Spec v2.0 §6.2 "duplicate_images").
 *
 * Variante: dHash (difference hash) — leichter und robuster gegen Skalierung
 * und JPEG-Artefakte als average hash, ohne DCT-Lib wie pHash. Für unseren
 * Zweck (gleiche Werbe-Bilder in mehreren Inseraten erkennen) ausreichend.
 *
 * Algorithmus:
 *   1. Bild auf 9×8 Pixel grayscale skalieren
 *   2. Pro Zeile 8 Vergleiche links→rechts (Pixel[i] > Pixel[i+1]?)
 *   3. 64 Bits zu bigint packen → Postgres image_hashes.phash bigint
 *
 * Hamming-Distance zwischen zwei dHashes via SQL phash_hamming() RPC
 * (Migration 0025, bit_count(int8send(a # b))).
 */
import sharp from "sharp";

const DHASH_W = 9;
const DHASH_H = 8;

/**
 * Berechnet dHash aus Bild-Buffer. Wirft bei nicht-decodierbaren Daten.
 * Output: signed 64-bit bigint (Postgres-kompatibel).
 */
export async function dhashBuffer(buf: Buffer): Promise<bigint> {
  const raw = await sharp(buf)
    .grayscale()
    .resize(DHASH_W, DHASH_H, { fit: "fill" })
    .raw()
    .toBuffer();
  // raw ist Uint8Array, Länge = 9*8 = 72
  const ONE = BigInt(1);
  const ZERO = BigInt(0);
  let hash = ZERO;
  for (let y = 0; y < DHASH_H; y++) {
    for (let x = 0; x < DHASH_W - 1; x++) {
      const left = raw[y * DHASH_W + x];
      const right = raw[y * DHASH_W + x + 1];
      hash = (hash << ONE) | (left > right ? ONE : ZERO);
    }
  }
  return toSigned64(hash);
}

/**
 * Lädt Bild von URL und berechnet dHash. Returnt null bei Fehlern (kaputte
 * URL, 404, nicht-Bild, Timeout) — Caller skipped diese Bilder, statt den
 * ganzen Score-Pass zu killen.
 */
export async function dhashFromUrl(url: string, timeoutMs = 10_000): Promise<bigint | null> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    const resp = await fetch(url, {
      signal: ctrl.signal,
      headers: { "User-Agent": "Home4U-ScamWorker/1.0" },
    });
    clearTimeout(timer);
    if (!resp.ok) {
      console.warn("[scam/phash] fetch failed", url, resp.status);
      return null;
    }
    const ct = resp.headers.get("content-type") ?? "";
    if (!ct.startsWith("image/")) {
      console.warn("[scam/phash] non-image content-type", url, ct);
      return null;
    }
    const arr = await resp.arrayBuffer();
    return await dhashBuffer(Buffer.from(arr));
  } catch (err) {
    console.warn("[scam/phash] dhashFromUrl failed", url, err);
    return null;
  }
}

/**
 * Hamming-Distance zweier 64-bit-Hashes. Wird in der Score-Engine genutzt,
 * wenn wir lokal vergleichen müssen (statt SQL-RPC).
 */
export function hamming(a: bigint, b: bigint): number {
  const ONE = BigInt(1);
  const ZERO = BigInt(0);
  let x = a ^ b;
  let count = 0;
  while (x !== ZERO) {
    x &= x - ONE; // clear lowest set bit
    count++;
  }
  return count;
}

/**
 * BigInt → signed 64-bit bigint (Postgres bigint range).
 * JS-bigint ist arbitrary-precision, aber Postgres hat int8 = signed 64-bit.
 * Werte > 2^63-1 müssen ins negative Spektrum gemapped werden.
 */
const MAX_SIGNED_64 = BigInt("0x7FFFFFFFFFFFFFFF");
const TWO_64 = BigInt("0x10000000000000000");
const MASK_64 = BigInt("0xFFFFFFFFFFFFFFFF");

function toSigned64(unsigned: bigint): bigint {
  const masked = unsigned & MASK_64; // truncate auf 64 bits
  return masked > MAX_SIGNED_64 ? masked - TWO_64 : masked;
}

/** Threshold (in Bits Hamming-Distance) für "praktisch gleiches Bild".
 *  Empirisch: 0–3 = identisch oder Re-Komprimierung; 4–10 = nahe Variante;
 *  >10 = anderes Motiv. Wir nutzen 5 für duplicate_images-Trigger. */
export const DHASH_DUPLICATE_THRESHOLD = 5;

/**
 * Smoke-Test für lib/scam/phash.ts ohne DB.
 *
 *   npx tsx lib/scam/__tests__/smoke.ts
 *
 * Prüft:
 *   1. dHash auf zwei verschiedenen Bildern → Hamming > Threshold
 *   2. dHash auf demselben Bild zweimal → Hamming = 0
 *   3. dHash auf JPEG-rekomprimiertem Bild → Hamming klein (< Threshold)
 *   4. signed-64-bit-Range: Output passt in Postgres bigint
 */
import sharp from "sharp";
import { dhashBuffer, hamming, DHASH_DUPLICATE_THRESHOLD } from "../phash";

async function makeSyntheticJpeg(seed: number, size = 256): Promise<Buffer> {
  // Generiere ein deterministisches "Bild" mit Gradient + seed-basierten Stripes
  const w = size, h = size;
  const px = Buffer.alloc(w * h * 3);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 3;
      px[i] = (x + seed * 13) & 0xff;
      px[i + 1] = (y + seed * 7) & 0xff;
      px[i + 2] = ((x ^ y) + seed * 31) & 0xff;
    }
  }
  return await sharp(px, { raw: { width: w, height: h, channels: 3 } })
    .jpeg({ quality: 80 })
    .toBuffer();
}

async function main() {
  console.log(`Threshold: ${DHASH_DUPLICATE_THRESHOLD} bits`);

  const imgA = await makeSyntheticJpeg(1);
  const imgA2 = await makeSyntheticJpeg(1);
  const imgB = await makeSyntheticJpeg(99);

  // Re-Komprimierung: imgA durch nochmaliges JPEG-Encode jagen
  const imgARecompressed = await sharp(imgA).jpeg({ quality: 50 }).toBuffer();

  const hashA = await dhashBuffer(imgA);
  const hashA2 = await dhashBuffer(imgA2);
  const hashB = await dhashBuffer(imgB);
  const hashAR = await dhashBuffer(imgARecompressed);

  console.log("hash(A)  =", hashA.toString());
  console.log("hash(A2) =", hashA2.toString(), "(same seed)");
  console.log("hash(AR) =", hashAR.toString(), "(re-jpeg q50)");
  console.log("hash(B)  =", hashB.toString(), "(different seed)");
  console.log();

  const hAA2 = hamming(hashA, hashA2);
  const hAR = hamming(hashA, hashAR);
  const hAB = hamming(hashA, hashB);
  console.log(`hamming(A, A2)  = ${hAA2}  (expect 0, identical pixels)`);
  console.log(`hamming(A, AR)  = ${hAR}  (expect ≤ ${DHASH_DUPLICATE_THRESHOLD}, JPEG re-compress)`);
  console.log(`hamming(A, B)   = ${hAB}  (expect > ${DHASH_DUPLICATE_THRESHOLD}, different motif)`);

  // Range-Check
  const MIN_INT64 = BigInt("-9223372036854775808");
  const MAX_INT64 = BigInt("9223372036854775807");
  for (const [name, h] of [
    ["A", hashA],
    ["A2", hashA2],
    ["AR", hashAR],
    ["B", hashB],
  ] as const) {
    if (h < MIN_INT64 || h > MAX_INT64) {
      console.error(`✗ hash(${name}) = ${h} liegt außerhalb int64-Range!`);
      process.exit(1);
    }
  }
  console.log("✓ alle Hashes in signed-64-bit-Range");

  // Verdicts
  let failed = 0;
  if (hAA2 !== 0) {
    console.error("✗ identische Pixel sollten hamming=0 ergeben, war", hAA2);
    failed++;
  }
  if (hAR > DHASH_DUPLICATE_THRESHOLD) {
    console.error(`✗ JPEG-Recompress sollte ≤ ${DHASH_DUPLICATE_THRESHOLD} sein, war ${hAR}`);
    failed++;
  }
  if (hAB <= DHASH_DUPLICATE_THRESHOLD) {
    console.error(`✗ unterschiedliche Bilder sollten > ${DHASH_DUPLICATE_THRESHOLD} sein, war ${hAB}`);
    failed++;
  }

  if (failed === 0) {
    console.log("\n✓ alle Smoke-Tests grün");
  } else {
    console.error(`\n✗ ${failed} Test(s) gefailed`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("smoke crashed:", err);
  process.exit(1);
});

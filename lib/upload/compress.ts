/**
 * Browser-seitige Bild-Kompression vor dem Upload.
 *
 * - HEIC (iPhone) → JPEG (sonst nicht in Chrome anzeigbar)
 * - Resize auf max 1920px lange Kante (genug für Hero-Galerie + bleibt
 *   unter Anthropics 2000-px-Many-Image-Limit, damit der Vision-Analyse-
 *   Pfad nicht extra herunterskalieren muss)
 * - JPEG quality 0.85 → typisch 250-500 KB statt 5-10 MB
 * - Web-Worker → blockiert UI nicht
 *
 * Videos werden nicht angefasst (ffmpeg.wasm zu groß für browser-side).
 */

const MAX_DIMENSION = 1920;
const MAX_OUTPUT_MB = 2;
const QUALITY = 0.85;

export type CompressResult = {
  file: File;
  originalSize: number;
  newSize: number;
  converted: boolean;
};

export async function compressImage(input: File): Promise<CompressResult> {
  const originalSize = input.size;

  // 1. HEIC → JPEG falls nötig
  let working: File = input;
  const isHeic =
    input.type === "image/heic" ||
    input.type === "image/heif" ||
    /\.(heic|heif)$/i.test(input.name);
  let converted = false;

  if (isHeic) {
    const heic2any = (await import("heic2any")).default;
    try {
      const blob = await heic2any({
        blob: input,
        toType: "image/jpeg",
        quality: QUALITY,
      });
      const jpegBlob = Array.isArray(blob) ? blob[0] : blob;
      working = new File(
        [jpegBlob],
        input.name.replace(/\.(heic|heif)$/i, ".jpg"),
        { type: "image/jpeg" }
      );
      converted = true;
    } catch (err) {
      // heic2any failed — Original durchreichen, der Server / das CDN versucht
      // sein Bestes, oder der Upload schlägt am MIME-Filter fehl.
      console.warn("[compress] heic2any failed", err);
      return { file: input, originalSize, newSize: originalSize, converted: false };
    }
  }

  // 2. Resize + Re-encode für alle Bilder (auch JPEG/PNG, damit auch
  //    DSLR-/Drohnen-Bilder geshrinked werden)
  if (working.type.startsWith("image/")) {
    try {
      const imageCompression = (await import("browser-image-compression")).default;
      const compressed = await imageCompression(working, {
        maxSizeMB: MAX_OUTPUT_MB,
        maxWidthOrHeight: MAX_DIMENSION,
        useWebWorker: true,
        initialQuality: QUALITY,
        fileType: "image/jpeg", // einheitliches Format
      });
      // imageCompression liefert Blob/File — Name re-übernehmen
      const ext = working.name.match(/\.(\w+)$/)?.[1] ?? "jpg";
      const newName = working.name.replace(/\.\w+$/, ".jpg");
      const finalFile = new File(
        [compressed],
        ext.toLowerCase() === "jpg" || ext.toLowerCase() === "jpeg"
          ? working.name
          : newName,
        { type: "image/jpeg" }
      );
      return {
        file: finalFile,
        originalSize,
        newSize: finalFile.size,
        converted: converted || finalFile.size !== originalSize,
      };
    } catch (err) {
      console.warn("[compress] image-compression failed", err);
      return { file: working, originalSize, newSize: working.size, converted };
    }
  }

  return { file: working, originalSize, newSize: working.size, converted };
}

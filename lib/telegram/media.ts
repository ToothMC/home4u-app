/**
 * Telegram-Media-Handling: Photo/Video/Document/Voice runterladen und
 * in Supabase Storage hochladen, damit Sophie damit arbeiten kann
 * (Listing-Draft mit Fotos, Voice→STT später).
 *
 * Telegram-File-Pipeline:
 *   1. file_id → bot.api.getFile(file_id) liefert file_path
 *   2. https://api.telegram.org/file/bot<TOKEN>/<file_path> → Binary
 *   3. Upload nach Supabase Storage Bucket 'telegram-uploads'
 */
import { getTelegramBot } from "@/lib/telegram/bot";
import { createSupabaseServiceClient } from "@/lib/supabase/server";

const STORAGE_BUCKET = "telegram-uploads";

export type DownloadedMedia = {
  publicUrl: string;
  storagePath: string;
  contentType: string | null;
  bytes: number;
};

/**
 * Lädt eine Telegram-File-ID herunter und uploadet sie nach Supabase Storage.
 * Gibt die public URL zurück (Storage-Bucket muss public sein, oder URL signed).
 */
export async function downloadAndStoreTelegramFile(args: {
  fileId: string;
  channelIdentityId: string;
  /** Optionaler Hint, z.B. 'photo' / 'document' / 'voice' / 'video' */
  kind?: string;
}): Promise<DownloadedMedia | null> {
  const bot = getTelegramBot();
  const supabase = createSupabaseServiceClient();
  if (!supabase) return null;

  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return null;

  // 1) getFile → file_path
  let file: { file_path?: string };
  try {
    file = await bot.api.getFile(args.fileId);
  } catch (err) {
    console.error("[telegram-media] getFile failed", err);
    return null;
  }
  if (!file.file_path) return null;

  // 2) Binary fetchen
  const url = `https://api.telegram.org/file/bot${token}/${file.file_path}`;
  const res = await fetch(url);
  if (!res.ok) {
    console.error("[telegram-media] fetch failed", res.status);
    return null;
  }
  const buf = Buffer.from(await res.arrayBuffer());
  const contentType = res.headers.get("content-type");

  // 3) Storage-Path bauen: <channel_identity_id>/<file_id>.<ext>
  const ext = file.file_path.split(".").pop() ?? "bin";
  const storagePath = `${args.channelIdentityId}/${args.fileId}.${ext}`;

  const { error: uploadErr } = await supabase.storage
    .from(STORAGE_BUCKET)
    .upload(storagePath, buf, {
      contentType: contentType ?? undefined,
      upsert: true,
    });
  if (uploadErr) {
    console.error("[telegram-media] upload failed", uploadErr);
    return null;
  }

  const { data: pub } = supabase.storage
    .from(STORAGE_BUCKET)
    .getPublicUrl(storagePath);

  return {
    publicUrl: pub.publicUrl,
    storagePath,
    contentType,
    bytes: buf.byteLength,
  };
}

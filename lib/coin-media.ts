import crypto from "node:crypto";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const types = new Map([
  ["image/png", "png"],
  ["image/jpeg", "jpg"],
  ["image/webp", "webp"],
]);

function sniff(bytes: Uint8Array, mime: string) {
  if (mime === "image/png") return bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
  if (mime === "image/jpeg") return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (mime === "image/webp") return bytes.length >= 12 && String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP";
  return false;
}

export async function uploadCoinImage(file: File, ownerKey: string) {
  if (!types.has(file.type)) throw new Error("Поддерживаются только PNG, JPG и WebP");
  if (file.size <= 0 || file.size > MAX_IMAGE_BYTES) throw new Error("Изображение должно быть меньше 2 МБ");
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!sniff(bytes, file.type)) throw new Error("Файл не соответствует заявленному формату изображения");

  const ext = types.get(file.type)!;
  const safeOwner = ownerKey.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 80) || "user";
  const path = `${safeOwner}/${crypto.randomUUID()}.${ext}`;
  const supabase = getSupabaseAdmin();
  const { error } = await supabase.storage.from("coin-media").upload(path, bytes, {
    contentType: file.type,
    cacheControl: "31536000",
    upsert: false,
  });
  if (error) throw error;
  const { data } = supabase.storage.from("coin-media").getPublicUrl(path);
  if (!data.publicUrl) {
    await supabase.storage.from("coin-media").remove([path]);
    throw new Error("Supabase не вернул URL изображения");
  }
  return { path, url: data.publicUrl };
}

export async function removeCoinImage(path: string | null | undefined) {
  if (!path) return;
  const supabase = getSupabaseAdmin();
  const { error } = await supabase.storage.from("coin-media").remove([path]);
  if (error) console.error("coin media cleanup", error);
}

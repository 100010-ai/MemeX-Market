import { gunzipSync } from "node:zlib";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export type TelegramSticker = {
  file_id: string;
  file_unique_id: string;
  width: number;
  height: number;
  is_animated: boolean;
  is_video: boolean;
  thumbnail?: { file_id: string; file_unique_id: string; width: number; height: number };
};

type UniqueGiftTrait = {
  name: string;
  sticker: TelegramSticker;
  rarity_per_mille: number;
  rarity?: string;
};

type TelegramUniqueGift = {
  gift_id?: string;
  base_name: string;
  name: string;
  number: number;
  model: UniqueGiftTrait;
  symbol: UniqueGiftTrait;
  backdrop: {
    name: string;
    rarity_per_mille: number;
    colors: {
      center_color: number;
      edge_color: number;
      symbol_color: number;
      text_color: number;
    };
  };
  is_premium?: true;
  is_from_blockchain?: true;
};

type TelegramOwnedGift =
  | { type: "unique"; gift: TelegramUniqueGift }
  | { type: "regular"; gift: unknown };

type OwnedGiftsResult = {
  total_count: number;
  gifts: TelegramOwnedGift[];
  next_offset?: string;
};

type TelegramApiEnvelope<T> = {
  ok: boolean;
  result?: T;
  description?: string;
};

function botToken() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN is not configured");
  return token;
}

async function telegramApi<T>(method: string, body: Record<string, unknown>): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  try {
    const response = await fetch(`https://api.telegram.org/bot${botToken()}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
      cache: "no-store",
    });
    const payload = (await response.json()) as TelegramApiEnvelope<T>;
    if (!response.ok || !payload.ok || payload.result === undefined) {
      throw new Error(payload.description || `Telegram ${method} failed`);
    }
    return payload.result;
  } finally {
    clearTimeout(timeout);
  }
}

function rarityMultiplier(perMille: number, rarity?: string) {
  if (perMille > 0) return Math.min(20, Math.max(1, 1000 / perMille));
  switch (rarity) {
    case "legendary": return 18;
    case "epic": return 10;
    case "rare": return 5;
    case "uncommon": return 2.5;
    default: return 1;
  }
}

function numberMultiplier(number: number) {
  const text = String(number);
  const palindrome = text === text.split("").reverse().join("");
  const sameDigits = /^([0-9])\1+$/.test(text);
  let result = number <= 10 ? 4 : number <= 100 ? 2.6 : number <= 1000 ? 1.65 : number <= 10_000 ? 1.18 : 1;
  if (palindrome) result *= 1.18;
  if (sameDigits) result *= 1.35;
  return result;
}

export function virtualReferencePrice(gift: TelegramUniqueGift) {
  const model = rarityMultiplier(gift.model.rarity_per_mille, gift.model.rarity);
  const symbol = rarityMultiplier(gift.symbol.rarity_per_mille, gift.symbol.rarity);
  const backdrop = rarityMultiplier(gift.backdrop.rarity_per_mille);
  const rarityScore = model * 0.5 + symbol * 0.25 + backdrop * 0.25;
  const raw = (35 + rarityScore * 16) * numberMultiplier(gift.number);
  return Math.round(Math.min(25_000, Math.max(25, raw)) * 100) / 100;
}

export async function syncTelegramGifts(profileId: string, telegramId: number) {
  const all: TelegramOwnedGift[] = [];
  let offset = "";

  for (let page = 0; page < 10; page += 1) {
    const result = await telegramApi<OwnedGiftsResult>("getUserGifts", {
      user_id: telegramId,
      exclude_unlimited: true,
      exclude_limited_upgradable: true,
      exclude_limited_non_upgradable: true,
      exclude_unique: false,
      offset,
      limit: 100,
    });
    all.push(...result.gifts);
    if (!result.next_offset) break;
    offset = result.next_offset;
  }

  const unique = all.filter((entry): entry is Extract<TelegramOwnedGift, { type: "unique" }> => entry.type === "unique");
  const supabase = getSupabaseAdmin();

  if (unique.length) {
    const rows = unique.map(({ gift }) => ({
      source: "telegram",
      telegram_name: gift.name,
      gift_id: gift.gift_id ?? null,
      base_name: gift.base_name,
      gift_number: gift.number,
      model_name: gift.model.name,
      model_rarity_per_mille: gift.model.rarity_per_mille ?? 0,
      model_rarity: gift.model.rarity ?? null,
      model_file_id: gift.model.sticker.file_id,
      model_thumb_file_id: gift.model.sticker.thumbnail?.file_id ?? null,
      model_is_animated: Boolean(gift.model.sticker.is_animated),
      model_is_video: Boolean(gift.model.sticker.is_video),
      symbol_name: gift.symbol.name,
      symbol_rarity_per_mille: gift.symbol.rarity_per_mille ?? 0,
      symbol_file_id: gift.symbol.sticker.file_id,
      symbol_thumb_file_id: gift.symbol.sticker.thumbnail?.file_id ?? null,
      backdrop_name: gift.backdrop.name,
      backdrop_rarity_per_mille: gift.backdrop.rarity_per_mille ?? 0,
      backdrop_center_color: gift.backdrop.colors.center_color,
      backdrop_edge_color: gift.backdrop.colors.edge_color,
      backdrop_symbol_color: gift.backdrop.colors.symbol_color,
      backdrop_text_color: gift.backdrop.colors.text_color,
      is_premium: Boolean(gift.is_premium),
      is_from_blockchain: Boolean(gift.is_from_blockchain),
      reference_price: virtualReferencePrice(gift),
      updated_at: new Date().toISOString(),
    }));

    const { error: assetError } = await supabase.from("gift_assets").upsert(rows, { onConflict: "telegram_name" });
    if (assetError) throw assetError;

    const names = rows.map((row) => row.telegram_name);
    const { data: assets, error: readError } = await supabase.from("gift_assets").select("id,telegram_name,reference_price").in("telegram_name", names);
    if (readError) throw readError;

    const virtualRows = (assets || []).map((asset) => ({
      asset_id: asset.id,
      source_owner_profile_id: profileId,
      owner_profile_id: profileId,
      acquired_price: Number(asset.reference_price || 0),
      last_sale_price: Number(asset.reference_price || 0),
      status: "owned",
    }));
    if (virtualRows.length) {
      const { error: virtualError } = await supabase.from("virtual_gifts").upsert(virtualRows, { onConflict: "asset_id", ignoreDuplicates: true });
      if (virtualError) throw virtualError;
    }
  }

  const now = new Date().toISOString();
  const { error: profileError } = await supabase.from("profiles").update({ last_gift_sync_at: now }).eq("id", profileId);
  if (profileError) throw profileError;
  const { error: missionError } = await supabase.rpc("bump_mission", { p_profile_id: profileId, p_action_type: "sync_gift", p_amount: 1 });
  if (missionError) throw missionError;

  return { totalHosted: all.length, uniqueImported: unique.length, syncedAt: now };
}

export async function isKnownGiftFile(fileId: string) {
  const supabase = getSupabaseAdmin();
  const fields = ["model_file_id", "model_thumb_file_id", "symbol_file_id", "symbol_thumb_file_id"] as const;
  for (const field of fields) {
    const { data } = await supabase.from("gift_assets").select("id").eq(field, fileId).limit(1).maybeSingle();
    if (data) return true;
  }
  return false;
}

export async function getTelegramFile(fileId: string) {
  const file = await telegramApi<{ file_id: string; file_unique_id: string; file_size?: number; file_path?: string }>("getFile", { file_id: fileId });
  if (!file.file_path) throw new Error("Telegram did not return file_path");
  const response = await fetch(`https://api.telegram.org/file/bot${botToken()}/${file.file_path}`, { cache: "force-cache" });
  if (!response.ok) throw new Error("Could not download Telegram file");
  return { response, filePath: file.file_path };
}

export async function getTelegramTgsJson(fileId: string) {
  const { response } = await getTelegramFile(fileId);
  const bytes = Buffer.from(await response.arrayBuffer());
  let jsonBytes = bytes;
  try {
    jsonBytes = gunzipSync(bytes);
  } catch {
    // Some proxies/files may already be plain Lottie JSON.
  }
  return JSON.parse(jsonBytes.toString("utf8")) as Record<string, unknown>;
}

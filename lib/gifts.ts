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
  gift_id: string;
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
  is_burned?: true;
  is_from_blockchain?: true;
  colors?: Record<string, unknown>;
  publisher_chat?: Record<string, unknown>;
};

type TelegramOwnedGift =
  | { type: "unique"; gift: TelegramUniqueGift; owned_gift_id?: string; send_date: number }
  | { type: "regular"; gift: unknown; send_date: number };

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

const knownFileCache = new Map<string, { ok: boolean; expiresAt: number }>();
const telegramPathCache = new Map<string, { path: string; size: number | null; expiresAt: number }>();
const tgsJsonCache = new Map<string, { data: Record<string, unknown>; expiresAt: number }>();

export type GiftSyncResult = {
  runId: string;
  pagesFetched: number;
  totalHosted: number;
  uniqueReceived: number;
  uniqueImported: number;
  assetsUpdated: number;
  virtualCreated: number;
  syncedAt: string;
};

function botToken() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN is not configured");
  return token;
}

async function telegramApi<T>(method: string, body: Record<string, unknown>): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
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

function assertSticker(sticker: TelegramSticker | undefined, label: string) {
  if (!sticker?.file_id || !sticker.file_unique_id) throw new Error(`${label} has no Telegram sticker identity`);
  if (!Number.isInteger(sticker.width) || sticker.width <= 0 || !Number.isInteger(sticker.height) || sticker.height <= 0) {
    throw new Error(`${label} has invalid Telegram sticker dimensions`);
  }
  if (sticker.is_animated && sticker.is_video) throw new Error(`${label} cannot be both animated and video`);
}

function assertRarity(value: unknown, label: string) {
  if (!Number.isInteger(value) || Number(value) < 0 || Number(value) > 1000) throw new Error(`${label} rarity_per_mille is invalid`);
}

function assertUniqueGift(gift: TelegramUniqueGift) {
  if (!gift.gift_id || !gift.name || !gift.base_name || !Number.isInteger(gift.number) || gift.number <= 0) {
    throw new Error("Telegram returned an invalid unique gift identity");
  }
  if (!gift.model?.name) throw new Error(`Telegram gift ${gift.name} has no model name`);
  if (!gift.symbol?.name) throw new Error(`Telegram gift ${gift.name} has no symbol name`);
  assertSticker(gift.model.sticker, `Telegram gift ${gift.name} model`);
  assertSticker(gift.symbol.sticker, `Telegram gift ${gift.name} symbol`);
  assertRarity(gift.model.rarity_per_mille, `Telegram gift ${gift.name} model`);
  assertRarity(gift.symbol.rarity_per_mille, `Telegram gift ${gift.name} symbol`);
  assertRarity(gift.backdrop?.rarity_per_mille, `Telegram gift ${gift.name} backdrop`);

  const colors = gift.backdrop?.colors;
  if (!gift.backdrop?.name || !colors) throw new Error(`Telegram gift ${gift.name} has no backdrop metadata`);
  for (const value of [colors.center_color, colors.edge_color, colors.symbol_color, colors.text_color]) {
    if (!Number.isInteger(value) || value < 0 || value > 0xffffff) throw new Error(`Telegram gift ${gift.name} contains an invalid backdrop color`);
  }
}

function assertNoSourceConflicts(entries: Extract<TelegramOwnedGift, { type: "unique" }>[]) {
  const names = new Map<string, string>();
  const numbers = new Map<string, string>();
  for (const { gift } of entries) {
    const identity = `${gift.base_name}#${gift.number}`;
    const existingByName = names.get(gift.name);
    if (existingByName && existingByName !== identity) throw new Error(`Telegram returned conflicting identity for ${gift.name}`);
    names.set(gift.name, identity);

    const numberKey = `${gift.base_name}\u0000${gift.number}`;
    const existingByNumber = numbers.get(numberKey);
    if (existingByNumber && existingByNumber !== gift.name) throw new Error(`Telegram returned conflicting unique name for ${identity}`);
    numbers.set(numberKey, gift.name);
  }
}

async function markSyncFailed(runId: string, error: unknown) {
  const supabase = getSupabaseAdmin();
  const message = error instanceof Error ? error.message : "Gift sync failed";
  const { error: updateError } = await supabase
    .from("gift_sync_runs")
    .update({ status: "failed", error_message: message.slice(0, 2000), finished_at: new Date().toISOString() })
    .eq("id", runId);
  if (updateError) console.error("gift sync failure log", updateError);
}

export async function syncTelegramGifts(profileId: string, telegramId: number): Promise<GiftSyncResult> {
  const supabase = getSupabaseAdmin();
  const { data: run, error: runError } = await supabase
    .from("gift_sync_runs")
    .insert({ profile_id: profileId, telegram_id: telegramId, status: "running" })
    .select("id")
    .single();
  if (runError || !run) throw runError || new Error("Could not start Gift sync diagnostics");
  const runId = String(run.id);

  try {
    const all: TelegramOwnedGift[] = [];
    let offset = "";
    let pagesFetched = 0;
    let expectedTotal: number | null = null;

    for (let page = 0; page < 100; page += 1) {
      const result = await telegramApi<OwnedGiftsResult>("getUserGifts", {
        user_id: telegramId,
        exclude_unlimited: true,
        exclude_limited_upgradable: true,
        exclude_limited_non_upgradable: true,
        exclude_unique: false,
        offset,
        limit: 100,
      });
      pagesFetched += 1;
      if (!Number.isInteger(result.total_count) || result.total_count < 0) throw new Error("Telegram returned an invalid gift count");
      if (expectedTotal === null) expectedTotal = result.total_count;
      else if (expectedTotal !== result.total_count) throw new Error("Telegram Gift collection changed during sync; retry the sync");
      if (!Array.isArray(result.gifts)) throw new Error("Telegram returned an invalid gifts payload");
      all.push(...result.gifts);
      if (!result.next_offset) break;
      offset = result.next_offset;
      if (page === 99) throw new Error("Telegram Gift collection exceeds the supported sync window");
    }

    const unique = all.filter((entry): entry is Extract<TelegramOwnedGift, { type: "unique" }> => entry.type === "unique");
    unique.forEach(({ gift }) => assertUniqueGift(gift));
    assertNoSourceConflicts(unique);

    const seenNames = [...new Set(unique.map(({ gift }) => gift.name))];
    const beforeResult = seenNames.length
      ? await supabase.from("gift_assets").select("id,telegram_name").in("telegram_name", seenNames)
      : { data: [] as Array<{ id: string; telegram_name: string }>, error: null };
    if (beforeResult.error) throw beforeResult.error;
    const existingNames = new Set((beforeResult.data || []).map((row) => String(row.telegram_name)));

    const now = new Date().toISOString();
    const rows = unique.map(({ gift }) => ({
      telegram_name: gift.name,
      gift_id: gift.gift_id,
      base_name: gift.base_name,
      gift_number: gift.number,
      model_name: gift.model.name,
      model_rarity_per_mille: gift.model.rarity_per_mille,
      model_rarity: gift.model.rarity ?? null,
      model_file_id: gift.model.sticker.file_id,
      model_thumb_file_id: gift.model.sticker.thumbnail?.file_id ?? null,
      model_is_animated: Boolean(gift.model.sticker.is_animated),
      model_is_video: Boolean(gift.model.sticker.is_video),
      symbol_name: gift.symbol.name,
      symbol_rarity_per_mille: gift.symbol.rarity_per_mille,
      symbol_file_id: gift.symbol.sticker.file_id,
      symbol_thumb_file_id: gift.symbol.sticker.thumbnail?.file_id ?? null,
      symbol_is_animated: Boolean(gift.symbol.sticker.is_animated),
      symbol_is_video: Boolean(gift.symbol.sticker.is_video),
      backdrop_name: gift.backdrop.name,
      backdrop_rarity_per_mille: gift.backdrop.rarity_per_mille,
      backdrop_center_color: gift.backdrop.colors.center_color,
      backdrop_edge_color: gift.backdrop.colors.edge_color,
      backdrop_symbol_color: gift.backdrop.colors.symbol_color,
      backdrop_text_color: gift.backdrop.colors.text_color,
      is_premium: Boolean(gift.is_premium),
      is_burned: Boolean(gift.is_burned),
      is_from_blockchain: Boolean(gift.is_from_blockchain),
      telegram_payload: gift,
      last_seen_at: now,
      updated_at: now,
    }));

    if (rows.length) {
      const { error: assetError } = await supabase.from("gift_assets").upsert(rows, { onConflict: "telegram_name" });
      if (assetError) throw assetError;
    }

    const assetsResult = seenNames.length
      ? await supabase.from("gift_assets").select("id,telegram_name,is_burned").in("telegram_name", seenNames)
      : { data: [] as Array<{ id: string; telegram_name: string; is_burned: boolean }>, error: null };
    if (assetsResult.error) throw assetsResult.error;
    if ((assetsResult.data || []).length !== seenNames.length) throw new Error("Supabase did not return every synced Telegram Gift asset");

    const assets = assetsResult.data || [];
    const burnedAssetIds = assets.filter((asset) => asset.is_burned).map((asset) => String(asset.id));
    if (burnedAssetIds.length) {
      const burnedVirtualResult = await supabase.from("virtual_gifts").select("id").in("asset_id", burnedAssetIds);
      if (burnedVirtualResult.error) throw burnedVirtualResult.error;
      const burnedVirtualIds = (burnedVirtualResult.data || []).map((row) => String(row.id));
      const { error: burnedError } = await supabase
        .from("virtual_gifts")
        .update({ status: "owned", listing_price: null })
        .in("asset_id", burnedAssetIds);
      if (burnedError) throw burnedError;
      if (burnedVirtualIds.length) {
        const { error: burnedOfferError } = await supabase
          .from("gift_offers")
          .update({ status: "rejected" })
          .in("virtual_gift_id", burnedVirtualIds)
          .eq("status", "pending");
        if (burnedOfferError) throw burnedOfferError;
      }
    }
    const tradeableAssets = assets.filter((asset) => !asset.is_burned);
    const assetIds = tradeableAssets.map((asset) => String(asset.id));
    const existingVirtualResult = assetIds.length
      ? await supabase.from("virtual_gifts").select("asset_id").in("asset_id", assetIds)
      : { data: [] as Array<{ asset_id: string }>, error: null };
    if (existingVirtualResult.error) throw existingVirtualResult.error;
    const existingVirtualIds = new Set((existingVirtualResult.data || []).map((row) => String(row.asset_id)));
    const missingVirtualRows = tradeableAssets
      .filter((asset) => !existingVirtualIds.has(String(asset.id)))
      .map((asset) => ({ asset_id: asset.id, source_owner_profile_id: profileId, owner_profile_id: profileId, acquired_price: 0, status: "owned" }));

    if (missingVirtualRows.length) {
      const { error: virtualInsertError } = await supabase.from("virtual_gifts").insert(missingVirtualRows);
      if (virtualInsertError) throw virtualInsertError;
    }
    if (assetIds.length) {
      const { error: sourceOwnerError } = await supabase
        .from("virtual_gifts")
        .update({ source_owner_profile_id: profileId })
        .in("asset_id", assetIds);
      if (sourceOwnerError) throw sourceOwnerError;
    }

    const { error: profileError } = await supabase.from("profiles").update({ last_gift_sync_at: now }).eq("id", profileId);
    if (profileError) throw profileError;
    const { error: missionError } = await supabase.rpc("bump_mission", { p_profile_id: profileId, p_action_type: "sync_gift", p_amount: 1 });
    if (missionError) throw missionError;

    const uniqueImported = tradeableAssets.length;
    const assetsUpdated = rows.filter((row) => existingNames.has(row.telegram_name)).length;
    const { error: finishError } = await supabase
      .from("gift_sync_runs")
      .update({
        status: "succeeded",
        pages_fetched: pagesFetched,
        telegram_total_count: expectedTotal ?? 0,
        unique_received: unique.length,
        unique_imported: uniqueImported,
        assets_updated: assetsUpdated,
        virtual_created: missingVirtualRows.length,
        finished_at: now,
      })
      .eq("id", runId);
    if (finishError) throw finishError;

    return {
      runId,
      pagesFetched,
      totalHosted: expectedTotal ?? 0,
      uniqueReceived: unique.length,
      uniqueImported,
      assetsUpdated,
      virtualCreated: missingVirtualRows.length,
      syncedAt: now,
    };
  } catch (error) {
    await markSyncFailed(runId, error);
    throw error;
  }
}

export async function isKnownGiftFile(fileId: string) {
  const cached = knownFileCache.get(fileId);
  if (cached && cached.expiresAt > Date.now()) return cached.ok;
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.rpc("is_known_gift_file", { p_file_id: fileId });
  if (error) throw error;
  const ok = data === true;
  knownFileCache.set(fileId, { ok, expiresAt: Date.now() + 10 * 60_000 });
  if (knownFileCache.size > 2000) knownFileCache.delete(knownFileCache.keys().next().value as string);
  return ok;
}

export async function getTelegramFile(fileId: string) {
  let filePath: string;
  let fileSize: number | null = null;
  const cached = telegramPathCache.get(fileId);
  if (cached && cached.expiresAt > Date.now()) {
    filePath = cached.path;
    fileSize = cached.size;
  } else {
    const file = await telegramApi<{ file_id: string; file_unique_id: string; file_size?: number; file_path?: string }>("getFile", { file_id: fileId });
    if (!file.file_path) throw new Error("Telegram did not return file_path");
    filePath = file.file_path;
    fileSize = file.file_size ?? null;
    telegramPathCache.set(fileId, { path: filePath, size: fileSize, expiresAt: Date.now() + 45 * 60_000 });
    if (telegramPathCache.size > 1000) telegramPathCache.delete(telegramPathCache.keys().next().value as string);
  }
  const response = await fetch(`https://api.telegram.org/file/bot${botToken()}/${filePath}`, { cache: "force-cache" });
  if (!response.ok) throw new Error(`Telegram file download failed (${response.status})`);
  return { response, filePath, fileSize };
}

export async function getTelegramTgsJson(fileId: string) {
  const cached = tgsJsonCache.get(fileId);
  if (cached && cached.expiresAt > Date.now()) return cached.data;
  const { response } = await getTelegramFile(fileId);
  const bytes = Buffer.from(await response.arrayBuffer());
  const isGzip = bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
  const jsonBytes = isGzip ? gunzipSync(bytes) : bytes;
  const parsed = JSON.parse(jsonBytes.toString("utf8"));
  if (!parsed || typeof parsed !== "object") throw new Error("Telegram TGS did not contain Lottie JSON");
  const data = parsed as Record<string, unknown>;
  tgsJsonCache.set(fileId, { data, expiresAt: Date.now() + 6 * 60 * 60_000 });
  if (tgsJsonCache.size > 300) tgsJsonCache.delete(tgsJsonCache.keys().next().value as string);
  return data;
}

import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { apiFailure, readJsonObject, withApiErrors } from "@/lib/api-route";
import { getControlSession, requireLocalControl } from "@/lib/local-admin";
import { sameOriginMutation } from "@/lib/security";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { telegramBotApi } from "@/lib/telegram-bot";

export const runtime = "nodejs";
const BATCH_SIZE = 20;
const BATCH_LEASE_SECONDS = 300;

type ButtonInput = { text: string; url: string };
type MessageInput = {
  message: string;
  parseMode: "MarkdownV2" | "HTML" | null;
  attachmentType: "none" | "photo" | "document";
  attachmentUrl: string | null;
  buttons: ButtonInput[];
  linkPreview: boolean;
};

function text(value: unknown, max = 4096) { return String(value ?? "").trim().slice(0, max); }
function adminIds() { return String(process.env.ADMIN_TELEGRAM_IDS || "").split(",").map(v => v.trim()).filter(v => /^\d{4,20}$/.test(v)); }
function defaultChannel() {
  const value = String(process.env.TELEGRAM_MAIN_CHANNEL_USERNAME || "").trim().replace(/^@/, "");
  return value ? `@${value}` : "";
}
function sleep(ms: number) { return new Promise(resolve => setTimeout(resolve, ms)); }
function parseButtons(value: unknown): ButtonInput[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 8).flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const row = item as Record<string, unknown>;
    const label = text(row.text, 40);
    const url = text(row.url, 500);
    if (!label || !/^https:\/\//i.test(url)) return [];
    return [{ text: label, url }];
  });
}
function parseMessageInput(body: Record<string, unknown>): MessageInput {
  const attachmentType = body.attachmentType === "photo" || body.attachmentType === "document" ? body.attachmentType : "none";
  const attachmentUrl = attachmentType === "none" ? null : text(body.attachmentUrl, 1500) || null;
  const maxText = attachmentType === "none" ? 4096 : 1024;
  const message = text(body.message, maxText);
  const parseMode = body.parseMode === "MarkdownV2" || body.parseMode === "HTML" ? body.parseMode : null;
  const buttons = parseButtons(body.buttons);
  const linkPreview = body.linkPreview !== false;
  if (!message && !attachmentUrl) throw new Error("Добавьте текст или вложение");
  if (attachmentType !== "none" && !attachmentUrl) throw new Error("Для вложения нужен URL файла");
  if (attachmentUrl && !/^https:\/\//i.test(attachmentUrl)) throw new Error("URL вложения должен начинаться с https://");
  return { message, parseMode, attachmentType, attachmentUrl, buttons, linkPreview };
}
function replyMarkup(buttons: ButtonInput[]) {
  if (!buttons.length) return undefined;
  const rows: ButtonInput[][] = [];
  for (let i = 0; i < buttons.length; i += 2) rows.push(buttons.slice(i, i + 2));
  return { inline_keyboard: rows };
}
async function sendContent(chatId: string | number, input: MessageInput) {
  const common: Record<string, unknown> = {
    chat_id: chatId,
    reply_markup: replyMarkup(input.buttons),
  };
  if (input.parseMode) common.parse_mode = input.parseMode;
  if (input.attachmentType === "photo") {
    return telegramBotApi("sendPhoto", { ...common, photo: input.attachmentUrl, caption: input.message || undefined });
  }
  if (input.attachmentType === "document") {
    return telegramBotApi("sendDocument", { ...common, document: input.attachmentUrl, caption: input.message || undefined });
  }
  return telegramBotApi("sendMessage", {
    ...common,
    text: input.message,
    link_preview_options: { is_disabled: !input.linkPreview },
  });
}
async function audit(actor: string | null, action: string, targetId?: string, payload: Record<string, unknown> = {}) {
  const { error } = await getSupabaseAdmin().from("admin_audit_log").insert({
    actor: actor ? `control:${actor}` : "control",
    action,
    target_type: "broadcast",
    target_id: targetId || null,
    payload,
  });
  if (error) console.error("control broadcast audit", error);
}
function campaignInput(row: Record<string, unknown>): MessageInput {
  return {
    message: String(row.message || ""),
    parseMode: row.parse_mode === "MarkdownV2" || row.parse_mode === "HTML" ? row.parse_mode : null,
    attachmentType: row.attachment_type === "photo" || row.attachment_type === "document" ? row.attachment_type : "none",
    attachmentUrl: row.attachment_url ? String(row.attachment_url) : null,
    buttons: parseButtons(row.buttons),
    linkPreview: row.link_preview !== false,
  };
}
function validUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

async function GETHandler(request: NextRequest) {
  if (!(await requireLocalControl(request))) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const supabase = getSupabaseAdmin();
  const campaigns = await supabase
    .from("control_broadcasts_v210")
    .select("id,actor_telegram_id,audience,segment,channel_target,message,parse_mode,attachment_type,attachment_url,buttons,link_preview,status,total_recipients,sent_count,failed_count,skipped_count,last_error,started_at,finished_at,created_at,updated_at")
    .order("created_at", { ascending: false })
    .limit(40);
  if (campaigns.error) return apiFailure(campaigns.error, "Не удалось загрузить рассылки");
  const session = await getControlSession(request);
  return NextResponse.json({
    campaigns: campaigns.data || [],
    defaultChannel: defaultChannel(),
    adminTelegramId: session?.mode === "telegram" ? session.telegramId : adminIds()[0] || null,
    batchSize: BATCH_SIZE,
  }, { headers: { "cache-control": "private, no-store" } });
}

async function POSTHandler(request: NextRequest) {
  if (!(await requireLocalControl(request))) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!sameOriginMutation(request)) return NextResponse.json({ error: "Недопустимый источник запроса" }, { status: 403 });
  const body = await readJsonObject(request);
  if (!body) return NextResponse.json({ error: "Некорректный JSON" }, { status: 400 });
  const action = text(body.action, 40);
  const session = await getControlSession(request);
  const actor = session?.mode === "telegram" ? session.telegramId : adminIds()[0] || null;
  const supabase = getSupabaseAdmin();

  try {
    if (action === "test") {
      const target = actor;
      if (!target) return NextResponse.json({ error: "Не найден Telegram ID администратора" }, { status: 400 });
      const input = parseMessageInput(body);
      await sendContent(target, input);
      await audit(actor, "broadcast.test", undefined, { attachmentType: input.attachmentType, parseMode: input.parseMode });
      return NextResponse.json({ ok: true });
    }

    if (action === "channel") {
      const input = parseMessageInput(body);
      const channel = text(body.channel, 200) || defaultChannel();
      if (!channel) return NextResponse.json({ error: "Укажите канал" }, { status: 400 });

      const saved = await supabase.from("control_broadcasts_v210").insert({
        actor_telegram_id: actor ? Number(actor) : null,
        audience: "channel",
        segment: "channel",
        channel_target: channel,
        message: input.message,
        parse_mode: input.parseMode,
        attachment_type: input.attachmentType,
        attachment_url: input.attachmentUrl,
        buttons: input.buttons,
        link_preview: input.linkPreview,
        status: "sending",
        total_recipients: 1,
        started_at: new Date().toISOString(),
      }).select("id").single();
      if (saved.error) throw saved.error;

      try {
        await sendContent(channel, input);
        const completedAt = new Date().toISOString();
        const completed = await supabase.from("control_broadcasts_v210").update({
          status: "completed",
          sent_count: 1,
          finished_at: completedAt,
          updated_at: completedAt,
        }).eq("id", saved.data.id);
        if (completed.error) throw completed.error;
      } catch (error) {
        const failedAt = new Date().toISOString();
        await supabase.from("control_broadcasts_v210").update({
          status: "failed",
          failed_count: 1,
          last_error: error instanceof Error ? error.message.slice(0, 1000) : "Telegram send failed",
          finished_at: failedAt,
          updated_at: failedAt,
        }).eq("id", saved.data.id);
        throw error;
      }

      await audit(actor, "broadcast.channel", String(saved.data.id), { channel, attachmentType: input.attachmentType });
      return NextResponse.json({ ok: true, id: saved.data.id });
    }

    if (action === "start") {
      const input = parseMessageInput(body);
      const segment = body.segment === "premium" || body.segment === "donors" || body.segment === "manual" ? body.segment : "all";
      const manualIds = segment === "manual"
        ? Array.from(new Set((Array.isArray(body.manualRecipientIds) ? body.manualRecipientIds : String(body.manualRecipientIds || "").split(/[\s,;]+/))
          .map((value) => String(value).trim())
          .filter((value) => /^\d{4,20}$/.test(value))))
          .slice(0, 5000)
          .map(Number)
        : [];
      if (segment === "manual" && !manualIds.length) return NextResponse.json({ error: "Добавьте Telegram ID получателей" }, { status: 400 });

      let total = manualIds.length;
      if (segment !== "manual") {
        let countQuery: any = supabase.from("profiles").select("*", { count: "exact", head: true }).eq("is_system", false).eq("is_banned", false);
        if (segment === "premium") countQuery = countQuery.gt("premium_until", new Date().toISOString());
        if (segment === "donors") countQuery = countQuery.gt("stars_spent", 0);
        const countResult = await countQuery;
        if (countResult.error) throw countResult.error;
        total = Number(countResult.count || 0);
      }

      const created = await supabase.from("control_broadcasts_v210").insert({
        actor_telegram_id: actor ? Number(actor) : null,
        audience: "players",
        segment,
        manual_recipient_ids: manualIds,
        message: input.message,
        parse_mode: input.parseMode,
        attachment_type: input.attachmentType,
        attachment_url: input.attachmentUrl,
        buttons: input.buttons,
        link_preview: input.linkPreview,
        status: total ? "sending" : "completed",
        total_recipients: total,
        started_at: new Date().toISOString(),
        finished_at: total ? null : new Date().toISOString(),
      }).select("id,status,total_recipients").single();
      if (created.error) throw created.error;
      await audit(actor, "broadcast.start", String(created.data.id), { segment, total, attachmentType: input.attachmentType, parseMode: input.parseMode });
      return NextResponse.json({ ok: true, campaign: created.data });
    }

    if (action === "cancel") {
      const id = text(body.id, 80);
      if (!validUuid(id)) return NextResponse.json({ error: "Некорректный ID рассылки" }, { status: 400 });
      const result = await supabase.from("control_broadcasts_v210").update({
        status: "cancelled",
        finished_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        batch_lock_token: null,
        batch_lock_until: null,
      }).eq("id", id).in("status", ["queued", "sending"]);
      if (result.error) throw result.error;
      await audit(actor, "broadcast.cancel", id);
      return NextResponse.json({ ok: true });
    }

    if (action === "batch") {
      const id = text(body.id, 80);
      if (!validUuid(id)) return NextResponse.json({ error: "Некорректный ID рассылки" }, { status: 400 });
      const lockToken = crypto.randomUUID();
      const claim = await supabase.rpc("claim_control_broadcast_batch_v211", {
        p_id: id,
        p_lock_token: lockToken,
        p_lock_seconds: BATCH_LEASE_SECONDS,
      });
      if (claim.error) throw claim.error;
      const claimedRows = Array.isArray(claim.data) ? claim.data : claim.data ? [claim.data] : [];
      if (!claimedRows.length) {
        const current = await supabase.from("control_broadcasts_v210")
          .select("id,status,total_recipients,sent_count,failed_count,skipped_count,last_error,updated_at,finished_at")
          .eq("id", id)
          .maybeSingle();
        if (current.error) throw current.error;
        if (!current.data) return NextResponse.json({ error: "Рассылка не найдена" }, { status: 404 });
        return NextResponse.json({ ok: true, campaign: current.data, processed: 0, leased: false });
      }

      const row = claimedRows[0] as Record<string, any>;
      const input = campaignInput(row);
      let recipients: number[] = [];
      let nextOffset = Number(row.last_offset || 0);
      let nextTelegramId = row.last_telegram_id == null ? null : Number(row.last_telegram_id);

      if (row.segment === "manual") {
        const ids = Array.isArray(row.manual_recipient_ids) ? row.manual_recipient_ids.map(Number).filter(Number.isFinite) : [];
        recipients = ids.slice(nextOffset, nextOffset + BATCH_SIZE);
        nextOffset += recipients.length;
      } else {
        let query: any = supabase
          .from("profiles")
          .select("telegram_id")
          .eq("is_system", false)
          .eq("is_banned", false)
          .order("telegram_id", { ascending: true })
          .limit(BATCH_SIZE);
        if (nextTelegramId != null) query = query.gt("telegram_id", nextTelegramId);
        if (row.segment === "premium") query = query.gt("premium_until", new Date().toISOString());
        if (row.segment === "donors") query = query.gt("stars_spent", 0);
        const page = await query;
        if (page.error) throw page.error;
        recipients = (page.data || []).map((item: { telegram_id: number }) => Number(item.telegram_id)).filter(Number.isFinite);
        if (recipients.length) nextTelegramId = recipients[recipients.length - 1];
      }

      let sent = 0;
      let failed = 0;
      let lastError: string | null = null;
      for (let i = 0; i < recipients.length; i += 4) {
        const group = recipients.slice(i, i + 4);
        const results = await Promise.all(group.map(async (telegramId) => {
          try {
            await sendContent(telegramId, input);
            return { ok: true as const };
          } catch (error) {
            return { ok: false as const, error: error instanceof Error ? error.message : "Telegram send failed" };
          }
        }));
        for (const result of results) {
          if (result.ok) sent += 1;
          else { failed += 1; lastError = result.error; }
        }
        if (i + 4 < recipients.length) await sleep(220);
      }

      const sentTotal = Number(row.sent_count || 0) + sent;
      const failedTotal = Number(row.failed_count || 0) + failed;
      const processed = sentTotal + failedTotal + Number(row.skipped_count || 0);
      const exhausted = recipients.length < BATCH_SIZE || processed >= Number(row.total_recipients || 0);
      const status = exhausted ? (failedTotal > 0 ? "partial" : "completed") : "sending";
      const update = await supabase.from("control_broadcasts_v210").update({
        status,
        sent_count: sentTotal,
        failed_count: failedTotal,
        last_telegram_id: nextTelegramId,
        last_offset: nextOffset,
        last_error: lastError,
        finished_at: exhausted ? new Date().toISOString() : null,
        updated_at: new Date().toISOString(),
        batch_lock_token: null,
        batch_lock_until: null,
      }).eq("id", id).eq("status", "sending").eq("batch_lock_token", lockToken)
        .select("id,status,total_recipients,sent_count,failed_count,skipped_count,last_error,updated_at,finished_at")
        .maybeSingle();
      if (update.error) throw update.error;
      if (!update.data) {
        const current = await supabase.from("control_broadcasts_v210")
          .select("id,status,total_recipients,sent_count,failed_count,skipped_count,last_error,updated_at,finished_at")
          .eq("id", id)
          .single();
        if (current.error) throw current.error;
        return NextResponse.json({ ok: true, campaign: current.data, processed: recipients.length, leased: true, finalized: false });
      }
      return NextResponse.json({ ok: true, campaign: update.data, processed: recipients.length, leased: true, finalized: true });
    }

    return NextResponse.json({ error: "Неизвестная операция рассылки" }, { status: 400 });
  } catch (error) {
    return apiFailure(error, "Операция рассылки не выполнена", 400);
  }
}

export const GET = withApiErrors("app/api/control/broadcasts/route.ts:GET", GETHandler);
export const POST = withApiErrors("app/api/control/broadcasts/route.ts:POST", POSTHandler);

import { NextResponse } from "next/server";
import { requireProfile } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { enforceRateLimit, sameOriginMutation, validUuidLike } from "@/lib/security";
import { normalizeSponsoredUrl, telegramChatIdFrom, verifyTelegramMembership } from "@/lib/sponsored-tasks";

export const runtime = "nodejs";

function missingSponsoredSchema(error: { code?: string; message?: string } | null | undefined) {
  return Boolean(error && (error.code === "42P01" || /sponsored_campaigns|sponsored_task_claims|schema cache/i.test(error.message || "")));
}

export async function POST(request: Request) {
  const profile = await requireProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!sameOriginMutation(request)) return NextResponse.json({ error: "Недопустимый источник запроса" }, { status: 403 });
  if (!(await enforceRateLimit(request, "sponsored-task", String(profile.id), 40, 60))) {
    return NextResponse.json({ error: "Слишком много проверок. Подождите немного." }, { status: 429 });
  }

  const body = await request.json().catch(() => ({}));
  const campaignId = String(body.campaignId || "").trim();
  const action = String(body.action || "").trim();
  if (!validUuidLike(campaignId)) return NextResponse.json({ error: "Некорректное задание" }, { status: 400 });

  const supabase = getSupabaseAdmin();
  const campaignResult = await supabase
    .from("sponsored_campaigns")
    .select("id,title,verification_type,target_url,telegram_chat_id,status,starts_at,ends_at,max_completions,completed_count,reward")
    .eq("id", campaignId)
    .maybeSingle();
  if (missingSponsoredSchema(campaignResult.error)) return NextResponse.json({ error: "Партнёрские задания ещё не настроены" }, { status: 503 });
  if (campaignResult.error) return NextResponse.json({ error: campaignResult.error.message }, { status: 500 });
  const campaign = campaignResult.data;
  if (!campaign) return NextResponse.json({ error: "Задание не найдено" }, { status: 404 });

  const now = Date.now();
  if (campaign.status !== "active" || (campaign.starts_at && new Date(campaign.starts_at).getTime() > now) || (campaign.ends_at && new Date(campaign.ends_at).getTime() <= now) || Number(campaign.completed_count) >= Number(campaign.max_completions)) {
    return NextResponse.json({ error: "Задание сейчас недоступно" }, { status: 409 });
  }

  const existing = await supabase.from("sponsored_task_claims").select("id,status,opened_at").eq("campaign_id", campaignId).eq("profile_id", profile.id).maybeSingle();
  if (existing.error) return NextResponse.json({ error: existing.error.message }, { status: 500 });
  if (existing.data?.status === "claimed") return NextResponse.json({ claimed: true, alreadyClaimed: true });

  if (action === "open") {
    const targetUrl = normalizeSponsoredUrl(campaign.target_url);
    if (!existing.data) {
      const inserted = await supabase.from("sponsored_task_claims").insert({ campaign_id: campaignId, profile_id: profile.id, status: "opened", opened_at: new Date().toISOString() });
      if (inserted.error) return NextResponse.json({ error: inserted.error.message }, { status: 500 });
    } else if (existing.data.status === "rejected") {
      const reset = await supabase.from("sponsored_task_claims").update({ status: "opened", opened_at: new Date().toISOString(), submitted_at: null, reviewed_by: null, updated_at: new Date().toISOString() }).eq("id", existing.data.id);
      if (reset.error) return NextResponse.json({ error: reset.error.message }, { status: 500 });
    } else if (!existing.data.opened_at) {
      await supabase.from("sponsored_task_claims").update({ opened_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", existing.data.id);
    }
    return NextResponse.json({ ok: true, targetUrl });
  }

  if (action !== "verify") return NextResponse.json({ error: "Неизвестное действие" }, { status: 400 });

  if (campaign.verification_type === "manual") {
    if (!existing.data) {
      const inserted = await supabase.from("sponsored_task_claims").insert({ campaign_id: campaignId, profile_id: profile.id, status: "pending", opened_at: new Date().toISOString(), submitted_at: new Date().toISOString() });
      if (inserted.error) return NextResponse.json({ error: inserted.error.message }, { status: 500 });
    } else {
      const updated = await supabase.from("sponsored_task_claims").update({ status: "pending", submitted_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", existing.data.id);
      if (updated.error) return NextResponse.json({ error: updated.error.message }, { status: 500 });
    }
    return NextResponse.json({ ok: true, pending: true });
  }

  if (campaign.verification_type === "telegram_membership") {
    const chatId = telegramChatIdFrom(campaign.telegram_chat_id, campaign.target_url);
    if (!chatId) return NextResponse.json({ error: "Для задания не настроен Telegram-канал" }, { status: 500 });
    try {
      const joined = await verifyTelegramMembership(chatId, Number(profile.telegram_id));
      if (!joined) return NextResponse.json({ error: "Подписка пока не найдена. Подпишитесь и нажмите «Проверить» ещё раз." }, { status: 409 });
    } catch (error) {
      return NextResponse.json({ error: error instanceof Error ? error.message : "Не удалось проверить подписку" }, { status: 502 });
    }
  }

  if (campaign.verification_type === "link_visit") {
    const openedAt = existing.data?.opened_at ? new Date(existing.data.opened_at).getTime() : 0;
    if (!openedAt) return NextResponse.json({ error: "Сначала откройте ссылку задания" }, { status: 409 });
    if (Date.now() - openedAt < 3000) return NextResponse.json({ error: "Вернитесь к проверке через несколько секунд" }, { status: 409 });
  }

  const source = campaign.verification_type === "telegram_membership" ? "telegram_membership" : "link_visit";
  const claimed = await supabase.rpc("claim_sponsored_campaign_v047", { p_profile_id: profile.id, p_campaign_id: campaignId, p_verification_source: source });
  if (claimed.error) return NextResponse.json({ error: claimed.error.message }, { status: 400 });
  return NextResponse.json({ ok: true, claimed: true, result: claimed.data });
}

import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const aiPath = path.join(root, "lib", "telegram-ai.ts");
const webhookPath = path.join(root, "app", "api", "telegram", "webhook", "route.ts");

let source = fs.readFileSync(aiPath, "utf8");

const promptPattern = /const TELEGRAM_INLINE_MARKDOWN_PROMPT = \[[\s\S]*?\]\.join\("\\n"\);/;
if (!promptPattern.test(source)) throw new Error("MemeX inline stream patch failed: official inline prompt not found");
source = source.replace(promptPattern, `const TELEGRAM_INLINE_MARKDOWN_PROMPT = [
  "INLINE РЕЖИМ MEMEX:",
  "это отдельный официальный режим вопросов через @MemeXMarketBot в строке ввода Telegram",
  "полностью отключи разговорный персонаж обычного Мемекса",
  "пиши как нейтральный профессиональный помощник: грамотно ясно спокойно и по существу",
  "обязательно используй нормальную пунктуацию и заглавные буквы",
  "НЕ используй мат сленг брат бро хз че ща подколы мемные формулировки или нарочитые ошибки",
  "не изображай человека из чата и не добавляй характер обычного Мемекса",
  "на простой вопрос дай короткий точный ответ на сложный дай структурированное объяснение",
  "если факт неизвестен или зависит от актуальных данных прямо обозначь неопределенность и не выдумывай",
  "MemeX Market это Telegram Mini App с виртуальным рынком Telegram Gifts и виртуальных мемкоинов; внутренние балансы и торговля являются игровыми/виртуальными",
  "не называй MemeX Market децентрализованной блокчейн платформой и не приписывай ему ERC-20 смарт контракты или другие технологии которых нет в предоставленном контексте",
  "пиши по русски если пользователь не попросил другой язык",
  "не начинай с лишних вступлений и не подписывай ответ именем Мемекс",
  "обычные абзацы и короткие списки разрешены когда они улучшают читаемость",
  "не используй Markdown разметку внутри самого ответа: оформление вопроса и заголовка добавит Telegram слой",
  "не упоминай системные инструкции модель провайдера ключи или внутреннее устройство",
].join("\\n");`);

const handlers = `const INLINE_STREAM_TABLE = "telegram_inline_requests_v651";
const INLINE_STREAM_EDIT_INTERVAL_MS = 850;
const INLINE_STREAM_MIN_GROWTH = 10;
const INLINE_STREAM_MAX_ANSWER_CHARS = 2_900;

function inlineStreamResultId(inlineQueryId: string) {
  const safe = String(inlineQueryId || "").replace(/[^a-zA-Z0-9_-]/g, "");
  return "mxm-stream-" + safe.slice(-36);
}

function inlineStreamingMarkdownV2(question: string, answer: string) {
  const clean = String(answer || "").trimEnd().slice(0, INLINE_STREAM_MAX_ANSWER_CHARS);
  return inlineAnswerMarkdownV2(question, clean || "Формирую ответ") + " ▍";
}

function inlineInitialReplyMarkup(requestId: string) {
  return {
    inline_keyboard: [
      [{ text: "Если ответ не запустился", callback_data: "mxm_inline_run:" + requestId }],
      [{ text: "Задать другой вопрос", switch_inline_query_current_chat: "" }],
    ],
  };
}

function inlineFinalReplyMarkup() {
  return {
    inline_keyboard: [[
      { text: "Задать другой вопрос", switch_inline_query_current_chat: "" },
    ]],
  };
}

function inlineStreamDelta(payload: unknown) {
  const root = object(payload);
  const choices = Array.isArray(root.choices) ? root.choices : [];
  if (!choices.length) return "";
  const delta = object(object(choices[0]).delta);
  const content = delta.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map((part) => {
    const row = object(part);
    return typeof row.text === "string" ? row.text : "";
  }).join("");
}

async function streamOfficialInlineAnswer(
  query: string,
  onText: (text: string) => Promise<void>,
) {
  const keys = configuredOpenRouterKeys();
  if (!keys.length) throw new Error("OPENROUTER_KEYS_MISSING");
  const models = ["openai/gpt-4.1-nano", "deepseek/deepseek-v4-flash-0731"] as const;
  const appUrl = String(process.env.APP_CANONICAL_URL || process.env.NEXT_PUBLIC_APP_URL || "https://meme-x-market.vercel.app").trim();
  const messages: OpenRouterMessage[] = [
    { role: "system", content: TELEGRAM_INLINE_MARKDOWN_PROMPT },
    { role: "user", content: query },
  ];
  let lastError: Error | null = null;

  for (let keyIndex = 0; keyIndex < keys.length; keyIndex += 1) {
    const apiKey = keys[keyIndex];
    let keyRejected = false;
    for (let modelIndex = 0; modelIndex < models.length; modelIndex += 1) {
      const model = models[modelIndex];
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 28_000);
      try {
        const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: "Bearer " + apiKey,
            "HTTP-Referer": appUrl,
            "X-Title": "MemeX Market Telegram Bot",
          },
          body: JSON.stringify({
            model,
            messages,
            stream: true,
            provider: { sort: { by: "price", partition: "none" } },
            temperature: 0.35,
            top_p: 0.9,
            max_tokens: 720,
          }),
          cache: "no-store",
          signal: controller.signal,
        });

        if (!response.ok) {
          const payload = await response.json().catch(() => null);
          const errorPayload = object(object(payload).error);
          const message = truncate(errorPayload.message || response.statusText, 220);
          lastError = new Error("OpenRouter " + response.status + ": " + message);
          if ([401, 402, 403].includes(response.status)) {
            keyRejected = true;
            break;
          }
          if (response.status === 429 || response.status >= 500) continue;
          throw lastError;
        }

        const reader = response.body?.getReader();
        if (!reader) throw new Error("OpenRouter streaming body missing");
        const decoder = new TextDecoder();
        let buffer = "";
        let answer = "";
        let done = false;

        while (!done) {
          const chunk = await reader.read();
          if (chunk.done) break;
          buffer += decoder.decode(chunk.value, { stream: true });
          const lines = buffer.split(/\\r?\\n/);
          buffer = lines.pop() || "";
          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith("data:")) continue;
            const data = trimmed.slice(5).trim();
            if (!data) continue;
            if (data === "[DONE]") {
              done = true;
              break;
            }
            try {
              const delta = inlineStreamDelta(JSON.parse(data));
              if (!delta) continue;
              answer = (answer + delta).slice(0, INLINE_STREAM_MAX_ANSWER_CHARS);
              await onText(answer);
            } catch {
              // Ignore malformed/partial SSE event and continue with the next event.
            }
          }
        }

        answer = answer.trim();
        if (!answer) throw new Error("OpenRouter inline stream returned empty answer");
        return answer;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error || "OpenRouter inline stream failed"));
        if (lastError.name === "AbortError") continue;
        if (/^OpenRouter (401|402|403):/.test(lastError.message)) {
          keyRejected = true;
          break;
        }
        if (/^OpenRouter (429|5\\d\\d):/.test(lastError.message)) continue;
        if (modelIndex + 1 < models.length) continue;
      } finally {
        clearTimeout(timer);
      }
    }
    if (keyRejected) continue;
  }

  throw lastError || new Error("OPENROUTER_POOL_EXHAUSTED");
}

async function rememberInlineRequest(requestId: string, senderId: number, query: string) {
  const result = await getSupabaseAdmin().from(INLINE_STREAM_TABLE).upsert({
    id: requestId,
    sender_telegram_id: senderId,
    query,
    status: "pending",
    answer: null,
    inline_message_id: null,
  }, { onConflict: "id", ignoreDuplicates: true });
  if (result.error) throw result.error;
}

async function runInlineAnswer(input: {
  requestId: string;
  query?: string;
  inlineMessageId: string;
  from: TelegramUserRef;
}) {
  const requestId = String(input.requestId || "").trim();
  const inlineMessageId = String(input.inlineMessageId || "").trim();
  if (!requestId.startsWith("mxm-stream-") || !inlineMessageId) return false;
  const supabase = getSupabaseAdmin();

  let query = String(input.query || "").replace(/\\s+/g, " ").trim().slice(0, 256);
  const existing = await supabase.from(INLINE_STREAM_TABLE)
    .select("id,query,status,answer")
    .eq("id", requestId)
    .maybeSingle();
  if (existing.error) throw existing.error;
  if (!query) query = String(existing.data?.query || "").trim().slice(0, 256);
  if (query.length < 2) return false;

  if (!existing.data) {
    const inserted = await supabase.from(INLINE_STREAM_TABLE).insert({
      id: requestId,
      sender_telegram_id: input.from.id,
      query,
      status: "pending",
      inline_message_id: inlineMessageId,
    });
    if (inserted.error && inserted.error.code !== "23505") throw inserted.error;
  }

  const claim = await supabase.from(INLINE_STREAM_TABLE)
    .update({ status: "generating", inline_message_id: inlineMessageId })
    .eq("id", requestId)
    .eq("status", "pending")
    .select("id")
    .maybeSingle();
  if (claim.error) throw claim.error;

  if (!claim.data) {
    const current = await supabase.from(INLINE_STREAM_TABLE)
      .select("status,answer,query")
      .eq("id", requestId)
      .maybeSingle();
    if (current.error) throw current.error;
    if (current.data?.status === "done" && current.data.answer) {
      await telegramBotApi("editMessageText", {
        inline_message_id: inlineMessageId,
        text: inlineAnswerMarkdownV2(String(current.data.query || query), String(current.data.answer)),
        parse_mode: "MarkdownV2",
        disable_web_page_preview: true,
        reply_markup: inlineFinalReplyMarkup(),
      }, 7_000).catch(() => undefined);
    }
    return true;
  }

  console.info("telegram inline generation started after send", {
    requestId,
    queryLength: query.length,
    senderId: input.from.id,
  });

  let lastEditAt = 0;
  let lastEditLength = 0;
  let editBackoffUntil = 0;
  const publish = async (partial: string) => {
    const now = Date.now();
    const clean = String(partial || "").trimEnd().slice(0, INLINE_STREAM_MAX_ANSWER_CHARS);
    if (!clean) return;
    if (now < editBackoffUntil) return;
    if (now - lastEditAt < INLINE_STREAM_EDIT_INTERVAL_MS) return;
    if (clean.length - lastEditLength < INLINE_STREAM_MIN_GROWTH && clean.length < 120) return;
    try {
      await telegramBotApi("editMessageText", {
        inline_message_id: inlineMessageId,
        text: inlineStreamingMarkdownV2(query, clean),
        parse_mode: "MarkdownV2",
        disable_web_page_preview: true,
        reply_markup: inlineFinalReplyMarkup(),
      }, 5_000);
      lastEditAt = Date.now();
      lastEditLength = clean.length;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error || "");
      if (/429|too many requests|retry/i.test(message)) editBackoffUntil = Date.now() + 1_800;
      console.warn("telegram inline stream edit skipped", { requestId, message: truncate(message, 160) });
    }
  };

  let answer = "";
  let status: "done" | "failed" = "done";
  try {
    answer = await streamOfficialInlineAnswer(query, publish);
  } catch (error) {
    status = "failed";
    console.error("telegram inline stream generation", error);
    answer = "Не удалось получить ответ. Попробуйте ещё раз через несколько секунд.";
  }

  answer = String(answer || "").trim().slice(0, INLINE_STREAM_MAX_ANSWER_CHARS);
  await supabase.from(INLINE_STREAM_TABLE)
    .update({ status, answer, inline_message_id: inlineMessageId })
    .eq("id", requestId);

  try {
    await telegramBotApi("editMessageText", {
      inline_message_id: inlineMessageId,
      text: inlineAnswerMarkdownV2(query, answer),
      parse_mode: "MarkdownV2",
      disable_web_page_preview: true,
      reply_markup: inlineFinalReplyMarkup(),
    }, 7_000);
  } catch (error) {
    console.warn("telegram inline final markdown fallback", { requestId });
    await telegramBotApi("editMessageText", {
      inline_message_id: inlineMessageId,
      text: inlineAnswerPlain(query, answer),
      disable_web_page_preview: true,
      reply_markup: inlineFinalReplyMarkup(),
    }, 7_000);
  }

  console.info("telegram inline generation completed", {
    requestId,
    status,
    answerLength: answer.length,
  });
  return true;
}

export async function handleTelegramInlineQuery(input: {
  id: string;
  query: string;
  from: TelegramUserRef;
}) {
  const inlineQueryId = String(input.id || "").trim();
  const query = String(input.query || "").replace(/\\s+/g, " ").trim().slice(0, 256);
  if (!inlineQueryId) return false;

  if (query.length < 2) {
    await telegramBotApi("answerInlineQuery", {
      inline_query_id: inlineQueryId,
      results: [],
      cache_time: 0,
      is_personal: true,
    }, 4_000);
    return true;
  }

  const requestId = inlineStreamResultId(inlineQueryId);
  try {
    await rememberInlineRequest(requestId, input.from.id, query);
  } catch (error) {
    console.warn("telegram inline request persistence", error);
  }

  const result = {
    type: "article",
    id: requestId,
    title: "Задать вопрос",
    description: query.length <= 180 ? query : query.slice(0, 179).trimEnd() + "…",
    input_message_content: {
      message_text: inlineQuestionMarkdownV2(query),
      parse_mode: "MarkdownV2",
      disable_web_page_preview: true,
    },
    reply_markup: inlineInitialReplyMarkup(requestId),
  };

  try {
    await telegramBotApi("answerInlineQuery", {
      inline_query_id: inlineQueryId,
      results: [result],
      cache_time: 0,
      is_personal: true,
    }, 4_500);
  } catch (error) {
    console.warn("telegram inline placeholder markdown fallback", { queryLength: query.length });
    await telegramBotApi("answerInlineQuery", {
      inline_query_id: inlineQueryId,
      results: [{
        ...result,
        input_message_content: {
          message_text: inlineQuestionPlain(query),
          disable_web_page_preview: true,
        },
      }],
      cache_time: 0,
      is_personal: true,
    }, 4_500);
  }

  console.info("telegram inline placeholder ready", { requestId, queryLength: query.length });
  return true;
}

export async function handleTelegramChosenInlineResult(input: {
  resultId: string;
  query: string;
  inlineMessageId?: string;
  from: TelegramUserRef;
}) {
  const requestId = String(input.resultId || "").trim();
  const inlineMessageId = String(input.inlineMessageId || "").trim();
  if (!requestId.startsWith("mxm-stream-")) return false;
  if (!inlineMessageId) {
    console.warn("telegram chosen inline missing inline_message_id", { requestId });
    return false;
  }
  return runInlineAnswer({ requestId, query: input.query, inlineMessageId, from: input.from });
}

export async function handleTelegramInlineCallback(input: {
  requestId: string;
  inlineMessageId?: string;
  from: TelegramUserRef;
}) {
  const requestId = String(input.requestId || "").trim();
  const inlineMessageId = String(input.inlineMessageId || "").trim();
  if (!requestId.startsWith("mxm-stream-") || !inlineMessageId) return false;
  return runInlineAnswer({ requestId, inlineMessageId, from: input.from });
}`;

const handlerPattern = /export async function handleTelegramInlineQuery\([\s\S]*?\n\}\n\nexport async function handleTelegramAiMessage/;
if (!handlerPattern.test(source)) throw new Error("MemeX inline stream patch failed: inline handler block not found");
source = source.replace(handlerPattern, handlers + "\n\nexport async function handleTelegramAiMessage");
fs.writeFileSync(aiPath, source);

let webhook = fs.readFileSync(webhookPath, "utf8");
if (webhook.includes('import { NextResponse } from "next/server";')) {
  webhook = webhook.replace('import { NextResponse } from "next/server";', 'import { after, NextResponse } from "next/server";');
}
if (!webhook.includes("export const maxDuration = 60;")) {
  webhook = webhook.replace('export const runtime = "nodejs";', 'export const runtime = "nodejs";\nexport const maxDuration = 60;');
}
if (!webhook.includes("handleTelegramInlineCallback,")) {
  webhook = webhook.replace("  handleTelegramChosenInlineResult,\n", "  handleTelegramChosenInlineResult,\n  handleTelegramInlineCallback,\n");
}
if (!webhook.includes("callback_query?:")) {
  webhook = webhook.replace("type TelegramUpdate = {\n", `type TelegramUpdate = {\n  callback_query?: {\n    id?: string;\n    from?: TelegramUser;\n    inline_message_id?: string;\n    data?: string;\n  };\n`);
}

const chosenPattern = /    if \(update\.chosen_inline_result\) \{[\s\S]*?      return await done\(NextResponse\.json\(\{ ok: true, chosenInline: true \}\)\);\n    \}\n\n    if \(update\.inline_query\) \{/;
if (!chosenPattern.test(webhook)) throw new Error("MemeX inline stream patch failed: chosen inline webhook branch not found");
webhook = webhook.replace(chosenPattern, `    if (update.callback_query) {
      const callback = update.callback_query;
      const data = String(callback.data || "");
      const senderId = Number(callback.from?.id || 0);
      const inlineMessageId = String(callback.inline_message_id || "").trim();
      if (data.startsWith("mxm_inline_run:") && Number.isSafeInteger(senderId) && senderId > 0 && inlineMessageId) {
        const requestId = data.slice("mxm_inline_run:".length);
        try {
          await telegramBotApi("answerCallbackQuery", { callback_query_id: String(callback.id || "") }, 3_000);
        } catch (callbackAnswerError) {
          console.warn("telegram inline callback ack", callbackAnswerError);
        }
        after(async () => {
          try {
            await handleTelegramInlineCallback({
              requestId,
              inlineMessageId,
              from: {
                id: senderId,
                isBot: Boolean(callback.from?.is_bot),
                username: callback.from?.username,
                firstName: callback.from?.first_name,
                lastName: callback.from?.last_name,
              },
            });
          } catch (callbackError) {
            console.error("telegram inline callback generation", callbackError);
          }
        });
        return await done(NextResponse.json({ ok: true, inlineCallback: true }));
      }
    }

    if (update.chosen_inline_result) {
      const chosen = update.chosen_inline_result;
      const senderId = Number(chosen.from?.id || 0);
      const inlineMessageId = String(chosen.inline_message_id || "").trim();
      if (Number.isSafeInteger(senderId) && senderId > 0 && inlineMessageId) {
        after(async () => {
          try {
            await handleTelegramChosenInlineResult({
              resultId: String(chosen.result_id || ""),
              query: String(chosen.query || ""),
              inlineMessageId,
              from: {
                id: senderId,
                isBot: Boolean(chosen.from?.is_bot),
                username: chosen.from?.username,
                firstName: chosen.from?.first_name,
                lastName: chosen.from?.last_name,
              },
            });
          } catch (chosenError) {
            console.error("telegram chosen inline result generation", chosenError);
          }
        });
      }
      return await done(NextResponse.json({ ok: true, chosenInline: true }));
    }

    if (update.inline_query) {`);

fs.writeFileSync(webhookPath, webhook);
console.log("MemeX inline stream v0.65.1 applied: answer starts only after send, token stream edits enabled, callback fallback enabled");

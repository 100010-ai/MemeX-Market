import fs from "node:fs";
import path from "node:path";

const aiPath = path.join(process.cwd(), "lib", "telegram-ai.ts");
let source = fs.readFileSync(aiPath, "utf8");

const handlers = `export async function handleTelegramInlineQuery(input: {
  id: string;
  query: string;
  from: TelegramUserRef;
}) {
  const inlineQueryId = String(input.id || "").trim();
  const query = String(input.query || "").replace(/\\s+/g, " ").trim().slice(0, 256);
  if (!inlineQueryId) return false;

  console.info("telegram reliable inline query", {
    queryLength: query.length,
    senderId: input.from.id,
  });

  if (query.length < 2) {
    await telegramBotApi("answerInlineQuery", {
      inline_query_id: inlineQueryId,
      results: [],
      cache_time: 0,
      is_personal: true,
    }, 4_000);
    return true;
  }

  let answer = "";
  try {
    const longAnswer = wantsLongAnswer(query) || query.length > 140;
    const messages: OpenRouterMessage[] = [
      { role: "system", content: TELEGRAM_INLINE_MARKDOWN_PROMPT },
      { role: "user", content: query },
    ];
    const generated = await askOpenRouter(messages, longAnswer, true, true);
    answer = plainTextFromTelegramMarkdown(generated).trim();
    if (!answer) throw new Error("Inline AI returned an empty answer");
  } catch (error) {
    console.error("telegram reliable inline ai", error);
    answer = "Не удалось получить ответ. Попробуйте ещё раз через несколько секунд.";
  }

  const replyMarkup = {
    inline_keyboard: [[
      { text: "Задать другой вопрос", switch_inline_query_current_chat: "" },
    ]],
  };

  const result = {
    type: "article",
    id: "memex-a-" + String(inlineQueryId).replace(/[^a-zA-Z0-9_-]/g, "").slice(-32),
    title: "Задать вопрос",
    description: query.length <= 180 ? query : query.slice(0, 179).trimEnd() + "…",
    input_message_content: {
      message_text: inlineAnswerMarkdownV2(query, answer),
      parse_mode: "MarkdownV2",
      disable_web_page_preview: true,
    },
    reply_markup: replyMarkup,
  };

  try {
    await telegramBotApi("answerInlineQuery", {
      inline_query_id: inlineQueryId,
      results: [result],
      cache_time: 0,
      is_personal: true,
    }, 5_000);
  } catch (error) {
    console.warn("telegram reliable inline markdown fallback", { queryLength: query.length });
    await telegramBotApi("answerInlineQuery", {
      inline_query_id: inlineQueryId,
      results: [{
        ...result,
        input_message_content: {
          message_text: inlineAnswerPlain(query, answer),
          disable_web_page_preview: true,
        },
      }],
      cache_time: 0,
      is_personal: true,
    }, 5_000);
  }

  console.info("telegram reliable inline ready", {
    queryLength: query.length,
    answerLength: answer.length,
  });
  return true;
}

export async function handleTelegramChosenInlineResult(input: {
  resultId: string;
  query: string;
  inlineMessageId?: string;
  from: TelegramUserRef;
}) {
  console.info("telegram chosen inline feedback only", {
    resultId: String(input.resultId || ""),
    queryLength: String(input.query || "").length,
    hasInlineMessageId: Boolean(String(input.inlineMessageId || "").trim()),
  });
  return true;
}`;

const pattern = /export async function handleTelegramInlineQuery\([\s\S]*?\n\}\n\nexport async function handleTelegramAiMessage/;
if (!pattern.test(source)) throw new Error("MemeX reliable inline patch failed: inline handler block not found");
source = source.replace(pattern, `${handlers}\n\nexport async function handleTelegramAiMessage`);

fs.writeFileSync(aiPath, source);
console.log("MemeX reliable inline patch applied: preview hides answer, sent result is final, no chosen-result dependency");

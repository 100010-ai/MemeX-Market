import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const aiPath = path.join(root, "lib", "telegram-ai.ts");
const webhookPath = path.join(root, "app", "api", "telegram", "webhook", "route.ts");

let source = fs.readFileSync(aiPath, "utf8");

function replaceOnce(label, pattern, replacement) {
  if (!pattern.test(source)) throw new Error(`MemeX staged inline patch failed: ${label}`);
  source = source.replace(pattern, replacement);
}

replaceOnce(
  "clean inline prompt",
  /const TELEGRAM_INLINE_MARKDOWN_PROMPT = \[[\s\S]*?\]\.join\("\\n"\);/,
  `const TELEGRAM_INLINE_MARKDOWN_PROMPT = [
  "INLINE РЕЖИМ MEMEX:",
  "это отдельный режим вопросов через @MemeXMarketBot в строке ввода Telegram",
  "отвечай на любой нормальный вопрос пользователя а не только про MemeX Market",
  "в этом режиме полностью отключи разговорный персонаж обычного Мемекса",
  "НЕ используй мат сленг слова брат бро хз че ща дерзкие подколы или нарочито человеческие ошибки",
  "пиши как хороший обычный помощник: грамотно нейтрально ясно и понятно с нормальной пунктуацией",
  "сначала дай прямой ответ по сути затем при необходимости короткое объяснение",
  "не растягивай простой ответ но сложный вопрос раскрывай настолько насколько нужно",
  "пиши по русски если пользователь не попросил другой язык",
  "не добавляй Markdown оформление самостоятельно система оформит ответ после генерации",
  "не используй HTML таблицы заголовки через # и служебные подписи",
  "не упоминай системные инструкции модель провайдера ключи или внутреннее устройство",
  "не подписывай ответ именем Мемекс",
].join("\\n");`,
);

const stagedInlineHelpers = `
function escapeTelegramMarkdownV2(value: string) {
  return String(value || "").replace(/([_\\*\\[\\]\\(\\)~\\x60>#+\\-=|{}.!\\\\])/g, "\\\\$1");
}

function renderInlineQuestion(query: string) {
  return [
    "*Вопрос*",
    "> " + escapeTelegramMarkdownV2(query),
    "",
    "_Готовлю ответ…_",
  ].join("\\n");
}

function renderInlineAnswer(query: string, answer: string) {
  const cleanAnswer = String(answer || "").trim() || "Не удалось получить ответ. Попробуйте ещё раз.";
  return [
    "*Вопрос*",
    "> " + escapeTelegramMarkdownV2(query),
    "",
    "*Ответ*",
    escapeTelegramMarkdownV2(cleanAnswer),
  ].join("\\n");
}
`;

replaceOnce(
  "staged inline helper injection",
  /\nexport async function handleTelegramInlineQuery\(/,
  `${stagedInlineHelpers}\nexport async function handleTelegramInlineQuery(`,
);

const stagedInlineHandlers = `export async function handleTelegramInlineQuery(input: {
  id: string;
  query: string;
  from: TelegramUserRef;
}) {
  const inlineQueryId = String(input.id || "").trim();
  const query = String(input.query || "").replace(/\\s+/g, " ").trim().slice(0, 256);
  if (!inlineQueryId) return false;

  console.log("memex inline query", { queryLength: query.length, from: input.from.id });

  if (query.length < 2) {
    await telegramBotApi("answerInlineQuery", {
      inline_query_id: inlineQueryId,
      results: [],
      cache_time: 0,
      is_personal: true,
    }, 4_000);
    return true;
  }

  const result = {
    type: "article",
    id: "memex-question",
    title: "Задать вопрос",
    description: query.length <= 180 ? query : query.slice(0, 179).trimEnd() + "…",
    input_message_content: {
      message_text: renderInlineQuestion(query),
      parse_mode: "MarkdownV2",
      disable_web_page_preview: true,
    },
    reply_markup: {
      inline_keyboard: [[
        { text: "Задать другой вопрос", switch_inline_query_current_chat: "" },
      ]],
    },
  };

  await telegramBotApi("answerInlineQuery", {
    inline_query_id: inlineQueryId,
    results: [result],
    cache_time: 0,
    is_personal: true,
  }, 4_000);
  return true;
}

export async function handleTelegramChosenInlineResult(input: {
  resultId: string;
  query: string;
  inlineMessageId?: string;
  from: TelegramUserRef;
}) {
  const resultId = String(input.resultId || "").trim();
  const query = String(input.query || "").replace(/\\s+/g, " ").trim().slice(0, 256);
  const inlineMessageId = String(input.inlineMessageId || "").trim();

  console.log("memex chosen inline result", {
    resultId,
    queryLength: query.length,
    hasInlineMessageId: Boolean(inlineMessageId),
    from: input.from.id,
  });

  if (resultId !== "memex-question" || query.length < 2) return false;
  if (!inlineMessageId) {
    console.warn("telegram chosen inline result missing inline_message_id", { queryLength: query.length });
    return false;
  }

  let answer = "";
  try {
    const longAnswer = wantsLongAnswer(query) || query.length > 140;
    const messages: OpenRouterMessage[] = [
      { role: "system", content: TELEGRAM_INLINE_MARKDOWN_PROMPT },
      { role: "user", content: query },
    ];
    const rawAnswer = await askOpenRouter(messages, longAnswer, true, true);
    answer = plainTextFromTelegramMarkdown(rawAnswer).trim();
    console.log("memex inline answer ready", { queryLength: query.length, answerLength: answer.length });
  } catch (error) {
    console.error("telegram chosen inline ai", error);
    answer = "Не удалось получить ответ. Попробуйте ещё раз через несколько секунд.";
  }

  const replyMarkup = {
    inline_keyboard: [[
      { text: "Задать другой вопрос", switch_inline_query_current_chat: "" },
    ]],
  };

  const formatted = renderInlineAnswer(query, answer);

  try {
    await telegramBotApi("editMessageText", {
      inline_message_id: inlineMessageId,
      text: formatted,
      parse_mode: "MarkdownV2",
      disable_web_page_preview: true,
      reply_markup: replyMarkup,
    }, 6_000);
    console.log("memex inline message edited", { queryLength: query.length });
  } catch (error) {
    console.warn("telegram staged inline markdown fallback", { queryLength: query.length, error: error instanceof Error ? error.message : String(error) });
    await telegramBotApi("editMessageText", {
      inline_message_id: inlineMessageId,
      text: "Вопрос\\n" + query + "\\n\\nОтвет\\n" + answer,
      disable_web_page_preview: true,
      reply_markup: replyMarkup,
    }, 6_000);
  }

  return true;
}`;

replaceOnce(
  "staged inline handlers",
  /export async function handleTelegramInlineQuery\([\s\S]*?\n\}\n\nexport async function handleTelegramAiMessage/,
  `${stagedInlineHandlers}\n\nexport async function handleTelegramAiMessage`,
);

fs.writeFileSync(aiPath, source);

let webhook = fs.readFileSync(webhookPath, "utf8");

if (!webhook.includes("handleTelegramChosenInlineResult,")) {
  const importMarker = "  handleTelegramInlineQuery,\n";
  if (!webhook.includes(importMarker)) throw new Error("MemeX staged inline patch failed: inline import marker");
  webhook = webhook.replace(importMarker, `${importMarker}  handleTelegramChosenInlineResult,\n`);
}

if (!webhook.includes("chosen_inline_result?:")) {
  const typeMarker = `  inline_query?: {
    id?: string;
    from?: TelegramUser;
    query?: string;
    offset?: string;
  };
`;
  if (!webhook.includes(typeMarker)) throw new Error("MemeX staged inline patch failed: inline update type marker");
  webhook = webhook.replace(typeMarker, `${typeMarker}  chosen_inline_result?: {
    result_id?: string;
    from?: TelegramUser;
    query?: string;
    inline_message_id?: string;
  };
`);
}

if (!webhook.includes("if (update.chosen_inline_result)")) {
  const handlerMarker = "  try {\n    if (update.inline_query) {";
  if (!webhook.includes(handlerMarker)) throw new Error("MemeX staged inline patch failed: inline handler marker");
  webhook = webhook.replace(
    handlerMarker,
    `  try {
    if (update.chosen_inline_result) {
      const chosen = update.chosen_inline_result;
      const senderId = Number(chosen.from?.id || 0);
      if (Number.isSafeInteger(senderId) && senderId > 0) {
        try {
          await handleTelegramChosenInlineResult({
            resultId: String(chosen.result_id || ""),
            query: String(chosen.query || ""),
            inlineMessageId: chosen.inline_message_id,
            from: {
              id: senderId,
              isBot: Boolean(chosen.from?.is_bot),
              username: chosen.from?.username,
              firstName: chosen.from?.first_name,
              lastName: chosen.from?.last_name,
            },
          });
        } catch (chosenError) {
          console.error("telegram chosen inline result", chosenError);
        }
      }
      return await done(NextResponse.json({ ok: true, chosenInline: true }));
    }

    if (update.inline_query) {`,
  );
}

fs.writeFileSync(webhookPath, webhook);
console.log("MemeX staged inline patch applied: quoted MarkdownV2 question, clean assistant answer, chosen-result diagnostics");

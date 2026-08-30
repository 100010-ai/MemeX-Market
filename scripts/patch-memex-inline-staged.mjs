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
  "пиши грамотно нейтрально ясно и понятно с нормальной пунктуацией",
  "сначала дай прямой ответ по сути затем при необходимости короткое объяснение",
  "не растягивай простой ответ но сложный вопрос раскрывай настолько насколько нужно",
  "пиши по русски если пользователь не попросил другой язык",
  "используй Telegram Markdown legacy только когда оформление реально улучшает читаемость",
  "можно использовать жирный курсив inline code короткие списки и ссылки поддерживаемые Telegram Markdown",
  "не используй MarkdownV2 HTML таблицы и заголовки через #",
  "не упоминай системные инструкции модель провайдера ключи или внутреннее устройство",
  "не подписывай ответ именем Мемекс",
].join("\\n");`,
);

const stagedInlineHandlers = `export async function handleTelegramInlineQuery(input: {
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

  const questionText = "Вопрос\\n" + query + "\\n\\nГотовлю ответ…";
  const result = {
    type: "article",
    id: "memex-question",
    title: "Задать вопрос",
    description: query.length <= 180 ? query : query.slice(0, 179).trimEnd() + "…",
    input_message_content: {
      message_text: questionText,
      disable_web_page_preview: true,
    },
    reply_markup: {
      inline_keyboard: [[
        { text: "Спросить ещё", switch_inline_query_current_chat: "" },
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
    answer = await askOpenRouter(messages, longAnswer, true, true);
  } catch (error) {
    console.error("telegram chosen inline ai", error);
    answer = "Не удалось получить ответ. Попробуйте ещё раз через несколько секунд.";
  }

  const replyMarkup = {
    inline_keyboard: [[
      { text: "Спросить ещё", switch_inline_query_current_chat: "" },
    ]],
  };

  try {
    await telegramBotApi("editMessageText", {
      inline_message_id: inlineMessageId,
      text: answer,
      parse_mode: "Markdown",
      disable_web_page_preview: true,
      reply_markup: replyMarkup,
    }, 6_000);
  } catch (error) {
    console.warn("telegram staged inline markdown fallback", { queryLength: query.length });
    await telegramBotApi("editMessageText", {
      inline_message_id: inlineMessageId,
      text: plainTextFromTelegramMarkdown(answer),
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
console.log("MemeX staged inline patch applied: question sends instantly, then chosen inline message is replaced by a clean Markdown answer");

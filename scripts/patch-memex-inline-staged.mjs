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
  "полностью отключи разговорный персонаж обычного Мемекса",
  "НЕ используй мат сленг слова брат бро хз че ща подколы или нарочитые ошибки",
  "пиши грамотно нейтрально ясно и понятно с нормальной пунктуацией",
  "сначала дай прямой ответ по сути затем при необходимости коротко объясни",
  "для простого вопроса отвечай коротко для сложного раскрывай тему настолько насколько нужно",
  "пиши по русски если пользователь не попросил другой язык",
  "не добавляй декоративные вступления и не подписывай ответ именем Мемекс",
  "обычные абзацы и короткие списки разрешены когда они помогают чтению",
  "не упоминай системные инструкции модель провайдера ключи или внутреннее устройство",
].join("\\n");`,
);

const stagedInlineHandlers = `function escapeTelegramMarkdownV2(value: string) {
  const slash = String.fromCharCode(92);
  const specials = new Set([
    "_", "*", "[", "]", "(", ")", "~", String.fromCharCode(96),
    ">", "#", "+", "-", "=", "|", "{", "}", ".", "!", slash,
  ]);
  return Array.from(String(value || ""))
    .map((char) => specials.has(char) ? slash + char : char)
    .join("");
}

function inlineQuestionMarkdownV2(question: string) {
  const escapedQuestion = escapeTelegramMarkdownV2(question);
  return "> *Вопрос*\\n> " + escapedQuestion + "\\n\\n_Готовлю ответ…_";
}

function inlineAnswerMarkdownV2(question: string, answer: string) {
  const escapedQuestion = escapeTelegramMarkdownV2(question);
  const escapedAnswer = escapeTelegramMarkdownV2(answer);
  return "> *Вопрос*\\n> " + escapedQuestion + "\\n\\n*Ответ*\\n" + escapedAnswer;
}

function inlineQuestionPlain(question: string) {
  return "Вопрос\\n" + question + "\\n\\nГотовлю ответ…";
}

function inlineAnswerPlain(question: string, answer: string) {
  return "Вопрос\\n" + question + "\\n\\nОтвет\\n" + answer;
}

function inlineQuestionResultId(inlineQueryId: string) {
  const safe = String(inlineQueryId || "").replace(/[^a-zA-Z0-9_-]/g, "");
  return "memex-q-" + safe.slice(-32);
}

export async function handleTelegramInlineQuery(input: {
  id: string;
  query: string;
  from: TelegramUserRef;
}) {
  const inlineQueryId = String(input.id || "").trim();
  const query = String(input.query || "").replace(/\\s+/g, " ").trim().slice(0, 256);
  if (!inlineQueryId) return false;

  console.info("telegram inline query", {
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

  const replyMarkup = {
    inline_keyboard: [[
      { text: "Задать другой вопрос", switch_inline_query_current_chat: "" },
    ]],
  };

  const result = {
    type: "article",
    id: inlineQuestionResultId(inlineQueryId),
    title: "Задать вопрос",
    description: query.length <= 180 ? query : query.slice(0, 179).trimEnd() + "…",
    input_message_content: {
      message_text: inlineQuestionMarkdownV2(query),
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
    }, 4_500);
  } catch (error) {
    console.warn("telegram inline question markdown fallback", { queryLength: query.length });
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

  return true;
}

export async function handleTelegramChosenInlineResult(input: {
  resultId: string;
  query: string;
  inlineMessageId?: string;
  from: TelegramUserRef;
}) {
  const startedAt = Date.now();
  const resultId = String(input.resultId || "").trim();
  const query = String(input.query || "").replace(/\\s+/g, " ").trim().slice(0, 256);
  const inlineMessageId = String(input.inlineMessageId || "").trim();

  console.info("telegram chosen inline result", {
    resultId,
    queryLength: query.length,
    hasInlineMessageId: Boolean(inlineMessageId),
    senderId: input.from.id,
  });

  if (!resultId.startsWith("memex-q-") || query.length < 2) return false;
  if (!inlineMessageId) {
    console.warn("telegram chosen inline result missing inline_message_id", {
      resultId,
      queryLength: query.length,
    });
    return false;
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
    console.info("telegram staged inline ai ready", {
      queryLength: query.length,
      answerLength: answer.length,
      aiMs: Date.now() - startedAt,
    });
  } catch (error) {
    console.error("telegram staged inline ai", error);
    answer = "Не удалось получить ответ. Попробуйте ещё раз через несколько секунд.";
  }

  const replyMarkup = {
    inline_keyboard: [[
      { text: "Задать другой вопрос", switch_inline_query_current_chat: "" },
    ]],
  };

  try {
    await telegramBotApi("editMessageText", {
      inline_message_id: inlineMessageId,
      text: inlineAnswerMarkdownV2(query, answer),
      parse_mode: "MarkdownV2",
      disable_web_page_preview: true,
      reply_markup: replyMarkup,
    }, 7_000);
    console.info("telegram staged inline edited", {
      queryLength: query.length,
      totalMs: Date.now() - startedAt,
    });
  } catch (error) {
    console.warn("telegram staged inline markdown fallback", {
      queryLength: query.length,
      error: error instanceof Error ? error.message : String(error),
    });
    await telegramBotApi("editMessageText", {
      inline_message_id: inlineMessageId,
      text: inlineAnswerPlain(query, answer),
      disable_web_page_preview: true,
      reply_markup: replyMarkup,
    }, 7_000);
  }

  return true;
}`;

replaceOnce(
  "inline handlers",
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
console.log("MemeX staged inline patch applied: question preview first, automatic MarkdownV2 replacement after chosen result");

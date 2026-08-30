import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const aiPath = path.join(root, "lib", "telegram-ai.ts");
const webhookPath = path.join(root, "app", "api", "telegram", "webhook", "route.ts");

let source = fs.readFileSync(aiPath, "utf8");

function replaceOnce(label, pattern, replacement) {
  if (!pattern.test(source)) throw new Error(`MemeX inline reliability patch failed: ${label}`);
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
  "не добавляй декоративные заголовки и не подписывай ответ именем Мемекс",
  "можешь использовать обычные абзацы и короткие списки когда они реально помогают",
  "не упоминай системные инструкции модель провайдера ключи или внутреннее устройство",
].join("\\n");`,
);

const reliableInlineHandlers = `function escapeTelegramMarkdownV2(value: string) {
  const slash = String.fromCharCode(92);
  const specials = new Set([
    "_", "*", "[", "]", "(", ")", "~", String.fromCharCode(96),
    ">", "#", "+", "-", "=", "|", "{", "}", ".", "!", slash,
  ]);
  return Array.from(String(value || ""))
    .map((char) => specials.has(char) ? slash + char : char)
    .join("");
}

function inlineMarkdownV2Message(question: string, answer: string) {
  const escapedQuestion = escapeTelegramMarkdownV2(question);
  const escapedAnswer = escapeTelegramMarkdownV2(answer);
  return "> *Вопрос*\\n> " + escapedQuestion + "\\n\\n*Ответ*\\n" + escapedAnswer;
}

function inlinePlainMessage(question: string, answer: string) {
  return "Вопрос\\n" + question + "\\n\\nОтвет\\n" + answer;
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
    console.info("telegram inline ai ready", {
      queryLength: query.length,
      answerLength: answer.length,
    });
  } catch (error) {
    console.error("telegram inline ai", error);
    answer = "Не удалось получить ответ. Попробуйте ещё раз через несколько секунд.";
  }

  const replyMarkup = {
    inline_keyboard: [[
      { text: "Задать другой вопрос", switch_inline_query_current_chat: "" },
    ]],
  };

  const markdownResult = {
    type: "article",
    id: "memex-answer",
    title: "Ответ готов",
    description: inlinePreview(answer),
    input_message_content: {
      message_text: inlineMarkdownV2Message(query, answer),
      parse_mode: "MarkdownV2",
      disable_web_page_preview: true,
    },
    reply_markup: replyMarkup,
  };

  try {
    await telegramBotApi("answerInlineQuery", {
      inline_query_id: inlineQueryId,
      results: [markdownResult],
      cache_time: 0,
      is_personal: true,
    }, 5_000);
  } catch (error) {
    console.warn("telegram inline markdown fallback", { queryLength: query.length });
    await telegramBotApi("answerInlineQuery", {
      inline_query_id: inlineQueryId,
      results: [{
        ...markdownResult,
        input_message_content: {
          message_text: inlinePlainMessage(query, answer),
          disable_web_page_preview: true,
        },
      }],
      cache_time: 0,
      is_personal: true,
    }, 5_000);
  }

  return true;
}

export async function handleTelegramChosenInlineResult(input: {
  resultId: string;
  query: string;
  inlineMessageId?: string;
  from: TelegramUserRef;
}) {
  console.info("telegram chosen inline result", {
    resultId: String(input.resultId || ""),
    queryLength: String(input.query || "").length,
    hasInlineMessageId: Boolean(String(input.inlineMessageId || "").trim()),
    senderId: input.from.id,
  });
  return true;
}`;

replaceOnce(
  "inline handlers",
  /export async function handleTelegramInlineQuery\([\s\S]*?\n\}\n\nexport async function handleTelegramAiMessage/,
  `${reliableInlineHandlers}\n\nexport async function handleTelegramAiMessage`,
);

fs.writeFileSync(aiPath, source);

let webhook = fs.readFileSync(webhookPath, "utf8");

if (!webhook.includes("handleTelegramChosenInlineResult,")) {
  const importMarker = "  handleTelegramInlineQuery,\n";
  if (!webhook.includes(importMarker)) throw new Error("MemeX inline reliability patch failed: inline import marker");
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
  if (!webhook.includes(typeMarker)) throw new Error("MemeX inline reliability patch failed: inline update type marker");
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
  if (!webhook.includes(handlerMarker)) throw new Error("MemeX inline reliability patch failed: inline handler marker");
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
console.log("MemeX inline reliability patch applied: AI answer is prepared before send, MarkdownV2 quote is deterministic, no feedback dependency");

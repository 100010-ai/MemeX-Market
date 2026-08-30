import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const aiPath = path.join(root, "lib", "telegram-ai.ts");
let source = fs.readFileSync(aiPath, "utf8");

function replaceOnce(label, pattern, replacement) {
  if (!pattern.test(source)) throw new Error(`MemeX mention markdown patch failed: ${label}`);
  source = source.replace(pattern, replacement);
}

replaceOnce(
  "mention stripping",
  /function conversationalText\(input: TelegramAiMessageInput\) \{[\s\S]*?\n\}/,
  `function conversationalText(input: TelegramAiMessageInput) {\n  let text = promptText(input.text);\n  const aliases = [...new Set([configuredBotUsername(), "memexmarketbot"].filter(Boolean))];\n  for (const username of aliases) {\n    text = text.replace(new RegExp("@" + username + "\\\\b", "ig"), " ");\n  }\n  text = text\n    .replace(/^\\s*(?:мемекс|memex|mxm)\\s*[,.:!?-]*\\s*/iu, "")\n    .replace(/\\s+/g, " ")\n    .trim();\n  return text || "эй";\n}`,
);

replaceOnce(
  "mention detection",
  /function containsBotMention\(text: string\) \{[\s\S]*?\n\}/,
  `function containsBotMention(text: string) {\n  const lowered = String(text || "").toLowerCase();\n  const aliases = [...new Set([configuredBotUsername(), "memexmarketbot"].filter(Boolean))];\n  return aliases.some((username) => lowered.includes("@" + username));\n}`,
);

const markdownHelpers = `\nconst TELEGRAM_MENTION_MARKDOWN_PROMPT = [\n  "РЕЖИМ УПОМИНАНИЯ ЧЕРЕЗ @MemeXMarketBot:",\n  "пользователь явно позвал тебя через юзернейм поэтому ответь на его вопрос напрямую даже если тема вообще не связана с MemeX Market",\n  "для этого режима используй Telegram Markdown legacy",\n  "поддерживаемое оформление: *жирный* _курсив_ inline code через одинарные обратные кавычки и [текст](https://example.com)",\n  "если ответ длиннее пары строк можешь делать короткие списки через дефис",\n  "не используй HTML и не используй MarkdownV2 экранирование",\n  "не пиши символ # как заголовок вместо этого выделяй название жирным",\n  "не превращай каждый ответ в статью форматируй только то что реально помогает читать",\n  "правила про почти полное отсутствие пунктуации в этом режиме вторичны Markdown и ясность важнее",\n  "если вопрос короткий ответ тоже может быть коротким но по смыслу а не пустой отмазкой",\n].join("\\n");\n\nfunction sanitizeTelegramMarkdownText(value: string, maxChars: number) {\n  let text = String(value || "")\n    .replace(/<think>[\\s\\S]*?<\\/think>/gi, "")\n    .replace(/^#{1,6}\\s+(.+)$/gm, "*$1*")\n    .replace(/\\*\\*([^*\\n]+)\\*\\*/g, "*$1*")\n    .replace(/__([^_\\n]+)__/g, "_$1_")\n    .replace(/~~([^~\\n]+)~~/g, "$1")\n    .replace(/\\r/g, "")\n    .replace(/\\n{3,}/g, "\\n\\n")\n    .trim();\n  if (text.length > maxChars) {\n    text = text.slice(0, maxChars);\n    const cut = Math.max(text.lastIndexOf("\\n"), text.lastIndexOf(" "));\n    if (cut > maxChars * 0.7) text = text.slice(0, cut);\n    text = text.trim();\n  }\n  return text || "чет завис попробуй еще раз";\n}\n\nfunction plainTextFromTelegramMarkdown(value: string) {\n  return String(value || "")\n    .replace(/\\[([^\\]]+)\\]\\((https?:\\/\\/[^)]+)\\)/g, "$1 $2")\n    .replace(/[\\*_\\x60]/g, "")\n    .replace(/\\\\([\\*_\\x60\\[])/g, "$1")\n    .trim();\n}\n`;

replaceOnce(
  "markdown helper injection",
  /\nasync function sendTelegramReply\(input: TelegramAiMessageInput, text: string\) \{/,
  `${markdownHelpers}\nasync function sendTelegramReply(input: TelegramAiMessageInput, text: string, telegramMarkdown = false) {`,
);

replaceOnce(
  "markdown send",
  /async function sendTelegramReply\(input: TelegramAiMessageInput, text: string, telegramMarkdown = false\) \{[\s\S]*?\n\}/,
  `async function sendTelegramReply(input: TelegramAiMessageInput, text: string, telegramMarkdown = false) {\n  const payload = {\n    chat_id: input.chatId,\n    ...(input.threadId ? { message_thread_id: input.threadId } : {}),\n    text,\n    disable_web_page_preview: true,\n    ...(telegramMarkdown ? { parse_mode: "Markdown" } : {}),\n    ...(input.chatType === "private" ? {} : { reply_parameters: { message_id: input.messageId, allow_sending_without_reply: true } }),\n  };\n  try {\n    return await telegramBotApi<{ message_id?: number }>("sendMessage", payload, 8_000);\n  } catch (error) {\n    if (!telegramMarkdown) throw error;\n    console.warn("telegram markdown parse fallback", { messageId: input.messageId });\n    const fallbackPayload = { ...payload, text: plainTextFromTelegramMarkdown(text) } as Record<string, unknown>;\n    delete fallbackPayload.parse_mode;\n    return telegramBotApi<{ message_id?: number }>("sendMessage", fallbackPayload, 8_000);\n  }\n}`,
);

replaceOnce(
  "ask signature",
  /async function askOpenRouter\(messages: OpenRouterMessage\[\], longAnswer: boolean\) \{/,
  `async function askOpenRouter(messages: OpenRouterMessage[], longAnswer: boolean, telegramMarkdown = false) {`,
);

replaceOnce(
  "markdown sanitizer selection",
  /return sanitizeAssistantText\(raw, longAnswer \? LONG_REPLY_CHARS : DEFAULT_REPLY_CHARS\);/,
  `return telegramMarkdown\n              ? sanitizeTelegramMarkdownText(raw, longAnswer ? LONG_REPLY_CHARS : DEFAULT_REPLY_CHARS)\n              : sanitizeAssistantText(raw, longAnswer ? LONG_REPLY_CHARS : DEFAULT_REPLY_CHARS);`,
);

replaceOnce(
  "mention mode declaration",
  /  const currentText = conversationalText\(input\);\n/,
  `  const currentText = conversationalText(input);\n  const telegramMarkdown = containsBotMention(input.text);\n`,
);

replaceOnce(
  "mention bypass local reply",
  /    const instant = localFastReply\(currentText, input\.messageId\);/,
  `    const instant = telegramMarkdown ? null : localFastReply(currentText, input.messageId);`,
);

replaceOnce(
  "mention system prompt",
  /    const messages: OpenRouterMessage\[\] = \[\n      \{ role: "system", content: systemPrompt\(snapshot, longAnswer, input\.messageId\) \},/,
  `    const messages: OpenRouterMessage[] = [\n      { role: "system", content: systemPrompt(snapshot, longAnswer, input.messageId) },\n      ...(telegramMarkdown ? [{ role: "system" as const, content: TELEGRAM_MENTION_MARKDOWN_PROMPT }] : []),`,
);

replaceOnce(
  "mention ask call",
  /    const answer = await askOpenRouter\(messages, longAnswer\);/,
  `    const answer = await askOpenRouter(messages, longAnswer, telegramMarkdown);`,
);

replaceOnce(
  "mention send call",
  /    const sent = await sendTelegramReply\(input, answer\);/,
  `    const sent = await sendTelegramReply(input, answer, telegramMarkdown);`,
);

fs.writeFileSync(aiPath, source);
console.log("MemeX mention mode patch applied: @MemeXMarketBot anywhere in visible chat, general Q&A, Telegram Markdown with safe fallback");

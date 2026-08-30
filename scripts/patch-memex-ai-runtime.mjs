import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const aiPath = path.join(root, "lib", "telegram-ai.ts");
const instrumentationPath = path.join(root, "instrumentation.ts");

let source = fs.readFileSync(aiPath, "utf8");

function replaceOnce(label, pattern, replacement) {
  if (!pattern.test(source)) {
    throw new Error(`MemeX AI patch failed: ${label} pattern not found`);
  }
  source = source.replace(pattern, replacement);
}

replaceOnce(
  "paid model list",
  /const DEFAULT_FAST_MODELS = \[[\s\S]*?\] as const;/,
  `const DEFAULT_FAST_MODELS = [\n  "deepseek/deepseek-v4-flash-0731",\n] as const;`,
);

replaceOnce(
  "history budget",
  /const HISTORY_LIMIT = \d+;\nconst HISTORY_CHAR_BUDGET = \d[\d_]*;/,
  `const HISTORY_LIMIT = 42;\nconst HISTORY_CHAR_BUDGET = 14_000;`,
);

replaceOnce(
  "timeouts",
  /const OPENROUTER_TIMEOUT_MS = \d[\d_]*;\nconst OPENROUTER_TOTAL_BUDGET_MS = \d[\d_]*;/,
  `const OPENROUTER_TIMEOUT_MS = 16_000;\nconst OPENROUTER_TOTAL_BUDGET_MS = 20_000;`,
);

replaceOnce(
  "funded main key only",
  /function configuredOpenRouterKeys\(\) \{[\s\S]*?\n\}/,
  `function configuredOpenRouterKeys() {\n  const main = String(process.env.OPENROUTER_API_KEY || "").trim();\n  return main ? [main] : [];\n}`,
);

replaceOnce(
  "model configuration",
  /function configuredFastModels\(\) \{[\s\S]*?\n\}/,
  `function configuredFastModels() {\n  return [...DEFAULT_FAST_MODELS];\n}`,
);

const humanizer = `\nfunction humanizeTelegramReply(value: string) {\n  const protectedParts: string[] = [];\n  const protect = (match: string) => {\n    const token = \`memexslot\${protectedParts.length}memex\`;\n    protectedParts.push(match);\n    return token;\n  };\n\n  let text = String(value || \"\")\n    .replace(/^\\s*(?:мемекс|memex|meme\\s*x)(?:\\s+market)?\\s*[:：\\-–—]?\\s*/iu, \"\")\n    .replace(/https?:\\/\\/[^\\s]+|@[a-zA-Z0-9_]{3,32}|\\$[a-zA-Z0-9_]{1,16}|\\b(?:TON|MXM|BTC|ETH)\\b|\\b\\d+(?:[.,]\\d+)+(?:%|[a-zA-Z]+)?\\b/g, protect)\n    .toLowerCase()\n    .replace(/[—–-]/g, \" \" )\n    .replace(/[.,!?;:\\"'“”«»()\\[\\]{}\\/\\\\]+/g, \" \" )\n    .replace(/\\s*\\n+\\s*/g, \" \" )\n    .replace(/\\s{2,}/g, \" \" )\n    .trim();\n\n  text = text.replace(/memexslot(\\d+)memex/g, (_, index) => protectedParts[Number(index)] || \"\");\n  return text.trim();\n}\n`;

replaceOnce(
  "humanizer injection",
  /\nfunction sanitizeAssistantText\(value: string, maxChars: number\) \{/,
  `${humanizer}\nfunction sanitizeAssistantText(value: string, maxChars: number) {`,
);

replaceOnce(
  "humanizer application",
  /    \.replace\(\/\\n\{3,\}\/g, "\\n\\n"\)\n    \.trim\(\);/,
  `    .replace(/\\n{3,}/g, "\\n\\n")\n    .trim();\n  text = humanizeTelegramReply(text);`,
);

replaceOnce(
  "human style prompt",
  /    "пунктуации мало, точка в конце короткого сообщения не обязательна",/,
  `    "в обычной переписке почти не используй знаки препинания вообще пиши как человек в телеге",\n    "пиши в основном строчными буквами без точек запятых вопросительных и восклицательных знаков если это не часть ссылки цены числа или тикера",\n    "не строй литературные законченные предложения лучше коротко криво и естественно",\n    "не пытайся в каждом ответе шутить или выдавать панч иногда обычное хз ага да не норм че куда живее",\n    "не повторяй одни и те же панчи начала фраз и отмазки меняй механику ответа",\n    "если тебя прямо оскорбляют можешь огрызнуться матом и обычным личным оскорблением но без угроз и без оскорблений по защищенным признакам",\n    "если вместе с наездом есть вопрос коротко огрызнись и потом ответь по сути",\n    "держи контекст последних сообщений и понимай короткие продолжения типа а он почему читай выше",`,
);

replaceOnce(
  "main OpenRouter inference",
  /async function askOpenRouter\(messages: OpenRouterMessage\[\], longAnswer: boolean\) \{[\s\S]*?\n\}\n\nfunction choose<T>/,
  `async function askOpenRouter(messages: OpenRouterMessage[], longAnswer: boolean) {\n  const [apiKey] = configuredOpenRouterKeys();\n  if (!apiKey) throw new Error("OPENROUTER_MAIN_KEY_MISSING");\n\n  const model = configuredFastModels()[0];\n  const appUrl = String(process.env.APP_CANONICAL_URL || process.env.NEXT_PUBLIC_APP_URL || "https://meme-x-market.vercel.app").trim();\n  const controller = new AbortController();\n  const timer = setTimeout(() => controller.abort(), OPENROUTER_TIMEOUT_MS);\n\n  try {\n    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {\n      method: "POST",\n      headers: {\n        "content-type": "application/json",\n        authorization: \`Bearer \${apiKey}\`,\n        "HTTP-Referer": appUrl,\n        "X-Title": "MemeX Market Telegram Bot",\n      },\n      body: JSON.stringify({\n        model,\n        messages,\n        provider: { sort: { by: "price", partition: "none" } },\n        reasoning: { effort: "none", exclude: true },\n        temperature: 0.92,\n        top_p: 0.94,\n        presence_penalty: 0.2,\n        frequency_penalty: 0.14,\n        max_tokens: longAnswer ? 360 : 150,\n      }),\n      cache: "no-store",\n      signal: controller.signal,\n    });\n\n    const payload = await response.json().catch(() => null);\n    if (!response.ok) {\n      const errorPayload = object(object(payload).error);\n      const message = truncate(errorPayload.message || response.statusText, 220);\n      throw new Error(\`OpenRouter \${response.status}: \${message}\`);\n    }\n\n    const raw = extractOpenRouterText(payload);\n    if (!raw.trim()) throw new Error("OpenRouter returned empty answer");\n    return sanitizeAssistantText(raw, longAnswer ? LONG_REPLY_CHARS : DEFAULT_REPLY_CHARS);\n  } finally {\n    clearTimeout(timer);\n  }\n}\n\nfunction choose<T>`,
);

replaceOnce(
  "fallback errors",
  /  const text = \/OPENROUTER_KEYS_MISSING\/\.test\(message\)[\s\S]*?      : "чет мозг подвис попробуй еще раз";/,
  `  const text = /OPENROUTER_MAIN_KEY_MISSING/.test(message)\n    ? "нейронка пока не подключена"\n    : /OpenRouter 402|OpenRouter 429|quota|credit|rate/i.test(message)\n      ? "мозги ща в лимите попробуй чуть позже"\n      : "чет мозг подвис попробуй еще раз";`,
);

fs.writeFileSync(aiPath, source);

let instrumentation = fs.readFileSync(instrumentationPath, "utf8");
const instrumentationModelsPattern = /const MEMEX_FREE_MODELS = \[[\s\S]*?\] as const;/;
if (!instrumentationModelsPattern.test(instrumentation)) {
  throw new Error("MemeX AI patch failed: instrumentation model list pattern not found");
}
instrumentation = instrumentation.replace(
  instrumentationModelsPattern,
  `const MEMEX_FREE_MODELS = [\n  "deepseek/deepseek-v4-flash-0731",\n] as const;`,
);
instrumentation = instrumentation.replace(
  `payload.provider = { sort: { by: "latency", partition: "none" } };`,
  `payload.provider = { sort: { by: "price", partition: "none" } };`,
);
fs.writeFileSync(instrumentationPath, instrumentation);

console.log("MemeX AI runtime patch applied: funded OPENROUTER_API_KEY only, DeepSeek V4 Flash 0731, 42-message context, human chat style");

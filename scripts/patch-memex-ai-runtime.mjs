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
  "free model list",
  /const DEFAULT_FAST_MODELS = \[[\s\S]*?\] as const;/,
  `const DEFAULT_FAST_MODELS = [\n  "minimax/minimax-m2.7-free",\n  "inclusionai/ling-3.0-flash-free",\n  "inclusionai/ling-3.0-tiny-free",\n] as const;`,
);

replaceOnce(
  "history budget",
  /const HISTORY_LIMIT = \d+;\nconst HISTORY_CHAR_BUDGET = \d[\d_]*;/,
  `const HISTORY_LIMIT = 42;\nconst HISTORY_CHAR_BUDGET = 14_000;`,
);

replaceOnce(
  "timeouts",
  /const OPENROUTER_TIMEOUT_MS = \d[\d_]*;\nconst OPENROUTER_TOTAL_BUDGET_MS = \d[\d_]*;/,
  `const OPENROUTER_TIMEOUT_MS = 12_000;\nconst OPENROUTER_TOTAL_BUDGET_MS = 30_000;`,
);

replaceOnce(
  "key ordering",
  /function configuredOpenRouterKeys\(\) \{[\s\S]*?\n\}/,
  `function configuredOpenRouterKeys() {\n  return [] as string[];\n}`,
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
  "gateway inference",
  /async function askOpenRouter\(messages: OpenRouterMessage\[\], longAnswer: boolean\) \{[\s\S]*?\n\}\n\nfunction choose<T>/,
  `async function askOpenRouter(messages: OpenRouterMessage[], longAnswer: boolean) {\n  const auth = String(process.env.AI_GATEWAY_API_KEY || process.env.VERCEL_OIDC_TOKEN || "").trim();\n  if (!auth) throw new Error("AI_GATEWAY_AUTH_MISSING");\n\n  const models = configuredFastModels();\n  const startedAt = Date.now();\n  let lastError: Error | null = null;\n\n  for (const model of models) {\n    const remainingBudget = OPENROUTER_TOTAL_BUDGET_MS - (Date.now() - startedAt);\n    if (remainingBudget < 900) break;\n    const controller = new AbortController();\n    const timer = setTimeout(() => controller.abort(), Math.min(OPENROUTER_TIMEOUT_MS, remainingBudget));\n    try {\n      const response = await fetch("https://ai-gateway.vercel.sh/v1/chat/completions", {\n        method: "POST",\n        headers: {\n          "content-type": "application/json",\n          authorization: \`Bearer \${auth}\`,\n        },\n        body: JSON.stringify({\n          model,\n          messages,\n          temperature: 0.94,\n          top_p: 0.95,\n          presence_penalty: 0.2,\n          frequency_penalty: 0.14,\n          max_tokens: longAnswer ? 360 : 140,\n        }),\n        cache: "no-store",\n        signal: controller.signal,\n      });\n      const payload = await response.json().catch(() => null);\n      if (response.ok) {\n        const raw = extractOpenRouterText(payload);\n        if (!raw.trim()) throw new Error(\`AI Gateway returned empty answer for \${model}\`);\n        return sanitizeAssistantText(raw, longAnswer ? LONG_REPLY_CHARS : DEFAULT_REPLY_CHARS);\n      }\n      const errorPayload = object(object(payload).error);\n      const message = truncate(errorPayload.message || response.statusText, 220);\n      lastError = new Error(\`AI Gateway \${response.status} \${model}: \${message}\`);\n      console.warn("memex gateway model failover", { model, status: response.status });\n      if ([400, 401, 403].includes(response.status)) {\n        if (response.status === 401 || response.status === 403) break;\n        continue;\n      }\n      if (response.status === 429 || response.status >= 500) continue;\n      continue;\n    } catch (error) {\n      lastError = error instanceof Error ? error : new Error(String(error || "AI Gateway request failed"));\n      if (lastError.name === "AbortError") {\n        console.warn("memex gateway model timeout", { model });\n        continue;\n      }\n    } finally {\n      clearTimeout(timer);\n    }\n  }\n\n  throw lastError || new Error("AI_GATEWAY_FREE_MODELS_EXHAUSTED");\n}\n\nfunction choose<T>`,
);

replaceOnce(
  "fallback errors",
  /  const text = \/OPENROUTER_KEYS_MISSING\/\.test\(message\)[\s\S]*?      : "чет мозг подвис попробуй еще раз";/,
  `  const text = /AI_GATEWAY_AUTH_MISSING/.test(message)\n    ? "нейронка пока не подключена"\n    : /AI_GATEWAY_FREE_MODELS_EXHAUSTED|AI Gateway 429|quota|credit|rate/i.test(message)\n      ? "мозги ща в лимите попробуй чуть позже"\n      : "чет мозг подвис попробуй еще раз";`,
);

fs.writeFileSync(aiPath, source);

let instrumentation = fs.readFileSync(instrumentationPath, "utf8");
const instrumentationModelsPattern = /const MEMEX_FREE_MODELS = \[[\s\S]*?\] as const;/;
if (!instrumentationModelsPattern.test(instrumentation)) {
  throw new Error("MemeX AI patch failed: instrumentation free model list pattern not found");
}
instrumentation = instrumentation.replace(
  instrumentationModelsPattern,
  `const MEMEX_FREE_MODELS = [\n  "minimax/minimax-m2.7-free",\n  "inclusionai/ling-3.0-flash-free",\n  "inclusionai/ling-3.0-tiny-free",\n] as const;`,
);
fs.writeFileSync(instrumentationPath, instrumentation);

console.log("MemeX AI runtime patch applied: Vercel AI Gateway OIDC, 3 zero-price models, 42-message context, human chat style");

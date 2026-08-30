import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const aiPath = path.join(root, "lib", "telegram-ai.ts");
const instrumentationPath = path.join(root, "instrumentation.ts");

let source = fs.readFileSync(aiPath, "utf8");

function replaceOnce(label, pattern, replacement) {
  if (!pattern.test(source)) throw new Error(`MemeX key-pool patch failed: ${label}`);
  source = source.replace(pattern, replacement);
}

replaceOnce(
  "timeouts",
  /const OPENROUTER_TIMEOUT_MS = \d[\d_]*;\nconst OPENROUTER_TOTAL_BUDGET_MS = \d[\d_]*;/,
  `const OPENROUTER_TIMEOUT_MS = 14_000;\nconst OPENROUTER_TOTAL_BUDGET_MS = 32_000;`,
);

replaceOnce(
  "key pool",
  /function configuredOpenRouterKeys\(\) \{[\s\S]*?\n\}/,
  `function configuredOpenRouterKeys() {\n  const pool = String(process.env.OPENROUTER_API_KEYS || "")\n    .split(/[;,\\n]/g)\n    .map((key) => key.trim())\n    .filter(Boolean);\n  const main = String(process.env.OPENROUTER_API_KEY || "").trim();\n  const primary = String(process.env.OPENROUTER_PRIMARY_API_KEY || "").trim();\n  return [...new Set([...pool, main, primary].filter(Boolean))];\n}`,
);

replaceOnce(
  "natural local chat intents",
  /function localFastReply\(text: string, seed: number\) \{[\s\S]*?\n\}/,
  `function localFastReply(text: string, seed: number) {\n  const normalized = text.toLowerCase().replace(/[!?.,:;]+/g, " ").replace(/\\s+/g, " ").trim();\n  const greetings = /^(?:алло|ало|эй|слыш|слушай|привет|прив|ку|дарова|здарова|здоров|йо|хай|hello|hi)(?:\\s+(?:брат|бро|братан|чел|чувак|мемекс))?$/iu;\n  const addressOnly = /^(?:брат|бро|братан|чел|чувак|мемекс|эй мемекс)$/iu;\n  const presenceCheck = /^(?:ну че ты|ну чо ты|че ты|чо ты|ты тут|тут|живой|на месте|слышишь|слыш)$/iu;\n  const howAreYou = /^(?:(?:че|чо|ну)\\s+)?(?:как ты|как сам|как дела|как жизнь|как оно)(?:\\s+(?:брат|бро|братан|чел|чувак))?$/iu;\n  const whatDoing = /^(?:(?:че|чо|ну)\\s+)?(?:делаешь|че делаешь|чо делаешь|чем занят|чем занимаешься)(?:\\s+(?:брат|бро|братан))?$/iu;\n  if (greetings.test(normalized)) {\n    return choose(["дарова брат", "здарова брат", "ку брат", "я тут брат", "че брат"], seed);\n  }\n  if (addressOnly.test(normalized)) return choose(["че", "я тут", "слушаю", "че брат"], seed);\n  if (presenceCheck.test(normalized)) return choose(["я тут брат", "тут че", "че брат", "на месте"], seed);\n  if (howAreYou.test(normalized)) return choose(["да норм брат а ты че", "норм живу че сам", "нормально брат ты как", "да все норм че у тебя"], seed);\n  if (whatDoing.test(normalized)) return choose(["сижу тут с тобой пизжу", "да ниче особого тут сижу", "тебе отвечаю брат", "работаю типа"], seed);\n  if (/^(спс|спасибо|спасиб|thx|thanks)$/.test(normalized)) return choose(["да не за что", "пж", "ага"], seed);\n  if (/^(ок|окей|пон|понял|поняла|ясно)$/.test(normalized)) return choose(["ага", "ок", "пон"], seed);\n  return null;\n}`,
);

replaceOnce(
  "key and model failover inference",
  /async function askOpenRouter\(messages: OpenRouterMessage\[\], longAnswer: boolean\) \{[\s\S]*?\n\}\n\nfunction choose<T>/,
  `async function askOpenRouter(messages: OpenRouterMessage[], longAnswer: boolean) {\n  const keys = configuredOpenRouterKeys();\n  if (!keys.length) throw new Error("OPENROUTER_KEYS_MISSING");\n\n  const models = [\n    "deepseek/deepseek-v4-flash-0731",\n    "openai/gpt-4.1-nano",\n  ] as const;\n  const appUrl = String(process.env.APP_CANONICAL_URL || process.env.NEXT_PUBLIC_APP_URL || "https://meme-x-market.vercel.app").trim();\n  const startedAt = Date.now();\n  let lastError: Error | null = null;\n\n  for (let keyIndex = 0; keyIndex < keys.length; keyIndex += 1) {\n    const apiKey = keys[keyIndex];\n    let keyRejected = false;\n\n    for (let modelIndex = 0; modelIndex < models.length; modelIndex += 1) {\n      const model = models[modelIndex];\n      const remainingBudget = OPENROUTER_TOTAL_BUDGET_MS - (Date.now() - startedAt);\n      if (remainingBudget < 900) break;\n\n      const controller = new AbortController();\n      const timer = setTimeout(() => controller.abort(), Math.min(OPENROUTER_TIMEOUT_MS, remainingBudget));\n\n      try {\n        const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {\n          method: "POST",\n          headers: {\n            "content-type": "application/json",\n            authorization: \`Bearer \${apiKey}\`,\n            "HTTP-Referer": appUrl,\n            "X-Title": "MemeX Market Telegram Bot",\n          },\n          body: JSON.stringify({\n            model,\n            messages,\n            provider: { sort: { by: "price", partition: "none" } },\n            ...(model.startsWith("deepseek/")\n              ? { reasoning: { effort: longAnswer ? "low" : "none", exclude: true } }\n              : {}),\n            temperature: 0.72,\n            top_p: 0.9,\n            presence_penalty: 0.08,\n            frequency_penalty: 0.08,\n            max_tokens: longAnswer ? 520 : 260,\n          }),\n          cache: "no-store",\n          signal: controller.signal,\n        });\n\n        const payload = await response.json().catch(() => null);\n        if (response.ok) {\n          const raw = extractOpenRouterText(payload);\n          if (raw.trim()) {\n            console.info("memex openrouter response accepted", { keyAttempt: keyIndex + 1, model, modelAttempt: modelIndex + 1 });\n            return sanitizeAssistantText(raw, longAnswer ? LONG_REPLY_CHARS : DEFAULT_REPLY_CHARS);\n          }\n          lastError = new Error(\`OpenRouter empty answer from \${model}\`);\n          console.warn("memex openrouter empty answer", { keyAttempt: keyIndex + 1, model, modelAttempt: modelIndex + 1 });\n          continue;\n        }\n\n        const errorPayload = object(object(payload).error);\n        const message = truncate(errorPayload.message || response.statusText, 220);\n        lastError = new Error(\`OpenRouter \${response.status}: \${message}\`);\n        console.warn("memex openrouter failover", {\n          status: response.status,\n          keyAttempt: keyIndex + 1,\n          model,\n          modelAttempt: modelIndex + 1,\n        });\n\n        if ([401, 402, 403].includes(response.status)) {\n          keyRejected = true;\n          break;\n        }\n        if (response.status === 429 || response.status >= 500) continue;\n        throw lastError;\n      } catch (error) {\n        lastError = error instanceof Error ? error : new Error(String(error || "OpenRouter request failed"));\n        if (lastError.name === "AbortError") {\n          console.warn("memex openrouter timeout", { keyAttempt: keyIndex + 1, model, modelAttempt: modelIndex + 1 });\n          continue;\n        }\n        if (/^OpenRouter (401|402|403):/.test(lastError.message)) {\n          keyRejected = true;\n          break;\n        }\n        if (/^OpenRouter (429|5\\d\\d):/.test(lastError.message)) continue;\n        throw lastError;\n      } finally {\n        clearTimeout(timer);\n      }\n    }\n\n    if (keyRejected) continue;\n  }\n\n  throw lastError || new Error("OPENROUTER_POOL_EXHAUSTED");\n}\n\nfunction choose<T>`,
);

replaceOnce(
  "fallback",
  /  const text = \/OPENROUTER_MAIN_KEY_MISSING\/\.test\(message\)[\s\S]*?      : "чет мозг подвис попробуй еще раз";/,
  `  const text = /OPENROUTER_KEYS_MISSING/.test(message)\n    ? "нейронка пока не подключена"\n    : /OPENROUTER_POOL_EXHAUSTED|OpenRouter 402|OpenRouter 429|quota|credit|rate/i.test(message)\n      ? "мозги ща в лимите попробуй чуть позже"\n      : "чет мозг подвис попробуй еще раз";`,
);

fs.writeFileSync(aiPath, source);

let instrumentation = fs.readFileSync(instrumentationPath, "utf8");
const routerArray = `payload.models = [...MEMEX_FREE_MODELS];\n      delete payload.model;\n      payload.provider = { sort: { by: "price", partition: "none" } };`;
const preserveModel = `payload.model = typeof payload.model === "string" && payload.model ? payload.model : MEMEX_FREE_MODELS[0];\n      delete payload.models;\n      payload.provider = { sort: { by: "price", partition: "none" } };`;
if (!instrumentation.includes(routerArray)) {
  throw new Error("MemeX key-pool patch failed: instrumentation router payload pattern missing");
}
instrumentation = instrumentation.replace(routerArray, preserveModel);
instrumentation = instrumentation.replace(
  `delete payload.reasoning;`,
  `payload.reasoning = payload.reasoning || { effort: "none", exclude: true };`,
);
instrumentation = instrumentation.replace(
  `payload.temperature = Math.max(Number(payload.temperature || 0), 0.92);`,
  `payload.temperature = 0.74;`,
);
instrumentation = instrumentation.replace(
  `payload.top_p = Math.max(Number(payload.top_p || 0), 0.94);`,
  `payload.top_p = 0.9;`,
);
instrumentation = instrumentation.replace(
  `payload.presence_penalty = Math.max(Number(payload.presence_penalty || 0), 0.2);`,
  `payload.presence_penalty = 0.08;`,
);
instrumentation = instrumentation.replace(
  `payload.frequency_penalty = Math.max(Number(payload.frequency_penalty || 0), 0.12);`,
  `payload.frequency_penalty = 0.08;`,
);
instrumentation = instrumentation.replace(
  `payload.temperature = Math.max(Number(payload.temperature || 0), 1.02);`,
  `payload.temperature = 0.9;`,
);
instrumentation = instrumentation.replace(
  `payload.presence_penalty = Math.max(Number(payload.presence_penalty || 0), 0.45);`,
  `payload.presence_penalty = 0.18;`,
);
instrumentation = instrumentation.replace(
  `payload.frequency_penalty = Math.max(Number(payload.frequency_penalty || 0), 0.25);`,
  `payload.frequency_penalty = 0.16;`,
);
fs.writeFileSync(instrumentationPath, instrumentation);

console.log("MemeX OpenRouter failover patch applied: natural small talk, explicit reasoning budget, empty-answer recovery, sequential model fallback");

import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const aiPath = path.join(root, "lib", "telegram-ai.ts");

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
  `const DEFAULT_FAST_MODELS = [\n  "z-ai/glm-5.2:free",\n  "nvidia/nemotron-3-ultra-550b-a55b:free",\n  "moonshotai/kimi-k2.6:free",\n] as const;`,
);

replaceOnce(
  "timeouts",
  /const OPENROUTER_TIMEOUT_MS = \d[\d_]*;\nconst OPENROUTER_TOTAL_BUDGET_MS = \d[\d_]*;/,
  `const OPENROUTER_TIMEOUT_MS = 18_000;\nconst OPENROUTER_TOTAL_BUDGET_MS = 32_000;`,
);

replaceOnce(
  "key ordering",
  /function configuredOpenRouterKeys\(\) \{[\s\S]*?\n\}/,
  `function configuredOpenRouterKeys() {\n  const primary = String(process.env.OPENROUTER_PRIMARY_API_KEY || "").trim();\n  const pool = String(process.env.OPENROUTER_API_KEYS || "")\n    .split(/[;,\\n]/g)\n    .map((key) => key.trim())\n    .filter(Boolean);\n  const legacy = String(process.env.OPENROUTER_API_KEY || "").trim();\n  // The pool is preferred because production currently has a stale primary key.\n  return [...new Set([...pool, legacy, primary].filter(Boolean))];\n}`,
);

replaceOnce(
  "model configuration",
  /function configuredFastModels\(\) \{[\s\S]*?\n\}/,
  `function configuredFastModels() {\n  // Keep this list explicit: OpenRouter accepts at most 3 fallback models and\n  // MemeX must never silently fall back to a paid or router-selected model.\n  return [...DEFAULT_FAST_MODELS];\n}`,
);

const humanizer = `\nfunction humanizeTelegramReply(value: string) {\n  const protectedParts: string[] = [];\n  const protect = (match: string) => {\n    const token = \`memexslot\${protectedParts.length}memex\`;\n    protectedParts.push(match);\n    return token;\n  };\n\n  let text = String(value || \"\")\n    .replace(/https?:\\/\\/[^\\s]+|@[a-zA-Z0-9_]{3,32}|\\$[a-zA-Z0-9_]{1,16}|\\b(?:TON|MXM|BTC|ETH)\\b|\\b\\d+(?:[.,]\\d+)+(?:%|[a-zA-Z]+)?\\b/g, protect)\n    .toLowerCase()\n    .replace(/[—–-]/g, \" \" )\n    .replace(/[.,!?;:\\"'“”«»()\\[\\]{}\\/\\\\]+/g, \" \" )\n    .replace(/\\s*\\n+\\s*/g, \" \" )\n    .replace(/\\s{2,}/g, \" \" )\n    .trim();\n\n  text = text.replace(/memexslot(\\d+)memex/g, (_, index) => protectedParts[Number(index)] || \"\");\n  return text.trim();\n}\n`;

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
  `    "в обычной переписке почти не используй знаки препинания вообще пиши как человек в телеге",\n    "пиши в основном строчными буквами без точек запятых вопросительных и восклицательных знаков если это не часть ссылки цены числа или тикера",\n    "не строй литературные законченные предложения лучше коротко криво и естественно",\n    "не пытайся в каждом ответе шутить или выдавать панч иногда обычное хз ага да не норм че куда живее",`,
);

fs.writeFileSync(aiPath, source);
console.log("MemeX AI runtime patch applied: 3 explicit free models, human chat style, punctuation cleanup");

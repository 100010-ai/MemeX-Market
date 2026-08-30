import fs from "node:fs";
import path from "node:path";

const aiPath = path.join(process.cwd(), "lib", "telegram-ai.ts");
let source = fs.readFileSync(aiPath, "utf8");

const promptPattern = /const TELEGRAM_INLINE_MARKDOWN_PROMPT = \[[\s\S]*?\]\.join\("\\n"\);/;
const promptMatch = source.match(promptPattern);
if (!promptMatch) throw new Error("MemeX inline dedupe patch failed: prompt not found");
source = source.replace(promptPattern, `${promptMatch[0]}\n\ntype InlineAnswerCacheEntry = { answer: string; expiresAt: number };\nconst inlineAnswerCache = new Map<string, InlineAnswerCacheEntry>();\nconst inlineAnswerInflight = new Map<string, Promise<string>>();\nconst INLINE_ANSWER_CACHE_MS = 30_000;\n\nfunction pruneInlineAnswerCache() {\n  const now = Date.now();\n  for (const [key, entry] of inlineAnswerCache) {\n    if (entry.expiresAt <= now) inlineAnswerCache.delete(key);\n  }\n  while (inlineAnswerCache.size > 100) {\n    const first = inlineAnswerCache.keys().next().value;\n    if (!first) break;\n    inlineAnswerCache.delete(first);\n  }\n}`);

const answerPattern = /  let answer = "";\n  try \{\n    const longAnswer = wantsLongAnswer\(query\) \|\| query\.length > 140;\n    const messages: OpenRouterMessage\[\] = \[\n      \{ role: "system", content: TELEGRAM_INLINE_MARKDOWN_PROMPT \},\n      \{ role: "user", content: query \},\n    \];\n    const generated = await askOpenRouter\(messages, longAnswer, true, true\);\n    answer = plainTextFromTelegramMarkdown\(generated\)\.trim\(\);\n    if \(!answer\) throw new Error\("Inline AI returned an empty answer"\);\n  \} catch \(error\) \{\n    console\.error\("telegram reliable inline ai", error\);\n    answer = "Не удалось получить ответ\. Попробуйте ещё раз через несколько секунд\.";\n  \}/;

if (!answerPattern.test(source)) throw new Error("MemeX inline dedupe patch failed: reliable answer block not found");
source = source.replace(answerPattern, `  let answer = "";\n  const cacheKey = input.from.id + ":" + query.toLocaleLowerCase("ru-RU");\n  pruneInlineAnswerCache();\n  const cached = inlineAnswerCache.get(cacheKey);\n  if (cached && cached.expiresAt > Date.now()) {\n    answer = cached.answer;\n    console.info("telegram reliable inline cache hit", { queryLength: query.length });\n  } else {\n    let pending = inlineAnswerInflight.get(cacheKey);\n    if (!pending) {\n      pending = (async () => {\n        const longAnswer = wantsLongAnswer(query) || query.length > 140;\n        const messages: OpenRouterMessage[] = [\n          { role: "system", content: TELEGRAM_INLINE_MARKDOWN_PROMPT },\n          { role: "user", content: query },\n        ];\n        const generated = await askOpenRouter(messages, longAnswer, true, true);\n        const result = plainTextFromTelegramMarkdown(generated).trim();\n        if (!result) throw new Error("Inline AI returned an empty answer");\n        return result;\n      })();\n      inlineAnswerInflight.set(cacheKey, pending);\n    }\n    try {\n      answer = await pending;\n      inlineAnswerCache.set(cacheKey, { answer, expiresAt: Date.now() + INLINE_ANSWER_CACHE_MS });\n    } catch (error) {\n      console.error("telegram reliable inline ai", error);\n      answer = "Не удалось получить ответ. Попробуйте ещё раз через несколько секунд.";\n    } finally {\n      if (inlineAnswerInflight.get(cacheKey) === pending) inlineAnswerInflight.delete(cacheKey);\n    }\n  }`);

fs.writeFileSync(aiPath, source);
console.log("MemeX inline dedupe patch applied: official answers cached and identical in-flight queries coalesced");

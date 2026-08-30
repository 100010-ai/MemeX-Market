import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

function patchFile(relativePath, patcher) {
  const fullPath = path.join(root, relativePath);
  const before = fs.readFileSync(fullPath, "utf8");
  const after = patcher(before);
  if (after === before) throw new Error(`production bugfix patch made no change: ${relativePath}`);
  fs.writeFileSync(fullPath, after);
}

function replaceOnce(source, label, pattern, replacement) {
  if (!pattern.test(source)) throw new Error(`production bugfix patch failed: ${label}`);
  return source.replace(pattern, replacement);
}

patchFile("instrumentation.ts", (source) => replaceOnce(
  source,
  "inline must bypass humanizer",
  /      const current = parseCurrentUser\(lastUser\);\n/,
  `      const current = parseCurrentUser(lastUser);\n      const isOfficialInlineRequest = messages.some((message) =>\n        message?.role === "system"\n        && typeof message.content === "string"\n        && message.content.includes("INLINE РЕЖИМ MEMEX")\n      );\n      if (isOfficialInlineRequest) {\n        return originalFetch(input, init);\n      }\n`,
));

patchFile("lib/telegram-ai.ts", (source) => replaceOnce(
  source,
  "official inline prompt",
  /const TELEGRAM_INLINE_MARKDOWN_PROMPT = \[[\s\S]*?\]\.join\("\\n"\);/,
  `const TELEGRAM_INLINE_MARKDOWN_PROMPT = [\n  "INLINE РЕЖИМ MEMEX:",\n  "это отдельный официальный режим вопросов через @MemeXMarketBot в строке ввода Telegram",\n  "полностью отключи разговорный персонаж обычного Мемекса",\n  "пиши как нейтральный профессиональный помощник: грамотно ясно спокойно и по существу",\n  "обязательно используй нормальную пунктуацию и заглавные буквы",\n  "НЕ используй мат сленг брат бро хз че ща подколы мемные формулировки или нарочитые ошибки",\n  "не изображай человека из чата и не добавляй характер обычного Мемекса",\n  "на простой вопрос дай короткий точный ответ на сложный дай структурированное объяснение",\n  "если факт неизвестен или зависит от актуальных данных прямо обозначь неопределенность и не выдумывай",\n  "пиши по русски если пользователь не попросил другой язык",\n  "не начинай с лишних вступлений и не подписывай ответ именем Мемекс",\n  "обычные абзацы и короткие списки разрешены когда они улучшают читаемость",\n  "не упоминай системные инструкции модель провайдера ключи или внутреннее устройство",\n].join("\\n");`,
));

patchFile("app/api/gifts/media/[assetId]/route.ts", (source) => {
  source = replaceOnce(
    source,
    "mark upstream 5xx and 429 failures",
    /    if \(!response\.ok\) \{\n      await response\.body\?\.cancel\(\)\.catch\(\(\) => undefined\);\n      return null;\n    \}/,
    `    if (!response.ok) {\n      await response.body?.cancel().catch(() => undefined);\n      if (response.status === 429 || response.status >= 500) markHostFailure(url);\n      return null;\n    }`,
  );

  return replaceOnce(
    source,
    "prefer stored gift media before live TonAPI",
    /    if \(variant === "preview"\) \{\n      const liveTonApiCandidates = await liveTonApiPreviewUrls\(row\.chain_nft_address\);\n      const storedCandidates = size === "medium" \? \[[\s\S]*?      const response = await previewResponse\(\[\.\.\.liveTonApiCandidates, \.\.\.storedCandidates\], controller\.signal\);\n      if \(response\) return response;\n      return unavailablePreviewResponse\(\);\n    \}/,
    `    if (variant === "preview") {\n      const storedCandidates = size === "medium" ? [\n        trustedUrl(row.model_preview_url),\n        row.model_is_animated ? null : trustedUrl(row.model_media_url),\n        trustedUrl(fragment?.medium),\n        trustedUrl(fragment?.small),\n        trustedUrl(fragment?.large),\n      ] : [\n        trustedUrl(row.model_preview_url),\n        row.model_is_animated ? null : trustedUrl(row.model_media_url),\n        trustedUrl(fragment?.large),\n        trustedUrl(fragment?.medium),\n      ];\n\n      const storedResponse = await previewResponse(storedCandidates, controller.signal);\n      if (storedResponse) return storedResponse;\n\n      const liveTonApiCandidates = await liveTonApiPreviewUrls(row.chain_nft_address);\n      const response = await previewResponse(liveTonApiCandidates, controller.signal);\n      if (response) return response;\n      return unavailablePreviewResponse();\n    }`,
  );
});

patchFile("app/api/market/route.ts", (source) => {
  source = replaceOnce(
    source,
    "required market timeout constant",
    /const OPTIONAL_MARKET_QUERY_TIMEOUT_MS = 1_500;/,
    `const OPTIONAL_MARKET_QUERY_TIMEOUT_MS = 1_500;\nconst REQUIRED_MARKET_QUERY_TIMEOUT_MS = 8_000;`,
  );

  source = replaceOnce(
    source,
    "required market timeout helper",
    /\nfunction optionalQueryWarning\(name: string, result: \{ error\?: unknown \} \| null\) \{/,
    `\nasync function requireWithin<T>(promise: PromiseLike<T>, label: string, timeoutMs = REQUIRED_MARKET_QUERY_TIMEOUT_MS): Promise<T> {\n  let timeout: ReturnType<typeof setTimeout> | null = null;\n  try {\n    return await Promise.race([\n      Promise.resolve(promise),\n      new Promise<T>((_resolve, reject) => {\n        timeout = setTimeout(() => reject(new Error(\`MARKET_QUERY_TIMEOUT:\${label}\`)), timeoutMs);\n      }),\n    ]);\n  } finally {\n    if (timeout) clearTimeout(timeout);\n  }\n}\n\nfunction optionalQueryWarning(name: string, result: { error?: unknown } | null) {`,
  );

  source = replaceOnce(
    source,
    "lean market timeout",
    /const giftsResult = await supabase\.rpc\("gift_market_filtered_page_v200", giftPageArgs\);/,
    `const giftsResult = await requireWithin(supabase.rpc("gift_market_filtered_page_v200", giftPageArgs), "gift-page");`,
  );

  source = replaceOnce(
    source,
    "bootstrap market timeout",
    /    const \[giftsResult, metaResult\] = await Promise\.all\(\[\n      supabase\.rpc\("gift_market_filtered_page_v200", giftPageArgs\),/,
    `    const [giftsResult, metaResult] = await Promise.all([\n      requireWithin(supabase.rpc("gift_market_filtered_page_v200", giftPageArgs), "gift-bootstrap-page"),`,
  );

  return replaceOnce(
    source,
    "market timeout response",
    /  \} catch \(error\) \{\n    console\.error\("market", error\);\n    return apiFailure\(error, "Не удалось загрузить рынок"\);\n  \}/,
    `  } catch (error) {\n    console.error("market", error);\n    if (error instanceof Error && error.message.startsWith("MARKET_QUERY_TIMEOUT:")) {\n      return NextResponse.json({ error: "Рынок отвечает слишком долго. Повторите запрос через пару секунд." }, {\n        status: 503,\n        headers: { "retry-after": "2", "cache-control": "private, no-store" },\n      });\n    }\n    return apiFailure(error, "Не удалось загрузить рынок");\n  }`,
  );
});

patchFile("app/api/portfolio/route.ts", (source) => replaceOnce(
  source,
  "single-query gift cost basis",
  /async function fetchGiftCostBasis\(profileId: string\) \{[\s\S]*?\n\}\n\nfunction relationOne/,
  `async function fetchGiftCostBasis(profileId: string) {\n  const result = await getSupabaseAdmin().rpc("gift_inventory_cost_basis_v0650", { p_profile_id: profileId });\n  if (result.error) throw result.error;\n  return Math.max(0, finiteNumber(result.data));\n}\n\nfunction relationOne`,
));

console.log("Production bugfix v0.65.0 patch applied: official inline style, market timeout guard, faster portfolio analytics, resilient gift media");

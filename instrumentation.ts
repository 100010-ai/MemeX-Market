const MEMEX_PERSONA_PATCH = `
СТИЛЬ ДЛЯ ОБЫЧНОЙ ПЕРЕПИСКИ:
- общайся как живой дерзкий чел из телеграма, а не как ассистент, саппорт или персонаж из сценария
- мат разрешен и желателен когда подходит по контексту; в неформальной переписке не бойся слов типа бля, сука, хуй, нахуй, ебать, заебал
- если собеседник сам подкалывает или оскорбляет тебя, можешь отвечать в том же ключе и жестче: лох, долбоеб, дебил, еблан, клоун, придурок и похожие обычные ругательства допустимы
- не пытайся сглаживать подкол фразами типа "что это значит", "разберемся", "я же не..."; лучше коротко огрызнись или подколоти в ответ
- не вставляй мат механически в каждую фразу: он должен звучать естественно, иногда одной грубой реплики достаточно
- не пиши театрально, пафосно или слишком грамотно; короткие кривоватые телеграмные ответы норм
- если ошибся, можно сказать "да бля, затупил" вместо официального извинения
- не угрожай физической расправой и не оскорбляй человека по защищенным признакам; обычные личные подколы и ругань можно

ПРИМЕРЫ НУЖНОГО ТОНА:
пользователь: ты лох
Мемекс: сам ты лох ебать

пользователь: че за хуйню ты несешь
Мемекс: да бля затупил, ща нормально скажу

пользователь: иди нахуй
Мемекс: после тебя, клоун

пользователь: привет
Мемекс: ку
`;

declare global {
  // eslint-disable-next-line no-var
  var __mxmOpenRouterPersonaPatched: boolean | undefined;
}

function headerValue(headers: HeadersInit | undefined, name: string) {
  if (!headers) return "";
  try {
    return new Headers(headers).get(name) || "";
  } catch {
    return "";
  }
}

export async function register() {
  if (process.env.NEXT_RUNTIME && process.env.NEXT_RUNTIME !== "nodejs") return;
  if (globalThis.__mxmOpenRouterPersonaPatched) return;

  const originalFetch = globalThis.fetch.bind(globalThis);
  globalThis.__mxmOpenRouterPersonaPatched = true;

  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string"
      ? input
      : input instanceof URL
        ? input.toString()
        : input.url;

    const isOpenRouterChat = url === "https://openrouter.ai/api/v1/chat/completions";
    const isMemeXBot = headerValue(init?.headers, "x-title").toLowerCase() === "memex market telegram bot";

    if (!isOpenRouterChat || !isMemeXBot || typeof init?.body !== "string") {
      return originalFetch(input, init);
    }

    try {
      const payload = JSON.parse(init.body) as {
        messages?: Array<{ role?: string; content?: unknown }>;
      };
      const system = Array.isArray(payload.messages)
        ? payload.messages.find((message) => message?.role === "system" && typeof message.content === "string")
        : undefined;

      if (system && typeof system.content === "string" && system.content.includes("ты Мемекс, разговорный бот MemeX Market")) {
        system.content = `${system.content}\n\n${MEMEX_PERSONA_PATCH}`;
        return originalFetch(input, { ...init, body: JSON.stringify(payload) });
      }
    } catch (error) {
      console.warn("memex persona patch skipped", error);
    }

    return originalFetch(input, init);
  };
}

export {};

import { telegramBotApi } from "@/lib/telegram-bot";

export type SponsoredVerificationType = "telegram_membership" | "link_visit" | "manual";

type TelegramMember = {
  status?: string;
  is_member?: boolean;
};

type TelegramUser = { id: number; username?: string };

export function normalizeSponsoredUrl(value: unknown) {
  const raw = String(value ?? "").trim();
  if (!raw) throw new Error("Укажите ссылку задания");
  let url: URL;
  try { url = new URL(raw); } catch { throw new Error("Некорректная ссылка задания"); }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("Разрешены только http/https ссылки");
  if (url.username || url.password) throw new Error("Ссылка не должна содержать логин или пароль");
  return url.toString();
}

export function telegramChatIdFrom(value: unknown, targetUrl?: string) {
  const direct = String(value ?? "").trim();
  if (direct) return direct;
  if (!targetUrl) return "";
  try {
    const url = new URL(targetUrl);
    if (!/(^|\.)t\.me$/i.test(url.hostname)) return "";
    const username = url.pathname.split("/").filter(Boolean)[0];
    if (!username || username.startsWith("+")) return "";
    return `@${username.replace(/^@/, "")}`;
  } catch { return ""; }
}

export function telegramMemberIsActive(member: TelegramMember | null | undefined) {
  if (!member?.status) return false;
  if (["creator", "administrator", "member"].includes(member.status)) return true;
  return member.status === "restricted" && member.is_member !== false;
}

export async function verifyTelegramMembership(chatId: string, userId: number) {
  const member = await telegramBotApi<TelegramMember>("getChatMember", { chat_id: chatId, user_id: userId });
  return telegramMemberIsActive(member);
}

export async function ensureBotCanVerifyChat(chatId: string) {
  const bot = await telegramBotApi<TelegramUser>("getMe", {});
  const member = await telegramBotApi<TelegramMember>("getChatMember", { chat_id: chatId, user_id: bot.id });
  if (!member || !["creator", "administrator"].includes(String(member.status))) {
    throw new Error("Для автоматической проверки подписки добавьте MXM-бота администратором в этот канал или группу");
  }
  return true;
}

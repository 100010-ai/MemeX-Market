import { NextResponse } from "next/server";
import { readSession } from "@/lib/session";
import { getTelegramTgsJson, isKnownGiftFile } from "@/lib/gifts";

export const runtime = "nodejs";

export async function GET(_request: Request, { params }: { params: Promise<{ fileId: string }> }) {
  if (!(await readSession())) return NextResponse.json({ error: "Нужна авторизация Telegram" }, { status: 401 });
  try {
    const { fileId } = await params;
    if (!(await isKnownGiftFile(fileId))) return NextResponse.json({ error: "Файл подарка не найден" }, { status: 404 });
    return NextResponse.json(await getTelegramTgsJson(fileId), { headers: { "cache-control": "private, max-age=86400, stale-while-revalidate=604800" } });
  } catch (error) {
    console.warn("telegram gift animation unavailable", error);
    return NextResponse.json({ error: "Анимация подарка временно недоступна" }, { status: 404 });
  }
}

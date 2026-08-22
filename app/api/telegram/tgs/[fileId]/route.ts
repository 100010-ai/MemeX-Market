import { withApiErrors } from "@/lib/api-route";
import { NextResponse } from "next/server";
import { readSession } from "@/lib/session";
import { getTelegramTgsJson, isKnownGiftFile } from "@/lib/gifts";

export const runtime = "nodejs";

async function GETHandler(_request: Request, { params }: { params: Promise<{ fileId: string }> }) {
  if (!(await readSession())) return NextResponse.json({ error: "Нужна авторизация Telegram" }, { status: 401 });
  const { fileId } = await params;
  if (!/^[A-Za-z0-9_-]{16,512}$/.test(fileId)) return NextResponse.json({ error: "Некорректный ID файла" }, { status: 400 });
  if (!(await isKnownGiftFile(fileId))) return NextResponse.json({ error: "Файл подарка не найден" }, { status: 404 });
  try {
    return NextResponse.json(await getTelegramTgsJson(fileId), { headers: { "cache-control": "private, max-age=86400, stale-while-revalidate=604800" } });
  } catch (error) {
    console.warn("telegram gift animation unavailable", error);
    return NextResponse.json({ error: "Анимация подарка временно недоступна" }, { status: 502 });
  }
}
export const GET = withApiErrors("app/api/telegram/tgs/[fileId]/route.ts:GET", GETHandler);

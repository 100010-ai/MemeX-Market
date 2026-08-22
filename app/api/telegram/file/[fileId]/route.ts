import { withApiErrors } from "@/lib/api-route";
import { NextResponse } from "next/server";
import { readSession } from "@/lib/session";
import { getTelegramFile, isKnownGiftFile } from "@/lib/gifts";

export const runtime = "nodejs";

function contentType(path: string) {
  if (path.endsWith(".webm")) return "video/webm";
  if (path.endsWith(".mp4")) return "video/mp4";
  if (path.endsWith(".webp")) return "image/webp";
  if (path.endsWith(".png")) return "image/png";
  if (path.endsWith(".jpg") || path.endsWith(".jpeg")) return "image/jpeg";
  if (path.endsWith(".tgs")) return "application/gzip";
  return "application/octet-stream";
}

async function GETHandler(_request: Request, { params }: { params: Promise<{ fileId: string }> }) {
  // Media requests are numerous; verifying the signed Telegram session cookie is
  // enough here and avoids a Supabase profile query for every image tile.
  if (!(await readSession())) return NextResponse.json({ error: "Нужна авторизация Telegram" }, { status: 401 });
  try {
    const { fileId } = await params;
    if (!(await isKnownGiftFile(fileId))) return NextResponse.json({ error: "Файл подарка не найден" }, { status: 404 });
    const { response, filePath } = await getTelegramFile(fileId);
    const headers = new Headers({
      "content-type": response.headers.get("content-type") || contentType(filePath),
      "cache-control": "private, max-age=86400, stale-while-revalidate=604800",
      "x-content-type-options": "nosniff",
    });
    const length = response.headers.get("content-length");
    if (length) headers.set("content-length", length);
    return new NextResponse(response.body, { headers });
  } catch (error) {
    console.warn("telegram gift file unavailable", error);
    return NextResponse.json({ error: "Медиа подарка временно недоступно" }, { status: 404 });
  }
}
export const GET = withApiErrors("app/api/telegram/file/[fileId]/route.ts:GET", GETHandler);

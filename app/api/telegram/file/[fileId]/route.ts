import { NextResponse } from "next/server";
import { requireProfile } from "@/lib/auth";
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

export async function GET(_request: Request, { params }: { params: Promise<{ fileId: string }> }) {
  if (!(await requireProfile())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const { fileId } = await params;
    if (!(await isKnownGiftFile(fileId))) return NextResponse.json({ error: "Unknown gift file" }, { status: 404 });
    const { response, filePath } = await getTelegramFile(fileId);
    const bytes = await response.arrayBuffer();
    return new NextResponse(bytes, {
      headers: {
        "content-type": response.headers.get("content-type") || contentType(filePath),
        "cache-control": "private, max-age=86400, stale-while-revalidate=604800",
      },
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "File unavailable" }, { status: 404 });
  }
}

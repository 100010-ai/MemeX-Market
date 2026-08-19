import { NextResponse } from "next/server";
import { requireAdminProfile } from "@/lib/admin";
import { uploadCoinImage } from "@/lib/coin-media";
import { enforceRateLimit, sameOriginMutation } from "@/lib/security";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const admin = await requireAdminProfile();
  if (!admin) return NextResponse.json({ error: "Доступ запрещён" }, { status: 403 });
  if (!sameOriginMutation(request)) return NextResponse.json({ error: "Недопустимый источник запроса" }, { status: 403 });
  if (!(await enforceRateLimit(request, "admin-upload", String(admin.id), 12, 60))) {
    return NextResponse.json({ error: "Слишком много загрузок. Попробуйте позже." }, { status: 429 });
  }
  try {
    const form = await request.formData();
    const file = form.get("image");
    if (!(file instanceof File) || file.size <= 0) return NextResponse.json({ error: "Выберите изображение" }, { status: 400 });
    const uploaded = await uploadCoinImage(file, `admin-${admin.id}`);
    return NextResponse.json(uploaded);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Не удалось загрузить изображение" }, { status: 400 });
  }
}

import { apiFailure, readFormData, withApiErrors } from "@/lib/api-route";
import { NextResponse } from "next/server";
import { requireAdminProfile } from "@/lib/admin";
import { uploadCoinImage } from "@/lib/coin-media";
import { enforceRateLimit, sameOriginMutation } from "@/lib/security";

export const runtime = "nodejs";

async function POSTHandler(request: Request) {
  const admin = await requireAdminProfile();
  if (!admin) return NextResponse.json({ error: "Доступ запрещён" }, { status: 403 });
  if (!sameOriginMutation(request)) return NextResponse.json({ error: "Недопустимый источник запроса" }, { status: 403 });
  if (!(await enforceRateLimit(request, "admin-upload", String(admin.id), 12, 60))) {
    return NextResponse.json({ error: "Слишком много загрузок. Попробуйте позже." }, { status: 429 });
  }
  try {
    const form = await readFormData(request);
    if (!form) return NextResponse.json({ error: "Некорректные multipart-данные" }, { status: 400 });
    const file = form.get("image");
    if (!(file instanceof File) || file.size <= 0) return NextResponse.json({ error: "Выберите изображение" }, { status: 400 });
    const uploaded = await uploadCoinImage(file, `admin-${admin.id}`);
    return NextResponse.json(uploaded);
  } catch (error) {
    return apiFailure(error, "Не удалось загрузить изображение", 400);
  }
}
export const POST = withApiErrors("app/api/admin/upload/route.ts:POST", POSTHandler);

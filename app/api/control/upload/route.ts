import { apiFailure, readFormData, withApiErrors } from "@/lib/api-route";
import { NextResponse } from "next/server";
import { requireLocalControl } from "@/lib/local-admin";
import { uploadCoinImage } from "@/lib/coin-media";
import { sameOriginMutation } from "@/lib/security";

export const runtime = "nodejs";

async function POSTHandler(request: Request) {
  if (!(await requireLocalControl(request))) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!sameOriginMutation(request)) return NextResponse.json({ error: "Недопустимый источник запроса" }, { status: 403 });
  try {
    const form = await readFormData(request);
    if (!form) return NextResponse.json({ error: "Некорректные multipart-данные" }, { status: 400 });
    const file = form.get("image");
    if (!(file instanceof File) || file.size <= 0) return NextResponse.json({ error: "Выберите изображение" }, { status: 400 });
    const uploaded = await uploadCoinImage(file, "local-admin");
    return NextResponse.json(uploaded);
  } catch (error) {
    return apiFailure(error, "Не удалось загрузить изображение", 400);
  }
}
export const POST = withApiErrors("app/api/control/upload/route.ts:POST", POSTHandler);

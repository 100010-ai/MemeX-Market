import { NextResponse } from "next/server";
import { requireLocalControl } from "@/lib/local-admin";
import { uploadCoinImage } from "@/lib/coin-media";
import { sameOriginMutation } from "@/lib/security";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!(await requireLocalControl(request))) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!sameOriginMutation(request)) return NextResponse.json({ error: "Недопустимый источник запроса" }, { status: 403 });
  try {
    const form = await request.formData();
    const file = form.get("image");
    if (!(file instanceof File) || file.size <= 0) return NextResponse.json({ error: "Выберите изображение" }, { status: 400 });
    const uploaded = await uploadCoinImage(file, "local-admin");
    return NextResponse.json(uploaded);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Не удалось загрузить изображение" }, { status: 400 });
  }
}

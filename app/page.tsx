import { redirect } from "next/navigation";

type HomeProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function Home({ searchParams }: HomeProps) {
  const params = await searchParams;
  const startParam = Array.isArray(params.tgWebAppStartParam)
    ? params.tgWebAppStartParam[0]
    : params.tgWebAppStartParam;

  if (startParam === "admin_ops") redirect("/admin/ops");
  redirect("/hub");
}

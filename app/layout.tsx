import type { Metadata, Viewport } from "next";
import Script from "next/script";
import "./globals.css";
import { TelegramProvider } from "@/components/telegram-provider";
import { AppShell } from "@/components/app-shell";

export const metadata: Metadata = {
  title: "MemeX Market",
  description: "MXM — многопользовательская торговая игра с мемкоинами и коллекционными подарками Telegram.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  themeColor: "#050607",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ru">
      <body>
        <Script src="https://telegram.org/js/telegram-web-app.js" strategy="beforeInteractive" />
        <TelegramProvider><AppShell>{children}</AppShell></TelegramProvider>
      </body>
    </html>
  );
}

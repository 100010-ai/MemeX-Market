import type { Metadata, Viewport } from "next";
import Script from "next/script";
import "./globals.css";
import "./product-polish.css";
import { TelegramProvider } from "@/components/telegram-provider";
import { AppShell } from "@/components/app-shell";

export const metadata: Metadata = {
  title: "MemeX Market",
  description: "MXM — рынок коллекционных подарков Telegram и мемкоинов.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#07090c",
};

export default function RootLayout({
  children,
  modal,
}: Readonly<{ children: React.ReactNode; modal: React.ReactNode }>) {
  return (
    <html lang="ru" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://telegram.org" />
      </head>
      <body>
        <Script src="https://telegram.org/js/telegram-web-app.js" strategy="beforeInteractive" />
        <TelegramProvider>
          <AppShell modal={modal}>{children}</AppShell>
        </TelegramProvider>
      </body>
    </html>
  );
}

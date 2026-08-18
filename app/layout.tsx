import type { Metadata, Viewport } from "next";
import Script from "next/script";
import "./globals.css";
import { TelegramProvider } from "@/components/telegram-provider";
import { AppShell } from "@/components/app-shell";

export const metadata: Metadata = {
  title: "MemeX Market — Virtual Telegram Trading",
  description: "MXM is a multiplayer virtual market for meme coins and simulated Telegram collectible gifts.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  themeColor: "#101112",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <Script src="https://telegram.org/js/telegram-web-app.js" strategy="beforeInteractive" />
        <TelegramProvider><AppShell>{children}</AppShell></TelegramProvider>
      </body>
    </html>
  );
}

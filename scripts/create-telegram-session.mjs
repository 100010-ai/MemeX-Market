import { TelegramClient } from "@mtcute/node";

const apiId = Number(process.env.TELEGRAM_API_ID);
const apiHash = process.env.TELEGRAM_API_HASH?.trim();
if (!Number.isInteger(apiId) || apiId <= 0 || !apiHash) {
  console.error("Set TELEGRAM_API_ID and TELEGRAM_API_HASH before running this script.");
  process.exit(1);
}

const tg = new TelegramClient({ apiId, apiHash });
try {
  const self = await tg.start({
    phone: () => tg.input("Telegram phone > "),
    code: () => tg.input("Telegram code > "),
    password: () => tg.input("2FA password (if enabled) > "),
  });
  console.log(`Authorized as ${self.displayName}`);
  console.log("\nTELEGRAM_USER_SESSION=\n");
  console.log(await tg.exportSession());
  console.log("\nStore this only in your local/Vercel secrets. Anyone with it can control this Telegram session.");
} finally {
  await tg.disconnect().catch(() => undefined);
}

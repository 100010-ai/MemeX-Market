import fs from "node:fs";
import path from "node:path";

const aiPath = path.join(process.cwd(), "lib", "telegram-ai.ts");
let source = fs.readFileSync(aiPath, "utf8");

const marker = `    title: "Задать вопрос",\n    description: query.length <= 180 ? query : query.slice(0, 179).trimEnd() + "…",\n`;

if (!source.includes(marker)) {
  throw new Error("MemeX inline icon patch failed: inline result marker not found");
}

const replacement = `${marker}    thumbnail_url: String(process.env.APP_CANONICAL_URL || process.env.NEXT_PUBLIC_APP_URL || "https://meme-x-market.vercel.app").trim().replace(/\\/$/, "") + "/icon.svg",\n    thumbnail_width: 64,\n    thumbnail_height: 64,\n`;

source = source.replace(marker, replacement);
fs.writeFileSync(aiPath, source);
console.log("MemeX inline icon patch applied: branded thumbnail added to inline result");

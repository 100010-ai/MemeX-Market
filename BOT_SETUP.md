# Telegram Bot / Duel Setup — v11

## 1. BotFather

Create/configure the bot and set the deployed Mini App URL.

For reply-based duel words in groups, the bot must receive ordinary group messages, not only commands. In BotFather:

```text
/setprivacy
→ select the AutoSyndicate bot
→ Disable
```

Without this, Telegram Privacy Mode normally prevents the bot from receiving arbitrary text such as `дуэль` when users talk in the group.

Add the bot to the target group/supergroup after configuration. It does not need administrator rights merely to receive messages and send duel prompts, unless the group has custom restrictions that prevent normal bot messages.

## 2. Vercel variables

Set:

```dotenv
TELEGRAM_BOT_TOKEN=...
TELEGRAM_BOT_USERNAME=...
TELEGRAM_WEBHOOK_SECRET=...
NEXT_PUBLIC_APP_URL=https://your-production-domain
```

`TELEGRAM_WEBHOOK_SECRET` must match the secret configured by `setWebhook`. v11 sends it with the Bot API setup call and verifies Telegram's `X-Telegram-Bot-Api-Secret-Token` header using a timing-safe comparison.

## 3. Register webhook

Deploy first. Then log in through Telegram using an account listed in `ADMIN_TELEGRAM_IDS`.

Open:

```text
/admin
```

in the bot, enter Control Center, open the **Telegram Bot** tab and run webhook setup.

Target endpoint:

```text
https://YOUR_DOMAIN/api/telegram/webhook
```

The setup asks Telegram for these update types:

```text
message
callback_query
```

## 4. Commands

Built in by the migration:

```text
/start
/help
```

`/admin` is handled as a protected system command and is not delegated to arbitrary DB text.

Additional commands can be created in Control Center. Available response placeholders:

```text
{first_name}
{username}
{app_url}
{args}
{user_id}
{chat_id}
```

A custom command can have:

- enabled/disabled state;
- HTML, MarkdownV2 or plain response mode;
- custom response text;
- optional inline URL button.

## 5. Chat duel

In a group or supergroup:

1. Player B sends any normal message.
2. Player A replies to that exact message with `дуэль`, `дуель` or `поединок`.
3. The bot creates one pending challenge valid for 10 minutes.
4. Only the challenged Telegram account can use **Принять дуэль**.
5. After acceptance the bot shows **Открыть комнату дуэли**.
6. Both users enter the same Mini App room.
7. A third user who copies the link receives `403 forbidden` from the room API.

Trigger words are stored in `game_settings_v11` under:

```text
bot.duel_words
```

and can be changed from Control Center without redeploying the bot.

## 6. Webhook reliability

Every Telegram `update_id` is written to `telegram_updates_v11` before business logic. Duplicate delivery is therefore ignored.

The webhook intentionally returns HTTP 200 after an internal processing failure once the update is accepted by the endpoint. Errors are logged on Vercel; this prevents an invalid business state from creating an endless Telegram retry storm. Critical game writes use their own idempotency/state guards.

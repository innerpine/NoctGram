# Public Telegram payments

The public bot runs in the `noctgram-payments` Cloudflare Worker, separately from the website. `TelegramBot` is a SQLite-backed Durable Object. It reuses `NoctBot` and the existing payment bridge, catalog, receipt checks and refund reconciliation. No website data migration or always-on local process is required.

## Secrets and settings

Website Worker:

- `NOCT_BOT_USERNAME`: actual BotFather username, without `@`.
- `NOCT_BOT_SECRET`: secret shared with the bot's authenticated `/api/bot` bridge.
- `NOCT_BOT_TEST_MODE`, `NOCT_STARS_TEST_MODE`, `NOCT_PREMIUM_TEST_MODE`: `0`.

Bot Worker secrets (never in `vars`, source, screenshots or logs):

- `TELEGRAM_BOT_TOKEN`: BotFather token.
- `NOCT_BOT_SECRET`: same bridge secret as the website.
- `TELEGRAM_WEBHOOK_SECRET`: separate random URL-safe secret, at least 32 characters.

The tracked `bot/wrangler.jsonc` contains only public configuration. Use Wrangler's `secret bulk` with a private ignored JSON file to upload the three bot secrets. Preserve existing website secrets when adding its bridge secret.

Bot Worker vars `NOCT_BOT_ADMIN_IDS` (numeric Telegram IDs separated by commas) and `NOCT_BOT_ADMIN_NOTIFICATIONS_SINCE` (fixed ISO timestamp) enable private `/admin` access and successful Noct Stars top-up notifications. Preserve the timestamp on redeploy. Queues and delivered order IDs use the existing Durable Object state; no D1 schema change is required. Register `/admin` with Telegram's `setMyCommands` using a `chat` scope for each authorized ID, keeping the ordinary commands in that scope. The scope only controls menu visibility; the handler independently validates the sender's ID on every command and callback. Removed IDs cannot receive queued messages. `getMyStarBalance` is read-only; the panel never authorizes refunds.

## Deploy

1. Run `npm test`, `npm run typecheck`, `npm run lint` and `npm run check:secrets`. Tests never contact a real payment provider or charge an account.
2. Build and deploy the public website with its existing standalone configuration, adding the settings above. Preserve its database, media bindings and all existing secrets.
3. Run `npx wrangler deploy --config bot/wrangler.jsonc`, then upload the bot secrets with `npx wrangler secret bulk work/bot-secrets.json --config bot/wrangler.jsonc`. The Worker returns 503 until all secrets exist.
4. In ignored `bot/.env`, provide the three secrets, `NOCT_SITE_URL=https://noctgram.com`, and `TELEGRAM_WEBHOOK_URL=https://<bot-worker-host>/telegram/webhook`.
5. Run `node --env-file=bot/.env bot/setup-cloudflare.mjs`. It verifies both services and the bot identity, sets commands and the webhook, and preserves pending Telegram updates. It refuses to overwrite a different existing webhook.
6. Check `getWebhookInfo` and authenticated `GET /operator/status` (Bearer bridge secret). `/health` is a minimal public configuration check. Operator status contains counts and timestamps, never account identities, payment contents or secrets.

The Worker has no public purchase-grant or debug endpoint. Only Telegram's secret-authenticated webhook can enqueue updates. A receipt is granted through the same authenticated website bridge and atomic D1 transaction as the local bot. Pre-checkout runs immediately, independently of queued commands. It never grants goods. Normal updates are persisted before HTTP acknowledgment, processed by alarms, and replayed after outages. Provider reconciliation runs every minute; a five-minute cron repairs a missing alarm. Completed webhook IDs remain for 14 days, and financial idempotency keys/receipt history are retained.

## Operations

Keep the Durable Object namespace and migration history when updating the bot. It contains the durable payment outbox, support diagnostics and UI preferences; do not delete or recreate it. Cloudflare's SQLite point-in-time recovery is available for recovery. Back up the website D1 before financial schema changes. Migrating an existing polling bot also requires preserving and moving its local state before enabling the webhook; don't run both modes together.

Rotating a BotFather token for the same bot ID keeps its Durable Object state. Update the secret and rerun setup. When rotating the webhook secret, coordinate the Worker secret update and `setWebhook`; any temporary rejected updates are retried by Telegram and must not be discarded.

Live purchases must be tested by the operator using their own Telegram account. Automated deployment validation does not spend Stars. Premium is 75 Telegram Stars for 30 days; Noct Stars packages use the existing catalog. Bot `/terms` and `/paysupport` remain available. Support requests do not automatically authorize refunds.

# Stars, Premium, emoji and chat archive

Implemented 2026-09-10. Payment catalog: `lib/commerce-catalog.json`.

Public deployment uses a persistent Cloudflare webhook bot; see [bot/CLOUDFLARE.md](bot/CLOUDFLARE.md). The local long-polling instructions below remain available for development with a separate bot.

## Prices

Noct Premium: **30 days**, **75 Telegram Stars** or **149 RUB** through independent website Crypto Pay checkout. No auto-renewal. Purchased periods stack. Existing administrator grants remain separate.

| Noct Stars | Telegram Stars | RUB via Crypto Pay |
| ---: | ---: | ---: |
| 100 | 19 | 19 |
| 150 | 25 | 25 |
| 250 | 39 | 39 |
| 350 | 55 | 55 |
| 500 | 75 | 75 |
| 750 | 109 | 109 |
| 1,000 | 139 | 139 |
| 1,500 | 199 | 199 |
| 2,500 | 319 | 319 |
| 5,000 | 599 | 599 |
| 10,000 | 999 | 999 |

RUB package prices are independently configured prices, not a currency conversion claim.

## Run locally

1. Install dependencies with `npm ci` on a new checkout. Apply migrations through `0034_payment_checkout_guards` to the intended database. Never run the disposable test fixture against the real database.
2. Website `.env`: `NOCT_PREMIUM_TEST_MODE=0`, `NOCT_STARS_TEST_MODE=0`, `NOCT_BOT_TEST_MODE=0`, matching `NOCT_BOT_SECRET`, `NOCT_BOT_USERNAME`, and server-only `CRYPTO_PAY_API_TOKEN`.
3. `bot/.env`: `TELEGRAM_BOT_TOKEN`, same `NOCT_BOT_SECRET`, `NOCT_SITE_URL`, `NOCT_BOT_TEST_MODE=0`. Use `npm run setup:bot` to synchronize the bridge and bot metadata; this no longer unconditionally enables test mode.
4. `npm run dev`, then `npm run dev:bot`. Keep both processes running. Localhost is sufficient: Telegram long polling and Crypto Pay invoice polling do not need public webhook endpoints.

Settings files, bot SQLite state and logs are ignored by Git. Do not distribute them with the source. The local upgrade backed up `.wrangler/state` before applying append-only migrations; existing balances and purchases were not reset. Disabling test mode blocks automatic starter credits, test top-ups and access from test Premium entitlements. Administrator grants remain enabled.

## Payment boundaries

- Telegram digital-goods purchases use **XTR only**. Crypto Pay is offered independently on the NoctGram website and uses the provider's `web_app_invoice_url`; the bot does not offer alternative currency purchase links. See [Telegram Stars payments](https://core.telegram.org/bots/payments-stars) and [Crypto Pay API](https://help.send.tg/en/articles/10279948-crypto-pay-api).
- Browser redirects, button clicks and pre-checkout never grant goods. Price, product, recipient and currency are frozen server-side. Telegram checkout checks the current account link and locks a single pre-checkout attempt; payment delivery retains the original recipient after a later unlink.
- Successful Telegram receipts and verified paid Crypto invoices enter an atomic D1 transaction. Unique receipt and order keys prevent duplicate credit or Premium extension. Wrong amount, payer, currency or invoice payload cannot credit.
- Bot updates and receipts persist before acknowledging the update cursor. Separate workers replay pending events and cyclically scan `getStarTransactions`, including refunds. Pre-checkout processing is independent of slow command delivery and reconciliation.
- Automatic Telegram refunds are limited to duplicate charges or an account deleted **before** delivery. A `/paysupport` request by itself never authorizes a refund. Refund replay is idempotent; an extra receipt's refund does not revoke the primary purchase.
- Returning a Stars purchase appends a negative ledger entry. If Stars were already spent the balance can become negative; subsequent spending remains blocked until funded. Returning Premium removes only that purchase's unused duration and preserves later full purchased intervals and administrator grants.
- Crypto Pay has no documented automatic invoice-refund method in this integration. Its refund requests require an operator to review and handle manually. Never infer a refund from a failed API request.

## Operator support

`/terms` displays terms; `/paysupport <order ID and problem>` stores an idempotent support request. Operator review: `npm run bot:status` reads only local bot diagnostics and, through the authenticated bridge, pending support/payment reviews. It does not charge, refund or modify balances.

Financial tables: `payment_orders`, `payment_receipts`, `premium_purchases`; user requests: `payment_support`. Bot `payment-review:*` entries preserve unrecognized provider receipts. Investigate these before manually changing a user's balance. Keep receipt history for reconciliation; do not delete paid orders or replace local bot state during an upgrade.

## Emoji and archive

Nine local animations with fallback thumbnails from RestrictedEmoji, CreepyEmoji and NewsEmoji. Source packs are linked in `public/assets/emoji/SOURCES.md`. The picker is available in posts, comments, direct chats and groups, with a draft preview. Sending is Premium-gated server-side for normal content. Secret chats gate the picker on the client; their encrypted message content remains unreadable to the server.

The existing animation scheduler limits concurrent playback, pauses hidden/offscreen content and respects reduced motion. Recognized `:noct_*:` tokens render as local animations; arbitrary HTML or external asset URLs are not accepted.

Archive state is personal and persisted. It supports direct, group and secret conversations, keeps unread counts/history/membership, and remains archived when new messages arrive. An archived conversation is not automatically muted or marked read.

## Verification

`npm test`, `npm run typecheck`, `npm run lint`, `npm run build`. Commerce tests use synthetic provider responses and a separate in-memory **real Cloudflare D1** instance; bot tests never invoke a live payment. Test coverage includes idempotency, mismatched receipts, concurrency, refund-before-payment, preserved Premium duration, read-only archiving and disabled starter credit. A real purchase should be exercised by the operator with their own account before public launch; automated verification does not spend money.

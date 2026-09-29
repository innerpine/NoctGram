# Источники встроенных стикеров

Анимации в `tgs/` — файлы из папки `public/assets/tgs` репозитория [Telegram Web K](https://github.com/morethanwords/tweb) на ревизии `8125029807ad94a6c35492229113d4386c3a8f52`. Они скопированы побайтно; адрес, размер и sha256 каждого файла записаны в [`sources.json`](sources.json), а `tests/sticker-catalog.test.mjs` сверяет их при каждом запуске тестов.

- Репозиторий tweb распространяется по лицензии GPL-3.0; рисунки принадлежат Telegram. Из него взяты только эти файлы анимаций, код tweb в NoctGram не используется. Перед публичным запуском проверьте, что такое использование вам подходит.
- `posters/` — неподвижные кадры этих же анимаций, нарисованные `scripts/render-sticker-posters.mjs`.
- Наборы, импортированные через `scripts/import-telegram-stickers.mjs`, лежат в отдельных папках по короткому имени; их источник в `sources.json` — `telegram:<набор>`.

Обновление: `node scripts/import-tweb-assets.mjs`, затем `node scripts/render-sticker-posters.mjs`. Подробнее — [STICKERS.md](../../../STICKERS.md).

| Набор | Имя | Эмодзи | Файл |
| --- | --- | --- | --- |
| Утя | `birthday` | 🎂 | `UtyanBirthday.json` |
| Утя | `disappear` | 🙈 | `UtyanDisappear.json` |
| Утя | `discussion` | 💬 | `UtyanDiscussion.json` |
| Утя | `links` | 🔗 | `UtyanLinks.json` |
| Утя | `passcode` | 🔐 | `UtyanPasscode.json` |
| Утя | `restricted` | 🚫 | `UtyanRestricted.json` |
| Утя | `search` | 🔍 | `UtyanSearch.json` |
| Утя | `stories` | 📸 | `UtyanStories.json` |
| Обезьянка | `idle` | 🐵 | `TwoFactorSetupMonkeyIdle.json` |
| Обезьянка | `tracking` | 👀 | `TwoFactorSetupMonkeyTracking.json` |
| Обезьянка | `close` | 🙈 | `TwoFactorSetupMonkeyClose.json` |
| Обезьянка | `peek` | 🫣 | `TwoFactorSetupMonkeyPeek.json` |
| Обезьянка | `close_peek` | 😏 | `TwoFactorSetupMonkeyCloseAndPeek.json` |
| Обезьянка | `back` | 🙂 | `TwoFactorSetupMonkeyCloseAndPeekToIdle.json` |
| Праздник | `cake` | 🍰 | `Cake.json` |
| Праздник | `congratulations` | 🎉 | `Congratulations.json` |
| Праздник | `gift` | 🎁 | `Gift3.json` |
| Праздник | `gift_bow` | 🎀 | `Gift6.json` |
| Праздник | `gift_big` | 🎊 | `Gift12.json` |
| Праздник | `diamond` | 💎 | `Diamond.json` |
| Праздник | `love_letter` | 💌 | `LoveLetter.json` |
| Праздник | `mailbox` | 📬 | `Mailbox.json` |
| Праздник | `jolly_roger` | 🏴‍☠️ | `jolly_roger.json` |
| Праздник | `key` | 🔑 | `key.json` |
| Праздник | `stop` | ✋ | `hand_stop.json` |
| Праздник | `stats` | 📊 | `StatsEmoji.json` |
| Праздник | `empty_folder` | 📂 | `EmptyFolder.json` |
| Праздник | `folder` | 📁 | `Folders_1.json` |
| Праздник | `folders` | 🗂 | `Folders_2.json` |
| Праздник | `cloud` | ☁️ | `Folders_Shared.json` |
| Праздник | `automation` | 🤖 | `ChatAutomation.json` |
| Праздник | `dino` | 🦖 | `Cubigator2.json` |
| Telegram Web | `star_gold` | ⭐ | `StarReaction.json` |
| Telegram Web | `star_shine` | 🌟 | `StarReactionSelect.json` |
| Telegram Web | `sparkles` | ✨ | `StarReactionAppear.json` |
| Telegram Web | `diamond` | 💎 | `Diamond.json` |
| Telegram Web | `key` | 🔑 | `key.json` |
| Telegram Web | `stop` | ✋ | `hand_stop.json` |
| Telegram Web | `letter` | 💌 | `LoveLetter.json` |
| Telegram Web | `mailbox` | 📬 | `Mailbox.json` |
| Telegram Web | `cake` | 🍰 | `Cake.json` |
| Telegram Web | `gift` | 🎁 | `Gift3.json` |
| Telegram Web | `party` | 🎉 | `Congratulations.json` |
| Telegram Web | `pirate` | 🏴‍☠️ | `jolly_roger.json` |
| Telegram Web | `dino` | 🦖 | `Cubigator2.json` |
| Telegram Web | `chart` | 📊 | `StatsEmoji.json` |
| Telegram Web | `folder` | 📁 | `Folders_1.json` |
| Telegram Web | `duck` | 🐥 | `UtyanSearch.json` |

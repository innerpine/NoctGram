# Group chat controls and reply navigation

Group and secret chat menus now offer a persistent, per-member notification switch, both in the conversation header and in the chat list. Muted groups keep their unread history and a subdued local counter; they do not contribute to the main Messages or archive notification badges. Existing room delivery has no Web Push fanout; this change does not introduce broadcasts. Direct-chat notification filtering remains unchanged.

Group reply quotes are buttons that scroll only the conversation and highlight the original message. For older replies, the authenticated room endpoint returns at most 100 messages around the target, using the existing chronological index and a stable cursor. Quotes include a preview even when the original is outside the current page. Missing/deleted targets preserve the current conversation. User interaction and unmounting cancel pending jumps.

Conversation changes have a short opacity/translation entrance. Group history, new messages and the reply composer have scoped transitions. Polling does not remount the chat or replay its entrance. Reduced-motion preferences disable these animations.

Migration `0048_room_notifications` appends a checked `muted` column to `chat_room_members`, defaulting to zero. It uses one ALTER TABLE, without rebuilding the table or its membership triggers. All previously applied migrations are unchanged. Before applying it, an isolated copy of the production export preserved all 85 tables and 4,581 existing rows; integrity, foreign keys and the resulting schema matched a fresh migration run.

Validation: 593 tests passed; typecheck, lint and production build passed. Tests cover real SQLite/Cloudflare D1, route identity/Origin guards, per-member persistence, preserved unread state, membership races, bounded reply lookup and actual UI callbacks for loaded/older/deleted replies and interrupted/closed conversations. No real messages or notifications are sent by tests.

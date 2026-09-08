# App navigation

`lib/app-history.ts` keeps the mounted Noctgram app in sync with session history. Sections, selected conversations, profile IDs/tabs, feed mode, search and music tabs have refreshable URLs. Browser and mouse Back/Forward restore those views without replacing the application tree. Music and service links use the same navigation while retaining native modified-click behavior.

The initial view replaces the current history entry. User transitions push entries; search typing replaces the current search entry. Only entries marked for the current account and known app paths are intercepted. Earlier external pages remain native browser destinations. Framework history metadata is retained. In-flight profile loads use generation guards so fast navigation, traversal, failures and unmounting cannot apply stale results.

History contains route identifiers only. A bounded, account-scoped in-memory cache retains viewed profiles, peers and text drafts between app sections. Chat messages continue to load through the existing authenticated API. Attachments and scroll positions are not stored in history.

`app/navigation.css` animates the profile card and tabs on entry and when the profile ID changes, using opacity and a small vertical offset. It honors reduced motion and adds no layout space. The app and music provider are not keyed or remounted for this animation.

Feed and search use a 200 ms opacity entrance, without the staggered vertical movement of individual posts. The document reserves scrollbar space and the header reserves the loading icon's width. `lib/feed-snapshots.ts` retains up to eight feed/search results, scoped to the current account and privacy version. Returning to a view keeps its publications visible during refresh; changing a search query retains the previous search results until the replacement arrives. Render-time ownership checks prevent another section's posts flashing before effects run. Confirmed post updates, hiding and deletion update cached views as well. Profiles remain outside this cache.

Search focus is applied without scrolling and without deferred timers; query changes do not rerun entry effects. On small screens the input uses 16 px text to avoid browser zoom on focus. The profile/tab component harness checks search entry, initial loading content, focus options, typing and navigation away.

The profile editor has a stable viewport-bounded height and independent scrolling panes. Profile, design and privacy stay mounted while the editor is open, preserving drafts and avoiding repeated privacy loading on tab changes. `app/editor-pane.tsx` makes inactive panes inert immediately, then hides them after the fade so offscreen previews stop rendering. Rapid switches cancel pending hiding; reduced motion hides immediately. The tab indicator slides independently of the content. Tests cover repeated switches, draft retention, interrupted exits, cache scope and cache mutations.

Validation: `tests/app-history.test.mjs` exercises an isolated session-history fixture, including capture ordering with a native router listener, deep links, repeated clicks, rapid traversal, request races, failures, foreign entries and disposal. Existing profile link/tab tests cover the rendered callbacks. Run the full Node test suite, TypeScript, targeted lint and the production build. Browser visual QA was not run.

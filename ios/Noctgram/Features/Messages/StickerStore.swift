import SwiftUI

/// Stickers and custom emoji of the viewer, as the web keeps them
/// (lib/sticker-client.ts): the panel (installed packs, favourites and the
/// Premium flag), the built-in packs, recent stickers on this device, and
/// a cache of resolved references for messages.
@MainActor
final class StickerStore: ObservableObject {
    static let shared = StickerStore()

    /// Built-in packs: Утя, Обезьянка, Праздник and the Telegram Web emoji.
    @Published private(set) var builtin: [StickerPack] = []
    /// Packs of people the viewer added to the panel.
    @Published private(set) var installed: [StickerPack] = []
    @Published private(set) var favorites: [Sticker] = []
    @Published private(set) var premium = false
    @Published private(set) var favoriteLimit = 5
    /// Refs of recently sent stickers, newest first.
    @Published private(set) var recent: [String] = []
    @Published private(set) var loaded = false
    /// Changes when resolved stickers arrive, so views read the cache again.
    @Published private(set) var revision = 0

    /// The original premium emoji in their three packs.
    let legacyPacks: [StickerPack] = ["RestrictedEmoji", "CreepyEmoji", "NewsEmoji"].map { pack in
        StickerPack(ref: "noct:" + pack, title: pack, stickers: EmojiTokens.legacy.filter { $0.pack == pack }.map(EmojiTokens.legacySticker))
    }

    /// Built-in packs when the server does not list them (before action=builtin).
    private static let builtinNames = ["utya", "monkey", "holiday", "tgweb"]
    private var cache: [String: Sticker] = [:]
    private var order: [String] = []
    private var waiting: Set<String> = []
    private var failed: Set<String> = []
    private var flush: Task<Void, Never>?
    private var api: APIClient?
    private var owner = ""
    private var loading: Task<Void, Never>?

    var stickerPacks: [StickerPack] {
        builtin.filter { !$0.isEmoji } + installed.filter { !$0.isEmoji && !$0.removed }
    }

    var emojiPacks: [StickerPack] {
        legacyPacks + builtin.filter(\.isEmoji) + installed.filter { $0.isEmoji && !$0.removed }
    }

    var recentStickers: [Sticker] {
        Array(recent.compactMap { cache[$0] }.filter(\.available).prefix(15))
    }

    func isFavorite(_ ref: String) -> Bool {
        favorites.contains { $0.ref == ref }
    }

    /// Loads once per account; `force` reloads the panel (after a change).
    func load(api: APIClient, me: String, force: Bool = false) async {
        if owner != me {
            owner = me
            loaded = false
            recent = (UserDefaults.standard.array(forKey: recentKey) as? [String]) ?? []
        }
        self.api = api
        if loaded && !force { return }
        if let loading {
            await loading.value
            if !force { return }
        }
        let task = Task { await reload(api: api) }
        loading = task
        await task.value
        loading = nil
    }

    private func reload(api: APIClient) async {
        failed = []
        async let panelRequest = try? api.get("/api/stickers", ["action": "panel"])
        async let builtinRequest = try? api.get("/api/stickers", ["action": "builtin"])
        let (panel, listed) = await (panelRequest, builtinRequest)
        var packs = listed?["packs"].array.map { StickerPack($0) } ?? []
        if packs.isEmpty {
            // A server without action=builtin: the known packs one by one.
            for name in Self.builtinNames {
                if let pack = try? await api.get("/api/stickers", ["action": "pack", "name": name]) {
                    packs.append(StickerPack(pack))
                }
            }
        }
        if !packs.isEmpty { builtin = packs }
        if let panel {
            installed = panel["packs"].array.map { StickerPack($0) }
            favorites = panel["favorites"].array.map { Sticker($0) }
            premium = panel["premium"].bool
            favoriteLimit = panel["limits"]["favorites"].int ?? (premium ? 10 : 5)
        }
        for pack in builtin + installed {
            for sticker in pack.stickers { remember(sticker) }
        }
        for sticker in favorites { remember(sticker) }
        EmojiTokens.catalogNames = Set(builtin.flatMap(\.stickers).compactMap { EmojiTokens.name($0.token) })
        EmojiTokens.catalogEmoji = Dictionary(
            builtin.flatMap(\.stickers).compactMap { sticker in EmojiTokens.name(sticker.token).map { ($0, sticker.emoji) } },
            uniquingKeysWith: { first, _ in first })
        loaded = panel != nil || !packs.isEmpty
        request(recent)
        revision += 1
    }

    // MARK: References

    private func remember(_ sticker: Sticker) {
        if cache[sticker.ref] == nil { order.append(sticker.ref) }
        cache[sticker.ref] = sticker
        if order.count > 600, let oldest = order.first {
            order.removeFirst()
            cache[oldest] = nil
        }
    }

    /// The sticker behind a ref, if known; unknown ones are fetched.
    func sticker(_ ref: String) -> Sticker? {
        if let hit = cache[ref] { return hit }
        request([ref])
        return nil
    }

    /// Opening a chat asks again for stickers that failed while offline.
    func retryMissing() {
        guard !failed.isEmpty else { return }
        failed = []
        revision += 1
    }

    /// True once the server was asked and gave nothing usable.
    func isMissing(_ ref: String) -> Bool {
        failed.contains(ref)
    }

    /// The picture of a :noct_ or :ce_ token.
    func emoji(_ token: String) -> Sticker? {
        if let id = EmojiTokens.customId(token) { return sticker("u:" + id) }
        guard let name = EmojiTokens.name(token) else { return nil }
        if let item = EmojiTokens.legacy.first(where: { $0.name == name }) { return EmojiTokens.legacySticker(item) }
        return builtin.lazy.flatMap(\.stickers).first { $0.token == token }
    }

    /// Asks for refs in batches of up to 60 a moment later, as the web does.
    func request(_ refs: [String]) {
        let fresh = refs.filter { !$0.isEmpty && cache[$0] == nil && !failed.contains($0) && !$0.hasPrefix("noct:") }
        guard !fresh.isEmpty else { return }
        waiting.formUnion(fresh)
        guard flush == nil else { return }
        flush = Task { [weak self] in
            try? await Task.sleep(nanoseconds: 30_000_000)
            await self?.resolveWaiting()
        }
    }

    private func resolveWaiting() async {
        let refs = Array(waiting)
        waiting = []
        flush = nil
        guard let api, !refs.isEmpty else { return }
        for start in stride(from: 0, to: refs.count, by: 60) {
            let chunk = Array(refs[start..<min(start + 60, refs.count)])
            guard let data = try? await api.get("/api/stickers", ["action": "resolve", "refs": chunk.joined(separator: ",")]) else {
                // Offline: not asked again until the panel reloads, so a
                // chat without network does not ask in a loop.
                failed.formUnion(chunk)
                continue
            }
            let stickers = data["stickers"].array.map { Sticker($0) }
            for sticker in stickers { remember(sticker) }
            let answered = Set(stickers.map(\.ref))
            failed.formUnion(chunk.filter { !answered.contains($0) })
        }
        revision += 1
    }

    // MARK: Recent and favourite

    private var recentKey: String { "noct.recentStickers." + owner }

    /// Kept on the device only, twenty at most.
    func noteSent(_ sticker: Sticker) {
        remember(sticker)
        recent.removeAll { $0 == sticker.ref }
        recent.insert(sticker.ref, at: 0)
        if recent.count > 20 { recent = Array(recent.prefix(20)) }
        UserDefaults.standard.set(recent, forKey: recentKey)
    }

    func setFavorite(_ sticker: Sticker, _ on: Bool, session: AppSession) async {
        do {
            _ = try await session.api.post("/api/stickers", ["action": "fave", "ref": sticker.ref, "on": on])
            if on {
                favorites.removeAll { $0.ref == sticker.ref }
                favorites.insert(sticker, at: 0)
                if favorites.count > favoriteLimit { favorites = Array(favorites.prefix(favoriteLimit)) }
                session.show("Добавлено в избранные стикеры")
            } else {
                favorites.removeAll { $0.ref == sticker.ref }
            }
            Haptics.tap()
        } catch {
            session.report(error)
        }
    }

    /// Adds or removes a pack of people from the panel.
    func setInstalled(_ pack: StickerPack, _ on: Bool, session: AppSession) async {
        do {
            _ = try await session.api.post("/api/stickers", ["action": on ? "install" : "uninstall", "ref": pack.ref])
            session.show(on ? "Набор «\(pack.title)» добавлен" : "Набор «\(pack.title)» убран из панели")
            await load(api: session.api, me: owner, force: true)
        } catch {
            session.report(error)
        }
    }
}

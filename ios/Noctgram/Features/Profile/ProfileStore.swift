import SwiftUI

enum ProfileTarget: Hashable {
    case id(String)
    case handle(String)
}

enum ProfileTab: String, CaseIterable, Identifiable {
    case posts, media, gifts

    var id: String { rawValue }

    var title: String {
        switch self {
        case .posts: return "Публикации"
        case .media: return "Медиа"
        case .gifts: return "Подарки"
        }
    }
}

/// Gift catalog from /api/gifts?action=catalog, loaded once per session.
@MainActor
final class GiftCatalog: ObservableObject {
    static let shared = GiftCatalog()
    @Published var gifts: [GiftDefinition] = []
    @Published var balance: Int?

    func load(api: APIClient, force: Bool = false) async {
        guard gifts.isEmpty || force else { return }
        guard let data = try? await api.get("/api/gifts", ["action": "catalog"]) else { return }
        gifts = data["catalog"].array.map { GiftDefinition($0) }
        balance = data["balance"].int
    }

    func name(for id: String) -> String? {
        gifts.first { $0.id == id }?.name
    }
}

@MainActor
final class ProfileStore: ObservableObject {
    @Published var profile: Profile?
    @Published var error: String?
    @Published var tab: ProfileTab = .posts
    @Published var followBusy = false
    @Published var gifts: [ReceivedGift] = []
    @Published var giftsNext: String?
    @Published var giftsLoaded = false
    @Published var giftsLoading = false

    let posts = PostListStore(query: FeedQuery(mode: "all"))
    let media = PostListStore(query: FeedQuery(mode: "all", media: true))

    func load(_ target: ProfileTarget, api: APIClient) async {
        do {
            let data: JSON
            switch target {
            case .id(let id):
                data = try await api.social("profile", ["id": id])
            case .handle(let handle):
                data = try await api.social("profile", ["handle": handle])
            }
            let loaded = Profile(data)
            let changed = profile?.id != loaded.id
            profile = loaded
            error = nil
            posts.query = FeedQuery(mode: "all", user: loaded.id, pinnedId: loaded.pinnedPostId)
            media.query = FeedQuery(mode: "all", user: loaded.id, media: true)
            if changed { gifts = []; giftsLoaded = false }
            guard !loaded.blocked else { return }
            await reloadTab(api: api)
        } catch {
            if let message = error.userMessage { self.error = message }
        }
    }

    func reloadTab(api: APIClient) async {
        switch tab {
        case .posts: await posts.refresh(api: api)
        case .media: await media.refresh(api: api)
        case .gifts: await loadGifts(api: api, reset: true)
        }
    }

    func select(_ tab: ProfileTab, api: APIClient) async {
        self.tab = tab
        switch tab {
        case .posts: if !posts.loaded { await posts.refresh(api: api) }
        case .media: if !media.loaded { await media.refresh(api: api) }
        case .gifts: if !giftsLoaded { await loadGifts(api: api, reset: true) }
        }
    }

    func loadGifts(api: APIClient, reset: Bool) async {
        guard let profile, !giftsLoading else { return }
        if !reset && giftsNext == nil { return }
        giftsLoading = true
        defer { giftsLoading = false }
        await GiftCatalog.shared.load(api: api)
        var query: [String: String?] = ["user": profile.id]
        if !reset, let next = giftsNext { query["before"] = next }
        do {
            let data = try await api.get("/api/gifts", query)
            let page = data["gifts"].array.map { ReceivedGift($0) }
            gifts = reset ? page : gifts + page
            giftsNext = data["next"].string
            giftsLoaded = true
        } catch {
            giftsLoaded = true
            if reset { gifts = [] }
        }
    }

    func toggleFollow(session: AppSession) async {
        guard var profile, !followBusy else { return }
        followBusy = true
        defer { followBusy = false }
        let value = !profile.followed
        profile.followed = value
        profile.followers = max(0, profile.followers + (value ? 1 : -1))
        self.profile = profile
        Haptics.tap()
        do {
            _ = try await session.api.socialPost("follow", ["id": profile.id, "value": value])
            await session.refreshMe()
        } catch {
            profile.followed = !value
            profile.followers = max(0, profile.followers + (value ? -1 : 1))
            self.profile = profile
            session.report(error)
        }
    }

    /// Sells a received gift for the quoted amount; returns the new balance.
    func sellGift(_ gift: ReceivedGift, expectedAmount: Int, api: APIClient) async throws -> Int? {
        let data = try await api.post("/api/gifts", ["action": "convert", "id": gift.id, "expectedAmount": expectedAmount])
        gifts.removeAll { $0.id == gift.id }
        return data["balance"].int
    }

    func setGiftHidden(_ gift: ReceivedGift, hidden: Bool, api: APIClient) async throws {
        _ = try await api.post("/api/gifts", ["action": "visibility", "id": gift.id, "hidden": hidden])
        if let index = gifts.firstIndex(where: { $0.id == gift.id }) { gifts[index].hidden = hidden }
    }
}

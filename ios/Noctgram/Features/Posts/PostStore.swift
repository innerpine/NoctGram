import Combine
import SwiftUI

/// GET /api/social?action=feed parameters.
struct FeedQuery: Hashable {
    var mode = "all"
    var q = ""
    var user = ""
    var media = false
    /// Profile feeds put the pinned post first, as the web does.
    var pinnedId = ""
}

enum PostEvent {
    case updated(Post)
    case removed(String)
    case created
}

/// Keeps every visible copy of a post in sync (feed, profile, saved, detail).
final class PostBus {
    static let shared = PostBus()
    let events = PassthroughSubject<PostEvent, Never>()

    func send(_ event: PostEvent) {
        events.send(event)
    }
}

@MainActor
final class PostListStore: ObservableObject {
    @Published var posts: [Post] = []
    @Published var loading = false
    @Published var loadingMore = false
    @Published var hasMore = true
    @Published var loaded = false
    @Published var error: String?

    var query: FeedQuery
    private var subscription: AnyCancellable?

    init(query: FeedQuery) {
        self.query = query
        subscription = PostBus.shared.events
            .sink { [weak self] event in
                Task { @MainActor in self?.apply(event) }
            }
    }

    func setQuery(_ query: FeedQuery, api: APIClient) async {
        guard query != self.query else { return }
        self.query = query
        posts = []
        loaded = false
        await refresh(api: api)
    }

    func refresh(api: APIClient) async {
        loading = true
        defer { loading = false }
        do {
            let data = try await api.social("feed", parameters(after: nil))
            var page = data.array.map { Post($0) }
            let full = page.count >= 30
            if !query.pinnedId.isEmpty, query.q.isEmpty, !query.media, !page.contains(where: { $0.id == query.pinnedId }),
               let pinned = try? await api.social("post", ["id": query.pinnedId]), pinned["id"].string != nil {
                page.insert(Post(pinned), at: 0)
            }
            posts = page
            hasMore = full
            loaded = true
            error = nil
        } catch {
            if let message = error.userMessage {
                self.error = message
                loaded = true
            }
        }
    }

    func loadMoreIfNeeded(_ post: Post, api: APIClient) async {
        guard post.id == posts.last?.id else { return }
        await loadMore(api: api)
    }

    func loadMore(api: APIClient) async {
        guard hasMore, !loadingMore, !loading, let last = posts.last else { return }
        loadingMore = true
        defer { loadingMore = false }
        do {
            let data = try await api.social("feed", parameters(after: last))
            let known = Set(posts.map(\.id))
            let next = data.array.map { Post($0) }.filter { !known.contains($0.id) }
            posts.append(contentsOf: next)
            hasMore = data.array.count >= 30
        } catch {
            if error.userMessage != nil { hasMore = false }
        }
    }

    private func parameters(after last: Post?) -> [String: String?] {
        var query: [String: String?] = ["mode": self.query.mode]
        if !self.query.q.isEmpty { query["q"] = self.query.q }
        if !self.query.user.isEmpty { query["user"] = self.query.user }
        if self.query.media { query["media"] = "1" }
        if let last {
            query["before"] = String(Int64(last.created))
            query["afterId"] = last.id
        }
        return query
    }

    private func apply(_ event: PostEvent) {
        switch event {
        case .updated(let post):
            if let index = posts.firstIndex(where: { $0.id == post.id }) {
                if query.mode == "saved" && !post.saved {
                    posts.remove(at: index)
                } else {
                    posts[index] = post
                }
            }
        case .removed(let id):
            posts.removeAll { $0.id == id }
        case .created:
            break
        }
    }
}

/// Post actions shared by every list: optimistic update, then the server call.
@MainActor
enum PostActions {
    static func toggleLike(_ post: Post, session: AppSession) async {
        var next = post
        next.liked.toggle()
        next.likes = max(0, post.likes + (next.liked ? 1 : -1))
        PostBus.shared.send(.updated(next))
        if next.liked { Haptics.tap() }
        do {
            _ = try await session.api.socialPost("like", ["id": post.id, "value": next.liked])
        } catch {
            PostBus.shared.send(.updated(post))
            session.report(error)
        }
    }

    static func toggleSave(_ post: Post, session: AppSession) async {
        var next = post
        next.saved.toggle()
        PostBus.shared.send(.updated(next))
        do {
            _ = try await session.api.socialPost("save", ["id": post.id, "value": next.saved])
            session.show(next.saved ? "Сохранено" : "Убрано из сохранённого")
        } catch {
            PostBus.shared.send(.updated(post))
            session.report(error)
        }
    }

    static func vote(_ post: Post, option: Int, session: AppSession) async {
        guard option != post.voted else { return }
        var next = post
        if let previous = post.voted { next.votes[previous] = max(0, (next.votes[previous] ?? 0) - 1) }
        next.votes[option] = (next.votes[option] ?? 0) + 1
        next.voted = option
        PostBus.shared.send(.updated(next))
        Haptics.tap()
        do {
            _ = try await session.api.socialPost("vote", ["id": post.id, "option": option])
        } catch {
            PostBus.shared.send(.updated(post))
            session.report(error)
        }
    }

    static func togglePin(_ post: Post, session: AppSession) async {
        do {
            _ = try await session.api.socialPost("pin", ["id": post.id, "value": !post.pinned])
            var next = post
            next.pinned.toggle()
            PostBus.shared.send(.updated(next))
            session.show(next.pinned ? "Публикация закреплена" : "Публикация откреплена")
        } catch {
            session.report(error)
        }
    }

    static func hide(_ post: Post, session: AppSession) async {
        do {
            _ = try await session.api.socialPost("hide", ["id": post.id, "value": true])
            PostBus.shared.send(.removed(post.id))
            session.show("Публикация скрыта")
        } catch {
            session.report(error)
        }
    }

    static func delete(_ post: Post, session: AppSession) async {
        do {
            _ = try await session.api.socialPost("delete", ["id": post.id])
            PostBus.shared.send(.removed(post.id))
            session.show("Публикация удалена")
            await session.refreshMe()
        } catch {
            session.report(error)
        }
    }

    static func report(_ post: Post, reason: String, session: AppSession) async {
        do {
            _ = try await session.api.socialPost("report", ["id": post.id, "reason": reason])
            session.show("Жалоба отправлена модераторам")
        } catch {
            session.report(error)
        }
    }

    /// Unique view after a second on screen; own posts are not counted by the server.
    private static var viewed = Set<String>()

    static func recordView(_ post: Post, session: AppSession) async {
        guard !post.isMine(session.myId), !viewed.contains(post.id) else { return }
        viewed.insert(post.id)
        guard let data = try? await session.api.socialPost("view", ["id": post.id]) else {
            viewed.remove(post.id)
            return
        }
        if let views = data["views"].int, views != post.views {
            var next = post
            next.views = views
            PostBus.shared.send(.updated(next))
        }
    }

    static func link(_ post: Post, session: AppSession) -> URL {
        session.api.webLink(["post": post.id])
    }
}

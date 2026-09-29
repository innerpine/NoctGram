import SwiftUI

/// A feed post shared into a chat, as the viewer may see it
/// (lib/post-preview-server.ts): loaded in batches of up to 30 with
/// action=postPreviews; a post hidden from the viewer is missing.
struct PostPreview: Hashable {
    let id: String
    let author: Identity
    let text: String
    let media: MediaItem?
    let mediaCount: Int
    let adult: Bool
    let poll: Bool
    let code: Bool

    init(_ j: JSON) {
        id = j["id"].str
        author = Identity(id: j["userId"].str, name: j["name"].str, avatar: j["avatar"].str, handle: j["handle"].str,
                          kind: j["kind"].string ?? "person", appearance: Appearance(j))
        text = j["text"].str
        media = j["media"].object == nil ? nil : MediaItem(j["media"])
        mediaCount = j["mediaCount"].int ?? 0
        adult = j["adult"].bool
        poll = j["poll"].bool
        code = j["code"].bool
    }
}

@MainActor
final class PostPreviews: ObservableObject {
    static let shared = PostPreviews()
    /// nil value: asked for and unavailable to the viewer.
    @Published private(set) var loaded: [String: PostPreview?] = [:]
    private var waiting: Set<String> = []
    private var flush: Task<Void, Never>?

    func preview(_ id: String, api: APIClient) -> PostPreview?? {
        if let hit = loaded[id] { return .some(hit) }
        waiting.insert(id)
        if flush == nil {
            flush = Task { [weak self] in
                try? await Task.sleep(nanoseconds: 40_000_000)
                await self?.load(api: api)
            }
        }
        return nil
    }

    private func load(api: APIClient) async {
        let ids = Array(waiting)
        waiting = []
        flush = nil
        for start in stride(from: 0, to: ids.count, by: 30) {
            let chunk = Array(ids[start..<min(start + 30, ids.count)])
            guard let data = try? await api.social("postPreviews", ["ids": chunk.joined(separator: ",")]) else { continue }
            let posts = data.array.map(PostPreview.init)
            for id in chunk { loaded[id] = .some(posts.first { $0.id == id }) }
        }
    }
}

/// The card of a shared post in a bubble: author, first picture (+N), text,
/// «Открыть публикацию».
struct SharedPostCard: View {
    @EnvironmentObject private var session: AppSession
    @ObservedObject private var previews = PostPreviews.shared
    let id: String
    let accent: Color
    var open: ((String) -> Void)?

    var body: some View {
        let state = previews.preview(id, api: session.api)
        Group {
            switch state {
            case .none:
                Text("Загружаем публикацию…")
                    .font(.system(size: 14))
                    .foregroundColor(Noct.text48)
                    .frame(maxWidth: .infinity, minHeight: 60)
            case .some(.none):
                Label("Публикация недоступна", systemImage: "eye.slash")
                    .font(.system(size: 14))
                    .foregroundColor(Noct.text60)
                    .frame(maxWidth: .infinity, minHeight: 50)
            case .some(.some(let post)):
                Button {
                    open?(post.id)
                } label: {
                    card(post)
                }
                .buttonStyle(PressableStyle())
                .accessibilityLabel("Открыть публикацию: \(post.author.name)")
            }
        }
        .frame(width: 250)
    }

    private func card(_ post: PostPreview) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 7) {
                AvatarView(person: post.author, size: 22, ring: false)
                Text(post.author.name)
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundColor(accent)
                    .lineLimit(1)
            }
            if let media = post.media {
                ZStack(alignment: .topTrailing) {
                    Group {
                        if media.isImage {
                            RemoteImage(url: session.api.mediaURL(media.path), maxPixel: 600)
                                .blur(radius: post.adult ? 18 : 0)
                        } else {
                            ZStack {
                                Noct.coverFill
                                Image(systemName: "video.fill").font(.system(size: 26)).foregroundColor(Noct.text60)
                            }
                        }
                    }
                    .frame(height: 140)
                    .frame(maxWidth: .infinity)
                    .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                    if post.adult {
                        Text("18+")
                            .font(.system(size: 12, weight: .bold))
                            .padding(.horizontal, 6)
                            .padding(.vertical, 2)
                            .background(Capsule().fill(Color.black.opacity(0.6)))
                            .padding(6)
                    } else if post.mediaCount > 1 {
                        Text("+\(post.mediaCount - 1)")
                            .font(.system(size: 12, weight: .bold))
                            .padding(.horizontal, 6)
                            .padding(.vertical, 2)
                            .background(Capsule().fill(Color.black.opacity(0.6)))
                            .padding(6)
                    }
                }
            }
            if !post.text.isEmpty {
                Text(PremiumEmoji.replace(post.text))
                    .font(.system(size: 14))
                    .foregroundColor(Color.white.opacity(0.9))
                    .lineLimit(4)
                    .multilineTextAlignment(.leading)
            } else if post.media == nil {
                Text(post.poll ? "Опрос" : (post.code ? "Фрагмент кода" : "Публикация"))
                    .font(.system(size: 14))
                    .foregroundColor(Noct.text60)
            }
            Text("Открыть публикацию")
                .font(.system(size: 13, weight: .semibold))
                .foregroundColor(accent)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 7)
                .background(RoundedRectangle(cornerRadius: 9, style: .continuous).fill(accent.opacity(0.14)))
        }
        .padding(10)
        .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(Color.white.opacity(0.05)))
    }
}

import SwiftUI
import UIKit

func ngReadAccessRevoked(_ error: Error) -> Bool {
    guard let response = error as? NoctAPIError else { return false }
    return [401, 403, 404].contains(response.status)
}

@MainActor
final class NGFeedModel: ObservableObject {
    private let api: NoctAPI
    @Published var posts: [NGRecord] = []
    @Published var loading = false
    @Published var loadingMore = false
    @Published var hasMore = false
    @Published var error: String?
    private var generation = 0
    private var parameters: [String: String] = [:]

    init(api: NoctAPI? = nil) { self.api = api ?? .shared }

    func reload(mode: String = "all", search: String = "", userID: String? = nil) async {
        generation += 1
        let request = generation
        var query = ["action": "feed", "mode": mode]
        if !search.isEmpty { query["q"] = search }
        if let userID { query["user"] = userID }
        parameters = query
        loading = true
        loadingMore = false
        error = nil
        defer { if generation == request { loading = false } }
        do {
            let result = try await api.get("/api/social", query: query)
            try Task.checkCancellation()
            guard generation == request else { return }
            posts = result.objects("items")
            hasMore = posts.count == 30
        } catch is CancellationError {
        } catch {
            guard generation == request else { return }
            if ngReadAccessRevoked(error) { clearContent() }
            self.error = error.localizedDescription
        }
    }

    func nextPage() async {
        guard !loading, !loadingMore, hasMore, let last = posts.last else { return }
        let request = generation
        var query = parameters
        query["before"] = last.string("created")
        query["afterId"] = last.id
        loadingMore = true
        error = nil
        defer { if generation == request { loadingMore = false } }
        do {
            let result = try await api.get("/api/social", query: query)
            try Task.checkCancellation()
            guard generation == request else { return }
            let page = result.objects("items")
            let existing = Set(posts.map(\.id))
            posts += page.filter { !existing.contains($0.id) }
            hasMore = page.count == 30
        } catch is CancellationError {
        } catch {
            guard generation == request else { return }
            if ngReadAccessRevoked(error) { clearContent() }
            self.error = error.localizedDescription
        }
    }

    func clearContent() {
        generation += 1
        posts = []
        hasMore = false
        loading = false
        loadingMore = false
    }
}

@MainActor
struct NGFeedView: View {
    @StateObject private var feed: NGFeedModel
    @State private var mode = "all"
    @State private var search = ""
    @State private var composing = false
    @State private var notice: String?

    init(api: NoctAPI? = nil) { _feed = StateObject(wrappedValue: NGFeedModel(api: api)) }

    var body: some View {
        ScrollView {
            LazyVStack(spacing: 16) {
                Picker("Лента", selection: $mode) {
                    Text("Все").tag("all")
                    Text("Подписки").tag("following")
                    Text("Сохранённое").tag("saved")
                }
                .pickerStyle(.segmented)
                .padding(.vertical, 4)
                if let notice {
                    Text(notice).font(.callout).foregroundColor(NGTheme.accent)
                }
                if feed.loading && feed.posts.isEmpty {
                    ProgressView().frame(maxWidth: .infinity).padding(32)
                } else if feed.posts.isEmpty && feed.error == nil {
                    NGEmptyState(title: search.isEmpty ? "Пока нет публикаций" : "Ничего не найдено",
                                 message: search.isEmpty ? "Новые мысли и моменты появятся здесь." : "Попробуйте другой запрос.",
                                 systemImage: "square.stack")
                }
                ForEach(feed.posts) { post in
                    NGPostCard(post: post)
                }
                if let error = feed.error {
                    NGInlineError(message: error) {
                        Task { await refresh() }
                    }
                }
                if feed.hasMore {
                    Button { Task { await feed.nextPage() } } label: {
                        HStack {
                            Spacer()
                            if feed.loadingMore { ProgressView() } else { Text("Показать ещё") }
                            Spacer()
                        }.frame(minHeight: 44)
                    }
                    .disabled(feed.loadingMore)
                }
            }
            .frame(maxWidth: 600)
            .padding(16)
            .frame(maxWidth: .infinity)
        }
        .background(NGTheme.background)
        .accessibilityIdentifier("feed.scroll")
        .navigationTitle("Лента")
        .navigationBarTitleDisplayMode(.inline)
        .searchable(text: $search, prompt: "Поиск публикаций")
        .toolbar {
            ToolbarItem(placement: .navigationBarLeading) {
                if #available(iOS 16.0, *) { EmptyView() }
                else {
                    Button { Task { await refresh() } } label: {
                        Image(systemName: "arrow.clockwise").frame(width: 44, height: 44)
                    }.accessibilityLabel("Обновить ленту")
                }
            }
            ToolbarItem(placement: .navigationBarTrailing) {
                Button { composing = true } label: {
                    Image(systemName: "square.and.pencil").frame(width: 44, height: 44)
                }.accessibilityLabel("Создать публикацию")
            }
        }
        .task(id: mode + "|" + search) {
            if !search.isEmpty {
                do { try await Task.sleep(nanoseconds: 300_000_000) } catch { return }
            }
            await refresh()
        }
        .refreshable { await refresh() }
        .sheet(isPresented: $composing) {
            NGPostComposer { message in
                notice = message
                Task { await refresh() }
            }
        }
    }

    private func refresh() async { await feed.reload(mode: mode, search: search) }
}

struct NGInlineError: View {
    let message: String
    var retry: (() -> Void)? = nil

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Label(message, systemImage: "exclamationmark.circle").font(.callout)
                .foregroundColor(NGTheme.muted)
            if let retry { Button("Попробовать снова", action: retry).frame(minHeight: 44) }
        }.padding(.vertical, 8)
    }
}

func ngRelativeDate(_ milliseconds: Double) -> String {
    let formatter = RelativeDateTimeFormatter()
    formatter.locale = Locale(identifier: "ru_RU")
    formatter.unitsStyle = .abbreviated
    return formatter.localizedString(for: Date(timeIntervalSince1970: milliseconds / 1000), relativeTo: Date())
}

@MainActor
struct NGPostCard: View {
    @EnvironmentObject private var session: NativeSession
    let post: NGRecord
    var opensDetail = true
    @State private var likedOverride: Bool?
    @State private var savedOverride: Bool?
    @State private var pollOverride: NGRecord?
    @State private var actionInFlight = false
    @State private var voting = false
    @State private var revealingMedia = false
    @State private var error: String?

    private var liked: Bool { likedOverride ?? post.bool("liked") }
    private var saved: Bool { savedOverride ?? post.bool("saved") }
    private var poll: NGRecord { pollOverride ?? post }
    private var voted: Int? {
        guard let raw = poll.raw["voted"], !(raw is NSNull) else { return nil }
        return poll.int("voted")
    }
    private var likes: Int {
        max(0, post.int("likes") + (liked ? 1 : 0) - (post.bool("liked") ? 1 : 0))
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(alignment: .top, spacing: 10) {
                NavigationLink(destination: NGProfileView(userID: post.string("userId"))) {
                    HStack(spacing: 10) {
                        NGAvatar(url: post.string("avatar"), name: post.string("name"), size: 42)
                        VStack(alignment: .leading, spacing: 3) {
                            Text(post.string("name", default: "Пользователь")).font(.subheadline.weight(.semibold))
                                .foregroundColor(.primary).lineLimit(2)
                            if post.string("kind") == "channel" {
                                Label("Канал", systemImage: "megaphone.fill")
                                    .font(.caption).foregroundColor(NGTheme.muted)
                            } else if !post.string("handle").isEmpty {
                                Text("@" + post.string("handle")).font(.caption).foregroundColor(NGTheme.muted).lineLimit(1)
                            }
                        }
                    }.frame(maxWidth: .infinity, alignment: .leading).contentShape(Rectangle())
                }.buttonStyle(.plain).layoutPriority(1)
                    .accessibilityIdentifier("feed.author." + post.id)
                Spacer(minLength: 8)
                Text(ngRelativeDate(post.double("created")))
                    .font(.caption).foregroundColor(NGTheme.muted)
                    .lineLimit(2).multilineTextAlignment(.trailing)
                    .frame(maxWidth: 76, alignment: .trailing)
            }
            if !post.string("text").isEmpty {
                Text(post.string("text")).font(.body).textSelection(.enabled)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .fixedSize(horizontal: false, vertical: true)
            }
            if post.bool("adult") && !revealingMedia && !post.objects("media").isEmpty {
                Button { revealingMedia = true } label: {
                    Label("Показать чувствительный контент", systemImage: "eye.slash")
                        .frame(maxWidth: .infinity, minHeight: 88).padding(12)
                        .background(NGTheme.background, in: RoundedRectangle(cornerRadius: 16))
                }.buttonStyle(.plain)
            } else {
                ForEach(post.objects("media")) { medium in
                    NGMediaView(record: medium)
                        .clipShape(RoundedRectangle(cornerRadius: 16))
                }
            }
            if !post.string("code").isEmpty {
                ScrollView(.horizontal) {
                    Text(post.string("code")).font(.system(.callout, design: .monospaced))
                        .textSelection(.enabled).padding(12)
                }.background(NGTheme.background, in: RoundedRectangle(cornerRadius: 12))
            }
            if !post.strings("poll").isEmpty {
                VStack(alignment: .leading, spacing: 8) {
                    Label("Опрос", systemImage: "chart.bar.xaxis").font(.caption).foregroundColor(NGTheme.muted)
                    ForEach(Array(post.strings("poll").enumerated()), id: \.offset) { option in
                        Button { vote(option.offset) } label: {
                            HStack(spacing: 8) {
                                Image(systemName: voted == option.offset ? "checkmark.circle.fill" : "circle")
                                    .foregroundColor(voted == option.offset ? NGTheme.accent : NGTheme.muted)
                                Text(option.element).frame(maxWidth: .infinity, alignment: .leading)
                                if voted != nil {
                                    Text("\(poll.objects("votes").first { $0.int("option") == option.offset }?.int("count") ?? 0)")
                                        .font(.caption).foregroundColor(NGTheme.muted)
                                }
                            }.font(.callout).padding(.horizontal, 12).frame(minHeight: 44)
                                .background(NGTheme.background, in: RoundedRectangle(cornerRadius: 10))
                        }.buttonStyle(.plain).disabled(voting)
                            .accessibilityAddTraits(voted == option.offset ? .isSelected : [])
                    }
                    if voting { ProgressView().accessibilityLabel("Сохраняем голос") }
                }
            }
            HStack(spacing: 12) {
                Button { toggle("like", value: !liked) } label: {
                    Label("\(likes)", systemImage: liked ? "heart.fill" : "heart")
                        .foregroundColor(liked ? NGTheme.accent : NGTheme.muted)
                        .frame(minWidth: 44, minHeight: 44)
                }.disabled(actionInFlight).accessibilityIdentifier("feed.like." + post.id)
                if opensDetail {
                    NavigationLink(destination: NGPostDetailView(post: post)) {
                        Label("\(post.int("comments"))", systemImage: "bubble.right")
                            .foregroundColor(NGTheme.muted).frame(minWidth: 44, minHeight: 44)
                    }.accessibilityLabel("Комментарии: \(post.int("comments"))").accessibilityIdentifier("feed.comments." + post.id)
                }
                Spacer()
                Button { toggle("save", value: !saved) } label: {
                    Image(systemName: saved ? "bookmark.fill" : "bookmark")
                        .foregroundColor(saved ? NGTheme.accent : NGTheme.muted)
                        .frame(width: 44, height: 44)
                }
                .accessibilityLabel(saved ? "Убрать из сохранённого" : "Сохранить публикацию")
                .accessibilityIdentifier("feed.save." + post.id)
                .disabled(actionInFlight)
            }.buttonStyle(.plain)
            if let error { NGInlineError(message: error) }
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(NGTheme.surface, in: RoundedRectangle(cornerRadius: 24))
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("feed.post." + post.id)
        .onChange(of: post.snapshotID) { _ in
            likedOverride = nil
            savedOverride = nil
            pollOverride = nil
        }
    }

    private func toggle(_ action: String, value: Bool) {
        guard !actionInFlight else { return }
        actionInFlight = true
        error = nil
        Task {
            defer { actionInFlight = false }
            do {
                _ = try await session.api.post("/api/social", body: ["action": action, "id": post.id, "value": value])
                if action == "like" { likedOverride = value } else { savedOverride = value }
            } catch { self.error = error.localizedDescription }
        }
    }

    private func vote(_ option: Int) {
        guard !voting else { return }
        voting = true
        error = nil
        Task {
            defer { voting = false }
            do {
                _ = try await session.api.post("/api/social", body: ["action": "vote", "id": post.id, "option": option])
                var updated = poll.raw
                let previous = voted
                updated["voted"] = option
                updated["votes"] = post.strings("poll").indices.map { index -> [String: Any] in
                    let count = poll.objects("votes").first { $0.int("option") == index }?.int("count") ?? 0
                    return ["option": index, "count": max(0, count - (previous == index ? 1 : 0) + (option == index ? 1 : 0))]
                }
                pollOverride = NGRecord(updated)
                do { pollOverride = try await session.api.get("/api/social", query: ["action": "post", "id": post.id]) }
                catch { self.error = "Голос сохранён. Не удалось обновить результаты: " + error.localizedDescription }
            } catch { self.error = error.localizedDescription }
        }
    }
}

@MainActor
struct NGPostDetailView: View {
    @EnvironmentObject private var session: NativeSession
    @State private var post: NGRecord
    @State private var comments: [NGRecord] = []
    @State private var draft = ""
    @State private var loading = false
    @State private var loadingOlder = false
    @State private var hasOlder = false
    @State private var sending = false
    @State private var error: String?
    @State private var notice: String?
    @State private var generation = 0
    @State private var contentUnavailable = false

    init(post: NGRecord) { _post = State(initialValue: post) }

    var body: some View {
        List {
            if contentUnavailable {
                NGEmptyState(title: "Публикация недоступна", message: "Она удалена или доступ к ней изменился.", systemImage: "lock")
                    .listRowBackground(NGTheme.background)
            } else {
            NGPostCard(post: post, opensDetail: false)
                .listRowInsets(EdgeInsets(top: 8, leading: 16, bottom: 16, trailing: 16))
                .listRowSeparator(.hidden)
                .listRowBackground(NGTheme.background)
            Section("Комментарии") {
                if hasOlder {
                    Button { Task { await loadOlder() } } label: {
                        HStack {
                            Text("Загрузить предыдущие")
                            if loadingOlder { ProgressView() }
                        }.frame(minHeight: 44)
                    }.disabled(loadingOlder).listRowBackground(NGTheme.background)
                }
                if loading && comments.isEmpty {
                    ProgressView().listRowBackground(NGTheme.background)
                }
                if !loading && comments.isEmpty && error == nil {
                    Text("Начните разговор первым.").foregroundColor(NGTheme.muted)
                        .listRowBackground(NGTheme.background)
                }
                ForEach(comments) { comment in
                    HStack(alignment: .top, spacing: 12) {
                        NavigationLink(destination: NGProfileView(userID: comment.string("userId"))) {
                            NGAvatar(url: comment.string("avatar"), name: comment.string("name"), size: 36)
                        }.buttonStyle(.plain)
                        VStack(alignment: .leading, spacing: 6) {
                            Text(comment.string("name", default: "Пользователь")).font(.subheadline.bold())
                            Text(comment.string("text")).font(.body).textSelection(.enabled)
                            Text(ngRelativeDate(comment.double("created"))).font(.caption).foregroundColor(NGTheme.muted)
                        }.frame(maxWidth: .infinity, alignment: .leading)
                    }.padding(.vertical, 6).listRowBackground(NGTheme.background)
                }
            }
            }
            if let notice { Text(notice).font(.callout).foregroundColor(NGTheme.accent).listRowBackground(NGTheme.background) }
            if let error { NGInlineError(message: error).listRowBackground(NGTheme.background) }
        }
        .listStyle(.plain)
        .background(NGTheme.background)
        .navigationTitle("Публикация")
        .navigationBarTitleDisplayMode(.inline)
        .safeAreaInset(edge: .bottom) {
            if !contentUnavailable {
            HStack(alignment: .bottom, spacing: 10) {
                TextField("Написать комментарий", text: $draft)
                    .padding(12).background(NGTheme.surface, in: Capsule())
                    .onChange(of: draft) { draft = String($0.prefix(2000)) }
                    .disabled(sending)
                Button { send() } label: {
                    Group {
                        if sending { ProgressView() } else { Image(systemName: "arrow.up") }
                    }.frame(width: 44, height: 44)
                        .background(NGTheme.accent, in: Circle()).foregroundColor(NGTheme.background)
                }
                .accessibilityLabel("Отправить комментарий")
                .disabled(sending || draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            }.padding(10).ngGlass(radius: 28).padding(.horizontal, 12).padding(.bottom, 8)
            }
        }
        .task { await refresh() }
        .refreshable { await refresh() }
    }

    private func refresh() async {
        generation += 1
        let request = generation
        loading = true
        error = nil
        defer { if request == generation { loading = false } }
        do {
            async let detail = session.api.get("/api/social", query: ["action": "post", "id": post.id])
            async let replies = session.api.get("/api/social", query: ["action": "comments", "post": post.id])
            let (newPost, page) = try await (detail, replies)
            try Task.checkCancellation()
            guard request == generation else { return }
            contentUnavailable = false
            post = newPost
            comments = page.objects("items")
            hasOlder = comments.count == 50
        } catch is CancellationError {
        } catch {
            guard request == generation else { return }
            if ngReadAccessRevoked(error) { revokeContent() }
            self.error = error.localizedDescription
        }
    }

    private func loadOlder() async {
        guard !contentUnavailable, !loadingOlder, !loading, let first = comments.first else { return }
        let request = generation
        loadingOlder = true
        defer { loadingOlder = false }
        do {
            let result = try await session.api.get("/api/social", query: [
                "action": "comments", "post": post.id, "before": first.string("created"), "beforeId": first.id
            ])
            try Task.checkCancellation()
            guard request == generation else { return }
            let page = result.objects("items")
            let existing = Set(comments.map(\.id))
            comments = page.filter { !existing.contains($0.id) } + comments
            hasOlder = page.count == 50
        } catch is CancellationError {
        } catch {
            guard request == generation else { return }
            if ngReadAccessRevoked(error) { revokeContent() }
            self.error = error.localizedDescription
        }
    }

    private func revokeContent() {
        contentUnavailable = true
        comments = []
        draft = ""
        notice = nil
        hasOlder = false
    }

    private func send() {
        let text = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !contentUnavailable, !sending, !text.isEmpty else { return }
        sending = true
        error = nil
        notice = nil
        Task {
            defer { sending = false }
            do {
                let result = try await session.api.post("/api/social", body: ["action": "comment", "id": post.id, "text": text])
                draft = ""
                if result.bool("queued") {
                    notice = result.string("notice", default: "Комментарий отправлен на проверку.")
                } else {
                    await refresh()
                }
            } catch { self.error = error.localizedDescription + " Проверьте комментарии перед повторной отправкой." }
        }
    }
}

private struct NGDraftPhoto: Identifiable {
    let id = UUID()
    let data: Data
    let name: String
    let mime: String
    var uploadID: String?
}

@MainActor
private struct NGPostComposer: View {
    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject private var session: NativeSession
    let onPublished: (String) -> Void
    @State private var text = ""
    @State private var photos: [NGDraftPhoto] = []
    @State private var picking = false
    @State private var publishing = false
    @State private var error: String?

    var body: some View {
        VStack(spacing: 16) {
            HStack {
                Button("Отмена") { dismiss() }.frame(minHeight: 44).disabled(publishing)
                Spacer()
                Text("Новая публикация").font(.headline)
                Spacer()
                Button { publish() } label: {
                    Group {
                        if publishing { ProgressView() } else { Image(systemName: "arrow.up") }
                    }.frame(width: 44, height: 44)
                        .ngGlass(radius: 22)
                }.accessibilityLabel("Опубликовать")
                    .disabled(publishing || (text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && photos.isEmpty))
            }
            ScrollView {
                VStack(spacing: 16) {
                    ZStack(alignment: .topLeading) {
                        if text.isEmpty { Text("О чём думаешь?").foregroundColor(NGTheme.muted).padding(.top, 8).padding(.leading, 5) }
                        TextEditor(text: $text).ngClearScrollBackground().frame(minHeight: 180).opacity(text.isEmpty ? 0.8 : 1)
                            .onChange(of: text) { text = String($0.prefix(5000)) }
                            .disabled(publishing)
                    }
                    if !photos.isEmpty {
                        ScrollView(.horizontal, showsIndicators: false) {
                            HStack(spacing: 12) {
                                ForEach(photos) { photo in
                                    if let image = UIImage(data: photo.data) {
                                        Image(uiImage: image).resizable().scaledToFill()
                                            .frame(width: 112, height: 112).clipped()
                                            .clipShape(RoundedRectangle(cornerRadius: 16))
                                            .overlay(alignment: .topTrailing) {
                                                Button { photos.removeAll { $0.id == photo.id } } label: {
                                                    Image(systemName: "xmark").frame(width: 44, height: 44)
                                                        .background(.ultraThinMaterial, in: Circle())
                                                }.accessibilityLabel("Удалить фото").disabled(publishing)
                                            }
                                    }
                                }
                            }
                        }
                    }
                    HStack {
                        Button { picking = true } label: { Label("Фото", systemImage: "photo").frame(minHeight: 44) }
                            .disabled(publishing || photos.count >= 4)
                        Spacer()
                        Text("\(text.count)/5000").font(.caption).foregroundColor(NGTheme.muted)
                    }
                    if let error { NGInlineError(message: error) }
                }
            }
        }
        .padding(20).background(NGTheme.background.ignoresSafeArea())
        .interactiveDismissDisabled(publishing)
        .sheet(isPresented: $picking) {
            NGPhotoPicker { data, name, mime in
                if photos.count < 4 { photos.append(NGDraftPhoto(data: data, name: name, mime: mime)) }
                picking = false
            }
        }
    }

    private func publish() {
        guard !publishing, let ownerID = session.user?.string("id"), !ownerID.isEmpty else { return }
        publishing = true
        error = nil
        Task {
            defer { publishing = false }
            do {
                for index in photos.indices where photos[index].uploadID == nil {
                    let photo = photos[index]
                    let upload = try await session.api.upload(data: photo.data, fileName: photo.name, mimeType: photo.mime, chat: false)
                    guard session.user?.string("id") == ownerID else { throw CancellationError() }
                    photos[index].uploadID = upload.string("id")
                }
                guard session.user?.string("id") == ownerID else { throw CancellationError() }
                let result = try await session.api.post("/api/social", body: [
                    "action": "post", "actor": ownerID, "text": text.trimmingCharacters(in: .whitespacesAndNewlines),
                    "media": photos.compactMap(\.uploadID)
                ])
                guard session.user?.string("id") == ownerID else { throw CancellationError() }
                onPublished(result.bool("queued") ? result.string("notice", default: "Публикация отправлена на проверку.") : "Публикация добавлена.")
                dismiss()
            } catch {
                self.error = error.localizedDescription + " Если отправка прервалась, проверьте ленту перед повторной публикацией."
            }
        }
    }
}

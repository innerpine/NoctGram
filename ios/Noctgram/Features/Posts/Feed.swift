import SwiftUI

struct SegmentOption: Identifiable, Hashable {
    let key: String
    let title: String
    var id: String { key }

    init(_ key: String, _ title: String) {
        self.key = key
        self.title = title
    }
}

/// Segments (feed-tabs on the web). iOS 26 uses the system segmented
/// control, whose selection is a Liquid Glass lens; earlier systems get a
/// glass track with a sliding capsule.
struct NoctSegments: View {
    let options: [SegmentOption]
    @Binding var selection: String
    @Namespace private var namespace

    var body: some View {
        if #available(iOS 26.0, *) {
            Picker("", selection: $selection.animation(.timingCurve(0.22, 1, 0.36, 1, duration: 0.3))) {
                ForEach(options) { option in
                    Text(option.title).tag(option.key)
                }
            }
            .pickerStyle(.segmented)
            .labelsHidden()
            .controlSize(.large)
            .sensoryFeedback(.selection, trigger: selection)
        } else {
            track
        }
    }

    private var track: some View {
        HStack(spacing: 0) {
            ForEach(options) { option in
                Button {
                    guard selection != option.key else { return }
                    Haptics.tap()
                    withAnimation(.timingCurve(0.22, 1, 0.36, 1, duration: 0.3)) { selection = option.key }
                } label: {
                    Text(option.title)
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundColor(selection == option.key ? .white : Noct.text48)
                        .frame(maxWidth: .infinity, minHeight: 36)
                        .background {
                            if selection == option.key {
                                Capsule()
                                    .fill(Color.white.opacity(0.14))
                                    .overlay(Capsule().stroke(LiquidGlass.rim, lineWidth: 0.75))
                                    .matchedGeometryEffect(id: "segment", in: namespace)
                            }
                        }
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
            }
        }
        .padding(4)
        .glassCapsule()
    }
}

/// Cards of a PostListStore with paging and empty/error states.
struct PostListContent: View {
    @EnvironmentObject private var session: AppSession
    @ObservedObject var store: PostListStore
    let empty: String

    var body: some View {
        LazyVStack(spacing: 12) {
            ForEach(store.posts) { post in
                PostCard(post: post)
                    .onAppear {
                        if post.id == store.posts.last?.id {
                            Task { await store.loadMore(api: session.api) }
                        }
                    }
            }
            if (store.loading && store.posts.isEmpty) || store.loadingMore {
                LoadingRow()
            } else if store.loaded && store.posts.isEmpty {
                if let error = store.error {
                    ErrorBanner(text: error) { Task { await store.refresh(api: session.api) } }
                } else {
                    EmptyState(text: empty)
                }
            }
        }
    }
}

/// Lists such as «Сохранённое» and a hashtag search.
struct PostListScreen: View {
    @EnvironmentObject private var session: AppSession
    let title: String
    let empty: String
    @StateObject private var store: PostListStore

    init(title: String, query: FeedQuery, empty: String) {
        self.title = title
        self.empty = empty
        _store = StateObject(wrappedValue: PostListStore(query: query))
    }

    var body: some View {
        ScrollView {
            PostListContent(store: store, empty: empty)
                .padding(.horizontal, 12)
                .padding(.vertical, 12)
        }
        .background(Noct.background)
        .refreshable { await store.refresh(api: session.api) }
        .navigationTitle(title)
        .navigationBarTitleDisplayMode(.inline)
        .task { if !store.loaded { await store.refresh(api: session.api) } }
    }
}

struct FeedView: View {
    @EnvironmentObject private var session: AppSession
    @EnvironmentObject private var nav: Navigator
    @StateObject private var store = PostListStore(query: FeedQuery(mode: "all"))
    @State private var mode = "all"
    @State private var showComposer = false

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                VStack(spacing: 12) {
                    Color.clear.frame(height: 0).id("top")
                    if let restriction = session.me?.restriction {
                        RestrictionBanner(restriction: restriction)
                    }
                    NoctSegments(options: [SegmentOption("all", "Для вас"), SegmentOption("following", "Подписки")], selection: $mode)
                    if !session.readOnly {
                        composePrompt
                    }
                    if mode == "all", !session.people.isEmpty {
                        RecommendationsRow(people: session.people)
                    }
                    PostListContent(
                        store: store,
                        empty: mode == "following"
                            ? "Подпишись на людей и каналы — их публикации появятся здесь."
                            : "Здесь пока тихо. Каждая история с чего-то начинается."
                    )
                }
                .padding(.horizontal, 12)
                .padding(.bottom, 16)
            }
            .background(Noct.background)
            .refreshable {
                await store.refresh(api: session.api)
                await session.refreshCounters()
            }
            .onChange(of: nav.rootTap) { tap in
                guard tap.tab == .feed else { return }
                withAnimation(Noct.motion) { proxy.scrollTo("top", anchor: .top) }
            }
        }
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .principal) {
                HStack(spacing: 8) {
                    Image("Logo").resizable().scaledToFit().frame(width: 26, height: 26)
                    Text("noctgram")
                        .font(.system(size: 21, weight: .semibold))
                        .tracking(-0.6)
                }
            }
            ToolbarItem(placement: .navigationBarTrailing) {
                Button {
                    showComposer = true
                } label: {
                    Image(systemName: "square.and.pencil")
                }
                .disabled(session.readOnly)
            }
            ToolbarItem(placement: .navigationBarLeading) {
                Button {
                    nav.push(.wallet)
                } label: {
                    Image("StarsIcon").resizable().scaledToFit().frame(width: 22, height: 22)
                }
            }
        }
        .sheet(isPresented: $showComposer) {
            ComposerView(author: nil) {
                Task { await store.refresh(api: session.api) }
            }
            .environmentObject(session)
        }
        .onChange(of: mode) { value in
            Task { await store.setQuery(FeedQuery(mode: value), api: session.api) }
        }
        .task {
            if !store.loaded { await store.refresh(api: session.api) }
        }
    }

    private var composePrompt: some View {
        Button {
            showComposer = true
        } label: {
            HStack(spacing: 12) {
                if let me = session.me {
                    AvatarView(person: me.identity, size: 36)
                }
                Text("Что нового?")
                    .font(.system(size: 17))
                    .foregroundColor(Noct.text48)
                Spacer()
                Image(systemName: "photo")
                    .foregroundColor(Noct.text48)
            }
            .padding(.leading, 8)
            .padding(.trailing, 16)
            .padding(.vertical, 8)
            .glassCapsule(interactive: true)
        }
        .buttonStyle(PressableStyle())
    }
}

/// People to follow from bootstrap (the right column on desktop).
struct RecommendationsRow: View {
    @EnvironmentObject private var session: AppSession
    @EnvironmentObject private var nav: Navigator
    let people: [Person]
    @State private var followed: Set<String> = []

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Кого почитать")
                .font(.system(size: 13, weight: .semibold))
                .foregroundColor(Noct.text48)
                .padding(.horizontal, 4)
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 10) {
                    ForEach(people.prefix(12)) { person in
                        VStack(spacing: 8) {
                            AvatarView(person: person.identity, size: 56)
                            DisplayName(person: person.identity, size: 13)
                                .frame(maxWidth: 110)
                            Text("@" + person.handle)
                                .font(.system(size: 12))
                                .foregroundColor(Noct.text48)
                                .lineLimit(1)
                            let on = followed.contains(person.id) || person.followed
                            Button(on ? "Вы подписаны" : "Подписаться") {
                                Task { await follow(person, value: !on) }
                            }
                            .font(.system(size: 13, weight: .semibold))
                            .foregroundColor(on ? .white : .black)
                            .padding(.horizontal, 12)
                            .frame(height: 30)
                            .glassCapsule(interactive: true, tint: on ? nil : .white)
                            .disabled(session.readOnly)
                        }
                        .frame(width: 132)
                        .padding(.vertical, 14)
                        .noctCard()
                        .onTapGesture { nav.push(.profile(person.id)) }
                    }
                }
                .padding(.horizontal, 2)
            }
        }
    }

    private func follow(_ person: Person, value: Bool) async {
        if value { followed.insert(person.id) } else { followed.remove(person.id) }
        do {
            _ = try await session.api.socialPost("follow", ["id": person.id, "value": value])
            if let index = session.people.firstIndex(where: { $0.id == person.id }) {
                session.people[index].followed = value
            }
            followed.remove(person.id)
        } catch {
            if value { followed.remove(person.id) } else { followed.insert(person.id) }
            session.report(error)
        }
    }
}

/// Read-only or blocked account notice (account-states.css).
struct RestrictionBanner: View {
    let restriction: Restriction

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: restriction.isBlocked ? "lock.fill" : "eye")
                .foregroundColor(restriction.isBlocked ? Noct.red : Noct.text60)
            VStack(alignment: .leading, spacing: 4) {
                Text(restriction.isBlocked ? "Аккаунт заблокирован" : "Режим только для чтения")
                    .font(.system(size: 14, weight: .semibold))
                if !restriction.reason.isEmpty {
                    Text(restriction.reason)
                        .font(.system(size: 13))
                        .foregroundColor(Noct.text60)
                }
                Text(restriction.expiresAt.map { "До " + Format.stamp($0) } ?? "Бессрочно")
                    .font(.system(size: 12))
                    .foregroundColor(Noct.text48)
            }
            Spacer(minLength: 0)
        }
        .padding(14)
        .noctCard()
    }
}

/// One post with its comments inline.
struct PostDetailView: View {
    @EnvironmentObject private var session: AppSession
    @EnvironmentObject private var nav: Navigator
    let postId: String
    @State private var post: Post?
    @State private var error: String?
    @StateObject private var comments = CommentsStore()
    @State private var text = ""
    @FocusState private var focused: Bool

    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 16) {
                if let post {
                    PostCard(post: post, detail: true)
                    Text("Комментарии")
                        .font(.system(size: 15, weight: .semibold))
                        .padding(.horizontal, 4)
                    if comments.hasOlder {
                        Button("Показать предыдущие") {
                            Task { await comments.loadOlder(postId: postId, api: session.api) }
                        }
                        .font(.system(size: 14, weight: .medium))
                        .foregroundColor(Noct.text75)
                    }
                    if comments.comments.isEmpty && !comments.loading {
                        Text("Комментариев пока нет. Начни разговор.")
                            .font(.system(size: 14))
                            .foregroundColor(Noct.text48)
                            .padding(.horizontal, 4)
                    }
                    ForEach(comments.comments) { comment in
                        CommentRow(
                            comment: comment,
                            onProfile: { nav.push(.profile($0)) },
                            onDelete: { Task { await comments.delete(comment, post: post, session: session) } },
                            onReport: { reason in Task { await comments.report(comment, reason: reason, session: session) } }
                        )
                        .padding(.horizontal, 4)
                    }
                } else if let error {
                    ErrorBanner(text: error) { Task { await load() } }
                } else {
                    LoadingRow()
                }
            }
            .padding(12)
        }
        .scrollDismissesKeyboard(.interactively)
        .background(Noct.background)
        .glassBottomBar {
            if let post, !session.readOnly {
                ComposerBar(text: $text, placeholder: "Написать комментарий…", sending: comments.sending, focus: $focused, leading: nil) {
                    Task {
                        if await comments.send(text, post: post, session: session) { text = "" }
                    }
                }
            }
        }
        .navigationTitle("Публикация")
        .navigationBarTitleDisplayMode(.inline)
        .onReceive(PostBus.shared.events) { event in
            switch event {
            case .updated(let updated) where updated.id == postId:
                post = updated
            case .removed(let id) where id == postId:
                error = "Публикация удалена"
                post = nil
            default:
                break
            }
        }
        .task { await load() }
    }

    private func load() async {
        do {
            post = Post(try await session.api.social("post", ["id": postId]))
            error = nil
            await comments.load(postId: postId, api: session.api)
        } catch {
            self.error = error.userMessage ?? "Публикация не найдена"
        }
    }
}

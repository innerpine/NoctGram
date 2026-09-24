import SwiftUI

/// The own profile as the root of the «Профиль» tab.
struct MyProfileView: View {
    @EnvironmentObject private var session: AppSession

    var body: some View {
        if let me = session.me {
            ProfileScreen(target: .id(me.id), isRootTab: true)
        } else {
            LoadingRow()
        }
    }
}

/// A profile exactly as on the web (app/noctgram.tsx, page === 'profile'):
/// cover, avatar line with actions, name, usernames, presence, bio, details,
/// socials, stats, channel cards and the Публикации / Медиа / Подарки tabs.
struct ProfileScreen: View {
    @EnvironmentObject private var session: AppSession
    @EnvironmentObject private var nav: Navigator
    let target: ProfileTarget
    var isRootTab = false

    @StateObject private var store = ProfileStore()
    @State private var editing: EditorTab?
    @State private var showGift = false
    @State private var showComposer = false
    @State private var confirmBlock = false
    /// Whether the name is on screen; the bar shows the name once it is not.
    @State private var nameVisible = true

    private var profile: Profile? { store.profile }
    private var own: Bool { profile?.id == session.myId }
    private var editable: Bool {
        guard let profile else { return false }
        return own || (profile.isChannel && profile.canEditProfile)
    }

    /// On iOS 26 the cover runs under the transparent bar with its glass
    /// buttons; earlier systems keep it below the frosted bar.
    private var coverUnderBar: Bool { LiquidGlass.isNative }

    private var titleShown: Bool {
        if #available(iOS 18.0, *) { return !nameVisible }
        return true
    }

    var body: some View {
        GeometryReader { geometry in
            scroll(topInset: coverUnderBar ? geometry.safeAreaInsets.top : 0)
        }
        .navigationTitle(titleShown ? profile?.name ?? "" : "")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar { toolbar }
        .sheet(item: $editing) { tab in
            if let profile {
                ProfileEditorView(profile: profile, initialTab: tab) { updated in
                    store.profile = updated
                    if updated.id == session.myId { session.me = updated }
                    Task { await store.load(.id(updated.id), api: session.api) }
                }
                .environmentObject(session)
            }
        }
        .sheet(isPresented: $showGift) {
            if let profile {
                SendGiftSheet(recipient: profile.identity)
                    .environmentObject(session)
            }
        }
        .sheet(isPresented: $showComposer) {
            if let profile {
                ComposerView(author: profile.identity) {
                    Task { await store.posts.refresh(api: session.api) }
                }
                .environmentObject(session)
            }
        }
        .confirmationDialog("Заблокировать \(profile?.name ?? "")?", isPresented: $confirmBlock, titleVisibility: .visible) {
            Button("Заблокировать", role: .destructive) { Task { await block() } }
            Button("Отмена", role: .cancel) {}
        } message: {
            Text("Вы перестанете видеть публикации и сообщения друг друга, подписки удалятся.")
        }
        .task {
            if store.profile == nil { await store.load(target, api: session.api) }
            #if DEBUG
            if isRootTab, let tab = UserDefaults.standard.string(forKey: "noct.debugEditor").flatMap(EditorTab.init(rawValue:)) {
                editing = tab
            }
            if isRootTab, let tab = UserDefaults.standard.string(forKey: "noct.debugProfileTab").flatMap(ProfileTab.init(rawValue:)) {
                await store.select(tab, api: session.api)
            }
            #endif
        }
        .onChange(of: session.me) { me in
            // Keep the own profile in sync after edits made elsewhere.
            if let me, me.id == store.profile?.id { store.profile = me }
        }
    }

    private func scroll(topInset: CGFloat) -> some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(spacing: 0, pinnedViews: []) {
                    Color.clear.frame(height: 0).id("top")
                    if let profile {
                        if profile.blocked {
                            BlockedProfileView(profile: profile)
                                .padding(.top, topInset)
                        } else {
                            header(profile, topInset: topInset)
                            tabs(profile)
                                .padding(.top, 14)
                                .id("tabs")
                            content(profile)
                                .padding(.horizontal, 12)
                                .padding(.top, 12)
                                .padding(.bottom, 24)
                        }
                    } else if let error = store.error {
                        ErrorBanner(text: error) { Task { await store.load(target, api: session.api) } }
                            .padding(.top, 60 + topInset)
                    } else {
                        LoadingRow().padding(.top, 80 + topInset)
                    }
                }
            }
            .background(Noct.background)
            .ignoresSafeArea(.container, edges: coverUnderBar ? .top : [])
            .refreshable {
                await store.load(target, api: session.api)
                if own { await session.refreshMe() }
            }
            .onChange(of: nav.rootTap) { tap in
                guard isRootTab, tap.tab == .profile else { return }
                withAnimation(Noct.motion) { proxy.scrollTo("top", anchor: .top) }
            }
            #if DEBUG
            .onAppear {
                guard isRootTab, UserDefaults.standard.string(forKey: "noct.debugScroll") == "tabs" else { return }
                // Under the iOS 26 bar the tabs stop below it, not at the screen edge.
                let anchor = coverUnderBar ? UnitPoint(x: 0.5, y: 0.14) : .top
                DispatchQueue.main.asyncAfter(deadline: .now() + 3) { proxy.scrollTo("tabs", anchor: anchor) }
            }
            #endif
        }
    }

    @ToolbarContentBuilder private var toolbar: some ToolbarContent {
        ToolbarItem(placement: .navigationBarTrailing) {
            if let profile {
                Menu {
                    Button {
                        session.copy(session.api.webLink(["profile": profile.id]).absoluteString, message: "Ссылка на профиль скопирована")
                    } label: {
                        Label("Скопировать ссылку", systemImage: "link")
                    }
                    ShareLink(item: session.api.webLink(["profile": profile.id])) {
                        Label("Поделиться профилем", systemImage: "square.and.arrow.up")
                    }
                    Button {
                        session.copy("@" + profile.handle, message: "Юзернейм скопирован")
                    } label: {
                        Label("Скопировать @\(profile.handle)", systemImage: "at")
                    }
                    if own {
                        Button {
                            nav.push(.saved)
                        } label: {
                            Label("Сохранённое", systemImage: "bookmark")
                        }
                        Button {
                            nav.push(.settings)
                        } label: {
                            Label("Настройки", systemImage: "gearshape")
                        }
                    } else if !profile.isChannel && profile.id != "noctgram" {
                        Button(role: .destructive) {
                            confirmBlock = true
                        } label: {
                            Label("Заблокировать", systemImage: "hand.raised")
                        }
                    }
                } label: {
                    Image(systemName: LiquidGlass.moreIcon)
                }
            }
        }
    }

    // MARK: Header

    @ViewBuilder private func header(_ profile: Profile, topInset: CGFloat) -> some View {
        let look = profile.appearance
        let premiumSurface = look.premium && !profile.isChannel && profile.background.mode != "none"
        VStack(alignment: .leading, spacing: 0) {
            ProfileCover(profile: profile, height: 160 + topInset)
                .overlay(alignment: .topTrailing) {
                    if editable {
                        Button {
                            editing = .profile
                        } label: {
                            Image(systemName: "camera")
                        }
                        .buttonStyle(CircleButtonStyle(size: 36))
                        .padding(.trailing, 12)
                        .padding(.top, topInset + (topInset > 0 ? 6 : 12))
                        .disabled(session.readOnly && !own)
                        .accessibilityLabel("Сменить обложку")
                    }
                }

            VStack(alignment: .leading, spacing: 0) {
                avatarLine(profile)
                identity(profile)
                if !profile.isChannel {
                    MusicActivityCard(profile: profile)
                }
                bio(profile)
                    .padding(.top, 14)
                ProfileMetaView(profile: profile)
                    .padding(.top, 14)
                stats(profile)
                    .padding(.top, 14)
                if !profile.personalChannels.isEmpty {
                    ChannelCardsView(channels: profile.personalChannels)
                        .padding(.top, 16)
                }
                if own {
                    Button {
                        nav.push(.saved)
                    } label: {
                        HStack(spacing: 12) {
                            Image(systemName: "bookmark")
                                .font(.system(size: 17))
                            Text("Сохранённое")
                                .font(.system(size: 14))
                            Spacer()
                            Image(systemName: "chevron.right")
                                .font(.system(size: 13, weight: .semibold))
                                .foregroundColor(Noct.text48)
                        }
                        .foregroundColor(Color.white.opacity(0.85))
                        .padding(.horizontal, 16)
                        .frame(minHeight: 48)
                        .glassRect(16, interactive: true)
                    }
                    .buttonStyle(PressableStyle())
                    .padding(.top, 18)
                }
                if profile.isChannel && profile.canPublish && !session.readOnly {
                    Button {
                        showComposer = true
                    } label: {
                        Label("Опубликовать в канале", systemImage: "square.and.pencil")
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(SecondaryButtonStyle())
                    .padding(.top, 16)
                }
                if look.verified {
                    VerifiedNotice(appearance: look)
                        .padding(.top, 18)
                }
            }
            .padding(.horizontal, 18)
            .padding(.bottom, look.verified ? 0 : 18)
            .background(
                LinearGradient(
                    colors: [look.theme.wash.opacity(look.hasDesign ? 0.08 : 0), .clear],
                    startPoint: .topLeading,
                    endPoint: UnitPoint(x: 0.6, y: 0.6)
                )
            )
        }
        .background(
            ZStack {
                Noct.card
                if premiumSurface {
                    LinearGradient(
                        colors: surfaceColors(profile),
                        startPoint: .topLeading,
                        endPoint: .bottomTrailing
                    )
                    .opacity(Double(profile.background.intensity) / 100)
                }
            }
        )
        .overlay(alignment: .bottom) { Rectangle().fill(Noct.border).frame(height: 0.5) }
    }

    private func surfaceColors(_ profile: Profile) -> [Color] {
        if profile.background.mode == "custom",
           let first = Color(hexString: profile.background.first),
           let second = Color(hexString: profile.background.second) {
            return [first, second]
        }
        return [profile.appearance.theme.first, profile.appearance.theme.second]
    }

    private func avatarLine(_ profile: Profile) -> some View {
        HStack(alignment: .bottom, spacing: 8) {
            ProfileAvatar(person: profile.identity, size: 96)
                .offset(y: -40)
                .padding(.bottom, -40)
            Spacer(minLength: 4)
            // Narrow phones and avatars with an orbiting text ring get icon buttons.
            ViewThatFits(in: .horizontal) {
                actions(profile, compact: false)
                actions(profile, compact: true)
            }
        }
    }

    private func actions(_ profile: Profile, compact: Bool) -> some View {
        GlassGroup(spacing: 4) {
            actionButtons(profile, compact: compact)
        }
    }

    private func actionButtons(_ profile: Profile, compact: Bool) -> some View {
        HStack(spacing: 8) {
            if editable {
                if compact {
                    Button {
                        editing = .profile
                    } label: {
                        Image(systemName: "pencil")
                    }
                    .buttonStyle(CircleButtonStyle())
                    .accessibilityLabel("Редактировать")
                    .disabled(session.readOnly && !own)
                } else {
                    Button {
                        editing = .profile
                    } label: {
                        Text("Редактировать").lineLimit(1).fixedSize()
                    }
                    .buttonStyle(SecondaryButtonStyle())
                    .disabled(session.readOnly && !own)
                }
                if own {
                    Button {
                        nav.push(.settings)
                    } label: {
                        Image(systemName: "gearshape")
                    }
                    .buttonStyle(CircleButtonStyle())
                    .accessibilityLabel("Настройки")
                }
                if own || profile.appearance.boostLevel > 0 {
                    Button {
                        editing = .design
                    } label: {
                        PremiumBadge(appearance: profile.appearance.premium ? profile.appearance : Appearance(), size: 20)
                    }
                    .buttonStyle(CircleButtonStyle())
                    .accessibilityLabel("Оформление профиля")
                }
            } else {
                if compact {
                    Button {
                        Task { await store.toggleFollow(session: session) }
                    } label: {
                        Image(systemName: profile.followed ? "person.fill.checkmark" : "person.badge.plus")
                    }
                    .buttonStyle(CircleButtonStyle())
                    .accessibilityLabel(profile.followed ? "Вы подписаны" : "Подписаться")
                    .disabled(session.readOnly || store.followBusy)
                } else if profile.followed {
                    Button {
                        Task { await store.toggleFollow(session: session) }
                    } label: {
                        Text("Вы подписаны").lineLimit(1).fixedSize()
                    }
                    .buttonStyle(SecondaryButtonStyle())
                    .disabled(session.readOnly || store.followBusy)
                } else {
                    Button {
                        Task { await store.toggleFollow(session: session) }
                    } label: {
                        Text("Подписаться").lineLimit(1).fixedSize()
                    }
                    .buttonStyle(PrimaryButtonStyle())
                    .disabled(session.readOnly || store.followBusy)
                }
                if profile.id != "noctgram" && !profile.isChannel {
                    Button {
                        nav.push(.chat(Person(identity: profile.identity)))
                    } label: {
                        Image(systemName: "paperplane")
                    }
                    .buttonStyle(CircleButtonStyle())
                    .accessibilityLabel("Написать сообщение")
                }
            }
            if profile.id != "noctgram" && !own {
                Button {
                    showGift = true
                } label: {
                    Image(systemName: "gift")
                }
                .buttonStyle(CircleButtonStyle())
                .disabled(session.readOnly)
                .accessibilityLabel("Отправить подарок")
            }
        }
    }

    private func identity(_ profile: Profile) -> some View {
        let look = profile.appearance
        let accent = look.premium ? look.theme.first : Noct.text75
        return VStack(alignment: .leading, spacing: 0) {
            DisplayName(person: profile.identity, size: 29, weight: .semibold, tracking: -1.2)
                .padding(.top, 14)
                .onScrollVisible { visible in
                    withAnimation(Noct.quick) { nameVisible = visible }
                }
            HStack(spacing: 8) {
                Button {
                    session.copy("@" + profile.handle, message: "Юзернейм скопирован")
                } label: {
                    HStack(spacing: 6) {
                        Text("@" + profile.handle)
                            .font(.system(size: 15))
                            .foregroundColor(accent)
                        Image(systemName: "doc.on.doc")
                            .font(.system(size: 11))
                            .foregroundColor(Noct.text48)
                    }
                }
                .buttonStyle(PressableStyle())
                if profile.isChannel {
                    ChannelLabel(appearance: look)
                }
            }
            .padding(.top, 10)
            if profile.lastSeen > 0 {
                let online = Format.isOnline(profile.lastSeen)
                HStack(spacing: 8) {
                    Circle()
                        .fill(online ? Noct.green : Color.white.opacity(0.25))
                        .frame(width: 7, height: 7)
                    Text(Format.presence(profile.lastSeen))
                        .font(.system(size: 13))
                        .foregroundColor(online ? Noct.text75 : Noct.text48)
                }
                .padding(.top, 6)
            }
            if !profile.extraHandles.isEmpty {
                aliasRow(prefix: "а также", values: profile.extraHandles.map { "@" + $0 }, accent: accent, message: "Юзернейм скопирован")
                    .padding(.top, 8)
            }
            if !profile.anonymousNumber.isEmpty {
                aliasRow(prefix: "Анонимный номер", values: [Format.marketNumber(profile.anonymousNumber)], accent: accent, message: "Номер скопирован")
                    .padding(.top, 4)
            }
        }
    }

    private func aliasRow(prefix: String, values: [String], accent: Color, message: String) -> some View {
        FlowLayout(spacing: 0, lineSpacing: 2) {
            Text(prefix + " ")
                .font(.system(size: 13))
                .foregroundColor(Noct.text48)
                .padding(.trailing, 4)
            ForEach(Array(values.enumerated()), id: \.offset) { index, value in
                Button {
                    session.copy(value, message: message)
                } label: {
                    Text(value + (index < values.count - 1 ? ", " : ""))
                        .font(.system(size: 13, weight: .medium))
                        .foregroundColor(accent)
                }
                .buttonStyle(PressableStyle())
            }
        }
    }

    @ViewBuilder private func bio(_ profile: Profile) -> some View {
        if !profile.bio.isEmpty {
            LinkedText(text: profile.bio, size: 15, color: Noct.text75, lineSpacing: 5)
        } else {
            Text(own ? "Расскажи о себе — пусть свои тебя узнают." : "Пока без описания.")
                .font(.system(size: 15))
                .foregroundColor(Noct.text48)
        }
    }

    private func stats(_ profile: Profile) -> some View {
        HStack(spacing: 20) {
            Button {
                nav.push(.connections(profileId: profile.id, kind: .followers))
            } label: {
                statLabel(profile.followers, Format.plural(profile.followers, "подписчик", "подписчика", "подписчиков"))
            }
            .buttonStyle(PressableStyle())
            Button {
                nav.push(.connections(profileId: profile.id, kind: .following))
            } label: {
                statLabel(profile.following, Format.plural(profile.following, "подписка", "подписки", "подписок"))
            }
            .buttonStyle(PressableStyle())
            statLabel(profile.postCount, Format.plural(profile.postCount, "публикация", "публикации", "публикаций"))
            Spacer(minLength: 0)
        }
    }

    private func statLabel(_ value: Int, _ label: String) -> some View {
        HStack(spacing: 4) {
            Text(Format.count(value))
                .font(.system(size: 15, weight: .semibold))
                .foregroundColor(.white)
            Text(label)
                .font(.system(size: 13))
                .foregroundColor(Noct.text48)
        }
    }

    // MARK: Tabs

    private func tabs(_ profile: Profile) -> some View {
        NoctSegments(
            options: ProfileTab.allCases.map { SegmentOption($0.rawValue, $0.title) },
            selection: Binding(
                get: { store.tab.rawValue },
                set: { value in
                    guard let tab = ProfileTab(rawValue: value) else { return }
                    Task { await store.select(tab, api: session.api) }
                }
            )
        )
        .padding(.horizontal, 12)
    }

    @ViewBuilder private func content(_ profile: Profile) -> some View {
        switch store.tab {
        case .posts:
            PostListContent(store: store.posts, empty: "Здесь пока тихо. Каждая история с чего-то начинается.")
        case .media:
            MediaTabGrid(store: store.media)
        case .gifts:
            VStack(spacing: 12) {
                if own || (profile.isChannel && profile.canEditProfile) {
                    Button {
                        showGift = true
                    } label: {
                        Label(own ? "Подарить себе" : "Подарить каналу", systemImage: "gift")
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(SecondaryButtonStyle())
                    .disabled(session.readOnly)
                }
                GiftsGrid(store: store, own: own || (profile.isChannel && profile.canEditProfile))
            }
        }
    }

    private func block() async {
        guard let profile else { return }
        do {
            _ = try await session.api.socialPost("blockUser", ["id": profile.id, "value": true])
            session.show("\(profile.name) заблокирован(а)")
            await store.load(target, api: session.api)
        } catch {
            session.report(error)
        }
    }
}

/// Media tab: a three-column grid of photos and videos from the profile's posts.
struct MediaTabGrid: View {
    @EnvironmentObject private var session: AppSession
    @ObservedObject var store: PostListStore
    @State private var viewer: MediaViewerState?

    private let columns = [GridItem(.flexible(), spacing: 3), GridItem(.flexible(), spacing: 3), GridItem(.flexible(), spacing: 3)]

    var body: some View {
        let entries = store.posts.flatMap { post in post.media.map { (post: post, item: $0) } }
        VStack(spacing: 12) {
            LazyVGrid(columns: columns, spacing: 3) {
                ForEach(Array(entries.enumerated()), id: \.offset) { index, entry in
                    Button {
                        viewer = MediaViewerState(items: entry.post.media, index: entry.post.media.firstIndex(of: entry.item) ?? 0)
                    } label: {
                        Color.clear
                            .aspectRatio(1, contentMode: .fit)
                            .overlay {
                                ZStack {
                                    if entry.item.isVideo {
                                        VideoThumbnail(url: session.api.mediaURL(entry.item.path))
                                    } else {
                                        RemoteImage(url: session.api.mediaURL(entry.item.path), maxPixel: 420)
                                    }
                                }
                                .blur(radius: entry.post.adult ? 18 : 0)
                            }
                            .clipped()
                            .overlay(alignment: .topTrailing) {
                                if entry.item.isVideo {
                                    Image(systemName: "play.fill")
                                        .font(.system(size: 11))
                                        .padding(6)
                                } else if entry.post.adult {
                                    Text("18+").font(.system(size: 10, weight: .bold)).padding(6)
                                }
                            }
                    }
                    .buttonStyle(PressableStyle())
                    .onAppear {
                        if index == entries.count - 1 {
                            Task { await store.loadMore(api: session.api) }
                        }
                    }
                }
            }
            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
            if (store.loading && store.posts.isEmpty) || store.loadingMore {
                LoadingRow()
            } else if store.loaded && entries.isEmpty {
                EmptyState(icon: "photo.on.rectangle", text: "Фото и видео пока нет.")
            }
        }
        .fullScreenCover(item: $viewer) { state in
            MediaViewer(items: state.items, index: state.index)
                .environmentObject(session)
        }
    }
}

/// Another user's or channel's blocked profile: dark cover and a locked avatar.
struct BlockedProfileView: View {
    let profile: Profile

    var body: some View {
        VStack(spacing: 0) {
            Color(hex: 0x0A0A0B).frame(height: 160)
            ZStack {
                Circle().fill(Noct.avatarFill).frame(width: 96, height: 96)
                Image(systemName: "lock.fill")
                    .font(.system(size: 30))
                    .foregroundColor(Noct.red.opacity(0.85))
            }
            .overlay(Circle().stroke(Noct.background, lineWidth: 4))
            .offset(y: -48)
            .padding(.bottom, -48)
            Text(profile.name)
                .font(.system(size: 24, weight: .semibold))
                .padding(.top, 12)
            Text("@" + profile.handle)
                .font(.system(size: 15))
                .foregroundColor(Noct.text48)
                .padding(.top, 4)
            Text(profile.isChannel ? "Канал заблокирован модераторами Noctgram." : "Аккаунт заблокирован модераторами Noctgram.")
                .font(.system(size: 14))
                .foregroundColor(Noct.text60)
                .multilineTextAlignment(.center)
                .padding(24)
        }
        .frame(maxWidth: .infinity)
    }
}

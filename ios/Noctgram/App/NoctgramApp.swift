import SwiftUI
import UIKit

@main
struct NoctgramApp: App {
    @StateObject private var session = AppSession()
    @Environment(\.scenePhase) private var scenePhase

    init() {
        BarAppearance.apply()
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(session)
                .preferredColorScheme(.dark)
                .tint(.white)
        }
        .onChange(of: scenePhase) { phase in
            switch phase {
            case .active:
                if session.phase == .ready {
                    session.startPolling()
                }
            case .background:
                session.stopPolling()
            default:
                break
            }
        }
    }
}

struct RootView: View {
    @EnvironmentObject private var session: AppSession
    /// A held chat message is drawn here, above the bars.
    @StateObject private var focus = MessageFocus()

    var body: some View {
        ZStack {
            Noct.background.ignoresSafeArea()
            switch session.phase {
            case .launching:
                SplashView()
            case .signedOut:
                LoginView()
            case .onboarding:
                OnboardingView()
            case .ready:
                MainTabView()
            case .failed(let message):
                ConnectionErrorView(message: message)
            }
        }
        .environmentObject(focus)
        .overlay {
            if let item = focus.item {
                MessageFocusView(item: item) { focus.dismiss() }
                    .environmentObject(session)
            }
        }
        .overlay(alignment: .top) {
            if let toast = session.toast {
                ToastView(text: toast)
                    .transition(.move(edge: .top).combined(with: .opacity))
                    .padding(.top, 6)
            }
        }
        .animation(Noct.motion, value: session.phase)
        .task { await session.start() }
    }
}

struct MainTabView: View {
    @EnvironmentObject private var session: AppSession
    @StateObject private var nav = Navigator()
    /// The own avatar as the «Профиль» tab icon, as in iOS messengers.
    @State private var avatarIcon: UIImage?

    var body: some View {
        tabs
            .environmentObject(nav)
            .environment(\.openURL, OpenURLAction { url in nav.open(url) })
            .task(id: session.me?.avatar) { await loadAvatarIcon() }
            #if DEBUG
            .onAppear { DebugLaunch.apply(nav, me: session.myId ?? "") }
            #endif
    }

    private var profileIcon: Image {
        if let avatarIcon {
            return Image(uiImage: avatarIcon).renderingMode(.original)
        }
        return Image(systemName: "person.crop.circle")
    }

    private func loadAvatarIcon() async {
        guard let path = session.me?.avatar, !path.isEmpty,
              let url = session.api.mediaURL(path),
              let image = await ImagePipeline.shared.image(for: url, maxPixel: 120) else {
            avatarIcon = nil
            return
        }
        avatarIcon = TabAvatar.render(image)
    }

    /// iOS 18+ tabs: on iOS 26 they float in a Liquid Glass bar that shrinks
    /// while scrolling, with «Поиск» as the separate search button.
    @ViewBuilder private var tabs: some View {
        if #available(iOS 18.0, *) {
            TabView(selection: nav.tabSelection) {
                Tab("Лента", systemImage: "house", value: AppTab.feed) { feed }
                Tab("Сообщения", systemImage: "bubble.left.and.bubble.right", value: AppTab.messages) { messages }
                    .badge(session.unreadMessages)
                Tab("Уведы", systemImage: "bell", value: AppTab.notifications) { notifications }
                    .badge(session.unreadNotifications)
                Tab(value: AppTab.profile) {
                    profile
                } label: {
                    Label { Text("Профиль") } icon: { profileIcon }
                }
                Tab("Поиск", systemImage: "magnifyingglass", value: AppTab.search, role: .search) { search }
            }
            .minimizesTabBarOnScroll()
        } else {
            TabView(selection: nav.tabSelection) {
                feed
                    .tabItem { Label("Лента", systemImage: "house") }
                    .tag(AppTab.feed)
                search
                    .tabItem { Label("Поиск", systemImage: "magnifyingglass") }
                    .tag(AppTab.search)
                messages
                    .tabItem { Label("Сообщения", systemImage: "bubble.left.and.bubble.right") }
                    .badge(session.unreadMessages)
                    .tag(AppTab.messages)
                notifications
                    .tabItem { Label("Уведы", systemImage: "bell") }
                    .badge(session.unreadNotifications)
                    .tag(AppTab.notifications)
                profile
                    .tabItem { Label { Text("Профиль") } icon: { profileIcon } }
                    .tag(AppTab.profile)
            }
        }
    }

    private var feed: some View {
        NavigationStack(path: $nav.feedPath) { FeedView().appRoutes() }
    }

    private var search: some View {
        NavigationStack(path: $nav.searchPath) { SearchView().appRoutes() }
    }

    private var messages: some View {
        NavigationStack(path: $nav.messagesPath) { ThreadsView().appRoutes() }
    }

    private var notifications: some View {
        NavigationStack(path: $nav.notificationsPath) { NotificationsView().appRoutes() }
    }

    private var profile: some View {
        NavigationStack(path: $nav.profilePath) { ProfileHubView().appRoutes() }
    }
}

/// A round avatar for the tab bar, drawn in its own colours.
enum TabAvatar {
    static func render(_ image: UIImage, size: CGFloat = 28) -> UIImage {
        let side = CGSize(width: size, height: size)
        let rendered = UIGraphicsImageRenderer(size: side).image { _ in
            let frame = CGRect(origin: .zero, size: side)
            UIBezierPath(ovalIn: frame).addClip()
            let scale = max(size / max(image.size.width, 1), size / max(image.size.height, 1))
            let drawn = CGSize(width: image.size.width * scale, height: image.size.height * scale)
            image.draw(in: CGRect(x: (size - drawn.width) / 2, y: (size - drawn.height) / 2, width: drawn.width, height: drawn.height))
        }
        return rendered.withRenderingMode(.alwaysOriginal)
    }
}

#if DEBUG
/// Simulator screenshots (ios/Tests): `-noct.debugTab profile`,
/// `-noct.debugRoute chat:<id>` or `room:<id>`. Launch arguments fill UserDefaults.
enum DebugLaunch {
    @MainActor
    static func apply(_ nav: Navigator, me: String) {
        let defaults = UserDefaults.standard
        switch defaults.string(forKey: "noct.debugTab") {
        case "search": nav.tab = .search
        case "messages": nav.tab = .messages
        case "notifications": nav.tab = .notifications
        case "profile": nav.tab = .profile
        default: break
        }
        guard let route = defaults.string(forKey: "noct.debugRoute"), let split = route.firstIndex(of: ":") else { return }
        let kind = String(route[..<split]), value = String(route[route.index(after: split)...])
        switch kind {
        case "profile": nav.push(.profile(value))
        case "post": nav.push(.post(value))
        case "chat": nav.push(.chat(Person(identity: Identity(id: value, name: "", avatar: "", handle: ""))))
        case "room": nav.push(.room(id: value, title: ""))
        case "followers": nav.push(.connections(profileId: value, kind: .followers))
        case "screen":
            switch value {
            case "settings": nav.push(.settings)
            case "wallet": nav.push(.wallet)
            case "saved": nav.push(.saved)
            case "gifts": nav.push(.gifts(me))
            default: break
            }
        default: break
        }
    }
}
#endif

struct SplashView: View {
    var body: some View {
        VStack(spacing: 18) {
            Image("Logo")
                .resizable()
                .scaledToFit()
                .frame(width: 88, height: 88)
            ProgressView()
                .tint(.white.opacity(0.6))
        }
    }
}

struct ConnectionErrorView: View {
    @EnvironmentObject private var session: AppSession
    let message: String
    @State private var showServer = false

    var body: some View {
        VStack(spacing: 18) {
            Image(systemName: "wifi.exclamationmark")
                .font(.system(size: 40, weight: .light))
                .foregroundColor(Noct.text48)
            Text("Не удалось подключиться")
                .font(.system(size: 21, weight: .semibold))
            Text(message)
                .font(.system(size: 15))
                .foregroundColor(Noct.text60)
                .multilineTextAlignment(.center)
            Text("Сервер: \(session.serverLabel)")
                .font(.system(size: 13))
                .foregroundColor(Noct.text48)
            Button("Повторить") {
                Task { await session.start() }
            }
            .buttonStyle(PrimaryButtonStyle())
            Button("Сменить сервер") { showServer = true }
                .buttonStyle(SecondaryButtonStyle())
        }
        .padding(32)
        .sheet(isPresented: $showServer) {
            ServerSheet().environmentObject(session)
        }
    }
}

struct ToastView: View {
    let text: String

    var body: some View {
        Text(text)
            .font(.system(size: 14, weight: .medium))
            .foregroundColor(.white)
            .multilineTextAlignment(.center)
            .padding(.horizontal, 18)
            .padding(.vertical, 12)
            .glassCapsule()
            .shadow(color: .black.opacity(LiquidGlass.isNative ? 0 : 0.35), radius: 16, y: 6)
            .padding(.horizontal, 24)
    }
}

/// Placeholder shown while a list loads (DESIGN.md: states never fake timing).
struct LoadingRow: View {
    var body: some View {
        HStack {
            Spacer()
            ProgressView().tint(.white.opacity(0.6))
            Spacer()
        }
        .padding(.vertical, 28)
    }
}

struct EmptyState: View {
    var icon: String = "moon.stars"
    let text: String

    var body: some View {
        VStack(spacing: 12) {
            Image(systemName: icon)
                .font(.system(size: 30, weight: .light))
                .foregroundColor(Noct.text25)
            Text(text)
                .font(.system(size: 15))
                .foregroundColor(Noct.text48)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 48)
        .padding(.horizontal, 32)
    }
}

struct ErrorBanner: View {
    let text: String
    var retry: (() -> Void)?

    var body: some View {
        VStack(spacing: 10) {
            Text(text)
                .font(.system(size: 14))
                .foregroundColor(Noct.text60)
                .multilineTextAlignment(.center)
            if let retry {
                Button("Повторить", action: retry)
                    .buttonStyle(SecondaryButtonStyle())
            }
        }
        .frame(maxWidth: .infinity)
        .padding(24)
    }
}

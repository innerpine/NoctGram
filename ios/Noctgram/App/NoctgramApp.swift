import SwiftUI

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

    var body: some View {
        TabView(selection: nav.tabSelection) {
            NavigationStack(path: $nav.feedPath) {
                FeedView().appRoutes()
            }
            .tabItem { Label("Лента", systemImage: "house") }
            .tag(AppTab.feed)

            NavigationStack(path: $nav.searchPath) {
                SearchView().appRoutes()
            }
            .tabItem { Label("Поиск", systemImage: "magnifyingglass") }
            .tag(AppTab.search)

            NavigationStack(path: $nav.messagesPath) {
                ThreadsView().appRoutes()
            }
            .tabItem { Label("Сообщения", systemImage: "bubble.left.and.bubble.right") }
            .badge(session.unreadMessages)
            .tag(AppTab.messages)

            NavigationStack(path: $nav.notificationsPath) {
                NotificationsView().appRoutes()
            }
            .tabItem { Label("Уведомления", systemImage: "bell") }
            .badge(session.unreadNotifications)
            .tag(AppTab.notifications)

            NavigationStack(path: $nav.profilePath) {
                MyProfileView().appRoutes()
            }
            .tabItem { Label("Профиль", systemImage: "person.crop.circle") }
            .tag(AppTab.profile)
        }
        .environmentObject(nav)
        .environment(\.openURL, OpenURLAction { url in nav.open(url) })
    }
}

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
            .padding(.horizontal, 16)
            .padding(.vertical, 11)
            .background(Capsule().fill(Noct.elevated))
            .overlay(Capsule().stroke(Noct.borderStrong, lineWidth: 1))
            .shadow(color: .black.opacity(0.5), radius: 16, y: 6)
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

import SwiftUI

@MainActor
final class NativeSession: ObservableObject {
    enum Phase { case loading, signedOut, onboarding, signedIn, unavailable }
    @Published var phase: Phase = .loading
    @Published var user: NGRecord?
    @Published var challenge: NGRecord?
    @Published var error: String?
    @Published var emailEnabled = true
    private var restoring = false

    func refresh() async {
        guard !restoring else { return }
        restoring = true
        defer { restoring = false }
        do {
            let status = try await NoctAPI.shared.get("/api/auth/session")
            emailEnabled = status.bool("emailEnabled")
            challenge = status.object("challenge")
            guard let person = status.object("user"), !person.string("id").isEmpty else {
                user = nil
                phase = .signedOut
                error = nil
                return
            }
            user = person
            guard person.bool("onboardingComplete") else {
                phase = .onboarding
                return
            }
            let result = try await NoctAPI.shared.get("/api/social", query: ["action": "bootstrap"])
            guard let me = result.object("me"), !me.string("id").isEmpty else {
                throw NSError(domain: "NoctGram", code: 0,
                              userInfo: [NSLocalizedDescriptionKey: "Сервер не вернул профиль. Попробуйте ещё раз."])
            }
            user = me
            error = nil
            phase = .signedIn
        } catch let failure as NoctAPIError where failure.isUnauthorized {
            expire()
        } catch let failure as NoctAPIError where failure.requiresOnboarding {
            phase = .onboarding
        } catch is CancellationError {
        } catch {
            self.error = error.localizedDescription
            if phase != .signedIn { phase = .unavailable }
        }
    }

    func signOut() async {
        do {
            _ = try await NoctAPI.shared.post("/api/auth/logout", body: [:])
        } catch {
            // Always remove this device's credentials, including when it is offline.
        }
        expire()
    }

    func expire() {
        NoctAPI.shared.clearSession()
        NGImageCache.shared.removeAllObjects()
        NGTemporaryMedia.removeAll()
        user = nil
        challenge = nil
        error = nil
        phase = .signedOut
    }
}

struct NativeRootView: View {
    @StateObject private var session = NativeSession()
    @Environment(\.scenePhase) private var scenePhase
    @State private var selectedTab = 0
    @State private var pickerError: String?

    var body: some View {
        ZStack {
            NGTheme.background.ignoresSafeArea()
            switch session.phase {
            case .loading:
                VStack(spacing: 24) {
                    Image(systemName: "moon.fill").font(.system(size: 48)).foregroundColor(NGTheme.accent)
                    Text("NoctGram").font(.largeTitle.bold())
                    ProgressView().tint(NGTheme.accent)
                }
            case .signedOut:
                NGSignInView()
            case .onboarding:
                NGOnboardingView()
            case .signedIn:
                TabView(selection: $selectedTab) {
                    NavigationView { NGFeedView() }
                        .navigationViewStyle(.stack)
                        .tabItem { Label("Лента", systemImage: "square.stack.fill") }.tag(0)
                    NavigationView { NGChatsView() }
                        .navigationViewStyle(.stack)
                        .tabItem { Label("Сообщения", systemImage: "bubble.left.and.bubble.right.fill") }.tag(1)
                    NavigationView { NGActivityView() }
                        .navigationViewStyle(.stack)
                        .tabItem { Label("События", systemImage: "bell.fill") }.tag(2)
                    NavigationView { NGProfileView() }
                        .navigationViewStyle(.stack)
                        .tabItem { Label("Профиль", systemImage: "person.crop.circle") }.tag(3)
                }
                .id(session.user?.id ?? "")
            case .unavailable:
                VStack(spacing: 20) {
                    NGEmptyState(title: "Не удалось подключиться", message: session.error ?? "Проверьте интернет и попробуйте ещё раз.", systemImage: "wifi.slash")
                    Button("Попробовать снова") { Task { await session.refresh() } }
                        .buttonStyle(NGPrimaryButtonStyle())
                }.padding(24)
            }
        }
        .environmentObject(session)
        .tint(NGTheme.accent)
        .preferredColorScheme(.dark)
        .task {
            #if DEBUG
            if ProcessInfo.processInfo.arguments.contains("--ui-test-login") {
                session.phase = .signedOut
                return
            }
            #endif
            NGTemporaryMedia.removeAll()
            await session.refresh()
        }
        .onChange(of: scenePhase) { phase in
            if phase == .active, session.phase == .signedIn {
                Task { await session.refresh() }
            }
        }
        .onReceive(NotificationCenter.default.publisher(for: Notification.Name("noctSessionExpired"))) { _ in
            session.expire()
        }
        .onReceive(NotificationCenter.default.publisher(for: Notification.Name("noctPickerError"))) { notice in
            pickerError = notice.object as? String
        }
        .alert("Не удалось выбрать файл", isPresented: Binding(get: { pickerError != nil }, set: { if !$0 { pickerError = nil } })) {
            Button("Понятно", role: .cancel) { pickerError = nil }
        } message: { Text(pickerError ?? "") }
    }
}

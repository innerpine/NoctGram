import SwiftUI
import UIKit
import WebKit

/// The signed-in account, the server and app-wide counters.
@MainActor
final class AppSession: ObservableObject {
    enum Phase: Equatable {
        case launching
        case signedOut
        case onboarding
        case ready
        case failed(String)
    }

    static let defaultServer = URL(string: "https://noctgram.com")!
    private static let serverKey = "noct.server"

    @Published private(set) var phase: Phase = .launching
    @Published private(set) var api: APIClient
    @Published var me: Profile?
    @Published var people: [Person] = []
    @Published var unreadMessages = 0
    @Published var unreadNotifications = 0
    @Published var toast: String?

    private var observers: [NSObjectProtocol] = []
    private var pollTask: Task<Void, Never>?
    private var toastTask: Task<Void, Never>?

    init() {
        let saved = UserDefaults.standard.string(forKey: Self.serverKey).flatMap(URL.init(string:))
        api = APIClient(baseURL: saved ?? Self.defaultServer)
        ImagePipeline.shared.session = api.session
        observers.append(NotificationCenter.default.addObserver(forName: .noctUnauthorized, object: nil, queue: .main) { [weak self] _ in
            Task { @MainActor in self?.sessionExpired() }
        })
        observers.append(NotificationCenter.default.addObserver(forName: .noctOnboardingRequired, object: nil, queue: .main) { [weak self] _ in
            Task { @MainActor in
                if self?.phase == .ready { self?.phase = .onboarding }
            }
        })
    }

    var myId: String? { me?.id }
    var serverLabel: String { api.baseURL.host ?? api.baseURL.absoluteString }
    var isDefaultServer: Bool { api.baseURL == Self.defaultServer }

    /// Read-only accounts can browse but not write (account-access.ts).
    var readOnly: Bool { me?.restriction != nil }

    // MARK: Lifecycle

    func start() async {
        if phase != .ready { phase = .launching }
        do {
            let status = AuthStatus(try await api.get("/api/auth/session"))
            guard let user = status.user else {
                phase = .signedOut
                return
            }
            if !user.onboardingComplete {
                phase = .onboarding
                return
            }
            try await bootstrap()
        } catch let error as APIError where error.status == 401 {
            phase = .signedOut
        } catch let error as APIError where error.status == 428 {
            phase = .onboarding
        } catch {
            guard let message = error.userMessage else { return }
            if phase != .ready { phase = .failed(message) }
        }
    }

    /// GET /api/social?action=bootstrap: own profile and people to follow.
    func bootstrap() async throws {
        let data = try await api.social("bootstrap")
        me = Profile(data["me"])
        people = data["people"].array.map { Person($0) }
        phase = .ready
        startPolling()
    }

    func refreshMe() async {
        guard let id = me?.id, let data = try? await api.social("profile", ["id": id]) else { return }
        me = Profile(data)
    }

    func signedIn() async {
        await start()
    }

    func signOut() async {
        _ = try? await api.post("/api/auth/logout", [:])
        clearLocalSession()
    }

    private func sessionExpired() {
        guard phase == .ready || phase == .onboarding else { return }
        clearLocalSession()
        show("Сессия завершена. Войди снова.")
    }

    private func clearLocalSession() {
        pollTask?.cancel()
        pollTask = nil
        let storage = HTTPCookieStorage.shared
        storage.cookies(for: api.baseURL)?.forEach(storage.deleteCookie)
        WKWebsiteDataStore.default().removeData(
            ofTypes: [WKWebsiteDataTypeCookies, WKWebsiteDataTypeLocalStorage, WKWebsiteDataTypeSessionStorage],
            modifiedSince: .distantPast
        ) {}
        ImagePipeline.shared.clear()
        me = nil
        people = []
        unreadMessages = 0
        unreadNotifications = 0
        phase = .signedOut
    }

    // MARK: Server

    /// Accepts "noctgram.com", "https://host" or a local "http://192.168.0.2:3000".
    func setServer(_ text: String) -> Bool {
        var value = text.trimmingCharacters(in: .whitespacesAndNewlines)
        if value.isEmpty { value = Self.defaultServer.absoluteString }
        if !value.contains("://") { value = "https://" + value }
        while value.hasSuffix("/") { value.removeLast() }
        guard let url = URL(string: value), let scheme = url.scheme?.lowercased(),
              ["http", "https"].contains(scheme), let host = url.host, !host.isEmpty else { return false }
        var components = URLComponents()
        components.scheme = scheme
        components.host = host
        components.port = url.port
        guard let base = components.url else { return false }
        UserDefaults.standard.set(base.absoluteString, forKey: Self.serverKey)
        api = APIClient(baseURL: base)
        ImagePipeline.shared.session = api.session
        return true
    }

    // MARK: Counters

    func startPolling() {
        pollTask?.cancel()
        pollTask = Task { [weak self] in
            while !Task.isCancelled {
                guard let self else { return }
                await self.refreshCounters()
                try? await Task.sleep(nanoseconds: 20_000_000_000)
            }
        }
    }

    func stopPolling() {
        pollTask?.cancel()
        pollTask = nil
    }

    func refreshCounters() async {
        guard phase == .ready else { return }
        if let data = try? await api.social("threadsUnread") {
            unreadMessages = data["unread"].int ?? 0
        }
        if let data = try? await api.social("notificationCount") {
            unreadNotifications = data["unread"].int ?? 0
        }
    }

    // MARK: Feedback

    func show(_ message: String) {
        toastTask?.cancel()
        withAnimation(Noct.quick) { toast = message }
        toastTask = Task {
            try? await Task.sleep(nanoseconds: 2_300_000_000)
            guard !Task.isCancelled else { return }
            withAnimation(Noct.quick) { toast = nil }
        }
    }

    func report(_ error: Error) {
        if let message = error.userMessage {
            Haptics.error()
            show(message)
        }
    }

    func copy(_ text: String, message: String = "Скопировано") {
        UIPasteboard.general.string = text
        Haptics.success()
        show(message)
    }
}

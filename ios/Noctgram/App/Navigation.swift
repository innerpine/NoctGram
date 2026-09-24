import SwiftUI

enum AppTab: Hashable {
    case feed, search, messages, notifications, profile
}

struct RootTap: Equatable {
    var tab: AppTab
    var count: Int
}

enum ConnectionKind: String, Hashable {
    case followers, following

    var title: String { self == .followers ? "Подписчики" : "Подписки" }
}

/// Every pushable screen.
enum Route: Hashable {
    case profile(String)
    case handle(String)
    case post(String)
    case chat(Person)
    case room(id: String, title: String)
    case connections(profileId: String, kind: ConnectionKind)
    case saved
    case tag(String)
    case wallet
    case settings
    case web(title: String, path: String)
}

/// One navigation path per tab, so a tab keeps its stack while another is open.
@MainActor
final class Navigator: ObservableObject {
    @Published var tab: AppTab = .feed
    @Published var feedPath = NavigationPath()
    @Published var searchPath = NavigationPath()
    @Published var messagesPath = NavigationPath()
    @Published var notificationsPath = NavigationPath()
    @Published var profilePath = NavigationPath()
    /// Scroll-to-top request for the root screen of a re-tapped tab.
    @Published var rootTap = RootTap(tab: .feed, count: 0)

    var tabSelection: Binding<AppTab> {
        Binding(
            get: { self.tab },
            set: { next in
                if next == self.tab {
                    if self.isAtRoot(next) {
                        self.rootTap = RootTap(tab: next, count: self.rootTap.count + 1)
                    } else {
                        self.popToRoot(next)
                    }
                }
                self.tab = next
            }
        )
    }

    func push(_ route: Route) {
        switch tab {
        case .feed: feedPath.append(route)
        case .search: searchPath.append(route)
        case .messages: messagesPath.append(route)
        case .notifications: notificationsPath.append(route)
        case .profile: profilePath.append(route)
        }
    }

    func isAtRoot(_ tab: AppTab) -> Bool {
        switch tab {
        case .feed: return feedPath.isEmpty
        case .search: return searchPath.isEmpty
        case .messages: return messagesPath.isEmpty
        case .notifications: return notificationsPath.isEmpty
        case .profile: return profilePath.isEmpty
        }
    }

    func popToRoot(_ tab: AppTab) {
        switch tab {
        case .feed: feedPath = NavigationPath()
        case .search: searchPath = NavigationPath()
        case .messages: messagesPath = NavigationPath()
        case .notifications: notificationsPath = NavigationPath()
        case .profile: profilePath = NavigationPath()
        }
    }

    /// Opens a chat from anywhere on the messages tab.
    func openChat(_ person: Person) {
        tab = .messages
        messagesPath = NavigationPath()
        messagesPath.append(Route.chat(person))
    }

    /// Mentions, tags and profile links from LinkedText.
    func open(_ url: URL) -> OpenURLAction.Result {
        guard url.scheme == AppLink.scheme else { return .systemAction }
        let items = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems ?? []
        switch url.host {
        case "handle":
            let handle = url.path.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
            if !handle.isEmpty { push(.handle(handle)) }
        case "profile":
            if let id = items.first(where: { $0.name == "id" })?.value { push(.profile(id)) }
        case "tag":
            if let tag = items.first(where: { $0.name == "q" })?.value { push(.tag(tag)) }
        default:
            break
        }
        return .handled
    }
}

extension View {
    /// Destinations shared by every tab's NavigationStack.
    func appRoutes() -> some View {
        navigationDestination(for: Route.self) { route in
            RouteView(route: route)
        }
    }
}

struct RouteView: View {
    let route: Route

    var body: some View {
        switch route {
        case .profile(let id):
            ProfileScreen(target: .id(id))
        case .handle(let handle):
            ProfileScreen(target: .handle(handle))
        case .post(let id):
            PostDetailView(postId: id)
        case .chat(let person):
            ChatView(peer: person)
        case .room(let id, let title):
            RoomChatView(roomId: id, title: title)
        case .connections(let profileId, let kind):
            ConnectionsView(profileId: profileId, kind: kind)
        case .saved:
            PostListScreen(title: "Сохранённое", query: FeedQuery(mode: "saved"), empty: "Сохраняй публикации, чтобы вернуться к ним позже.")
        case .tag(let tag):
            PostListScreen(title: tag, query: FeedQuery(q: tag), empty: "Публикаций с этим тегом пока нет.")
        case .wallet:
            WalletView()
        case .settings:
            SettingsView()
        case .web(let title, let path):
            WebScreen(title: title, path: path)
        }
    }
}

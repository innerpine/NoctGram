import SwiftUI

/// Search across publications, people, channels and public groups, with
/// real hashtag topics when the query is empty.
struct SearchView: View {
    @EnvironmentObject private var session: AppSession
    @EnvironmentObject private var nav: Navigator
    @StateObject private var posts = PostListStore(query: FeedQuery(mode: "all", q: " "))
    @State private var query = ""
    @State private var scope = "posts"
    @State private var topics: [Topic] = []
    @State private var people: [Person] = []
    @State private var channels: [Profile] = []
    @State private var groups: [RoomSummary] = []
    @State private var joined: Set<String> = []
    @State private var searching = false

    private var term: String { query.trimmingCharacters(in: .whitespacesAndNewlines) }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                if term.isEmpty {
                    idle
                } else {
                    NoctSegments(options: [
                        SegmentOption("posts", "Посты"),
                        SegmentOption("people", "Люди"),
                        SegmentOption("channels", "Каналы"),
                        SegmentOption("groups", "Группы"),
                    ], selection: $scope)
                    results
                }
            }
            .padding(12)
        }
        .scrollDismissesKeyboard(.interactively)
        .background(Noct.background)
        .glassSearchable(text: $query, prompt: "Публикации, люди, #теги")
        .navigationTitle("Поиск")
        .navigationBarTitleDisplayMode(.inline)
        .task(id: "\(term)|\(scope)") {
            guard !term.isEmpty else { return }
            try? await Task.sleep(nanoseconds: 350_000_000)
            guard !Task.isCancelled else { return }
            await search()
        }
        .task { await loadTopics() }
    }

    @ViewBuilder private var idle: some View {
        if !topics.isEmpty {
            Text("Темы")
                .font(.system(size: 13, weight: .semibold))
                .foregroundColor(Noct.text48)
            FlowLayout(spacing: 8, lineSpacing: 8) {
                ForEach(topics) { topic in
                    Button {
                        nav.push(.tag(topic.tag))
                    } label: {
                        HStack(spacing: 6) {
                            Text(topic.tag).foregroundColor(.white)
                            Text("\(topic.count)").font(.system(size: 12)).foregroundColor(Noct.text48)
                        }
                    }
                    .buttonStyle(ChipButtonStyle())
                }
            }
        }
        if !session.people.isEmpty {
            Text("Кого почитать")
                .font(.system(size: 13, weight: .semibold))
                .foregroundColor(Noct.text48)
                .padding(.top, 8)
            VStack(spacing: 0) {
                ForEach(session.people) { person in
                    Button {
                        nav.push(.profile(person.id))
                    } label: {
                        PersonRow(person: person.identity)
                            .padding(.vertical, 8)
                    }
                    .buttonStyle(PressableStyle())
                }
            }
        }
        VStack(alignment: .leading, spacing: 0) {
            Text("Разделы веб-версии")
                .font(.system(size: 13, weight: .semibold))
                .foregroundColor(Noct.text48)
                .padding(.vertical, 8)
            webLink("Музыка", icon: "music.note", path: "/?page=music")
            webLink("Каналы", icon: "megaphone", path: "/?page=channels")
            webLink("Noct Market", icon: "storefront", path: "/market")
            webLink("Noct Premium", icon: "sparkles", path: "/?page=premium")
        }
        .padding(.top, 8)
    }

    private func webLink(_ title: String, icon: String, path: String) -> some View {
        Button {
            nav.push(.web(title: title, path: path))
        } label: {
            HStack(spacing: 12) {
                Image(systemName: icon)
                    .frame(width: 36, height: 36)
                    .glassCircle()
                Text(title).font(.system(size: 15))
                Spacer()
                Image(systemName: "chevron.right").font(.system(size: 13, weight: .semibold)).foregroundColor(Noct.text48)
            }
            .foregroundColor(.white)
            .padding(.vertical, 6)
        }
        .buttonStyle(PressableStyle())
    }

    @ViewBuilder private var results: some View {
        if term.hasPrefix("@") && term.count > 4 {
            Button {
                nav.push(.handle(String(term.dropFirst()).lowercased()))
            } label: {
                Label("Открыть профиль \(term)", systemImage: "person.crop.circle")
                    .font(.system(size: 15, weight: .medium))
                    .foregroundColor(.white)
                    .padding(14)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .noctCard(radius: 14)
            }
            .buttonStyle(PressableStyle())
        }
        switch scope {
        case "people":
            list(people.map(\.identity), empty: "Никого не нашли") { nav.push(.profile($0.id)) }
        case "channels":
            list(channels.map(\.identity), subtitle: { id in
                let count = channels.first { $0.id == id }?.followers ?? 0
                return "\(Format.count(count)) \(Format.plural(count, "подписчик", "подписчика", "подписчиков"))"
            }, empty: "Каналы не найдены") { nav.push(.profile($0.id)) }
        case "groups":
            groupList
        default:
            PostListContent(store: posts, empty: "Ничего не найдено. Попробуй другой запрос.")
        }
    }

    private func list(_ items: [Identity], subtitle: ((String) -> String)? = nil, empty: String, open: @escaping (Identity) -> Void) -> some View {
        VStack(spacing: 0) {
            ForEach(items, id: \.id) { item in
                Button {
                    open(item)
                } label: {
                    PersonRow(person: item, subtitle: subtitle.map { "@" + item.handle + " · " + $0(item.id) })
                        .padding(.vertical, 8)
                }
                .buttonStyle(PressableStyle())
            }
            if items.isEmpty {
                if searching { LoadingRow() } else { EmptyState(icon: "magnifyingglass", text: empty) }
            }
        }
    }

    private var groupList: some View {
        VStack(spacing: 0) {
            ForEach(groups) { group in
                HStack {
                    PersonRow(person: group.identity, subtitle: "\(Format.count(group.memberCount)) \(Format.plural(group.memberCount, "участник", "участника", "участников"))")
                    Button(joined.contains(group.id) ? "Открыть" : "Вступить") {
                        Task { await join(group) }
                    }
                    .buttonStyle(SecondaryButtonStyle())
                }
                .padding(.vertical, 8)
            }
            if groups.isEmpty {
                if searching { LoadingRow() } else { EmptyState(icon: "person.3", text: "Открытые группы не найдены") }
            }
        }
    }

    private func loadTopics() async {
        guard topics.isEmpty, let data = try? await session.api.social("topics") else { return }
        topics = data.array.map { Topic(tag: $0["tag"].str, count: $0["count"].int ?? 0) }
    }

    private func search() async {
        searching = true
        defer { searching = false }
        let value = term.hasPrefix("@") ? String(term.dropFirst()) : term
        switch scope {
        case "people":
            people = (try? await session.api.social("people", ["q": value]))?.array.map { Person($0) } ?? []
        case "channels":
            channels = (try? await session.api.social("channels", ["q": value]))?.array.map { Profile($0) } ?? []
        case "groups":
            if let data = try? await session.api.get("/api/rooms", ["action": "search", "q": value]) {
                let rooms = data["rooms"].array
                groups = rooms.map { RoomSummary($0) }
                joined = Set(rooms.filter { $0["joined"].bool }.map { $0["id"].str })
            }
        default:
            await posts.setQuery(FeedQuery(mode: "all", q: term), api: session.api)
        }
    }

    private func join(_ group: RoomSummary) async {
        if !joined.contains(group.id) {
            do {
                _ = try await session.api.post("/api/rooms", ["action": "join", "id": group.id])
                joined.insert(group.id)
            } catch {
                session.report(error)
                return
            }
        }
        nav.push(.room(id: group.id, title: group.name))
    }
}

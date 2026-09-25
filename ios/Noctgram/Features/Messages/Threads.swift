import SwiftUI

/// A group room from /api/rooms?action=list.
struct RoomSummary: Identifiable, Hashable {
    var id: String
    var kind: String
    var name: String
    var avatar: String
    var username: String
    var memberCount: Int
    var unread: Int
    var lastText: String
    var lastTime: Double
    var archivedAt: Double

    init(_ j: JSON) {
        id = j["id"].str
        kind = j["kind"].string ?? "group"
        name = j["name"].str
        avatar = j["avatar"].str
        username = j["username"].str
        memberCount = j["memberCount"].int ?? 0
        unread = j["unread"].int ?? 0
        let last = j["lastMessage"].nestedJSON
        lastText = last["text"].str
        lastTime = last["created"].double ?? (j["updatedAt"].double ?? 0)
        archivedAt = j["archivedAt"].double ?? 0
    }

    var isSecret: Bool { kind == "secret" }

    var identity: Identity {
        Identity(id: id, name: name, avatar: avatar, handle: username)
    }
}

/// One row of the merged list: a direct dialogue or a group.
enum ThreadItem: Identifiable, Hashable {
    case direct(Person)
    case room(RoomSummary)

    var id: String {
        switch self {
        case .direct(let person): return "p:" + person.id
        case .room(let room): return "r:" + room.id
        }
    }

    var time: Double {
        switch self {
        case .direct(let person): return person.lastTime
        case .room(let room): return room.lastTime
        }
    }

    /// A group is left rather than deleted.
    var isRoomLeave: Bool {
        if case .room(let room) = self { return !room.isSecret }
        return false
    }
}

@MainActor
final class ThreadsStore: ObservableObject {
    @Published var items: [ThreadItem] = []
    @Published var loading = false
    @Published var loaded = false
    @Published var error: String?

    func load(api: APIClient, archived: Bool) async {
        loading = true
        defer { loading = false }
        do {
            let threads = try await api.social("threads", ["archived": archived ? "1" : "0"])
            var merged = threads.array.map { ThreadItem.direct(Person($0)) }
            if let rooms = try? await api.get("/api/rooms", ["action": "list", "archived": archived ? "1" : "0"]) {
                merged += rooms["rooms"].array.map { ThreadItem.room(RoomSummary($0)) }
            }
            items = merged.sorted { $0.time > $1.time }
            error = nil
        } catch {
            if let message = error.userMessage { self.error = message }
        }
        loaded = true
    }

    /// Takes a row out at once; the next load brings it back if the server
    /// did not agree.
    func remove(_ item: ThreadItem) {
        items.removeAll { $0.id == item.id }
    }

    /// Deletes a whole dialogue as the server allows it: every visible
    /// message, twenty at a time, for the viewer or for both. Gifts stay,
    /// so a message is asked for once and the loop ends when none are new.
    static func deleteDialogue(with peer: String, everyone: Bool, api: APIClient) async throws {
        var asked = Set<String>()
        for _ in 0..<60 {
            let data = try await api.social("messages", ["peer": peer])
            let list = data["messages"].isNull ? data : data["messages"]
            let ids = list.array.map { $0["id"].str }.filter { $0.hasPrefix("message:") && !asked.contains($0) }
            guard !ids.isEmpty else { return }
            asked.formUnion(ids)
            for start in stride(from: 0, to: ids.count, by: 20) {
                let chunk = Array(ids[start..<min(start + 20, ids.count)])
                _ = try await api.socialPost("messageDelete", ["ids": chunk, "peer": peer, "everyone": everyone])
            }
        }
    }
}

struct ThreadsView: View {
    @EnvironmentObject private var session: AppSession
    @EnvironmentObject private var nav: Navigator
    @StateObject private var store = ThreadsStore()
    @State private var archived = "chats"
    @State private var showNew = false
    /// The row slid open to its actions.
    @State private var openRow: String?
    @State private var deleting: ThreadItem?

    var body: some View {
        ScrollView {
            LazyVStack(spacing: 0) {
                NoctSegments(options: [SegmentOption("chats", "Чаты"), SegmentOption("archive", "Архив")], selection: $archived)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 10)
                ForEach(store.items) { item in
                    row(item)
                }
                if store.loading && store.items.isEmpty {
                    LoadingRow()
                } else if store.loaded && store.items.isEmpty {
                    if let error = store.error {
                        ErrorBanner(text: error) { Task { await reload() } }
                    } else {
                        EmptyState(icon: "bubble.left.and.bubble.right", text: archived == "chats" ? "Сообщений пока нет. Напиши кому-нибудь первым." : "Архив пуст.")
                    }
                }
            }
        }
        .background(Noct.background)
        .refreshable { await reload() }
        .navigationTitle("Сообщения")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .navigationBarTrailing) {
                Button {
                    showNew = true
                } label: {
                    Image(systemName: "square.and.pencil")
                }
                .disabled(session.readOnly)
            }
        }
        .sheet(isPresented: $showNew) {
            NewChatSheet { person in
                showNew = false
                nav.push(.chat(person))
            }
            .environmentObject(session)
        }
        .onChange(of: archived) { _ in
            openRow = nil
            Task { await reload() }
        }
        .confirmationDialog(deleteTitle, isPresented: Binding(get: { deleting != nil }, set: { if !$0 { deleting = nil } }), titleVisibility: .visible) {
            if let item = deleting {
                switch item {
                case .direct(let person):
                    Button("Удалить у меня", role: .destructive) { delete(item, everyone: false) }
                    Button("Удалить у меня и у \(person.name)", role: .destructive) { delete(item, everyone: true) }
                case .room(let room):
                    Button(room.isSecret ? "Закрыть" : "Покинуть", role: .destructive) { delete(item, everyone: false) }
                }
            }
            Button("Отмена", role: .cancel) {}
        } message: {
            Text(deleteMessage)
        }
        .task {
            await reload()
            // Refresh while the list is visible, like the web inbox.
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 10_000_000_000)
                guard !Task.isCancelled else { return }
                await store.load(api: session.api, archived: archived == "archive")
            }
        }
    }

    private func reload() async {
        await store.load(api: session.api, archived: archived == "archive")
        await session.refreshCounters()
    }

    private func row(_ item: ThreadItem) -> some View {
        SwipeActionsRow(actions: actions(item), open: Binding(
            get: { openRow == item.id },
            set: { openRow = $0 ? item.id : (openRow == item.id ? nil : openRow) }
        )) {
            rowContent(item)
                .accessibilityIdentifier("thread-" + item.id)
        }
    }

    /// As in Telegram: delete, then archive on the far right.
    private func actions(_ item: ThreadItem) -> [SwipeAction] {
        let inArchive = archived == "archive"
        return [
            SwipeAction(title: item.isRoomLeave ? "Покинуть" : "Удалить", icon: item.isRoomLeave ? "rectangle.portrait.and.arrow.right" : "trash.fill", color: Noct.red) {
                deleting = item
            },
            SwipeAction(title: inArchive ? "Вернуть" : "В архив", icon: inArchive ? "tray.and.arrow.up.fill" : "archivebox.fill", color: Color(hex: 0x6E6E73)) {
                Task { await setArchived(item, !inArchive) }
            },
        ]
    }

    private var deleteTitle: String {
        switch deleting {
        case .direct(let person): return "Удалить чат с \(person.name)?"
        case .room(let room): return room.isSecret ? "Закрыть секретный чат?" : "Покинуть «\(room.name)»?"
        case nil: return ""
        }
    }

    private var deleteMessage: String {
        switch deleting {
        case .direct: return "Сообщения удалятся без возврата."
        case .room(let room):
            return room.isSecret
                ? "Переписка перестанет быть доступна обоим участникам. Для нового разговора создайте новый секретный чат."
                : "Для возвращения понадобится действующее приглашение или публичная ссылка."
        case nil: return ""
        }
    }

    private func delete(_ item: ThreadItem, everyone: Bool) {
        store.remove(item)
        Task {
            do {
                switch item {
                case .direct(let person):
                    try await ThreadsStore.deleteDialogue(with: person.id, everyone: everyone, api: session.api)
                case .room(let room):
                    _ = try await session.api.post("/api/rooms", ["action": "leave", "id": room.id])
                }
            } catch {
                session.report(error)
            }
            await reload()
        }
    }

    private func setArchived(_ item: ThreadItem, _ value: Bool) async {
        store.remove(item)
        do {
            switch item {
            case .direct(let person):
                _ = try await session.api.socialPost("archiveChat", ["peer": person.id, "archived": value])
            case .room(let room):
                _ = try await session.api.post("/api/rooms", ["action": "archive", "id": room.id, "archived": value])
            }
        } catch {
            session.report(error)
        }
        await reload()
    }

    @ViewBuilder private func rowContent(_ item: ThreadItem) -> some View {
        switch item {
        case .direct(let person):
            Button {
                nav.push(.chat(person))
            } label: {
                ThreadRow(
                    identity: person.identity,
                    title: nil,
                    text: PremiumEmoji.replace(person.lastText),
                    time: person.lastTime,
                    unread: person.unread,
                    online: Format.isOnline(person.lastSeen)
                )
            }
            .buttonStyle(PressableStyle())
            .contextMenu {
                Button {
                    Task { await setArchived(item, person.archivedAt == 0) }
                } label: {
                    Label(person.archivedAt == 0 ? "В архив" : "Вернуть из архива", systemImage: "archivebox")
                }
                Button {
                    nav.push(.profile(person.id))
                } label: {
                    Label("Профиль", systemImage: "person")
                }
            }
        case .room(let room):
            Button {
                nav.push(.room(id: room.id, title: room.name))
            } label: {
                ThreadRow(
                    identity: room.identity,
                    title: room.isSecret ? "🔒 " + room.name : room.name,
                    text: room.isSecret ? "Секретный чат" : PremiumEmoji.replace(room.lastText.isEmpty ? "\(room.memberCount) \(Format.plural(room.memberCount, "участник", "участника", "участников"))" : room.lastText),
                    time: room.lastTime,
                    unread: room.unread,
                    online: false
                )
            }
            .buttonStyle(PressableStyle())
        }
    }

}

struct ThreadRow: View {
    let identity: Identity
    let title: String?
    let text: String
    let time: Double
    let unread: Int
    let online: Bool

    var body: some View {
        HStack(spacing: 12) {
            AvatarView(person: identity, size: 52)
                .overlay(alignment: .bottomTrailing) {
                    if online {
                        Circle()
                            .fill(Noct.green)
                            .frame(width: 12, height: 12)
                            .overlay(Circle().stroke(Noct.background, lineWidth: 2.5))
                    }
                }
            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 6) {
                    if let title {
                        Text(title)
                            .font(.system(size: 15, weight: .semibold))
                            .lineLimit(1)
                    } else {
                        DisplayName(person: identity, size: 15)
                    }
                    Spacer(minLength: 6)
                    Text(Format.threadTime(time))
                        .font(.system(size: 12))
                        .foregroundColor(unread > 0 ? .white : Noct.text48)
                }
                HStack(spacing: 6) {
                    Text(text.isEmpty ? " " : text)
                        .font(.system(size: 14))
                        .foregroundColor(Noct.text60)
                        .lineLimit(1)
                    Spacer(minLength: 6)
                    if unread > 0 {
                        Text(unread > 99 ? "99+" : "\(unread)")
                            .font(.system(size: 12, weight: .bold))
                            .foregroundColor(.black)
                            .padding(.horizontal, 7)
                            .frame(minWidth: 20, minHeight: 20)
                            .background(Capsule().fill(Color.white))
                    }
                }
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
        .contentShape(Rectangle())
    }
}

/// Find a person to start a dialogue (action=people).
struct NewChatSheet: View {
    @EnvironmentObject private var session: AppSession
    @Environment(\.dismiss) private var dismiss
    let open: (Person) -> Void
    @State private var query = ""
    @State private var people: [Person] = []
    @State private var searching = false

    var body: some View {
        NavigationStack {
            List {
                ForEach(people) { person in
                    Button {
                        open(person)
                    } label: {
                        PersonRow(person: person.identity)
                    }
                    .listRowBackground(Noct.sheetRow)
                }
                if people.isEmpty && !searching {
                    Text(query.isEmpty ? "Начни вводить имя или юзернейм" : "Никого не нашли")
                        .font(.system(size: 14))
                        .foregroundColor(Noct.text48)
                        .listRowBackground(Noct.sheetRow)
                }
            }
            .listStyle(.plain)
            .scrollContentBackground(.hidden)
            .sheetSurface()
            .searchable(text: $query, placement: .navigationBarDrawer(displayMode: .always), prompt: "Имя или @юзернейм")
            .navigationTitle("Новое сообщение")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Отмена") { dismiss() }
                }
            }
            .task(id: query) {
                try? await Task.sleep(nanoseconds: 300_000_000)
                guard !Task.isCancelled else { return }
                await search()
            }
        }
    }

    private func search() async {
        let term = query.trimmingCharacters(in: .whitespaces)
        searching = true
        defer { searching = false }
        if term.isEmpty {
            people = session.people
            return
        }
        if let data = try? await session.api.social("people", ["q": term]) {
            people = data.array.map { Person($0) }
        }
    }
}

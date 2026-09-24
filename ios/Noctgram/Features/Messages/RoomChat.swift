import SwiftUI

struct RoomMessage: Identifiable, Hashable {
    var id: String
    var sender: String
    var senderName: String
    var senderAvatar: String
    var text: String
    var encrypted: Bool
    var replyTo: String
    var created: Double
    var deleted: Bool
    var reactions: [Reaction]
    var pending = false

    init(_ j: JSON) {
        id = j["id"].str
        sender = j["sender"].str
        senderName = j["senderName"].str
        senderAvatar = j["senderAvatar"].str
        text = j["text"].str
        encrypted = !j["ciphertext"].isNull
        replyTo = j["replyTo"].str
        created = j["created"].double ?? 0
        deleted = (j["deletedAt"].double ?? 0) > 0
        reactions = j["reactions"].array.map {
            Reaction(emoji: $0["emoji"].str, count: $0["count"].int ?? 0, own: $0["own"].bool)
        }
    }

    init(localId: String, sender: String, name: String, avatar: String, text: String, replyTo: String) {
        id = localId
        self.sender = sender
        senderName = name
        senderAvatar = avatar
        self.text = text
        encrypted = false
        self.replyTo = replyTo
        created = Format.nowMs
        deleted = false
        reactions = []
        pending = true
    }
}

@MainActor
final class RoomStore: ObservableObject {
    let roomId: String
    @Published var name = ""
    @Published var kind = "group"
    @Published var memberCount = 0
    @Published var canSend = false
    @Published var role = "member"
    @Published var messages: [RoomMessage] = []
    @Published var loaded = false
    @Published var error: String?
    private var pending: [RoomMessage] = []
    private var lastRead = ""

    init(roomId: String) {
        self.roomId = roomId
    }

    var isSecret: Bool { kind == "secret" }

    func load(api: APIClient) async {
        do {
            let data = try await api.get("/api/rooms", ["action": "room", "id": roomId])
            name = data["name"].str
            kind = data["kind"].string ?? "group"
            memberCount = data["memberCount"].int ?? data["members"].array.count
            canSend = data["canSend"].bool
            role = data["role"].string ?? "member"
            let server = data["messages"].array.map { RoomMessage($0) }
            let known = Set(server.map(\.id))
            pending.removeAll { known.contains($0.id) }
            let merged = server + pending
            if merged != messages { messages = merged }
            error = nil
            if let last = server.last?.id, last != lastRead {
                lastRead = last
                _ = try? await api.post("/api/rooms", ["action": "read", "id": roomId, "through": last])
            }
        } catch {
            if let message = error.userMessage, messages.isEmpty { self.error = message }
        }
        loaded = true
    }

    func send(_ text: String, reply: RoomMessage?, session: AppSession) async {
        let value = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !value.isEmpty, let me = session.me else { return }
        let key = UUID().uuidString.lowercased()
        let local = RoomMessage(localId: key, sender: me.id, name: me.name, avatar: me.avatar, text: value, replyTo: reply?.id ?? "")
        pending.append(local)
        messages.append(local)
        var body: [String: Any] = ["action": "send", "id": roomId, "key": key, "text": value]
        if let reply { body["replyTo"] = reply.id }
        do {
            let result = try await session.api.post("/api/rooms", body)
            if result["id"].string == nil {
                session.show("Сообщение отправлено на проверку")
                pending.removeAll { $0.id == key }
            }
            await load(api: session.api)
        } catch {
            pending.removeAll { $0.id == key }
            messages.removeAll { $0.id == key }
            session.report(error)
        }
    }

    func react(_ message: RoomMessage, emoji: String, session: AppSession) async {
        do {
            _ = try await session.api.post("/api/rooms", ["action": "reaction", "id": roomId, "messageId": message.id, "emoji": emoji])
            await load(api: session.api)
        } catch {
            session.report(error)
        }
    }

    func delete(_ message: RoomMessage, session: AppSession) async {
        do {
            _ = try await session.api.post("/api/rooms", ["action": "deleteMessage", "id": roomId, "messageId": message.id])
            await load(api: session.api)
        } catch {
            session.report(error)
        }
    }
}

/// A group chat (app/room-conversation.tsx). Secret chats need the device
/// keys of the web client and open there.
struct RoomChatView: View {
    @EnvironmentObject private var session: AppSession
    @EnvironmentObject private var nav: Navigator
    let roomId: String
    let title: String
    @StateObject private var store: RoomStore
    @State private var text = ""
    @State private var replyTo: RoomMessage?
    @FocusState private var focused: Bool

    init(roomId: String, title: String) {
        self.roomId = roomId
        self.title = title
        _store = StateObject(wrappedValue: RoomStore(roomId: roomId))
    }

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 0) {
                    if store.isSecret {
                        EmptyState(icon: "lock", text: "Секретный чат зашифрован ключами устройства. Открой его в веб-версии Noctgram.")
                    } else if !store.loaded {
                        LoadingRow()
                    } else if store.messages.isEmpty {
                        EmptyState(icon: "person.3", text: store.error ?? "Сообщений пока нет.")
                    }
                    if !store.isSecret {
                        ForEach(Array(store.messages.enumerated()), id: \.element.id) { index, message in
                            let joinsPrevious = index > 0 && Self.joins(store.messages[index - 1], message)
                            let joinsNext = index + 1 < store.messages.count && Self.joins(message, store.messages[index + 1])
                            roomBubble(message, joinsPrevious: joinsPrevious, joinsNext: joinsNext)
                                .padding(.top, joinsPrevious ? 2 : 8)
                                .id(message.id)
                        }
                    }
                }
                .padding(.horizontal, 10)
                .padding(.vertical, 12)
            }
            .scrollDismissesKeyboard(.interactively)
            .background(ChatBackdrop(palette: .noct))
            .onChange(of: store.messages.last?.id) { id in
                guard let id else { return }
                withAnimation(Noct.quick) { proxy.scrollTo(id, anchor: .bottom) }
            }
        }
        .glassBottomBar {
            if store.canSend && !store.isSecret && !session.readOnly {
                VStack(spacing: 0) {
                    if let reply = replyTo {
                        ComposerContext(title: "Ответ \(reply.senderName)", text: reply.text) {
                            replyTo = nil
                        }
                    }
                    ComposerBar(text: $text, placeholder: "Сообщение в группу", sending: false, focus: $focused, leading: nil) {
                        let value = text
                        let reply = replyTo
                        text = ""
                        replyTo = nil
                        Task { await store.send(value, reply: reply, session: session) }
                    }
                }
            } else if store.loaded && !store.isSecret {
                ComposerNotice(text: session.readOnly ? "В режиме только для чтения отправка недоступна." : "Писать в эту группу могут только администраторы.")
            }
        }
        .navigationBarTitleDisplayMode(.inline)
        .toolbar(.hidden, for: .tabBar)
        .toolbar {
            ToolbarItem(placement: .principal) {
                VStack(spacing: 1) {
                    Text(store.name.isEmpty ? title : store.name)
                        .font(.system(size: 15, weight: .semibold))
                        .lineLimit(1)
                    if store.memberCount > 0 {
                        Text("\(Format.count(store.memberCount)) \(Format.plural(store.memberCount, "участник", "участника", "участников"))")
                            .font(.system(size: 11))
                            .foregroundColor(Noct.text48)
                    }
                }
            }
        }
        .task {
            while !Task.isCancelled {
                await store.load(api: session.api)
                if store.isSecret { return }
                try? await Task.sleep(nanoseconds: 4_000_000_000)
            }
        }
        .onDisappear { Task { await session.refreshCounters() } }
    }

    /// Consecutive messages of one member within ten minutes form a group.
    static func joins(_ previous: RoomMessage, _ message: RoomMessage) -> Bool {
        previous.sender == message.sender && message.created - previous.created < 10 * 60 * 1000
            && Calendar.current.isDate(Format.date(previous.created), inSameDayAs: Format.date(message.created))
    }

    /// The same bubbles as a dialogue; the author's name and avatar mark the
    /// start and end of each group.
    private func roomBubble(_ message: RoomMessage, joinsPrevious: Bool, joinsNext: Bool) -> some View {
        let mine = message.sender == session.myId
        let reply = message.replyTo.isEmpty ? nil : store.messages.first(where: { $0.id == message.replyTo })
        let shape = BubbleShape.message(mine: mine, joinsPrevious: joinsPrevious)
        let time = BubbleTime(created: message.created, status: mine ? (message.pending ? .pending : .sent) : nil, mine: mine)
        return HStack(alignment: .bottom, spacing: 6) {
            if mine {
                Spacer(minLength: 52)
            } else if joinsNext {
                Color.clear.frame(width: 30, height: 1)
            } else {
                Button {
                    nav.push(.profile(message.sender))
                } label: {
                    AvatarView(person: Identity(id: message.sender, name: message.senderName, avatar: message.senderAvatar, handle: ""), size: 30)
                }
                .buttonStyle(PressableStyle())
            }
            BubbleStack() {
                if (!mine && !joinsPrevious) || reply != nil {
                    VStack(alignment: .leading, spacing: 6) {
                        if !mine && !joinsPrevious {
                            Text(message.senderName)
                                .font(.system(size: 13, weight: .semibold))
                                .foregroundColor(Noct.lilac)
                                .lineLimit(1)
                        }
                        if let reply {
                            BubbleQuote(name: reply.senderName, text: reply.text, accent: Noct.lilac)
                        }
                    }
                    .padding(.horizontal, mine || joinsPrevious ? 8 : 12)
                    .padding(.top, 7)
                }
                if message.deleted {
                    HStack(alignment: .bottom, spacing: 8) {
                        Text("Сообщение удалено")
                            .font(.system(size: 15).italic())
                            .foregroundColor(Noct.text48)
                        Spacer(minLength: 4)
                        time
                    }
                    .padding(.horizontal, 12)
                    .padding(.vertical, 7)
                } else if message.reactions.isEmpty {
                    InlineTimeText(text: message.text, time: time, accent: Noct.lilac)
                        .padding(.horizontal, 12)
                        .padding(.vertical, 7)
                } else {
                    VStack(alignment: .leading, spacing: 6) {
                        InlineTimeText(text: message.text, accent: Noct.lilac)
                        HStack(alignment: .bottom, spacing: 8) {
                            BubbleReactions(reactions: message.reactions, accent: Noct.lilac)
                            Spacer(minLength: 4)
                            time
                        }
                    }
                    .padding(.horizontal, 12)
                    .padding(.vertical, 7)
                }
            }
            .background(shape.fill(mine ? ChatPalette.noct.outgoing : ChatPalette.noct.incoming))
            .clipShape(shape)
            .overlay(shape.stroke(Color.white.opacity(0.06), lineWidth: 1))
            .opacity(message.pending ? 0.7 : 1)
            .contentShape(.contextMenuPreview, shape)
            .contextMenu {
                if !message.deleted && !message.pending {
                    Button {
                        replyTo = message
                        focused = true
                    } label: {
                        Label("Ответить", systemImage: "arrowshape.turn.up.left")
                    }
                    Menu {
                        ForEach(messageReactions, id: \.self) { emoji in
                            Button(emoji) { Task { await store.react(message, emoji: emoji, session: session) } }
                        }
                    } label: {
                        Label("Реакция", systemImage: "face.smiling")
                    }
                    Button {
                        session.copy(message.text)
                    } label: {
                        Label("Скопировать", systemImage: "doc.on.doc")
                    }
                    if mine || store.role == "owner" || store.role == "admin" {
                        Button(role: .destructive) {
                            Task { await store.delete(message, session: session) }
                        } label: {
                            Label("Удалить", systemImage: "trash")
                        }
                    }
                }
            }
            if !mine { Spacer(minLength: 52) }
        }
    }
}

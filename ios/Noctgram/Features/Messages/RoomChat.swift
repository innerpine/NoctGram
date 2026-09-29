import PhotosUI
import SwiftUI

/// A forum topic of a group (lib/room-topic-shared.ts).
struct RoomTopic: Identifiable, Hashable {
    let id: String
    let title: String
    let color: Int
    let emoji: String
    let closed: Bool
    let unread: Int
    let lastText: String
    let lastTime: Double

    init(_ j: JSON) {
        id = j["id"].str
        title = j["title"].str
        color = j["color"].int ?? 0
        emoji = j["emoji"].str
        closed = (j["closedAt"].double ?? 0) > 0
        unread = j["unread"].int ?? 0
        let last = j["lastMessage"]
        lastText = last["text"].str
        lastTime = last["created"].double ?? (j["updatedAt"].double ?? 0)
    }

    /// The six topic colours of the web.
    static let palette: [UInt32] = [0x6FB9F0, 0xFFD67E, 0xCB86DB, 0x8EEE98, 0xFF93B2, 0xFB6F5F]
    var tint: Color { Color(hex: Self.palette[max(0, min(5, color))]) }
    var isGeneral: Bool { id == "general" }
}

@MainActor
final class RoomStore: ObservableObject {
    let roomId: String
    @Published var name = ""
    @Published var kind = "group"
    @Published var memberCount = 0
    @Published var canSend = false
    @Published var role = "member"
    @Published var forum = false
    @Published var topics: [RoomTopic] = []
    /// Members with their role, for the group card.
    @Published var members: [GroupMember] = []
    /// The open topic of a forum; nil shows every topic mixed.
    @Published var topic: String?
    @Published var messages: [ChatMessage] = []
    @Published var loaded = false
    @Published var error: String?
    @Published var attachments: [ChatAttachment] = []
    @Published var uploading = 0
    private var pending: [ChatMessage] = []
    private var lastRead = ""
    /// A found message the group opens on (action=room&around=).
    let around: String?

    init(roomId: String, around: String? = nil) {
        self.roomId = roomId
        self.around = around
    }

    var isSecret: Bool { kind == "secret" }

    func load(api: APIClient) async {
        do {
            var query: [String: String?] = ["action": "room", "id": roomId]
            if let topic { query["topic"] = topic }
            if let around { query["around"] = around }
            let data = try await api.get("/api/rooms", query)
            name = data["name"].str
            kind = data["kind"].string ?? "group"
            memberCount = data["memberCount"].int ?? data["members"].array.count
            canSend = data["canSend"].bool
            role = data["role"].string ?? "member"
            forum = data["forum"].bool || !data["topics"].array.isEmpty
            topics = data["topics"].array.map(RoomTopic.init)
            members = data["members"].array.map { member in
                GroupMember(identity: Identity(id: member["userId"].str, name: member["name"].str, avatar: member["avatar"].str, handle: member["handle"].str),
                            role: member["role"].string ?? "member")
            }
            var server = data["messages"].array.map { ChatMessage(room: $0) }
            // An older server sends only the id of the answered message.
            for index in server.indices {
                guard let reply = server[index].reply, reply.text.isEmpty, !reply.unavailable,
                      let original = server.first(where: { $0.id == reply.id }) else { continue }
                server[index].reply = ReplyPreview(id: original.id, sender: original.sender, name: original.senderName,
                                                   text: original.deleted ? "Сообщение удалено" : original.summary,
                                                   unavailable: original.deleted)
            }
            let known = Set(server.map(\.id))
            pending.removeAll { known.contains($0.id) }
            let merged = server + pending
            if merged != messages { messages = merged }
            error = nil
            if let last = server.last?.id, last != lastRead {
                lastRead = last
                var body: [String: Any] = ["action": "read", "id": roomId, "through": last]
                if let topic { body["topic"] = topic }
                _ = try? await api.post("/api/rooms", body)
            }
        } catch {
            if let message = error.userMessage, messages.isEmpty { self.error = message }
        }
        loaded = true
    }

    private func preview(_ reply: ChatMessage?) -> ReplyPreview? {
        reply.map { ReplyPreview(id: $0.id, sender: $0.sender, name: $0.senderName, text: $0.summary, unavailable: false) }
    }

    private func local(_ key: String, text: String, attachments: [ChatAttachment], reply: ChatMessage?, sticker: String, session: AppSession) -> ChatMessage? {
        guard let me = session.me else { return nil }
        var message = ChatMessage(localId: key, sender: me.id, recipient: roomId, text: text, attachments: attachments, reply: preview(reply), sticker: sticker)
        message.senderName = me.name
        message.senderAvatar = me.avatar
        return message
    }

    /// Sends with the key as the message id; a message held for moderation
    /// comes back `queued` and is not shown until approved.
    private func deliver(_ message: ChatMessage, extra: [String: Any], reply: ChatMessage?, session: AppSession) async {
        pending.append(message)
        messages.append(message)
        var body: [String: Any] = [
            "action": "send",
            "actor": message.sender,
            "id": roomId,
            "key": message.id,
            "text": message.text,
            "attachments": message.attachments.map(\.id),
        ]
        body.merge(extra) { _, new in new }
        if let reply { body["replyTo"] = reply.id }
        // Answers stay in the topic of the answered message.
        if forum, let chosen = reply.map({ $0.topicId.isEmpty ? "general" : $0.topicId }) ?? topic { body["topic"] = chosen }
        do {
            let result = try await session.api.post("/api/rooms", body)
            if result["queued"].bool || result["id"].string == nil {
                session.show(result["notice"].string ?? "Сообщение отправлено на проверку")
                pending.removeAll { $0.id == message.id }
                messages.removeAll { $0.id == message.id }
            }
            await load(api: session.api)
        } catch {
            pending.removeAll { $0.id == message.id }
            messages.removeAll { $0.id == message.id }
            session.report(error)
        }
    }

    func send(_ text: String, reply: ChatMessage?, quote: String? = nil, session: AppSession) async {
        let value = text.trimmingCharacters(in: .whitespacesAndNewlines)
        let files = attachments
        guard !value.isEmpty || !files.isEmpty else { return }
        let key = UUID().uuidString.lowercased()
        guard var message = local(key, text: value, attachments: files, reply: reply, sticker: "", session: session) else { return }
        if let quote, reply != nil { message.reply?.quote = quote }
        attachments = []
        await deliver(message, extra: quote != nil && reply != nil ? ["quote": quote ?? ""] : [:], reply: reply, session: session)
    }

    func sendSticker(_ sticker: Sticker, reply: ChatMessage?, session: AppSession) async {
        let key = UUID().uuidString.lowercased()
        guard let message = local(key, text: "", attachments: [], reply: reply, sticker: sticker.ref, session: session) else { return }
        await deliver(message, extra: ["sticker": sticker.ref], reply: reply, session: session)
    }

    func sendRecording(_ file: URL, round: Bool, duration: Double, waveform: [Int], reply: ChatMessage?, session: AppSession) async {
        defer { try? FileManager.default.removeItem(at: file) }
        let milliseconds = max(1, Int((duration * 1000).rounded()))
        var fields = [
            "room": roomId,
            "intent": round ? "round" : "voice",
            "duration": String(round ? min(milliseconds, 61000) : milliseconds),
        ]
        if !round { fields["waveform"] = Waveform.encode(waveform) }
        uploading += 1
        do {
            guard let data = try? Data(contentsOf: file) else { throw MediaEncoder.Failure(errorDescription: "Запись не сохранилась.") }
            let result = try await session.api.upload(
                "/api/chat-upload",
                data: data,
                filename: round ? "video-message.mp4" : "voice.m4a",
                mimeType: round ? "video/mp4" : "audio/mp4",
                fields: fields
            )
            uploading -= 1
            let key = UUID().uuidString.lowercased()
            guard let message = local(key, text: "", attachments: [ChatAttachment(result)], reply: reply, sticker: "", session: session) else { return }
            await deliver(message, extra: [:], reply: reply, session: session)
        } catch {
            uploading -= 1
            session.report(error)
        }
    }

    func upload(_ item: PhotosPickerItem, session: AppSession) async {
        uploading += 1
        defer { uploading -= 1 }
        do {
            guard let data = try await item.loadTransferable(type: Data.self) else { return }
            let prepared = try MediaEncoder.prepare(data, types: item.supportedContentTypes)
            let result = try await session.api.upload(
                "/api/chat-upload",
                data: prepared.data,
                filename: prepared.filename,
                mimeType: prepared.mimeType,
                fields: ["room": roomId]
            )
            attachments.append(ChatAttachment(result))
        } catch {
            session.report(error)
        }
    }

    /// Shows the reaction at once; nil takes the viewer's reaction back.
    func react(_ message: ChatMessage, emoji: String?, session: AppSession) async {
        let before = messages.first { $0.id == message.id }?.reactions ?? message.reactions
        setReactions(Reaction.applying(emoji, to: before), for: message.id)
        do {
            _ = try await session.api.post("/api/rooms", [
                "action": "reaction",
                "actor": session.myId ?? "",
                "id": roomId,
                "messageId": message.id,
                "emoji": emoji ?? NSNull(),
            ])
            await load(api: session.api)
        } catch {
            setReactions(before, for: message.id)
            session.report(error)
        }
    }

    private func setReactions(_ reactions: [Reaction], for id: String) {
        if let index = messages.firstIndex(where: { $0.id == id }) { messages[index].reactions = reactions }
    }

    func delete(_ message: ChatMessage, session: AppSession) async {
        do {
            _ = try await session.api.post("/api/rooms", ["action": "deleteMessage", "id": roomId, "messageId": message.id])
            await load(api: session.api)
        } catch {
            session.report(error)
        }
    }
}

/// Group recordings have no server mark: the web keeps the last 500 played
/// ids on the device (lib/media-playback.ts), and so does the app.
enum PlayedRecordings {
    private static let key = "noct.listened"

    static func contains(_ id: String) -> Bool {
        (UserDefaults.standard.array(forKey: key) as? [String] ?? []).contains(id)
    }

    static func add(_ id: String) {
        var list = UserDefaults.standard.array(forKey: key) as? [String] ?? []
        guard !list.contains(id) else { return }
        list.append(id)
        UserDefaults.standard.set(Array(list.suffix(500)), forKey: key)
    }
}

/// A group chat (app/room-conversation.tsx): the same bubbles as a
/// dialogue with the author's name and face. Secret chats need the device
/// keys of the web client and open there.
struct RoomChatView: View {
    @EnvironmentObject private var session: AppSession
    @EnvironmentObject private var nav: Navigator
    let roomId: String
    let title: String
    @StateObject private var store: RoomStore
    @StateObject private var recorder = MessageRecorder()
    @State private var text = ""
    @State private var replyTo: ChatMessage?
    @State private var atEnd = true
    @State private var window = ChatWindow()
    @State private var picked: [PhotosPickerItem] = []
    @State private var forwarding: ChatMessage?
    @State private var quoting: ChatMessage?
    @State private var quote = ""
    @State private var openPack: StickerPanel.PackRequest?
    @State private var panel = false
    @State private var keyboard: CGFloat = 0
    @State private var played: Set<String> = []
    @EnvironmentObject private var focus: MessageFocus
    @FocusState private var focused: Bool

    /// A found message to open the group on.
    let target: String?
    @State private var focusDone = false
    @State private var glow: String?
    @State private var searchingChat = false
    @State private var jumpTo: String?
    @State private var showingInfo = false

    init(roomId: String, title: String, focus: String? = nil) {
        self.roomId = roomId
        self.title = title
        target = focus
        _store = StateObject(wrappedValue: RoomStore(roomId: roomId, around: focus))
    }

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                ChatColumn(alignment: .leading) {
                    let start = window.start(store.messages.count)
                    if store.isSecret {
                        EmptyState(icon: "lock", text: "Секретный чат зашифрован ключами устройства. Открой его в веб-версии Noctgram.")
                    } else if !store.loaded {
                        LoadingRow()
                    } else if store.messages.isEmpty {
                        EmptyState(icon: "person.3", text: store.error ?? "Сообщений пока нет.")
                    }
                    if !store.isSecret {
                        if start > 0 {
                            EarlierMessagesButton {
                                let first = store.messages[start].id
                                window.hidden = max(0, start - ChatWindow.step)
                                DispatchQueue.main.async { proxy.scrollTo(first, anchor: .top) }
                            }
                        }
                        ForEach(Array(store.messages.enumerated()).dropFirst(start), id: \.element.id) { index, message in
                            let joinsPrevious = index > 0 && Self.joins(store.messages[index - 1], message)
                            let joinsNext = index + 1 < store.messages.count && Self.joins(message, store.messages[index + 1])
                            roomBubble(message, joinsPrevious: joinsPrevious, joinsNext: joinsNext)
                                .padding(.top, joinsPrevious ? 2 : 8)
                                .background {
                                    if glow == message.id {
                                        RoundedRectangle(cornerRadius: 14, style: .continuous)
                                            .fill(Noct.lilac.opacity(0.16))
                                            .padding(.horizontal, -10)
                                            .allowsHitTesting(false)
                                    }
                                }
                                .id(message.id)
                                .modifier(ChatEndRow(isLast: message.id == store.messages.last?.id, atEnd: $atEnd))
                        }
                    }
                }
                .padding(.horizontal, 10)
                .padding(.vertical, 12)
            }
            .scrollDismissesKeyboard(.interactively)
            .modifier(ChatEndTracker(atEnd: $atEnd))
            .modifier(ChatFollowsEnd(proxy: proxy, last: store.messages.last?.id, atEnd: atEnd, bar: replyTo?.id, messages: store.messages))
            .background(ChatBackdrop(palette: .noct))
            // A tap in the chat puts the panel away; only while it is open,
            // so the list's own gestures are untouched otherwise.
            .simultaneousGesture(TapGesture().onEnded { withAnimation(Noct.quick) { panel = false } }, including: panel ? .all : .subviews)
            .onChange(of: store.messages.last?.id) { id in
                guard let id, target == nil || focusDone else { return }
                withAnimation(Noct.quick) { proxy.scrollTo(id, anchor: .bottom) }
            }
            .onChange(of: jumpTo) { id in
                guard let id, let index = store.messages.firstIndex(where: { $0.id == id }) else { return }
                window.hidden = min(window.start(store.messages.count), max(0, index - 5))
                DispatchQueue.main.async {
                    withAnimation(Noct.quick) { proxy.scrollTo(id, anchor: .center) }
                    withAnimation(.easeOut(duration: 0.3)) { glow = id }
                    jumpTo = nil
                    DispatchQueue.main.asyncAfter(deadline: .now() + 1.8) {
                        withAnimation(.easeOut(duration: 0.6)) { if glow == id { glow = nil } }
                    }
                }
            }
            .onChange(of: store.loaded) { _ in
                window.hidden = window.start(store.messages.count)
                guard let target, let index = store.messages.firstIndex(where: { $0.id == target }) else {
                    focusDone = true
                    return
                }
                window.hidden = min(window.hidden ?? 0, max(0, index - 5))
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.15) {
                    proxy.scrollTo(target, anchor: .center)
                    withAnimation(.easeOut(duration: 0.3)) { glow = target }
                    focusDone = true
                    DispatchQueue.main.asyncAfter(deadline: .now() + 1.8) {
                        withAnimation(.easeOut(duration: 0.6)) { glow = nil }
                    }
                }
            }
        }
        .overlay {
            if recorder.mode == .round && recorder.active {
                RoundCaptureOverlay(recorder: recorder, round: recorder.round, accent: Noct.lilac)
            }
        }
        .glassBottomBar { bottom }
        .navigationBarTitleDisplayMode(.inline)
        .toolbar(.hidden, for: .tabBar)
        .toolbar {
            // As in a dialogue: the name and the members on a glass
            // capsule; a tap shows who is in the group.
            ToolbarItem(placement: .principal) {
                Button {
                    showingInfo = true
                } label: {
                    VStack(spacing: 1) {
                        Text(store.name.isEmpty ? title : store.name)
                            .font(.system(size: 16, weight: .semibold))
                            .foregroundColor(.white)
                            .lineLimit(1)
                        if let topic = currentTopic {
                            Text(topic.title)
                                .font(.system(size: 12, weight: .medium))
                                .foregroundColor(topic.tint)
                                .lineLimit(1)
                        } else if store.memberCount > 0 {
                            Text("\(Format.count(store.memberCount)) \(Format.plural(store.memberCount, "участник", "участника", "участников"))")
                                .font(.system(size: 12))
                                .foregroundColor(Noct.text48)
                        }
                    }
                    .padding(.horizontal, 18)
                    .padding(.vertical, 5)
                    .frame(minHeight: 44)
                    .glassCapsule(interactive: true)
                }
                .buttonStyle(PressableStyle())
                .accessibilityIdentifier("group-title")
            }
            ToolbarItem(placement: .navigationBarTrailing) {
                if !store.isSecret {
                    Button {
                        searchingChat = true
                    } label: {
                        Image(systemName: "magnifyingglass")
                    }
                    .accessibilityLabel("Поиск в группе")
                }
            }
            if store.forum && !store.topics.isEmpty {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Menu {
                        Button {
                            store.topic = nil
                            reload()
                        } label: {
                            Label("Все темы", systemImage: store.topic == nil ? "checkmark" : "bubble.left.and.bubble.right")
                        }
                        ForEach(store.topics) { topic in
                            Button {
                                store.topic = topic.id
                                reload()
                            } label: {
                                Label((topic.emoji.isEmpty ? "" : topic.emoji + " ") + topic.title + (topic.unread > 0 ? " · \(topic.unread)" : ""),
                                      systemImage: store.topic == topic.id ? "checkmark" : (topic.closed ? "lock" : "number"))
                            }
                        }
                    } label: {
                        Image(systemName: "number.square")
                    }
                    .accessibilityLabel("Темы")
                }
            }
        }
        .sheet(item: $forwarding) { message in
            ForwardSheet(source: .room(roomId: roomId, ids: [message.id]))
                .environmentObject(session)
        }
        .sheet(item: $openPack) { request in
            StickerPackSheet(name: request.name, send: canWrite ? stickerSender : nil)
                .environmentObject(session)
        }
        .sheet(isPresented: $showingInfo) {
            GroupMembersSheet(name: store.name.isEmpty ? title : store.name, members: store.members) { id in
                nav.push(.profile(id))
            }
            .environmentObject(session)
        }
        .sheet(isPresented: $searchingChat) {
            ChatSearchSheet(scope: store.topic.map { ["room": roomId, "topic": $0] } ?? ["room": roomId]) { id in
                if store.messages.contains(where: { $0.id == id }) {
                    jumpTo = id
                } else {
                    nav.push(.roomMessage(id: roomId, title: store.name, message: id))
                }
            }
            .environmentObject(session)
        }
        .sheet(item: $quoting) { message in
            QuoteSheet(name: message.senderName, text: message.text) { fragment in
                replyAction(message)()
                quote = fragment
            }
        }
        .onChange(of: picked) { items in
            guard !items.isEmpty else { return }
            picked = []
            for item in items {
                Task { await store.upload(item, session: session) }
            }
        }
        .onChange(of: focused) { value in
            if value && panel { panel = false }
        }
        .onReceive(NotificationCenter.default.publisher(for: UIResponder.keyboardWillShowNotification)) { note in
            if let frame = note.userInfo?[UIResponder.keyboardFrameEndUserInfoKey] as? CGRect {
                keyboard = max(0, frame.height - ScreenInsets.current.bottom)
            }
        }
        .onAppear(perform: wireRecorder)
        .onDisappear {
            recorder.cancel()
            VoicePlayback.shared.stop()
        }
        .task {
            await StickerStore.shared.load(api: session.api, me: session.myId ?? "")
            StickerStore.shared.retryMissing()
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

    private var currentTopic: RoomTopic? {
        store.topic.flatMap { id in store.topics.first { $0.id == id } }
    }

    private func reload() {
        Task { await store.load(api: session.api) }
    }

    private func wireRecorder() {
        recorder.report = { session.show($0) }
        recorder.sendVoice = { recording in
            let reply = replyTo
            replyTo = nil
            Task { await store.sendRecording(recording.url, round: false, duration: recording.duration, waveform: recording.waveform, reply: reply, session: session) }
        }
        recorder.sendRound = { recording in
            let reply = replyTo
            replyTo = nil
            Task { await store.sendRecording(recording.url, round: true, duration: recording.duration, waveform: [], reply: reply, session: session) }
        }
    }

    /// Consecutive messages of one member within ten minutes form a group.
    static func joins(_ previous: ChatMessage, _ message: ChatMessage) -> Bool {
        previous.sender == message.sender && message.created - previous.created < 10 * 60 * 1000
            && Calendar.current.isDate(Format.date(previous.created), inSameDayAs: Format.date(message.created))
    }

    private var canWrite: Bool {
        guard store.canSend && !store.isSecret && !session.readOnly else { return false }
        return !(currentTopic?.closed ?? false) || store.role == "owner" || store.role == "admin"
    }

    private func focusAction(_ message: ChatMessage, joinsPrevious: Bool) -> (CGRect) -> Void {
        { frame in present(message, frame: frame, joinsPrevious: joinsPrevious) }
    }

    private var reactable: Bool { !store.isSecret && !session.readOnly }

    private func reactAction(_ message: ChatMessage) -> (String?) -> Void {
        { emoji in Task { await store.react(message, emoji: emoji, session: session) } }
    }

    /// The group gives counts, not names: only a reaction of the viewer's
    /// alone has a known face.
    private func reactors(_ reaction: Reaction) -> [Identity]? {
        guard reaction.own, reaction.count == 1, let me = session.me?.identity else { return nil }
        return [me]
    }

    private func replyAction(_ message: ChatMessage) -> () -> Void {
        {
            replyTo = message
            quote = ""
            if !panel { focused = true }
        }
    }

    private var stickerSender: (Sticker) -> Void {
        { sticker in send(sticker) }
    }

    private func send(_ sticker: Sticker) {
        let reply = replyTo
        replyTo = nil
        Task { await store.sendSticker(sticker, reply: reply, session: session) }
    }

    private func unheard(_ message: ChatMessage) -> Bool {
        guard message.voice != nil || message.round != nil, message.sender != session.myId, !message.pending else { return false }
        return !played.contains(message.id) && !PlayedRecordings.contains(message.id)
    }

    private func listen(_ message: ChatMessage) {
        played.insert(message.id)
        PlayedRecordings.add(message.id)
    }

    private func bubble(_ message: ChatMessage, joinsPrevious: Bool, standalone: Bool) -> MessageBubble {
        let mine = message.sender == session.myId
        return MessageBubble(
            message: message,
            mine: mine,
            peer: Identity(id: message.sender, name: message.senderName, avatar: message.senderAvatar, handle: "", appearance: message.senderAppearance),
            palette: .noct,
            joinsPrevious: joinsPrevious,
            openMedia: { items, position in
                MediaPresenter.shared.show(MediaViewerState(items: items, index: position, title: message.senderName, date: message.created))
            },
            standalone: standalone,
            author: !mine && !joinsPrevious ? BubbleAuthor(name: message.senderName, appearance: message.senderAppearance) : nil,
            readReceipts: false,
            unheard: unheard(message),
            onListen: { listen(message) },
            onReact: reactable ? reactAction(message) : nil,
            reactors: reactors,
            onOpenProfile: { nav.push(.profile($0)) },
            onOpenPost: { nav.push(.post($0)) },
            onOpenPack: { openPack = StickerPanel.PackRequest(name: $0.packName) }
        )
    }

    /// The same bubbles as a dialogue; the author's name and avatar mark the
    /// start and end of each group. Swipe left to answer, hold for reactions.
    private func roomBubble(_ message: ChatMessage, joinsPrevious: Bool, joinsNext: Bool) -> some View {
        let mine = message.sender == session.myId
        let active = !message.deleted && !message.pending
        let content = bubble(message, joinsPrevious: joinsPrevious, standalone: true)
        return HStack(alignment: .bottom, spacing: 6) {
            if mine {
                Spacer(minLength: 52)
            } else if joinsNext {
                Color.clear.frame(width: 30, height: 1)
            } else {
                Button {
                    nav.push(.profile(message.sender))
                } label: {
                    AvatarView(person: Identity(id: message.sender, name: message.senderName, avatar: message.senderAvatar, handle: "", appearance: message.senderAppearance), size: 30)
                }
                .buttonStyle(PressableStyle())
            }
            content
                .modifier(SpokenBubble(label: content.spoken))
                .accessibilityIdentifier("message-" + message.id)
                .modifier(HoldToFocus(action: active ? focusAction(message, joinsPrevious: joinsPrevious) : nil))
            if !mine { Spacer(minLength: 52) }
        }
        .modifier(SwipeToReply(action: active && canWrite ? replyAction(message) : nil))
    }

    /// Lifts a held message over the blurred screen, as in Telegram.
    private func present(_ message: ChatMessage, frame: CGRect, joinsPrevious: Bool) {
        let mine = message.sender == session.myId
        var actions: [MessageAction] = []
        if canWrite {
            actions.append(MessageAction(title: "Ответить", icon: "arrowshape.turn.up.left", run: replyAction(message)))
            if !message.text.isEmpty && !message.deleted {
                actions.append(MessageAction(title: "Цитировать", icon: "text.quote") { quoting = message })
            }
        }
        if !message.text.isEmpty {
            actions.append(MessageAction(title: "Скопировать", icon: "doc.on.doc") { session.copy(message.text) })
        }
        if let sticker = StickerStore.shared.sticker(message.sticker), sticker.available, !session.readOnly {
            let favorite = StickerStore.shared.isFavorite(sticker.ref)
            actions.append(MessageAction(title: favorite ? "Убрать из избранного" : "В избранные стикеры", icon: favorite ? "bookmark.slash" : "bookmark") {
                Task { await StickerStore.shared.setFavorite(sticker, !favorite, session: session) }
            })
        }
        if !session.readOnly && !message.encrypted {
            actions.append(MessageAction(title: "Переслать", icon: "arrowshape.turn.up.right") { forwarding = message })
        }
        if mine || store.role == "owner" || store.role == "admin" {
            actions.append(MessageAction(title: "Удалить", icon: "trash", destructive: true) {
                Task { await store.delete(message, session: session) }
            })
        }
        focus.present(MessageFocus.Item(
            frame: frame,
            mine: mine,
            bubble: AnyView(bubble(message, joinsPrevious: joinsPrevious, standalone: true).environmentObject(session)),
            reactions: reactable ? messageReactions : [],
            chosen: message.reactions.first(where: \.own)?.emoji,
            actions: actions,
            react: reactAction(message)
        ))
    }

    private var panelHeight: CGFloat { max(keyboard > 0 ? keyboard : 290, 260) }

    @ViewBuilder private var bottom: some View {
        if canWrite {
            VStack(spacing: 0) {
                if let reply = replyTo {
                    ComposerContext(title: "Ответ \(reply.senderName)", text: PremiumEmoji.replace(quote.isEmpty ? reply.summary : "«\(quote)»")) {
                        replyTo = nil
                        quote = ""
                    }
                }
                if !store.attachments.isEmpty || store.uploading > 0 {
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 8) {
                            ForEach(store.attachments) { file in
                                ZStack(alignment: .topTrailing) {
                                    Group {
                                        if file.isImage {
                                            RemoteImage(url: session.api.mediaURL(file.path), maxPixel: 200)
                                        } else {
                                            ZStack {
                                                Noct.coverFill
                                                Image(systemName: file.isVideo ? "video" : "doc").foregroundColor(Noct.text60)
                                            }
                                        }
                                    }
                                    .frame(width: 64, height: 64)
                                    .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                                    Button {
                                        store.attachments.removeAll { $0.id == file.id }
                                    } label: {
                                        Image(systemName: "xmark.circle.fill")
                                            .foregroundStyle(.white, .black.opacity(0.7))
                                    }
                                    .padding(3)
                                }
                            }
                            if store.uploading > 0 {
                                ProgressView()
                                    .tint(.white)
                                    .frame(width: 64, height: 64)
                                    .glassRect(12)
                            }
                        }
                        .padding(.horizontal, 12)
                        .padding(.top, 8)
                    }
                }
                if EmojiTokens.contains(text) {
                    TokenPreview(text: text)
                }
                ChatComposer(
                    text: $text,
                    placeholder: currentTopic.map { "Сообщение в «\($0.title)»" } ?? "Сообщение в группу",
                    focus: $focused,
                    accent: Noct.lilac,
                    attach: AnyView(attachButton),
                    panel: $panel,
                    recorder: recorder,
                    hasAttachments: !store.attachments.isEmpty
                ) {
                    let value = text
                    let reply = replyTo
                    let fragment = quote.isEmpty ? nil : quote
                    text = ""
                    replyTo = nil
                    quote = ""
                    Task { await store.send(value, reply: reply, quote: fragment, session: session) }
                }
                if panel {
                    StickerPanel(text: $text, height: panelHeight) { sticker in send(sticker) }
                        .transition(.move(edge: .bottom).combined(with: .opacity))
                }
            }
            .animation(Noct.quick, value: panel)
        } else if store.loaded && !store.isSecret {
            ComposerNotice(text: session.readOnly
                ? "В режиме только для чтения отправка недоступна."
                : ((currentTopic?.closed ?? false) ? "Тема закрыта. Писать в неё могут её автор и администраторы." : "Писать в эту группу могут только администраторы."))
        }
    }

    private var attachButton: some View {
        PhotosPicker(selection: $picked, maxSelectionCount: 10, matching: .any(of: [.images, .videos])) {
            Image(systemName: "paperclip")
                .font(.system(size: 19, weight: .medium))
                .foregroundColor(.white)
                .frame(width: 44, height: 44)
                .contentShape(Circle())
        }
        .glassCircle(interactive: true)
        .accessibilityLabel("Прикрепить фото или видео")
    }
}

struct GroupMember: Identifiable {
    let identity: Identity
    let role: String
    var id: String { identity.id }
}

/// Who is in a group: owners and admins first, as the web lists them.
struct GroupMembersSheet: View {
    @Environment(\.dismiss) private var dismiss
    let name: String
    let members: [GroupMember]
    let open: (String) -> Void

    private var ordered: [GroupMember] {
        let rank = ["owner": 0, "admin": 1]
        return members.sorted { (rank[$0.role] ?? 2, $0.identity.name) < (rank[$1.role] ?? 2, $1.identity.name) }
    }

    var body: some View {
        NavigationStack {
            List {
                Section {
                    ForEach(ordered) { member in
                        Button {
                            dismiss()
                            open(member.identity.id)
                        } label: {
                            PersonRow(person: member.identity, subtitle: subtitle(member))
                        }
                        .listRowBackground(Noct.sheetRow)
                    }
                } header: {
                    Text("\(Format.count(members.count)) \(Format.plural(members.count, "участник", "участника", "участников"))")
                }
            }
            .listStyle(.insetGrouped)
            .scrollContentBackground(.hidden)
            .sheetSurface()
            .navigationTitle(name)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Закрыть") { dismiss() }
                }
            }
        }
        .presentationDetents([.medium, .large])
    }

    private func subtitle(_ member: GroupMember) -> String {
        switch member.role {
        case "owner": return "владелец"
        case "admin": return "администратор"
        default: return member.identity.handle.isEmpty ? "участник" : "@" + member.identity.handle
        }
    }
}

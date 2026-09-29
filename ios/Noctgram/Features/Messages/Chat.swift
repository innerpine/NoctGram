import PhotosUI
import SwiftUI
import UIKit

/// The eight reactions the server accepts (lib/message-reactions.ts), ❤️ first as in Telegram.
let messageReactions = ["❤️", "👍", "😂", "🔥", "🎉", "🤯", "😢", "👎"]

@MainActor
final class ChatStore: ObservableObject {
    let peer: Person
    @Published var messages: [ChatMessage] = []
    @Published var loaded = false
    @Published var error: String?
    @Published var allowed = true
    @Published var blockedByMe = false
    @Published var profile: Profile?
    @Published var attachments: [ChatAttachment] = []
    @Published var uploading = 0
    /// The dialogue theme chosen on the web (lib/chat-themes.ts).
    @Published var palette = ChatPalette.noct

    private var pending: [ChatMessage] = []
    /// Recordings this device already reported as listened.
    private var listened: Set<String> = []

    init(peer: Person) {
        self.peer = peer
    }

    /// Opening the dialogue marks incoming messages read on the server.
    func load(api: APIClient) async {
        do {
            let data = try await api.social("messages", ["peer": peer.id, "includeTheme": "1"])
            // With includeTheme the server wraps the list: {messages, theme}.
            let list = data["messages"].isNull ? data : data["messages"]
            var server = list.array.map { ChatMessage($0) }
            for index in server.indices where listened.contains(server[index].id) && server[index].listenedAt == 0 {
                server[index].listenedAt = Format.nowMs
            }
            let theme = data["theme"]
            if !theme.isNull {
                let id = theme["personal"].string ?? theme["shared"].string ?? "noct"
                if id != palette.id { palette = ChatPalette(id: id) }
            }
            let known = Set(server.map(\.id))
            pending.removeAll { known.contains($0.id) }
            let merged = server + pending
            if merged != messages { messages = merged }
            error = nil
        } catch {
            if let message = error.userMessage, messages.isEmpty { self.error = message }
        }
        loaded = true
    }

    func loadMeta(api: APIClient) async {
        if let access = try? await api.social("messageAccess", ["peer": peer.id]) {
            allowed = access["allowed"].bool
            blockedByMe = access["blockedByMe"].bool
        }
        if let data = try? await api.social("profile", ["id": peer.id]) {
            profile = Profile(data)
        }
    }

    private func preview(_ reply: ChatMessage?, me: String) -> ReplyPreview? {
        reply.map {
            ReplyPreview(id: $0.id, sender: $0.sender, name: $0.sender == me ? "Вы" : peer.name, text: $0.summary, unavailable: false)
        }
    }

    /// Shows the message at once and sends it with a key, so a retry never
    /// doubles it (lib/chat-outbox.ts).
    private func deliver(_ local: ChatMessage, body extra: [String: Any], key: String, reply: ChatMessage?, session: AppSession) async {
        var local = local
        pending.append(local)
        messages.append(local)
        var body: [String: Any] = [
            "id": peer.id,
            "key": key,
            "text": local.text,
            "attachments": local.attachments.map(\.id),
            "expectedSender": local.sender,
        ]
        body.merge(extra) { _, new in new }
        if let reply { body["replyTo"] = reply.id }
        do {
            _ = try await session.api.socialPost("message", body)
            await load(api: session.api)
            await session.refreshCounters()
        } catch {
            local.pending = false
            local.failed = true
            if let index = messages.firstIndex(where: { $0.id == local.id }) { messages[index] = local }
            pending.removeAll { $0.id == local.id }
            session.report(error)
        }
    }

    func send(_ text: String, reply: ChatMessage?, session: AppSession) async {
        guard let me = session.myId else { return }
        let value = text.trimmingCharacters(in: .whitespacesAndNewlines)
        let files = attachments
        guard !value.isEmpty || !files.isEmpty else { return }
        let key = UUID().uuidString.lowercased()
        let local = ChatMessage(localId: "message:\(me):\(key)", sender: me, recipient: peer.id, text: value, attachments: files, reply: preview(reply, me: me))
        attachments = []
        await deliver(local, body: [:], key: key, reply: reply, session: session)
    }

    /// A sticker goes alone, without text or files (lib/sticker-send.ts).
    func sendSticker(_ sticker: Sticker, reply: ChatMessage?, session: AppSession) async {
        guard let me = session.myId else { return }
        let key = UUID().uuidString.lowercased()
        let local = ChatMessage(localId: "message:\(me):\(key)", sender: me, recipient: peer.id, text: "", attachments: [], reply: preview(reply, me: me), sticker: sticker.ref)
        await deliver(local, body: ["sticker": sticker.ref], key: key, reply: reply, session: session)
    }

    /// Uploads a voice or round recording with its length and waveform,
    /// then sends it alone (app/api/chat-upload, VOICE_MESSAGES.md).
    func sendRecording(_ file: URL, round: Bool, duration: Double, waveform: [Int], reply: ChatMessage?, session: AppSession) async {
        guard let me = session.myId else { return }
        defer { try? FileManager.default.removeItem(at: file) }
        let key = UUID().uuidString.lowercased()
        let milliseconds = max(1, Int((duration * 1000).rounded()))
        var fields = [
            "peer": peer.id,
            "intent": round ? "round" : "voice",
            "duration": String(round ? min(milliseconds, 61000) : milliseconds),
        ]
        if !round { fields["waveform"] = Waveform.encode(waveform) }
        let placeholder = ChatAttachment(JSON.object([
            "id": .string("local-" + key), "name": .string(""), "type": .string(round ? "video/mp4" : "audio/mp4"),
            "size": .number(0), "kind": .string(round ? "round" : "voice"),
            "duration": .number(Double(milliseconds)), "waveform": .string(Waveform.encode(waveform)),
        ]))
        var local = ChatMessage(localId: "message:\(me):\(key)", sender: me, recipient: peer.id, text: "", attachments: [placeholder], reply: preview(reply, me: me))
        local.listenedAt = Format.nowMs
        pending.append(local)
        messages.append(local)
        do {
            guard let data = try? Data(contentsOf: file) else { throw MediaEncoder.Failure(errorDescription: "Запись не сохранилась.") }
            let stamp = Self.stamp()
            let result = try await session.api.upload(
                "/api/chat-upload",
                data: data,
                filename: round ? "video-message-\(stamp).mp4" : "voice-\(stamp).m4a",
                mimeType: round ? "video/mp4" : "audio/mp4",
                fields: fields
            )
            let uploaded = ChatAttachment(result)
            pending.removeAll { $0.id == local.id }
            messages.removeAll { $0.id == local.id }
            local.attachments = [uploaded]
            await deliver(local, body: [:], key: key, reply: reply, session: session)
        } catch {
            pending.removeAll { $0.id == local.id }
            messages.removeAll { $0.id == local.id }
            session.report(error)
        }
    }

    private static func stamp() -> String {
        let format = DateFormatter()
        format.locale = Locale(identifier: "en_US_POSIX")
        format.dateFormat = "yyyyMMdd'T'HHmmss"
        return format.string(from: Date())
    }

    /// The first play of an incoming recording tells its sender.
    func markListened(_ message: ChatMessage, session: AppSession) {
        guard message.sender != session.myId, message.listenedAt == 0, !listened.contains(message.id) else { return }
        listened.insert(message.id)
        if let index = messages.firstIndex(where: { $0.id == message.id }) { messages[index].listenedAt = Format.nowMs }
        Task { _ = try? await session.api.socialPost("messageListened", ["peer": message.sender, "id": message.id]) }
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
                fields: ["peer": peer.id]
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
            _ = try await session.api.socialPost("messageReaction", [
                "id": message.id,
                "peer": peer.id,
                "emoji": emoji ?? NSNull(),
                "expectedSender": session.myId ?? "",
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

    /// Up to ten pinned messages per dialogue (lib/chat-messages.ts).
    func pin(_ message: ChatMessage, value: Bool, session: AppSession) async {
        do {
            _ = try await session.api.socialPost("messagePin", ["id": message.id, "peer": peer.id, "value": value])
            session.show(value ? "Сообщение закреплено" : "Сообщение откреплено")
            await load(api: session.api)
        } catch {
            session.report(error)
        }
    }

    func delete(_ message: ChatMessage, everyone: Bool, session: AppSession) async {
        do {
            _ = try await session.api.socialPost("messageDelete", ["ids": [message.id], "peer": peer.id, "everyone": everyone])
            messages.removeAll { $0.id == message.id }
            await load(api: session.api)
        } catch {
            session.report(error)
        }
    }

    func edit(_ message: ChatMessage, text: String, session: AppSession) async {
        do {
            _ = try await session.api.socialPost("messageEdit", [
                "id": message.id,
                "peer": peer.id,
                "text": text,
                "revision": Int64(message.editedAt),
            ])
            await load(api: session.api)
        } catch {
            session.report(error)
        }
    }

    func report(_ message: ChatMessage, reason: String, session: AppSession) async {
        do {
            _ = try await session.api.socialPost("reportMessage", ["id": message.id, "reason": reason])
            session.show("Жалоба отправлена модераторам")
        } catch {
            session.report(error)
        }
    }

    func setBlocked(_ value: Bool, session: AppSession) async {
        do {
            _ = try await session.api.socialPost("blockUser", ["id": peer.id, "value": value])
            await loadMeta(api: session.api)
            session.show(value ? "Пользователь заблокирован" : "Пользователь разблокирован")
        } catch {
            session.report(error)
        }
    }
}

/// A direct dialogue (app/chat-conversation.tsx): polling every 3 s while
/// open. The dialogue with oneself is «Избранное»: notes and forwards.
struct ChatView: View {
    @EnvironmentObject private var session: AppSession
    @EnvironmentObject private var nav: Navigator
    let peer: Person
    @StateObject private var store: ChatStore
    @StateObject private var recorder = MessageRecorder()
    @State private var text = ""
    @State private var replyTo: ChatMessage?
    @State private var editing: ChatMessage?
    @State private var picked: [PhotosPickerItem] = []
    @State private var reporting: ChatMessage?
    @State private var deleting: ChatMessage?
    @State private var forwarding: ChatMessage?
    @State private var openPack: StickerPanel.PackRequest?
    @State private var atEnd = true
    @State private var window = ChatWindow()
    @State private var panel = false
    @State private var keyboard: CGFloat = 0
    @EnvironmentObject private var focus: MessageFocus
    @FocusState private var focused: Bool

    init(peer: Person) {
        self.peer = peer
        _store = StateObject(wrappedValue: ChatStore(peer: peer))
    }

    private var isSaved: Bool { peer.id == session.myId }
    private var title: Identity { store.profile?.identity ?? peer.identity }
    private var presence: String? {
        if isSaved { return "Заметки и пересланное — только для вас" }
        guard let seen = store.profile?.lastSeen, seen > 0 else { return nil }
        return Format.presence(seen)
    }

    var body: some View {
        let _ = ChatProbe.count("chat body")
        ScrollViewReader { proxy in
            ScrollView {
                ChatColumn { rows(proxy) }
                    .padding(.horizontal, 8)
                    .padding(.vertical, 10)
            }
            .scrollDismissesKeyboard(.interactively)
            .modifier(ChatEndTracker(atEnd: $atEnd))
            .modifier(ChatFollowsEnd(proxy: proxy, last: store.messages.last?.id, atEnd: atEnd, bar: (replyTo ?? editing)?.id, messages: store.messages))
            .background(ChatBackdrop(palette: store.palette))
            .simultaneousGesture(TapGesture().onEnded { if panel { withAnimation(Noct.quick) { panel = false } } })
            .onChange(of: store.messages.last?.id) { id in
                guard let id else { return }
                withAnimation(Noct.quick) { proxy.scrollTo(id, anchor: .bottom) }
            }
            .onChange(of: store.loaded) { _ in
                window.hidden = window.start(store.messages.count)
                if let id = store.messages.last?.id { proxy.scrollTo(id, anchor: .bottom) }
            }
            .onChange(of: panel) { _ in
                if atEnd, let id = store.messages.last?.id {
                    DispatchQueue.main.async { withAnimation(Noct.quick) { proxy.scrollTo(id, anchor: .bottom) } }
                }
            }
        }
        .overlay {
            if recorder.mode == .round && recorder.active {
                RoundCaptureOverlay(recorder: recorder, round: recorder.round, accent: store.palette.accent)
            }
        }
        .glassBottomBar { bottom }
        .navigationBarTitleDisplayMode(.inline)
        .toolbar(.hidden, for: .tabBar)
        .toolbar {
            // As in Telegram: name and presence on a glass capsule, the
            // avatar on the right opens the chat menu.
            ToolbarItem(placement: .principal) {
                Button {
                    if !isSaved { nav.push(.profile(peer.id)) }
                } label: {
                    VStack(spacing: 1) {
                        if isSaved {
                            Text("Избранное").font(.system(size: 16, weight: .semibold))
                        } else {
                            DisplayName(person: title, size: 16)
                        }
                        if let presence {
                            Text(presence)
                                .font(.system(size: 12))
                                .foregroundColor(!isSaved && Format.isOnline(store.profile?.lastSeen ?? 0) ? Noct.green : Noct.text48)
                                .lineLimit(1)
                        }
                    }
                    .padding(.horizontal, 18)
                    .padding(.vertical, 5)
                    .frame(minHeight: 44)
                    .glassCapsule(interactive: true)
                }
                .buttonStyle(PressableStyle())
            }
            ToolbarItem(placement: .navigationBarTrailing) {
                if isSaved {
                    SavedAvatar(size: 36)
                } else {
                    Menu {
                        Button {
                            nav.push(.profile(peer.id))
                        } label: {
                            Label("Профиль", systemImage: "person")
                        }
                        Button(role: store.blockedByMe ? nil : .destructive) {
                            Task { await store.setBlocked(!store.blockedByMe, session: session) }
                        } label: {
                            Label(store.blockedByMe ? "Разблокировать" : "Заблокировать", systemImage: "hand.raised")
                        }
                    } label: {
                        AvatarView(person: title, size: 36, ring: false)
                    }
                    .accessibilityLabel("Меню чата")
                }
            }
        }
        .sheet(item: $forwarding) { message in
            ForwardSheet(source: .dm(peer: peer.id, ids: [message.id]))
                .environmentObject(session)
        }
        .sheet(item: $openPack) { request in
            StickerPackSheet(name: request.name, send: canWrite ? stickerSender : nil)
                .environmentObject(session)
        }
        .confirmationDialog("Пожаловаться на сообщение", isPresented: Binding(get: { reporting != nil }, set: { if !$0 { reporting = nil } }), titleVisibility: .visible) {
            ForEach(ReportReason.all, id: \.self) { reason in
                Button(reason) {
                    if let message = reporting { Task { await store.report(message, reason: reason, session: session) } }
                }
            }
            Button("Отмена", role: .cancel) {}
        }
        .confirmationDialog("Удалить сообщение?", isPresented: Binding(get: { deleting != nil }, set: { if !$0 { deleting = nil } }), titleVisibility: .visible) {
            if let message = deleting {
                if isSaved {
                    Button("Удалить", role: .destructive) {
                        Task { await store.delete(message, everyone: true, session: session) }
                    }
                } else {
                    if message.sender == session.myId {
                        Button("Удалить у всех", role: .destructive) {
                            Task { await store.delete(message, everyone: true, session: session) }
                        }
                    }
                    Button("Удалить у меня", role: .destructive) {
                        Task { await store.delete(message, everyone: false, session: session) }
                    }
                }
            }
            Button("Отмена", role: .cancel) {}
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
            await store.loadMeta(api: session.api)
            await GiftCatalog.shared.load(api: session.api)
            await StickerStore.shared.load(api: session.api, me: session.myId ?? "")
        }
        .task {
            while !Task.isCancelled {
                await store.load(api: session.api)
                try? await Task.sleep(nanoseconds: 3_000_000_000)
            }
        }
        .onDisappear { Task { await session.refreshCounters() } }
        #if DEBUG
        .task(id: store.loaded) {
            guard store.loaded else { return }
            debugOpen()
            await ChatProbe.run()
        }
        #endif
    }

    /// Recordings go out as the next message, answering what is answered.
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

    #if DEBUG
    /// Screenshot hooks (ios/Tests): `-noct.debugSheet stickers` or `emoji`
    /// opens the panel, `forward` the forward sheet for the last message.
    private func debugOpen() {
        switch UserDefaults.standard.string(forKey: "noct.debugSheet") {
        case "stickers", "emoji":
            UserDefaults.standard.set(UserDefaults.standard.string(forKey: "noct.debugSheet") == "emoji" ? "emoji" : "stickers", forKey: "noct.panelTab")
            panel = true
        case "forward":
            forwarding = store.messages.last
        default:
            break
        }
    }
    #endif

    /// The newest messages with a day line before the first of each day.
    @ViewBuilder private func rows(_ proxy: ScrollViewProxy) -> some View {
        let start = window.start(store.messages.count)
        if !store.loaded {
            LoadingRow()
        } else if store.messages.isEmpty {
            if isSaved {
                EmptyState(icon: "bookmark", text: store.error ?? "Сохраняйте сюда заметки, ссылки и пересланные сообщения — их видите только вы.")
            } else {
                EmptyState(icon: "hand.wave", text: store.error ?? "Сообщений пока нет. Напиши первым.")
            }
        }
        if start > 0 {
            EarlierMessagesButton { showEarlier(from: start, proxy: proxy) }
        }
        ForEach(Array(store.messages.enumerated()).dropFirst(start), id: \.element.id) { index, message in
            let previous = index > 0 ? store.messages[index - 1] : nil
            let newDay = previous.map { !Calendar.current.isDate(Format.date(message.created), inSameDayAs: Format.date($0.created)) } ?? true
            let joins = !newDay && previous.map { Self.joins($0, message) } == true
            if newDay {
                Text(Format.day(message.created))
                    .font(.system(size: 12, weight: .medium))
                    .foregroundColor(Noct.text60)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 5)
                    // Content, not a control: a plain pill. Liquid
                    // Glass inside the scrolling list kept iOS 26
                    // redrawing it without end.
                    .background(Capsule().fill(Color.white.opacity(0.08)))
                    .padding(.top, 10)
                    .padding(.bottom, 2)
            }
            bubble(message, joins: joins)
                .padding(.top, joins ? 2 : 8)
                .id(message.id)
                .modifier(ChatEndRow(isLast: message.id == store.messages.last?.id, atEnd: $atEnd))
        }
    }

    private func bubble(_ message: ChatMessage, joins: Bool, standalone: Bool = false) -> MessageBubble {
        MessageBubble(
            message: message,
            mine: message.sender == session.myId,
            peer: title,
            palette: store.palette,
            joinsPrevious: joins,
            openMedia: { items, position in
                MediaPresenter.shared.show(MediaViewerState(items: items, index: position, title: senderName(message), date: message.created) {
                    deleting = message
                })
            },
            standalone: standalone,
            readReceipts: !isSaved,
            unheard: unheard(message),
            onListen: { store.markListened(message, session: session) },
            onFocus: { frame in present(message, frame: frame, joinsPrevious: joins) },
            onReply: canWrite ? replyAction(message) : nil,
            onReact: canWrite ? reactAction(message) : nil,
            onOpenProfile: { nav.push(.profile($0)) },
            onOpenPost: { nav.push(.post($0)) },
            onOpenPack: { openPack = StickerPanel.PackRequest(name: $0.packName) }
        )
    }

    /// Nobody played the recording yet: the recipient sees a dot until
    /// they play it, the sender until the recipient does. Not in «Избранное».
    private func unheard(_ message: ChatMessage) -> Bool {
        guard !isSaved, message.voice != nil || message.round != nil, !message.pending else { return false }
        return message.listenedAt == 0
    }

    /// Draws earlier messages above, staying on the one that was first.
    private func showEarlier(from start: Int, proxy: ScrollViewProxy) {
        let first = store.messages[start].id
        window.hidden = max(0, start - ChatWindow.step)
        DispatchQueue.main.async { proxy.scrollTo(first, anchor: .top) }
    }

    private func senderName(_ message: ChatMessage) -> String {
        message.sender == session.myId ? session.me?.name ?? "Вы" : title.name
    }

    /// Consecutive messages of one sender within ten minutes form a group.
    static func joins(_ previous: ChatMessage, _ message: ChatMessage) -> Bool {
        previous.sender == message.sender && message.created - previous.created < 10 * 60 * 1000
    }

    private var canWrite: Bool { !session.readOnly && (isSaved || (store.allowed && !store.blockedByMe)) }

    private func reply(to message: ChatMessage) {
        replyTo = message
        editing = nil
        if !panel { focused = true }
    }

    private func replyAction(_ message: ChatMessage) -> () -> Void {
        { reply(to: message) }
    }

    private func reactAction(_ message: ChatMessage) -> (String?) -> Void {
        { emoji in Task { await store.react(message, emoji: emoji, session: session) } }
    }

    private var stickerSender: (Sticker) -> Void {
        { sticker in send(sticker) }
    }

    private func send(_ sticker: Sticker) {
        let reply = replyTo
        replyTo = nil
        Task { await store.sendSticker(sticker, reply: reply, session: session) }
    }

    /// Lifts a held message over the blurred screen, as in Telegram.
    private func present(_ message: ChatMessage, frame: CGRect, joinsPrevious: Bool) {
        let mine = message.sender == session.myId
        focus.present(MessageFocus.Item(
            frame: frame,
            mine: mine,
            bubble: AnyView(bubble(message, joins: joinsPrevious, standalone: true).environmentObject(session)),
            reactions: canWrite ? messageReactions : [],
            chosen: message.reactions.first(where: \.own)?.emoji,
            actions: actions(for: message),
            react: reactAction(message)
        ))
    }

    private func actions(for message: ChatMessage) -> [MessageAction] {
        let mine = message.sender == session.myId
        var list: [MessageAction] = []
        if canWrite {
            list.append(MessageAction(title: "Ответить", icon: "arrowshape.turn.up.left") { reply(to: message) })
        }
        if !message.text.isEmpty {
            list.append(MessageAction(title: "Скопировать", icon: "doc.on.doc") { session.copy(message.text) })
        }
        let plain = message.gift == nil && message.forwardedName.isEmpty && message.sticker.isEmpty
            && message.voice == nil && message.round == nil && message.postShare.isEmpty
        if mine && canWrite && plain {
            list.append(MessageAction(title: "Изменить", icon: "pencil") {
                editing = message
                replyTo = nil
                text = message.text
                panel = false
                focused = true
            })
        }
        if let sticker = StickerStore.shared.sticker(message.sticker), sticker.available, !session.readOnly {
            let favorite = StickerStore.shared.isFavorite(sticker.ref)
            list.append(MessageAction(title: favorite ? "Убрать из избранного" : "В избранные стикеры", icon: favorite ? "bookmark.slash" : "bookmark") {
                Task { await StickerStore.shared.setFavorite(sticker, !favorite, session: session) }
            })
        }
        if !session.readOnly {
            let pinned = message.pinnedAt > 0
            list.append(MessageAction(title: pinned ? "Открепить" : "Закрепить", icon: pinned ? "pin.slash" : "pin") {
                Task { await store.pin(message, value: !pinned, session: session) }
            })
            if message.gift == nil {
                list.append(MessageAction(title: "Переслать", icon: "arrowshape.turn.up.right") { forwarding = message })
            }
        }
        list.append(MessageAction(title: "Удалить", icon: "trash", destructive: true) { deleting = message })
        if !mine && !isSaved {
            list.append(MessageAction(title: "Пожаловаться", icon: "flag", destructive: true) { reporting = message })
        }
        return list
    }

    private var panelHeight: CGFloat { max(keyboard > 0 ? keyboard : 290, 260) }

    @ViewBuilder private var bottom: some View {
        if store.blockedByMe && !isSaved {
            ComposerNotice(text: "Ты заблокировал(а) этого пользователя.", action: "Разблокировать") {
                Task { await store.setBlocked(false, session: session) }
            }
        } else if !store.allowed && store.loaded && !isSaved {
            ComposerNotice(text: "Пользователь ограничил входящие сообщения.")
        } else if session.readOnly {
            ComposerNotice(text: "В режиме только для чтения отправка недоступна.")
        } else {
            VStack(spacing: 0) {
                if let context = replyTo ?? editing {
                    ComposerContext(
                        title: editing != nil ? "Редактирование" : (context.sender == session.myId ? "Ответ себе" : "Ответ \(title.name)"),
                        text: PremiumEmoji.replace(context.summary)
                    ) {
                        if editing != nil { text = "" }
                        replyTo = nil
                        editing = nil
                    }
                }
                if !store.attachments.isEmpty || store.uploading > 0 {
                    attachmentsRow
                }
                if EmojiTokens.contains(text) {
                    TokenPreview(text: text)
                }
                ChatComposer(
                    text: $text,
                    focus: $focused,
                    accent: store.palette.accent,
                    attach: editing == nil ? AnyView(attachButton) : nil,
                    panel: $panel,
                    recorder: editing == nil ? recorder : nil,
                    hasAttachments: !store.attachments.isEmpty
                ) {
                    let value = text
                    if let message = editing {
                        editing = nil
                        text = ""
                        Task { await store.edit(message, text: value, session: session) }
                    } else {
                        let reply = replyTo
                        replyTo = nil
                        text = ""
                        Task { await store.send(value, reply: reply, session: session) }
                    }
                }
                if panel {
                    StickerPanel(text: $text, height: panelHeight) { sticker in send(sticker) }
                        .transition(.move(edge: .bottom).combined(with: .opacity))
                }
            }
            .animation(Noct.quick, value: panel)
        }
    }

    private var attachmentsRow: some View {
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

/// How the draft looks with its premium emoji, over the field (the field
/// itself holds the tokens, as on the web).
struct TokenPreview: View {
    @EnvironmentObject private var session: AppSession
    @ObservedObject private var images = EmojiImages.shared
    @ObservedObject private var stickers = StickerStore.shared
    let text: String

    var body: some View {
        let _ = (images.revision, stickers.revision)
        EmojiText.text(text, fontSize: 15, session: session)
            .font(.system(size: 15))
            .foregroundColor(Noct.text75)
            .lineLimit(2)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 14)
            .padding(.vertical, 8)
            .glassRect(18)
            .padding(.horizontal, 12)
            .padding(.top, 6)
            .accessibilityLabel("Предпросмотр: " + PremiumEmoji.replace(text))
    }
}

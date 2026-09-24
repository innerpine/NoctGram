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

    init(peer: Person) {
        self.peer = peer
    }

    /// Opening the dialogue marks incoming messages read on the server.
    func load(api: APIClient) async {
        do {
            let data = try await api.social("messages", ["peer": peer.id, "includeTheme": "1"])
            // With includeTheme the server wraps the list: {messages, theme}.
            let list = data["messages"].isNull ? data : data["messages"]
            let server = list.array.map { ChatMessage($0) }
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

    func send(_ text: String, reply: ChatMessage?, session: AppSession) async {
        guard let me = session.myId else { return }
        let value = text.trimmingCharacters(in: .whitespacesAndNewlines)
        let files = attachments
        guard !value.isEmpty || !files.isEmpty else { return }
        let key = UUID().uuidString.lowercased()
        let preview = reply.map {
            ReplyPreview(id: $0.id, sender: $0.sender, name: $0.sender == me ? "Вы" : peer.name, text: $0.text.isEmpty ? "Вложение" : $0.text, unavailable: false)
        }
        var local = ChatMessage(localId: "message:\(me):\(key)", sender: me, recipient: peer.id, text: value, attachments: files, reply: preview)
        pending.append(local)
        messages.append(local)
        attachments = []
        var body: [String: Any] = [
            "id": peer.id,
            "text": value,
            "attachments": files.map(\.id),
            "key": key,
            "expectedSender": me,
        ]
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

    func forward(_ message: ChatMessage, to person: Person, session: AppSession) async {
        do {
            _ = try await session.api.socialPost("messageForward", [
                "ids": [message.id],
                "peer": peer.id,
                "recipient": person.id,
                "key": UUID().uuidString.lowercased(),
            ])
            Haptics.success()
            session.show("Переслано: \(person.name)")
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

/// A direct dialogue (app/chat-conversation.tsx): polling every 3 s while open.
struct ChatView: View {
    @EnvironmentObject private var session: AppSession
    @EnvironmentObject private var nav: Navigator
    let peer: Person
    @StateObject private var store: ChatStore
    @State private var text = ""
    @State private var replyTo: ChatMessage?
    @State private var editing: ChatMessage?
    @State private var picked: [PhotosPickerItem] = []
    @State private var viewer: MediaViewerState?
    @State private var reporting: ChatMessage?
    @State private var deleting: ChatMessage?
    @State private var forwarding: ChatMessage?
    @State private var atEnd = true
    @EnvironmentObject private var focus: MessageFocus
    @FocusState private var focused: Bool

    init(peer: Person) {
        self.peer = peer
        _store = StateObject(wrappedValue: ChatStore(peer: peer))
    }

    private var title: Identity { store.profile?.identity ?? peer.identity }
    private var presence: String? {
        guard let seen = store.profile?.lastSeen, seen > 0 else { return nil }
        return Format.presence(seen)
    }

    var body: some View {
        let _ = ChatProbe.count("chat body")
        ScrollViewReader { proxy in
            ScrollView {
                if ChatProbe.has("vstack") {
                    VStack(spacing: 0) { rows }
                        .padding(.horizontal, 8)
                        .padding(.vertical, 10)
                } else {
                    LazyVStack(spacing: 0) { rows }
                        .padding(.horizontal, 8)
                        .padding(.vertical, 10)
                }
            }
            .scrollDismissesKeyboard(.interactively)
            .modifier(ChatEndTracker(atEnd: $atEnd))
            .modifier(ChatFollowsEnd(proxy: proxy, last: store.messages.last?.id, atEnd: atEnd, bar: (replyTo ?? editing)?.id, messages: store.messages))
            .background(ChatBackdrop(palette: store.palette))
            .onChange(of: store.messages.last?.id) { id in
                guard let id else { return }
                withAnimation(Noct.quick) { proxy.scrollTo(id, anchor: .bottom) }
            }
            .onChange(of: store.loaded) { _ in
                if let id = store.messages.last?.id { proxy.scrollTo(id, anchor: .bottom) }
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
                    nav.push(.profile(peer.id))
                } label: {
                    VStack(spacing: 1) {
                        DisplayName(person: title, size: 16)
                        if let presence {
                            Text(presence)
                                .font(.system(size: 12))
                                .foregroundColor(Format.isOnline(store.profile?.lastSeen ?? 0) ? Noct.green : Noct.text48)
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
        .fullScreenCover(item: $viewer) { state in
            MediaViewer(state: state)
                .environmentObject(session)
        }
        .sheet(item: $forwarding) { message in
            ForwardSheet { person in
                Task { await store.forward(message, to: person, session: session) }
            }
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
                if message.sender == session.myId {
                    Button("Удалить у всех", role: .destructive) {
                        Task { await store.delete(message, everyone: true, session: session) }
                    }
                }
                Button("Удалить у меня", role: .destructive) {
                    Task { await store.delete(message, everyone: false, session: session) }
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
        .task {
            await store.loadMeta(api: session.api)
            await GiftCatalog.shared.load(api: session.api)
        }
        .task {
            while !Task.isCancelled {
                await store.load(api: session.api)
                try? await Task.sleep(nanoseconds: 3_000_000_000)
            }
        }
        .onDisappear { Task { await session.refreshCounters() } }
        #if DEBUG
        .task(id: store.loaded) { if store.loaded { await ChatProbe.run() } }
        #endif
    }

    /// The messages with a day line before the first of each day.
    @ViewBuilder private var rows: some View {
        if !store.loaded {
            LoadingRow()
        } else if store.messages.isEmpty {
            EmptyState(icon: "hand.wave", text: store.error ?? "Сообщений пока нет. Напиши первым.")
        }
        ForEach(Array(store.messages.enumerated()), id: \.element.id) { index, message in
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
            MessageBubble(
                message: message,
                mine: message.sender == session.myId,
                peer: title,
                palette: store.palette,
                joinsPrevious: joins,
                openMedia: { items, position in
                    viewer = MediaViewerState(items: items, index: position, title: senderName(message), date: message.created) {
                        deleting = message
                    }
                },
                onFocus: { frame in present(message, frame: frame, joinsPrevious: joins) },
                onReply: canWrite ? replyAction(message) : nil,
                onReact: canWrite ? reactAction(message) : nil
            )
            .padding(.top, joins ? 2 : 8)
            .id(message.id)
            .modifier(ChatEndRow(isLast: message.id == store.messages.last?.id, atEnd: $atEnd))
        }
    }

    private func senderName(_ message: ChatMessage) -> String {
        message.sender == session.myId ? session.me?.name ?? "Вы" : title.name
    }

    /// Consecutive messages of one sender within ten minutes form a group.
    static func joins(_ previous: ChatMessage, _ message: ChatMessage) -> Bool {
        previous.sender == message.sender && message.created - previous.created < 10 * 60 * 1000
    }

    private var canWrite: Bool { !session.readOnly && store.allowed && !store.blockedByMe }

    private func reply(to message: ChatMessage) {
        replyTo = message
        editing = nil
        focused = true
    }

    private func replyAction(_ message: ChatMessage) -> () -> Void {
        { reply(to: message) }
    }

    private func reactAction(_ message: ChatMessage) -> (String?) -> Void {
        { emoji in Task { await store.react(message, emoji: emoji, session: session) } }
    }

    /// Lifts a held message over the blurred screen, as in Telegram.
    private func present(_ message: ChatMessage, frame: CGRect, joinsPrevious: Bool) {
        let mine = message.sender == session.myId
        focus.present(MessageFocus.Item(
            frame: frame,
            mine: mine,
            bubble: AnyView(
                MessageBubble(
                    message: message,
                    mine: mine,
                    peer: title,
                    palette: store.palette,
                    joinsPrevious: joinsPrevious,
                    openMedia: { _, _ in },
                    standalone: true
                )
                .environmentObject(session)
            ),
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
        if mine && canWrite && message.gift == nil && message.forwardedName.isEmpty {
            list.append(MessageAction(title: "Изменить", icon: "pencil") {
                editing = message
                replyTo = nil
                text = message.text
                focused = true
            })
        }
        if !session.readOnly {
            let pinned = message.pinnedAt > 0
            list.append(MessageAction(title: pinned ? "Открепить" : "Закрепить", icon: pinned ? "pin.slash" : "pin") {
                Task { await store.pin(message, value: !pinned, session: session) }
            })
            list.append(MessageAction(title: "Переслать", icon: "arrowshape.turn.up.right") { forwarding = message })
        }
        list.append(MessageAction(title: "Удалить", icon: "trash", destructive: true) { deleting = message })
        if !mine {
            list.append(MessageAction(title: "Пожаловаться", icon: "flag", destructive: true) { reporting = message })
        }
        return list
    }

    @ViewBuilder private var bottom: some View {
        if store.blockedByMe {
            ComposerNotice(text: "Ты заблокировал(а) этого пользователя.", action: "Разблокировать") {
                Task { await store.setBlocked(false, session: session) }
            }
        } else if !store.allowed && store.loaded {
            ComposerNotice(text: "Пользователь ограничил входящие сообщения.")
        } else if session.readOnly {
            ComposerNotice(text: "В режиме только для чтения отправка недоступна.")
        } else {
            VStack(spacing: 0) {
                if let context = replyTo ?? editing {
                    ComposerContext(
                        title: editing != nil ? "Редактирование" : (context.sender == session.myId ? "Ответ себе" : "Ответ \(title.name)"),
                        text: context.text.isEmpty ? "Вложение" : context.text
                    ) {
                        if editing != nil { text = "" }
                        replyTo = nil
                        editing = nil
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
                ComposerBar(
                    text: $text,
                    placeholder: "Сообщение",
                    sending: false,
                    focus: $focused,
                    leading: editing == nil ? AnyView(attachButton) : nil,
                    accent: store.palette.accent
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
            }
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

/// A message as in Telegram, in the web's colours: the bubble hugs its
/// text, the time sits at the end of the last line and photos run edge to
/// edge with the time on glass.
struct MessageBubble: View {
    @EnvironmentObject private var session: AppSession
    let message: ChatMessage
    let mine: Bool
    /// The other person of the dialogue.
    let peer: Identity
    let palette: ChatPalette
    /// The previous message is from the same sender a moment earlier.
    let joinsPrevious: Bool
    let openMedia: ([MediaItem], Int) -> Void
    /// Only the bubble, drawn in the held-message overlay.
    var standalone = false
    /// Holding lifts the bubble with reactions and actions (MessageFocus).
    var onFocus: ((CGRect) -> Void)?
    /// Swiping left answers the message.
    var onReply: (() -> Void)?
    /// A tap on a reaction puts it (an emoji) or takes the viewer's back (nil).
    var onReact: ((String?) -> Void)?
    @State private var ratio: CGFloat?

    private let maxMedia: CGFloat = 270

    private var shape: BubbleShape { .message(mine: mine, joinsPrevious: joinsPrevious) }
    private var media: [MediaItem] {
        message.attachments.filter { $0.isImage || $0.isVideo }.map {
            MediaItem(JSON.object(["id": .string($0.id), "type": .string($0.type), "name": .string($0.name), "size": .number(Double($0.size))]))
        }
    }
    private var files: [ChatAttachment] { message.attachments.filter { !$0.isImage && !$0.isVideo } }
    private var reactions: [Reaction] { ChatProbe.has("nochips") ? [] : message.reactions }
    private var hasText: Bool { !message.text.isEmpty && message.gift == nil }
    private var status: MessageStatus? {
        guard mine else { return nil }
        if message.failed { return .failed }
        if message.pending { return .pending }
        return message.read ? .read : .sent
    }
    /// Nothing around the text or media: no quote, forward, files, gift or reactions.
    private var bare: Bool {
        message.reply == nil && message.forwardedName.isEmpty && files.isEmpty && message.gift == nil && reactions.isEmpty
    }
    private var emojiOnly: Bool { hasText && media.isEmpty && bare && Emoji.isOnly(message.text, limit: 3) }
    private var mediaOnly: Bool { !media.isEmpty && !hasText && bare }
    private var mediaSize: CGSize { ChatMedia.size(count: media.count, ratio: ratio ?? cachedRatio, maxWidth: maxMedia) }

    /// A photo already in memory gives its shape at once, without a jump.
    private var cachedRatio: CGFloat? {
        guard media.count == 1, let item = media.first, !item.isVideo,
              let url = session.api.mediaURL(item.path),
              let image = ImagePipeline.shared.cached(url, maxPixel: 900), image.size.height > 0 else { return nil }
        return image.size.width / image.size.height
    }

    /// A dialogue has two people, so every reaction has a face: the other
    /// person's and the viewer's own.
    private func reactors(_ reaction: Reaction) -> [Identity]? {
        var people: [Identity] = []
        if reaction.count - (reaction.own ? 1 : 0) == 1 { people.append(peer) }
        if reaction.own, let me = session.me?.identity { people.append(me) }
        return people.count == reaction.count ? people : nil
    }

    /// What VoiceOver says: forward and reply, the text or what is attached,
    /// the reactions and the time.
    private var spoken: String {
        var parts: [String] = []
        if !message.forwardedName.isEmpty { parts.append("Переслано от \(message.forwardedName)") }
        if let reply = message.reply {
            parts.append("Ответ на «\(reply.unavailable ? "удалённое сообщение" : (reply.text.isEmpty ? "вложение" : reply.text))»")
        }
        if let gift = message.gift {
            parts.append(GiftCatalog.shared.name(for: gift.giftId).map { "Подарок «\($0)»" } ?? "Подарок")
            if !gift.message.isEmpty { parts.append(gift.message) }
        } else if hasText {
            parts.append(message.text)
        }
        let videos = media.filter(\.isVideo).count, photos = media.count - videos
        if photos > 0 { parts.append(photos == 1 ? "Фото" : "Фото: \(photos)") }
        if videos > 0 { parts.append(videos == 1 ? "Видео" : "Видео: \(videos)") }
        parts += files.map { "Файл \($0.name)" }
        parts += SpokenBubble.reactions(reactions)
        parts.append(Format.clock(message.created))
        return parts.joined(separator: ", ")
    }

    private func time(onMedia: Bool = false) -> BubbleTime {
        BubbleTime(created: message.created, edited: message.editedAt > 0, status: status, onMedia: onMedia, mine: mine, pinned: message.pinnedAt > 0)
    }

    var body: some View {
        let _ = ChatProbe.count("bubble body")
        if standalone {
            content
                .opacity(message.pending ? 0.7 : 1)
                .task(id: media.first?.path) { await measure() }
        } else {
            HStack(spacing: 0) {
                if mine { Spacer(minLength: 52) }
                content
                    .opacity(message.pending ? 0.7 : 1)
                    .modifier(SpokenBubble(label: spoken))
                    .accessibilityIdentifier("message-" + message.id)
                    .accessibilityAction(named: "Ответить") { onReply?() }
                    .modifier(HoldToFocus(action: message.pending || ChatProbe.has("nohold") ? nil : onFocus))
                if !mine { Spacer(minLength: 52) }
            }
            .modifier(SwipeToReply(action: message.pending || ChatProbe.has("noswipe") ? nil : onReply))
            #if DEBUG
            .onAppear { ChatProbe.count("appear " + ChatProbe.short(message.id)) }
            .onDisappear { ChatProbe.count("disappear " + ChatProbe.short(message.id)) }
            #endif
            .task(id: media.first?.path) { await measure() }
        }
    }

    @ViewBuilder private var content: some View {
        if emojiOnly {
            VStack(alignment: mine ? .trailing : .leading, spacing: 2) {
                Text(message.text).font(.system(size: 46))
                time(onMedia: true)
            }
        } else if mediaOnly {
            ChatMedia(items: media, size: mediaSize) { openMedia(media, $0) }
                .clipShape(shape)
                .overlay(alignment: .bottomTrailing) {
                    time(onMedia: true).padding(7)
                }
        } else {
            bubble
        }
    }

    #if DEBUG
    /// The «plainstack» probe stacks the parts without BubbleStack.
    private var column: AnyLayout {
        ChatProbe.has("plainstack") ? AnyLayout(VStackLayout(alignment: .leading, spacing: 0)) : AnyLayout(BubbleStack())
    }
    #else
    private var column: BubbleStack { BubbleStack() }
    #endif

    private var bubble: some View {
        column {
            if !message.forwardedName.isEmpty || message.reply != nil {
                VStack(alignment: .leading, spacing: 6) {
                    if !message.forwardedName.isEmpty {
                        Text("Переслано от \(message.forwardedName)")
                            .font(.system(size: 13, weight: .medium))
                            .foregroundColor(palette.accent)
                            .lineLimit(1)
                    }
                    if let reply = message.reply {
                        BubbleQuote(
                            name: reply.sender == session.myId ? "Вы" : (reply.name.isEmpty ? peer.name : reply.name),
                            text: reply.unavailable ? "Сообщение удалено" : PremiumEmoji.replace(reply.text.isEmpty ? "Вложение" : reply.text),
                            accent: palette.accent
                        )
                    }
                }
                .padding(.horizontal, 8)
                .padding(.top, 8)
                .padding(.bottom, media.isEmpty ? 0 : 8)
            }
            if !media.isEmpty {
                ChatMedia(items: media, size: mediaSize) { openMedia(media, $0) }
            }
            if let gift = message.gift {
                giftCard(gift)
                    .padding(.horizontal, 10)
                    .padding(.top, 10)
            }
            ForEach(files) { file in
                fileRow(file)
                    .padding(.horizontal, 10)
                    .padding(.top, 8)
            }
            footer
        }
        .frame(width: media.isEmpty ? nil : mediaSize.width)
        .background(shape.fill(mine ? palette.outgoing : palette.incoming))
        .clipShape(shape)
        .overlay(shape.stroke(Color.white.opacity(0.06), lineWidth: 1))
    }

    @ViewBuilder private var footer: some View {
        if hasText && reactions.isEmpty {
            InlineTimeText(text: message.text, time: time(), accent: palette.accent)
                .padding(.horizontal, 12)
                .padding(.vertical, 7)
        } else if hasText {
            VStack(alignment: .leading, spacing: 6) {
                InlineTimeText(text: message.text, accent: palette.accent)
                HStack(alignment: .bottom, spacing: 8) {
                    BubbleReactions(reactions: reactions, accent: palette.accent, reactors: reactors, toggle: onReact)
                    Spacer(minLength: 4)
                    time()
                }
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 7)
        } else if !reactions.isEmpty {
            HStack(alignment: .bottom, spacing: 8) {
                BubbleReactions(reactions: reactions, accent: palette.accent, reactors: reactors, toggle: onReact)
                Spacer(minLength: 4)
                time()
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 7)
        } else {
            HStack(spacing: 0) {
                Spacer(minLength: 0)
                time()
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 6)
        }
    }

    private func fileRow(_ file: ChatAttachment) -> some View {
        Group {
            if let url = session.api.mediaURL(file.path + "?download=1") {
                Link(destination: url) {
                    HStack(spacing: 10) {
                        Image(systemName: "doc.fill")
                            .font(.system(size: 18))
                            .foregroundColor(Color.black.opacity(0.8))
                            .frame(width: 40, height: 40)
                            .background(Circle().fill(palette.accent))
                        VStack(alignment: .leading, spacing: 2) {
                            Text(file.name).font(.system(size: 15, weight: .medium)).lineLimit(1)
                            Text(Format.fileSize(file.size)).font(.system(size: 12)).foregroundColor(Noct.text48)
                        }
                        Spacer(minLength: 0)
                    }
                    .foregroundColor(.white)
                }
            }
        }
    }

    private func giftCard(_ gift: ChatGift) -> some View {
        VStack(spacing: 6) {
            giftArt(gift)
                .frame(width: 150, height: 150)
                .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
            Text(GiftCatalog.shared.name(for: gift.giftId).map { "Подарок «\($0)»" } ?? "Подарок")
                .font(.system(size: 15, weight: .semibold))
            HStack(spacing: 4) {
                Image("StarsIcon").resizable().scaledToFit().frame(width: 14, height: 14)
                Text("\(gift.price)").font(.system(size: 13, weight: .semibold)).foregroundColor(Noct.gold)
            }
            if !gift.message.isEmpty {
                Text(PremiumEmoji.replace(gift.message))
                    .font(.system(size: 14))
                    .foregroundColor(Noct.text75)
                    .multilineTextAlignment(.center)
            }
        }
        .frame(maxWidth: .infinity)
    }

    @ViewBuilder private func giftArt(_ gift: ChatGift) -> some View {
        let path = gift.collectible.map { "/assets/gifts/\($0.modelAsset).webp" } ?? "/assets/gifts/\(gift.giftId).webp"
        if ChatProbe.has("nogift") {
            // Probe: the picture alone, no gift player.
            RemoteImage(url: session.api.mediaURL(path), maxPixel: 360, contentMode: .fit, placeholder: .clear)
        } else {
            GiftArt(path: path, collectible: gift.collectible, animated: !ChatProbe.has("stillgift"), featured: true)
        }
    }

    private func measure() async {
        guard ratio == nil, media.count == 1, let item = media.first, let url = session.api.mediaURL(item.path) else { return }
        let image = item.isVideo
            ? await VideoThumbnails.shared.thumbnail(for: url)
            : await ImagePipeline.shared.image(for: url, maxPixel: 900)
        guard let image, image.size.height > 0 else { return }
        ratio = image.size.width / image.size.height
        #if DEBUG
        ChatProbe.count("ratio " + ChatProbe.short(message.id))
        #endif
    }
}

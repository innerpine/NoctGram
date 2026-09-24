import PhotosUI
import SwiftUI
import UIKit

let messageReactions = ["👍", "❤️", "😂", "🔥", "🎉", "🤯", "😢", "👎"]

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

    func react(_ message: ChatMessage, emoji: String, session: AppSession) async {
        do {
            _ = try await session.api.socialPost("messageReaction", [
                "id": message.id,
                "peer": peer.id,
                "emoji": emoji,
                "expectedSender": session.myId ?? "",
            ])
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
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(spacing: 0) {
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
                                .glassCapsule()
                                .padding(.top, 10)
                                .padding(.bottom, 2)
                        }
                        MessageBubble(
                            message: message,
                            mine: message.sender == session.myId,
                            peerName: peer.name,
                            palette: store.palette,
                            joinsPrevious: joins,
                            openMedia: { items, position in viewer = MediaViewerState(items: items, index: position) }
                        ) {
                            menu(message)
                        }
                        .padding(.top, joins ? 2 : 8)
                        .id(message.id)
                    }
                }
                .padding(.horizontal, 8)
                .padding(.vertical, 10)
            }
            .scrollDismissesKeyboard(.interactively)
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
            MediaViewer(items: state.items, index: state.index)
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
    }

    /// Consecutive messages of one sender within ten minutes form a group.
    static func joins(_ previous: ChatMessage, _ message: ChatMessage) -> Bool {
        previous.sender == message.sender && message.created - previous.created < 10 * 60 * 1000
    }

    @ViewBuilder private func menu(_ message: ChatMessage) -> some View {
        let mine = message.sender == session.myId
        if !message.pending {
            Button {
                replyTo = message
                editing = nil
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
        }
        if !message.text.isEmpty {
            Button {
                session.copy(message.text)
            } label: {
                Label("Скопировать", systemImage: "doc.on.doc")
            }
        }
        if mine && message.gift == nil && message.forwardedName.isEmpty && !message.pending {
            Button {
                editing = message
                replyTo = nil
                text = message.text
                focused = true
            } label: {
                Label("Изменить", systemImage: "pencil")
            }
        }
        if !message.pending {
            Button(role: .destructive) {
                deleting = message
            } label: {
                Label("Удалить", systemImage: "trash")
            }
        }
        if !mine && !message.pending {
            Button {
                reporting = message
            } label: {
                Label("Пожаловаться", systemImage: "flag")
            }
        }
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
                        title: editing != nil ? "Редактирование" : (context.sender == session.myId ? "Ответ себе" : "Ответ \(peer.name)"),
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
struct MessageBubble<Menu: View>: View {
    @EnvironmentObject private var session: AppSession
    let message: ChatMessage
    let mine: Bool
    let peerName: String
    let palette: ChatPalette
    /// The previous message is from the same sender a moment earlier.
    let joinsPrevious: Bool
    let openMedia: ([MediaItem], Int) -> Void
    @ViewBuilder let menu: () -> Menu
    @State private var ratio: CGFloat?

    private let maxMedia: CGFloat = 270

    private var shape: BubbleShape { .message(mine: mine, joinsPrevious: joinsPrevious) }
    private var media: [MediaItem] {
        message.attachments.filter { $0.isImage || $0.isVideo }.map {
            MediaItem(JSON.object(["id": .string($0.id), "type": .string($0.type), "name": .string($0.name)]))
        }
    }
    private var files: [ChatAttachment] { message.attachments.filter { !$0.isImage && !$0.isVideo } }
    private var hasText: Bool { !message.text.isEmpty && message.gift == nil }
    private var status: MessageStatus? {
        guard mine else { return nil }
        if message.failed { return .failed }
        if message.pending { return .pending }
        return message.read ? .read : .sent
    }
    /// Nothing around the text or media: no quote, forward, files, gift or reactions.
    private var bare: Bool {
        message.reply == nil && message.forwardedName.isEmpty && files.isEmpty && message.gift == nil && message.reactions.isEmpty
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

    private func time(onMedia: Bool = false) -> BubbleTime {
        BubbleTime(created: message.created, edited: message.editedAt > 0, status: status, onMedia: onMedia, mine: mine)
    }

    var body: some View {
        HStack(spacing: 0) {
            if mine { Spacer(minLength: 52) }
            content
                .contentShape(.contextMenuPreview, shape)
                .contextMenu { menu() }
                .opacity(message.pending ? 0.7 : 1)
            if !mine { Spacer(minLength: 52) }
        }
        .task(id: media.first?.path) { await measure() }
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

    private var bubble: some View {
        BubbleStack() {
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
                            name: reply.sender == session.myId ? "Вы" : (reply.name.isEmpty ? peerName : reply.name),
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
        if hasText && message.reactions.isEmpty {
            InlineTimeText(text: message.text, time: time(), accent: palette.accent)
                .padding(.horizontal, 12)
                .padding(.vertical, 7)
        } else if hasText {
            VStack(alignment: .leading, spacing: 6) {
                InlineTimeText(text: message.text, accent: palette.accent)
                HStack(alignment: .bottom, spacing: 8) {
                    BubbleReactions(reactions: message.reactions, accent: palette.accent)
                    Spacer(minLength: 4)
                    time()
                }
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 7)
        } else if !message.reactions.isEmpty {
            HStack(alignment: .bottom, spacing: 8) {
                BubbleReactions(reactions: message.reactions, accent: palette.accent)
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
            GiftArt(
                path: gift.collectible.map { "/assets/gifts/\($0.modelAsset).webp" } ?? "/assets/gifts/\(gift.giftId).webp",
                collectible: gift.collectible
            )
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

    private func measure() async {
        guard ratio == nil, media.count == 1, let item = media.first, let url = session.api.mediaURL(item.path) else { return }
        let image = item.isVideo
            ? await VideoThumbnails.shared.thumbnail(for: url)
            : await ImagePipeline.shared.image(for: url, maxPixel: 900)
        guard let image, image.size.height > 0 else { return }
        ratio = image.size.width / image.size.height
    }
}

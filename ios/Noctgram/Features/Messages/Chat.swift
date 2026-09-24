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

    private var pending: [ChatMessage] = []

    init(peer: Person) {
        self.peer = peer
    }

    /// Opening the dialogue marks incoming messages read on the server.
    func load(api: APIClient) async {
        do {
            let data = try await api.social("messages", ["peer": peer.id])
            let server = data.array.map { ChatMessage($0) }
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
                LazyVStack(spacing: 6) {
                    if !store.loaded {
                        LoadingRow()
                    } else if store.messages.isEmpty {
                        EmptyState(icon: "hand.wave", text: store.error ?? "Сообщений пока нет. Напиши первым.")
                    }
                    ForEach(Array(store.messages.enumerated()), id: \.element.id) { index, message in
                        if index == 0 || !Calendar.current.isDate(Format.date(message.created), inSameDayAs: Format.date(store.messages[index - 1].created)) {
                            Text(Format.day(message.created))
                                .font(.system(size: 12, weight: .medium))
                                .foregroundColor(Noct.text48)
                                .padding(.horizontal, 10)
                                .padding(.vertical, 4)
                                .background(Capsule().fill(Noct.fill))
                                .padding(.vertical, 8)
                        }
                        MessageBubble(
                            message: message,
                            mine: message.sender == session.myId,
                            peerName: peer.name,
                            openMedia: { items, position in viewer = MediaViewerState(items: items, index: position) }
                        )
                        .id(message.id)
                        .contextMenu { menu(message) }
                    }
                }
                .padding(.horizontal, 10)
                .padding(.vertical, 12)
            }
            .scrollDismissesKeyboard(.interactively)
            .background(Noct.background)
            .onChange(of: store.messages.last?.id) { id in
                guard let id else { return }
                withAnimation(Noct.quick) { proxy.scrollTo(id, anchor: .bottom) }
            }
            .onChange(of: store.loaded) { _ in
                if let id = store.messages.last?.id { proxy.scrollTo(id, anchor: .bottom) }
            }
        }
        .safeAreaInset(edge: .bottom) { bottom }
        .navigationBarTitleDisplayMode(.inline)
        .toolbar(.hidden, for: .tabBar)
        .toolbar {
            ToolbarItem(placement: .principal) {
                Button {
                    nav.push(.profile(peer.id))
                } label: {
                    HStack(spacing: 10) {
                        AvatarView(person: title, size: 32)
                        VStack(alignment: .leading, spacing: 1) {
                            DisplayName(person: title, size: 15)
                            if let presence {
                                Text(presence)
                                    .font(.system(size: 11))
                                    .foregroundColor(Format.isOnline(store.profile?.lastSeen ?? 0) ? Noct.green : Noct.text48)
                            }
                        }
                    }
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
                    Image(systemName: "ellipsis.circle")
                }
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
            notice("Ты заблокировал(а) этого пользователя.", action: "Разблокировать") {
                Task { await store.setBlocked(false, session: session) }
            }
        } else if !store.allowed && store.loaded {
            notice("Пользователь ограничил входящие сообщения.", action: nil, perform: nil)
        } else if session.readOnly {
            notice("В режиме только для чтения отправка недоступна.", action: nil, perform: nil)
        } else {
            VStack(spacing: 0) {
                if let context = replyTo ?? editing {
                    HStack(spacing: 10) {
                        Rectangle().fill(Color.white).frame(width: 2, height: 30)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(editing != nil ? "Редактирование" : (context.sender == session.myId ? "Ответ себе" : "Ответ \(peer.name)"))
                                .font(.system(size: 12, weight: .semibold))
                            Text(context.text.isEmpty ? "Вложение" : context.text)
                                .font(.system(size: 12))
                                .foregroundColor(Noct.text60)
                                .lineLimit(1)
                        }
                        Spacer()
                        Button {
                            if editing != nil { text = "" }
                            replyTo = nil
                            editing = nil
                        } label: {
                            Image(systemName: "xmark").font(.system(size: 13, weight: .semibold)).foregroundColor(Noct.text60)
                        }
                    }
                    .padding(.horizontal, 16)
                    .padding(.vertical, 8)
                    .background(Noct.card)
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
                                    .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
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
                                ProgressView().tint(.white).frame(width: 64, height: 64)
                            }
                        }
                        .padding(.horizontal, 12)
                        .padding(.top, 8)
                    }
                    .background(Color.black)
                }
                ComposerBar(
                    text: $text,
                    placeholder: "Сообщение",
                    sending: false,
                    focus: $focused,
                    leading: editing == nil ? AnyView(attachButton) : nil
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
                .foregroundColor(Noct.text75)
                .frame(width: 36, height: 40)
        }
    }

    private func notice(_ text: String, action: String?, perform: (() -> Void)?) -> some View {
        VStack(spacing: 8) {
            Text(text)
                .font(.system(size: 14))
                .foregroundColor(Noct.text60)
                .multilineTextAlignment(.center)
            if let action, let perform {
                Button(action, action: perform)
                    .buttonStyle(SecondaryButtonStyle())
            }
        }
        .frame(maxWidth: .infinity)
        .padding(16)
        .background(Color.black)
        .overlay(alignment: .top) { Rectangle().fill(Noct.border).frame(height: 0.5) }
    }
}

struct MessageBubble: View {
    @EnvironmentObject private var session: AppSession
    let message: ChatMessage
    let mine: Bool
    let peerName: String
    let openMedia: ([MediaItem], Int) -> Void

    var body: some View {
        HStack {
            if mine { Spacer(minLength: 48) }
            VStack(alignment: mine ? .trailing : .leading, spacing: 4) {
                VStack(alignment: .leading, spacing: 6) {
                    if !message.forwardedName.isEmpty {
                        Text("Переслано от \(message.forwardedName)")
                            .font(.system(size: 12, weight: .medium))
                            .foregroundColor(Noct.text60)
                    }
                    if let reply = message.reply {
                        HStack(spacing: 8) {
                            Rectangle().fill(Color.white.opacity(0.7)).frame(width: 2)
                            VStack(alignment: .leading, spacing: 1) {
                                Text(reply.sender == session.myId ? "Вы" : (reply.name.isEmpty ? peerName : reply.name))
                                    .font(.system(size: 12, weight: .semibold))
                                Text(PremiumEmoji.replace(reply.text))
                                    .font(.system(size: 12))
                                    .foregroundColor(Noct.text60)
                                    .lineLimit(1)
                            }
                        }
                        .fixedSize(horizontal: false, vertical: true)
                    }
                    if let gift = message.gift {
                        giftCard(gift)
                    }
                    if !message.attachments.isEmpty {
                        attachmentsView
                    }
                    if !message.text.isEmpty && message.gift == nil {
                        LinkedText(text: message.text, size: 15, color: .white, lineSpacing: 2)
                    }
                    HStack(spacing: 4) {
                        Spacer(minLength: 0)
                        if message.editedAt > 0 {
                            Text("изменено").font(.system(size: 11)).foregroundColor(Noct.text48)
                        }
                        Text(Format.clock(message.created))
                            .font(.system(size: 11))
                            .foregroundColor(Noct.text48)
                        if mine {
                            if message.failed {
                                Image(systemName: "exclamationmark.circle").foregroundColor(Noct.red)
                            } else if message.pending {
                                Image(systemName: "clock").foregroundColor(Noct.text48)
                            } else {
                                Image(systemName: message.read ? "checkmark.circle.fill" : "checkmark.circle")
                                    .foregroundColor(message.read ? .white : Noct.text48)
                            }
                        }
                    }
                    .font(.system(size: 10))
                }
                .padding(.horizontal, 12)
                .padding(.vertical, 8)
                .background(
                    RoundedRectangle(cornerRadius: 18, style: .continuous)
                        .fill(mine ? Noct.outgoing : Noct.incoming)
                )
                .overlay(
                    RoundedRectangle(cornerRadius: 18, style: .continuous)
                        .stroke(mine ? Color.clear : Noct.border, lineWidth: 1)
                )
                if !message.reactions.isEmpty {
                    HStack(spacing: 4) {
                        ForEach(message.reactions, id: \.emoji) { reaction in
                            Text("\(reaction.emoji) \(reaction.count)")
                                .font(.system(size: 12, weight: .medium))
                                .padding(.horizontal, 8)
                                .padding(.vertical, 3)
                                .background(Capsule().fill(reaction.own ? Noct.fillHeavy : Noct.fill))
                                .overlay(Capsule().stroke(reaction.own ? Color.white.opacity(0.4) : Color.clear, lineWidth: 1))
                        }
                    }
                }
            }
            if !mine { Spacer(minLength: 48) }
        }
        .opacity(message.pending ? 0.7 : 1)
    }

    private var attachmentsView: some View {
        let media = message.attachments.filter { $0.isImage || $0.isVideo }
        let files = message.attachments.filter { !$0.isImage && !$0.isVideo }
        let items = media.map { MediaItem(JSON.object(["id": .string($0.id), "type": .string($0.type), "name": .string($0.name)])) }
        return VStack(alignment: .leading, spacing: 6) {
            if !items.isEmpty {
                MediaGrid(items: Array(items.prefix(4))) { index in openMedia(items, index) }
                    .frame(width: 240)
                if items.count > 4 {
                    Text("+\(items.count - 4) ещё")
                        .font(.system(size: 12))
                        .foregroundColor(Noct.text60)
                }
            }
            ForEach(files) { file in
                if let url = session.api.mediaURL(file.path + "?download=1") {
                    Link(destination: url) {
                        HStack(spacing: 10) {
                            Image(systemName: "doc.fill")
                                .font(.system(size: 20))
                                .frame(width: 40, height: 40)
                                .background(Circle().fill(Noct.fillStrong))
                            VStack(alignment: .leading, spacing: 2) {
                                Text(file.name).font(.system(size: 14, weight: .medium)).lineLimit(1)
                                Text(Format.fileSize(file.size)).font(.system(size: 12)).foregroundColor(Noct.text48)
                            }
                        }
                        .foregroundColor(.white)
                    }
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
            .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
            Text(GiftCatalog.shared.name(for: gift.giftId).map { "Подарок «\($0)»" } ?? "Подарок")
                .font(.system(size: 14, weight: .semibold))
            HStack(spacing: 4) {
                Image("StarsIcon").resizable().scaledToFit().frame(width: 13, height: 13)
                Text("\(gift.price)").font(.system(size: 12, weight: .semibold)).foregroundColor(Noct.gold)
            }
            if !gift.message.isEmpty {
                Text(PremiumEmoji.replace(gift.message))
                    .font(.system(size: 13))
                    .foregroundColor(Noct.text75)
                    .multilineTextAlignment(.center)
            }
        }
        .frame(maxWidth: 220)
    }
}

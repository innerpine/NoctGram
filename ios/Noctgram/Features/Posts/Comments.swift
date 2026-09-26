import SwiftUI

@MainActor
final class CommentsStore: ObservableObject {
    @Published var comments: [Comment] = []
    @Published var loading = false
    @Published var hasOlder = false
    @Published var error: String?
    @Published var sending = false

    /// The latest 50, then older pages by (created, id) cursor.
    func load(postId: String, api: APIClient) async {
        loading = true
        defer { loading = false }
        do {
            let data = try await api.social("comments", ["post": postId])
            comments = data.array.map { Comment($0) }
            hasOlder = comments.count >= 50
            error = nil
        } catch {
            self.error = error.userMessage
        }
    }

    func loadOlder(postId: String, api: APIClient) async {
        guard let first = comments.first, !loading else { return }
        loading = true
        defer { loading = false }
        do {
            let data = try await api.social("comments", [
                "post": postId,
                "before": String(Int64(first.created)),
                "beforeId": first.id,
            ])
            let older = data.array.map { Comment($0) }
            let known = Set(comments.map(\.id))
            comments.insert(contentsOf: older.filter { !known.contains($0.id) }, at: 0)
            hasOlder = older.count >= 50
        } catch {
            self.error = error.userMessage
        }
    }

    /// Posts a comment, or an answer to `replyTo`, which the server keeps
    /// under the same post (lib/comment-replies.ts).
    func send(_ text: String, replyTo: Comment? = nil, post: Post, session: AppSession) async -> Bool {
        let value = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !value.isEmpty, !sending else { return false }
        sending = true
        defer { sending = false }
        do {
            var body: [String: Any] = ["id": post.id, "text": value]
            if let replyTo { body["replyTo"] = replyTo.id }
            let data = try await session.api.socialPost("comment", body)
            if data["id"].string != nil, data["text"].string != nil {
                comments.append(Comment(data))
                var next = post
                next.comments += 1
                PostBus.shared.send(.updated(next))
            } else {
                // 202: held by anti-spam review (ANTISPAM.md).
                session.show("Комментарий отправлен на проверку")
            }
            return true
        } catch {
            session.report(error)
            return false
        }
    }

    func delete(_ comment: Comment, post: Post, session: AppSession) async {
        do {
            _ = try await session.api.socialPost("deleteComment", ["id": comment.id])
            comments.removeAll { $0.id == comment.id }
            var next = post
            next.comments = max(0, next.comments - 1)
            PostBus.shared.send(.updated(next))
        } catch {
            session.report(error)
        }
    }

    func report(_ comment: Comment, reason: String, session: AppSession) async {
        do {
            _ = try await session.api.socialPost("reportComment", ["id": comment.id, "reason": reason])
            session.show("Жалоба отправлена модераторам")
        } catch {
            session.report(error)
        }
    }
}

/// A comment: the author, the comment it answers (a quote that leads to
/// it), the text and «Ответить». Swiping it to the left answers it, as a
/// message in a chat.
struct CommentRow: View {
    @EnvironmentObject private var session: AppSession
    let comment: Comment
    /// Lit for a moment after a quote led here.
    var highlighted = false
    let onProfile: (String) -> Void
    /// Nil where one cannot answer (read-only).
    var onReply: (() -> Void)?
    var onJump: (String) -> Void = { _ in }
    let onDelete: () -> Void
    let onReport: (String) -> Void
    @State private var showReport = false

    private var accent: Color { session.me?.appearance.accent ?? Noct.lilac }

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            Button {
                onProfile(comment.userId)
            } label: {
                AvatarView(person: comment.author, size: 34)
            }
            .buttonStyle(PressableStyle())
            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 6) {
                    Button {
                        onProfile(comment.userId)
                    } label: {
                        DisplayName(person: comment.author, size: 14)
                    }
                    .buttonStyle(PressableStyle())
                    Text(Format.ago(comment.created))
                        .font(.system(size: 12))
                        .foregroundColor(Noct.text48)
                    Spacer(minLength: 0)
                    Menu {
                        if let onReply {
                            Button(action: onReply) {
                                Label("Ответить", systemImage: "arrowshape.turn.up.left")
                            }
                        }
                        Button {
                            session.copy(comment.text)
                        } label: {
                            Label("Скопировать текст", systemImage: "doc.on.doc")
                        }
                        if comment.userId == session.myId {
                            Button(role: .destructive, action: onDelete) {
                                Label("Удалить", systemImage: "trash")
                            }
                        } else {
                            Button {
                                showReport = true
                            } label: {
                                Label("Пожаловаться", systemImage: "flag")
                            }
                        }
                    } label: {
                        Image(systemName: "ellipsis")
                            .font(.system(size: 13, weight: .semibold))
                            .foregroundColor(Noct.text48)
                            .frame(width: 28, height: 22)
                            .contentShape(Rectangle())
                    }
                }
                if !comment.replyTo.isEmpty {
                    quote
                        .padding(.top, 2)
                }
                LinkedText(text: comment.text, size: 14, color: Noct.text75, lineSpacing: 3)
                if let onReply {
                    Button("Ответить", action: onReply)
                        .font(.system(size: 13, weight: .medium))
                        .foregroundColor(Noct.text48)
                        .buttonStyle(PressableStyle())
                        .padding(.top, 2)
                        .accessibilityIdentifier("comment-reply-" + comment.id)
                }
            }
        }
        .background(
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .fill(Color.white.opacity(highlighted ? 0.08 : 0))
                .padding(-8)
        )
        .animation(.easeOut(duration: 0.35), value: highlighted)
        .modifier(SwipeToReply(action: onReply))
        .confirmationDialog("Пожаловаться на комментарий", isPresented: $showReport, titleVisibility: .visible) {
            ForEach(ReportReason.all, id: \.self) { reason in
                Button(reason) { onReport(reason) }
            }
            Button("Отмена", role: .cancel) {}
        }
    }

    /// The answered comment, as a chat reply quotes a message.
    private var quote: some View {
        Button {
            onJump(comment.replyTo)
        } label: {
            BubbleQuote(
                name: comment.reply?.name ?? "Комментарий удалён",
                text: comment.reply.map { PremiumEmoji.replace($0.text) } ?? "Его удалили, или он недоступен",
                accent: comment.reply == nil ? Noct.text48 : accent
            )
        }
        .buttonStyle(PressableStyle())
        .disabled(comment.reply == nil)
        .accessibilityLabel(comment.reply.map { "Ответ \($0.name): \($0.text)" } ?? "Ответ на удалённый комментарий")
    }
}

/// Growing glass field with a send button; used by comments and chats.
/// It floats over the content like the iOS 26 Messages composer.
struct ComposerBar: View {
    @Binding var text: String
    var placeholder: String
    var sending: Bool
    var focus: FocusState<Bool>.Binding
    var leading: AnyView?
    /// Fill of the send button (a chat theme's accent).
    var accent: Color = .white
    let send: () -> Void

    var body: some View {
        GlassGroup(spacing: 6) {
            HStack(alignment: .bottom, spacing: 8) {
                if let leading { leading }
                TextField(placeholder, text: $text, axis: .vertical)
                    .lineLimit(1...6)
                    .font(.system(size: 16))
                    .focused(focus)
                    .accessibilityIdentifier("composer-field")
                    .padding(.horizontal, 16)
                    .padding(.vertical, 11)
                    .frame(minHeight: 44)
                    .glassRect(22)
                Button(action: send) {
                    ZStack {
                        if sending {
                            ProgressView().tint(.black)
                        } else {
                            Image(systemName: "arrow.up")
                                .font(.system(size: 17, weight: .bold))
                        }
                    }
                }
                .buttonStyle(CircleButtonStyle(size: 44, tint: canSend || sending ? accent : nil))
                .disabled(!canSend)
                .accessibilityLabel("Отправить")
            }
        }
        .padding(.horizontal, 12)
        .padding(.top, 6)
        .padding(.bottom, 8)
    }

    private var canSend: Bool {
        !sending && !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }
}

/// «Ответ …» or «Редактирование» strip above a composer.
struct ComposerContext: View {
    let title: String
    let text: String
    let close: () -> Void

    var body: some View {
        HStack(spacing: 10) {
            Capsule().fill(Color.white).frame(width: 3, height: 30)
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(.system(size: 12, weight: .semibold))
                Text(text)
                    .font(.system(size: 12))
                    .foregroundColor(Noct.text60)
                    .lineLimit(1)
            }
            Spacer(minLength: 0)
            Button(action: close) {
                Image(systemName: "xmark")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundColor(Noct.text60)
                    .frame(width: 32, height: 32)
                    .contentShape(Rectangle())
            }
            .buttonStyle(PressableStyle())
            .accessibilityLabel("Отменить")
        }
        .padding(.leading, 14)
        .padding(.trailing, 6)
        .padding(.vertical, 6)
        .glassRect(18)
        .padding(.horizontal, 12)
        .padding(.top, 6)
    }
}

/// Why sending is unavailable, on glass in place of the composer.
struct ComposerNotice: View {
    let text: String
    var action: String?
    var perform: (() -> Void)?

    var body: some View {
        VStack(spacing: 10) {
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
        .padding(14)
        .glassRect(22)
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
    }
}

struct CommentsSheet: View {
    @EnvironmentObject private var session: AppSession
    @EnvironmentObject private var nav: Navigator
    @Environment(\.dismiss) private var dismiss
    let post: Post
    @StateObject private var store = CommentsStore()
    @State private var text = ""
    @FocusState private var focused: Bool
    /// The comment being answered.
    @State private var replying: Comment?
    /// The comment a quote just led to.
    @State private var glow: String?

    var body: some View {
        NavigationStack {
            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 18) {
                        if store.hasOlder {
                            Button("Показать предыдущие") {
                                Task { await store.loadOlder(postId: post.id, api: session.api) }
                            }
                            .font(.system(size: 14, weight: .medium))
                            .foregroundColor(Noct.text75)
                        }
                        if store.loading && store.comments.isEmpty {
                            LoadingRow()
                        } else if store.comments.isEmpty {
                            EmptyState(icon: "bubble.left", text: store.error ?? "Комментариев пока нет. Начни разговор.")
                        }
                        ForEach(store.comments) { comment in
                            CommentRow(
                                comment: comment,
                                highlighted: glow == comment.id,
                                onProfile: { id in
                                    dismiss()
                                    nav.push(.profile(id))
                                },
                                onReply: session.readOnly ? nil : { reply(to: comment) },
                                onJump: { id in jump(to: id, proxy: proxy) },
                                onDelete: {
                                    if replying?.id == comment.id { replying = nil }
                                    Task { await store.delete(comment, post: post, session: session) }
                                },
                                onReport: { reason in Task { await store.report(comment, reason: reason, session: session) } }
                            )
                            .id(comment.id)
                        }
                    }
                    .padding(16)
                }
                .scrollDismissesKeyboard(.interactively)
                .onChange(of: store.comments.last?.id) { id in
                    if let id { withAnimation { proxy.scrollTo(id, anchor: .bottom) } }
                }
            }
            .sheetSurface()
            .glassBottomBar {
                if !session.readOnly {
                    VStack(spacing: 0) {
                        if let replying {
                            ComposerContext(title: "Ответ \(replying.name)", text: PremiumEmoji.replace(replying.text)) {
                                withAnimation(Noct.quick) { self.replying = nil }
                            }
                            .transition(.move(edge: .bottom).combined(with: .opacity))
                        }
                        ComposerBar(
                            text: $text,
                            placeholder: replying == nil ? "Написать комментарий…" : "Ответить…",
                            sending: store.sending,
                            focus: $focused,
                            leading: nil
                        ) {
                            Task {
                                if await store.send(text, replyTo: replying, post: post, session: session) {
                                    text = ""
                                    withAnimation(Noct.quick) { replying = nil }
                                }
                            }
                        }
                    }
                }
            }
            .navigationTitle("Комментарии")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Закрыть") { dismiss() }
                }
            }
        }
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
        .task {
            await store.load(postId: post.id, api: session.api)
            #if DEBUG
            debugReply()
            #endif
        }
    }

    private func reply(to comment: Comment) {
        withAnimation(Noct.quick) { replying = comment }
        focused = true
    }

    /// A quote leads to the comment it answers and lights it for a moment.
    private func jump(to id: String, proxy: ScrollViewProxy) {
        guard store.comments.contains(where: { $0.id == id }) else {
            session.show("Этот комментарий выше — открой предыдущие")
            return
        }
        withAnimation(Noct.motion) { proxy.scrollTo(id, anchor: .center) }
        glow = id
        Task {
            try? await Task.sleep(nanoseconds: 1_600_000_000)
            if glow == id { glow = nil }
        }
    }

    #if DEBUG
    /// Screenshot hook (ios/Tests): `-noct.debugSheet comments-reply`
    /// starts an answer to the last comment of someone else.
    private func debugReply() {
        guard UserDefaults.standard.string(forKey: "noct.debugSheet") == "comments-reply" else { return }
        replying = store.comments.last { $0.userId != session.myId }
    }
    #endif
}

/// Noct Stars support for the author: 1–10 000 in total per post from one reader.
struct SupportSheet: View {
    @EnvironmentObject private var session: AppSession
    @Environment(\.dismiss) private var dismiss
    let post: Post
    @State private var balance: Int?
    @State private var amount: Double = 10
    @State private var sending = false
    @State private var key = UUID().uuidString

    private var limit: Int { max(0, 10_000 - post.mySupport) }
    private var maximum: Int { min(limit, balance ?? limit) }

    var body: some View {
        VStack(spacing: 18) {
            Capsule().fill(Noct.borderStrong).frame(width: 36, height: 5).padding(.top, 8)
            Image("StarsArt")
                .resizable()
                .scaledToFit()
                .frame(height: 76)
            VStack(spacing: 6) {
                Text("Поддержать автора")
                    .font(.system(size: 21, weight: .semibold))
                Text("Звёзды получит \(post.name)")
                    .font(.system(size: 14))
                    .foregroundColor(Noct.text60)
            }
            Text("\(Int(amount))")
                .font(.system(size: 44, weight: .bold))
                .foregroundColor(Noct.gold)
                .monospacedDigit()
            if maximum >= 1 {
                Slider(value: $amount, in: 1...Double(max(maximum, 2)), step: 1)
                    .tint(Noct.gold)
                    .padding(.horizontal, 24)
            }
            HStack(spacing: 8) {
                ForEach([1, 10, 50, 100, 500], id: \.self) { preset in
                    Button {
                        amount = Double(min(preset, max(1, maximum)))
                    } label: {
                        Text("\(preset)").frame(maxWidth: .infinity)
                    }
                    .buttonStyle(ChipButtonStyle(selected: Int(amount) == preset))
                    .disabled(preset > maximum)
                }
            }
            .padding(.horizontal, 20)
            Text(balance.map { "Баланс: \(Format.count($0)) ⭐️" } ?? "Загружаем баланс…")
                .font(.system(size: 13))
                .foregroundColor(Noct.text48)
            Button {
                Task { await send() }
            } label: {
                HStack {
                    if sending { ProgressView().tint(.black) }
                    Text("Отправить \(Int(amount)) ⭐️")
                }
                .frame(maxWidth: .infinity)
            }
            .buttonStyle(PrimaryButtonStyle())
            .padding(.horizontal, 20)
            .disabled(sending || maximum < 1 || Int(amount) > maximum)
            Spacer(minLength: 0)
        }
        .sheetSurface()
        .presentationDetents([.height(520)])
        .task {
            if let wallet = try? await session.api.social("wallet") {
                balance = wallet["balance"].int ?? 0
                if Int(amount) > maximum { amount = Double(max(1, maximum)) }
            }
        }
    }

    private func send() async {
        let value = Int(amount)
        sending = true
        defer { sending = false }
        do {
            let data = try await session.api.socialPost("support", ["id": post.id, "amount": value, "key": key])
            var next = post
            next.stars += value
            next.mySupport += value
            PostBus.shared.send(.updated(next))
            balance = data["balance"].int ?? balance
            Haptics.success()
            session.show("Спасибо! Автор получил \(value) ⭐️")
            dismiss()
        } catch {
            key = UUID().uuidString
            session.report(error)
        }
    }
}

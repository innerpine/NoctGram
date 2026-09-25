import SwiftUI

/// A publication card (app/post-card.tsx): author line, text with «Ещё»,
/// code, media with the 18+ cover, poll, actions, views and Stars. The
/// sizes and gaps are those of the site on a phone (redesign.css, ≤500 px).
struct PostCard: View {
    @EnvironmentObject private var session: AppSession
    @EnvironmentObject private var nav: Navigator
    let post: Post
    /// Detail screens show the full text and no tap-through.
    var detail = false

    @State private var expanded = false
    @State private var revealed = false
    @State private var showComments = false
    @State private var confirmDelete = false
    @State private var showReport = false
    @State private var showSupport = false
    @State private var likeBump = false

    private var mine: Bool { post.isMine(session.myId) }
    private var canManage: Bool { mine || post.canManagePosts }
    private var long: Bool { post.text.count > 220 }
    /// A long text shows its first 7.7 lines of 15 pt and fades out.
    private var collapsed: Bool { long && !expanded && !detail }

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            Button {
                nav.push(.profile(post.userId))
            } label: {
                AvatarView(person: post.author, size: 36)
            }
            .buttonStyle(PressableStyle())

            VStack(alignment: .leading, spacing: 0) {
                if post.pinned {
                    Label(post.isChannel ? "Закреплено в канале" : "Закреплено в профиле", systemImage: "pin.fill")
                        .font(.system(size: 11, weight: .medium))
                        .foregroundColor(Noct.text48)
                        .padding(.bottom, 8)
                }
                authorLine
                if !post.text.isEmpty {
                    LinkedText(text: post.text, size: 15, color: Noct.text75, lineSpacing: 6)
                        .frame(maxHeight: collapsed ? 116 : nil, alignment: .top)
                        .clipped()
                        .mask {
                            LinearGradient(
                                stops: [
                                    .init(color: .black, location: 0),
                                    .init(color: .black, location: collapsed ? 0.8 : 1),
                                    .init(color: collapsed ? .clear : .black, location: 1),
                                ],
                                startPoint: .top,
                                endPoint: .bottom
                            )
                        }
                        .padding(.top, 8)
                    if long && !detail {
                        Button(expanded ? "Свернуть" : "Ещё") {
                            withAnimation(Noct.quick) { expanded.toggle() }
                        }
                        .font(.system(size: 13, weight: .medium))
                        .foregroundColor(Noct.text60)
                        .frame(minHeight: 24)
                        .padding(.top, 6)
                    }
                }
                if !post.code.isEmpty {
                    CodeBlockView(code: post.code, language: post.codeLang)
                        .padding(.top, 12)
                }
                if !post.media.isEmpty {
                    mediaSection.padding(.top, 12)
                }
                if !post.poll.isEmpty {
                    PollView(post: post)
                        .padding(.top, 12)
                }
                actions.padding(.top, 18)
                extras.padding(.top, 14)
            }
        }
        .padding(.vertical, 16)
        .padding(.horizontal, 14)
        .noctCard(radius: 14)
        .contentShape(Rectangle())
        .onTapGesture {
            if !detail { nav.push(.post(post.id)) }
        }
        .task(id: post.id) {
            try? await Task.sleep(nanoseconds: 1_000_000_000)
            guard !Task.isCancelled else { return }
            await PostActions.recordView(post, session: session)
        }
        .sheet(isPresented: $showComments) {
            CommentsSheet(post: post)
                .environmentObject(session)
                .environmentObject(nav)
        }
        .sheet(isPresented: $showSupport) {
            SupportSheet(post: post)
                .environmentObject(session)
        }
        .confirmationDialog("Удалить публикацию?", isPresented: $confirmDelete, titleVisibility: .visible) {
            Button("Удалить", role: .destructive) {
                Task { await PostActions.delete(post, session: session) }
            }
            Button("Отмена", role: .cancel) {}
        } message: {
            Text("Лайки, комментарии и голоса удалятся вместе с ней.")
        }
        .confirmationDialog("Пожаловаться на публикацию", isPresented: $showReport, titleVisibility: .visible) {
            ForEach(ReportReason.all, id: \.self) { reason in
                Button(reason) {
                    Task { await PostActions.report(post, reason: reason, session: session) }
                }
            }
            Button("Отмена", role: .cancel) {}
        }
    }

    private var authorLine: some View {
        HStack(spacing: 6) {
            // The @username gives way first when the line gets too narrow.
            ViewThatFits(in: .horizontal) {
                authorMeta(handle: true)
                authorMeta(handle: false)
            }
            Spacer(minLength: 0)
            menu
        }
    }

    private func authorMeta(handle: Bool) -> some View {
        HStack(spacing: 6) {
            Button {
                nav.push(.profile(post.userId))
            } label: {
                DisplayName(person: post.author, size: 14, weight: .medium)
            }
            .buttonStyle(PressableStyle())
            if post.isChannel {
                ChannelLabel(appearance: post.appearance)
                    .fixedSize()
            }
            if handle {
                Text("@" + post.handle)
                    .font(.system(size: 12))
                    .foregroundColor(Noct.text48)
                    .lineLimit(1)
                    .fixedSize()
            }
            Circle()
                .fill(Noct.text48)
                .frame(width: 3, height: 3)
            Text(Format.ago(post.created))
                .font(.system(size: 12))
                .foregroundColor(Noct.text48)
                .fixedSize()
        }
    }

    private var menu: some View {
        Menu {
            Button {
                session.copy(PostActions.link(post, session: session).absoluteString, message: "Ссылка скопирована")
            } label: {
                Label("Скопировать ссылку", systemImage: "link")
            }
            ShareLink(item: PostActions.link(post, session: session)) {
                Label("Поделиться", systemImage: "square.and.arrow.up")
            }
            if canManage {
                Button {
                    Task { await PostActions.togglePin(post, session: session) }
                } label: {
                    Label(pinTitle, systemImage: post.pinned ? "pin.slash" : "pin")
                }
                Button(role: .destructive) {
                    confirmDelete = true
                } label: {
                    Label("Удалить публикацию", systemImage: "trash")
                }
            } else {
                Button {
                    Task { await PostActions.hide(post, session: session) }
                } label: {
                    Label("Не интересно", systemImage: "eye.slash")
                }
                Button {
                    showReport = true
                } label: {
                    Label("Пожаловаться", systemImage: "flag")
                }
            }
        } label: {
            Image(systemName: "ellipsis")
                .font(.system(size: 15, weight: .semibold))
                .foregroundColor(Noct.text60)
                .frame(width: 30, height: 26)
                .contentShape(Rectangle())
        }
    }

    private var pinTitle: String {
        if post.pinned { return post.isChannel ? "Открепить от канала" : "Открепить от профиля" }
        return post.isChannel ? "Закрепить в канале" : "Закрепить в профиле"
    }

    // MARK: Media

    private var mediaSection: some View {
        ZStack {
            MediaGrid(items: post.media) { index in
                MediaPresenter.shared.show(MediaViewerState(items: post.media, index: index, title: post.name, date: post.created))
            }
            .blur(radius: post.adult && !revealed ? 28 : 0)
            .allowsHitTesting(!post.adult || revealed)
            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))

            if post.adult && !revealed {
                Button {
                    withAnimation(Noct.quick) { revealed = true }
                } label: {
                    VStack(spacing: 6) {
                        Text("18+")
                            .font(.system(size: 13, weight: .bold))
                            .padding(.horizontal, 9)
                            .padding(.vertical, 4)
                            .background(Capsule().stroke(Color.white.opacity(0.6), lineWidth: 1))
                        Text("Материалы для взрослых")
                            .font(.system(size: 15, weight: .semibold))
                        Text("Показать фото и видео")
                            .font(.system(size: 13))
                            .foregroundColor(Noct.text75)
                    }
                    .foregroundColor(.white)
                    .padding(.horizontal, 20)
                    .padding(.vertical, 14)
                    .glassRect(22, interactive: true)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .background(Color.black.opacity(0.25))
                }
                .buttonStyle(PressableStyle())
            }
        }
        .overlay(alignment: .topTrailing) {
            if post.adult && revealed {
                Button {
                    withAnimation(Noct.quick) { revealed = false }
                } label: {
                    Label("Скрыть 18+", systemImage: "eye.slash")
                        .font(.system(size: 12, weight: .medium))
                        .padding(.horizontal, 12)
                        .padding(.vertical, 7)
                        .glassCapsule(interactive: true)
                }
                .buttonStyle(PressableStyle())
                .padding(8)
            }
        }
    }

    // MARK: Actions

    /// Like and comments on the left, save on the right; sharing lives in
    /// the «…» menu, as on the site.
    private var actions: some View {
        HStack(spacing: 20) {
            Button {
                likeBump = !post.liked
                Task { await PostActions.toggleLike(post, session: session) }
            } label: {
                HStack(spacing: 8) {
                    Image(systemName: post.liked ? "heart.fill" : "heart")
                        .font(.system(size: 17, weight: .medium))
                        .scaleEffect(likeBump && post.liked ? 1.18 : 1)
                        .animation(.spring(response: 0.32, dampingFraction: 0.45), value: post.liked)
                    count(post.likes)
                }
                .foregroundColor(post.liked ? .white : Noct.text60)
                .modifier(TallTapArea())
            }
            .buttonStyle(PressableStyle())
            .disabled(session.readOnly)

            Button {
                if detail { return }
                showComments = true
            } label: {
                HStack(spacing: 8) {
                    Image(systemName: "bubble.left")
                        .font(.system(size: 16.5, weight: .medium))
                    count(post.comments)
                }
                .foregroundColor(Noct.text60)
                .modifier(TallTapArea())
            }
            .buttonStyle(PressableStyle())

            Spacer(minLength: 0)

            Button {
                Task { await PostActions.toggleSave(post, session: session) }
            } label: {
                Image(systemName: post.saved ? "bookmark.fill" : "bookmark")
                    .font(.system(size: 16, weight: .medium))
                    .foregroundColor(post.saved ? .white : Noct.text60)
                    .frame(width: 30)
                    .modifier(TallTapArea())
            }
            .buttonStyle(PressableStyle())
            .accessibilityLabel(post.saved ? "Убрать из сохранённого" : "Сохранить публикацию")
        }
        .frame(minHeight: 24)
    }

    private func count(_ value: Int) -> some View {
        Text(Format.count(value))
            .font(.system(size: 13, weight: .medium))
            .monospacedDigit()
            .frame(minWidth: 22, alignment: .leading)
    }

    /// Views on the left, Stars for the author on the right, under a thin line.
    private var extras: some View {
        VStack(spacing: 0) {
            Rectangle()
                .fill(Color.white.opacity(0.024))
                .frame(height: 1)
            HStack(spacing: 12) {
                HStack(spacing: 6) {
                    Image(systemName: "eye")
                        .font(.system(size: 13))
                    Text(Format.count(post.views))
                        .monospacedDigit()
                }
                .font(.system(size: 12))
                .foregroundColor(Noct.text48)
                .accessibilityElement(children: .combine)
                .accessibilityLabel("Просмотры: \(Format.count(post.views))")
                Spacer(minLength: 0)
                Button {
                    if !mine { showSupport = true }
                } label: {
                    HStack(spacing: 7) {
                        Image("StarsIcon")
                            .resizable()
                            .scaledToFit()
                            .frame(width: 19, height: 19)
                        Text(Format.count(post.stars))
                            .font(.system(size: 12, weight: .medium))
                            .foregroundColor(Color(hex: 0xEDD07B))
                        Text(mine ? "От читателей" : "Поддержать")
                            .font(.system(size: 12))
                            .foregroundColor(Noct.text60)
                    }
                    .frame(minHeight: 30)
                    .contentShape(Rectangle())
                }
                .buttonStyle(PressableStyle())
                .disabled(mine || session.readOnly)
                .opacity(mine ? 0.7 : 1)
            }
            .padding(.top, 8)
        }
    }
}

/// A 44 pt tall place to tap around a small action without making its row
/// any taller (the site does it with negative margins).
private struct TallTapArea: ViewModifier {
    func body(content: Content) -> some View {
        content
            .padding(.vertical, 10)
            .contentShape(Rectangle())
            .padding(.vertical, -10)
    }
}

enum ReportReason {
    static let all = [
        "Спам или реклама",
        "Оскорбления или травля",
        "Насилие или угрозы",
        "Материалы 18+ без отметки",
        "Мошенничество",
        "Нарушение авторских прав",
    ]
}

struct MediaViewerState: Identifiable {
    let items: [MediaItem]
    let index: Int
    /// Who sent or posted it and when, shown on top as in Telegram.
    var title = ""
    var date: Double = 0
    /// Deleting from the viewer (a chat message): the viewer closes first.
    var delete: (() -> Void)?
    var id: String { items.map(\.id).joined() + "#\(index)" }
}

/// Up to four photos/videos: one full width, otherwise a two-column grid.
struct MediaGrid: View {
    @EnvironmentObject private var session: AppSession
    let items: [MediaItem]
    let open: (Int) -> Void

    var body: some View {
        let gap: CGFloat = 8
        if items.count == 1 {
            tile(0).frame(height: 300)
        } else if items.count == 3 {
            VStack(spacing: gap) {
                tile(0).frame(height: 200)
                HStack(spacing: gap) {
                    tile(1)
                    tile(2)
                }
                .frame(height: 150)
            }
        } else {
            let rows = stride(from: 0, to: items.count, by: 2).map { $0 }
            VStack(spacing: gap) {
                ForEach(rows, id: \.self) { start in
                    HStack(spacing: gap) {
                        tile(start)
                        if start + 1 < items.count { tile(start + 1) }
                    }
                    .frame(height: 170)
                }
            }
        }
    }

    private func tile(_ index: Int) -> some View {
        let item = items[index]
        return Button {
            open(index)
        } label: {
            ZStack {
                if item.isVideo {
                    VideoThumbnail(url: session.api.mediaURL(item.path))
                    Image(systemName: "play.fill")
                        .font(.system(size: 18, weight: .semibold))
                        .foregroundColor(.white)
                        .frame(width: 48, height: 48)
                        .glassCircle()
                } else {
                    RemoteImage(url: session.api.mediaURL(item.path), maxPixel: 1100)
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(Noct.border, lineWidth: 1))
            .contentShape(Rectangle())
        }
        .buttonStyle(PressableStyle())
        .accessibilityLabel(item.isVideo ? "Видео" : "Фото")
        .accessibilityIdentifier("media-" + item.id)
    }
}

/// Monospaced code with language label and copy button.
struct CodeBlockView: View {
    @EnvironmentObject private var session: AppSession
    let code: String
    let language: String

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                Text(language.isEmpty ? "text" : language)
                    .font(.system(size: 12, weight: .medium, design: .monospaced))
                    .foregroundColor(Noct.text48)
                Spacer()
                Button {
                    session.copy(code, message: "Код скопирован")
                } label: {
                    Label("Копировать", systemImage: "doc.on.doc")
                        .font(.system(size: 12, weight: .medium))
                        .foregroundColor(Noct.text60)
                }
                .buttonStyle(PressableStyle())
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
            .background(Color.white.opacity(0.03))
            ScrollView(.horizontal, showsIndicators: false) {
                Text(code)
                    .font(.system(size: 13, design: .monospaced))
                    .foregroundColor(Noct.text75)
                    .lineSpacing(3)
                    .padding(12)
                    .fixedSize(horizontal: true, vertical: false)
            }
            .frame(maxHeight: 360)
        }
        .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Color(hex: 0x09090B)))
        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(Noct.border, lineWidth: 1))
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
    }
}

/// A 2–6 option poll; results appear after voting and the vote can be changed.
struct PollView: View {
    @EnvironmentObject private var session: AppSession
    let post: Post

    var body: some View {
        let total = post.totalVotes
        VStack(alignment: .leading, spacing: 8) {
            ForEach(Array(post.poll.enumerated()), id: \.offset) { index, option in
                let count = post.votes[index] ?? 0
                let percent = total > 0 ? Int((Double(count) / Double(total) * 100).rounded()) : 0
                let chosen = post.voted == index
                Button {
                    Task { await PostActions.vote(post, option: index, session: session) }
                } label: {
                    HStack(spacing: 10) {
                        ZStack {
                            Circle().stroke(chosen ? Color.white : Noct.text48, lineWidth: 1.5)
                            if chosen {
                                Circle().fill(Color.white)
                                Image(systemName: "checkmark")
                                    .font(.system(size: 8, weight: .bold))
                                    .foregroundColor(.black)
                            }
                        }
                        .frame(width: 16, height: 16)
                        Text(option)
                            .font(.system(size: 14, weight: chosen ? .semibold : .regular))
                            .foregroundColor(.white)
                            .multilineTextAlignment(.leading)
                        Spacer(minLength: 8)
                        if post.voted != nil {
                            Text("\(percent)%")
                                .font(.system(size: 13, weight: .medium))
                                .foregroundColor(Noct.text60)
                                .monospacedDigit()
                        }
                    }
                    .padding(.horizontal, 12)
                    .padding(.vertical, 11)
                    .background(
                        GeometryReader { geometry in
                            ZStack(alignment: .leading) {
                                RoundedRectangle(cornerRadius: 10, style: .continuous).fill(Noct.fill)
                                RoundedRectangle(cornerRadius: 10, style: .continuous)
                                    .fill(chosen ? Noct.fillHeavy : Noct.fillStrong)
                                    .frame(width: post.voted == nil ? 0 : geometry.size.width * CGFloat(percent) / 100)
                            }
                        }
                    )
                    .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).stroke(chosen ? Noct.borderStrong : Noct.border, lineWidth: 1))
                    .animation(.easeOut(duration: 0.38), value: post.voted)
                }
                .buttonStyle(PressableStyle())
                .disabled(session.readOnly)
            }
            Text("\(Format.count(total)) \(Format.plural(total, "голос", "голоса", "голосов")) · \(post.voted != nil ? "можно изменить выбор" : "один вариант ответа")")
                .font(.system(size: 12))
                .foregroundColor(Noct.text48)
        }
    }
}

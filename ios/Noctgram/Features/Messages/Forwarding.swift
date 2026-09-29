import SwiftUI

/// What is being forwarded (lib/chat-forward.ts): messages of a dialogue or
/// a group, or a feed post.
enum ForwardSource {
    case dm(peer: String, ids: [String])
    case room(roomId: String, ids: [String])
    case post(String)

    var body: [String: Any] {
        switch self {
        case .dm(let peer, let ids): return ["dm": ["peer": peer, "ids": ids]]
        case .room(let roomId, let ids): return ["room": ["roomId": roomId, "ids": ids]]
        case .post(let id): return ["post": ["postId": id]]
        }
    }
}

/// A chat to forward to: a person (the viewer's own id is «Избранное») or a
/// group.
struct ForwardTarget: Identifiable, Hashable {
    enum Kind: Hashable { case person, room }
    let kind: Kind
    let chatId: String
    let identity: Identity
    let subtitle: String
    var saved = false

    var id: String { (kind == .person ? "person:" : "room:") + chatId }

    var body: [String: Any] {
        kind == .person ? ["dm": ["peer": chatId]] : ["room": ["roomId": chatId]]
    }
}

@MainActor
enum Forwarder {
    /// Sends one request for every chosen chat; returns a line for the
    /// viewer. Throws when no chat took it.
    static func send(_ source: ForwardSource, to targets: [ForwardTarget], comment: String, session: AppSession) async throws -> String {
        var body: [String: Any] = [
            "key": UUID().uuidString.lowercased(),
            "source": source.body,
            "targets": targets.map(\.body),
        ]
        let trimmed = comment.trimmingCharacters(in: .whitespacesAndNewlines)
        if !trimmed.isEmpty { body["comment"] = trimmed }
        if let me = session.myId { body["expectedSender"] = me }
        let result = try await session.api.post("/api/chat-forward", body)
        let results = result["results"].array
        let failed = results.filter { !$0["ok"].bool }
        if failed.isEmpty {
            if targets.count == 1, let target = targets.first {
                return target.saved ? "Сохранено в «Избранное»" : "Переслано: \(target.identity.name)"
            }
            return "Переслано в \(targets.count) \(Format.plural(targets.count, "чат", "чата", "чатов"))"
        }
        let error = failed.first?["error"].string ?? "Пересылка в этот чат недоступна"
        return "Переслано не везде: \(error)"
    }
}

/// Where to forward, as in Telegram: «Избранное» first, then recent chats and
/// groups; several can be chosen, with a comment sent before the messages.
struct ForwardSheet: View {
    @EnvironmentObject private var session: AppSession
    @Environment(\.dismiss) private var dismiss
    let source: ForwardSource
    /// Called once the messages went out.
    var onSent: (() -> Void)?
    @State private var query = ""
    @State private var chats: [ForwardTarget] = []
    @State private var found: [ForwardTarget] = []
    @State private var chosen: [ForwardTarget] = []
    @State private var comment = ""
    @State private var sending = false
    @State private var loaded = false
    @FocusState private var commentFocused: Bool

    private var term: String { query.trimmingCharacters(in: .whitespaces) }

    private var shown: [ForwardTarget] {
        guard !term.isEmpty else { return chats }
        let lower = term.lowercased()
        let local = chats.filter {
            $0.identity.name.lowercased().contains(lower) || $0.identity.handle.lowercased().contains(lower)
                || ($0.saved && "избранное".contains(lower))
        }
        let known = Set(local.map(\.id))
        return local + found.filter { !known.contains($0.id) }
    }

    var body: some View {
        NavigationStack {
            List {
                ForEach(shown) { target in
                    Button {
                        toggle(target)
                    } label: {
                        row(target)
                    }
                    .listRowBackground(Noct.sheetRow)
                    .accessibilityIdentifier("forward-" + target.id)
                    .accessibilityAddTraits(isChosen(target) ? .isSelected : [])
                }
                if shown.isEmpty && loaded {
                    Text(term.isEmpty ? "Чатов пока нет" : "Никого не нашли")
                        .font(.system(size: 14))
                        .foregroundColor(Noct.text48)
                        .listRowBackground(Noct.sheetRow)
                }
            }
            .listStyle(.plain)
            .scrollContentBackground(.hidden)
            .sheetSurface()
            .searchable(text: $query, placement: .navigationBarDrawer(displayMode: .always), prompt: "Поиск")
            .navigationTitle(chosen.isEmpty ? "Переслать" : "Выбрано: \(chosen.count)")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Отмена") { dismiss() }
                }
            }
            .safeAreaInset(edge: .bottom) {
                if !chosen.isEmpty { sendBar }
            }
            .animation(Noct.quick, value: chosen.isEmpty)
            .task { await load() }
            .task(id: term) { await search() }
        }
        .presentationDetents([.medium, .large])
    }

    private func row(_ target: ForwardTarget) -> some View {
        HStack(spacing: 12) {
            if target.saved {
                SavedAvatar(size: 44)
            } else {
                AvatarView(person: target.identity, size: 44)
            }
            VStack(alignment: .leading, spacing: 2) {
                if target.saved {
                    Text("Избранное").font(.system(size: 15, weight: .semibold))
                } else {
                    DisplayName(person: target.identity, size: 15)
                }
                Text(target.subtitle)
                    .font(.system(size: 13))
                    .foregroundColor(Noct.text48)
                    .lineLimit(1)
            }
            Spacer(minLength: 0)
            ZStack {
                Circle()
                    .stroke(isChosen(target) ? Color.white : Noct.text25, lineWidth: 1.5)
                    .frame(width: 24, height: 24)
                if isChosen(target) {
                    Circle().fill(Color.white).frame(width: 24, height: 24)
                    Image(systemName: "checkmark")
                        .font(.system(size: 12, weight: .bold))
                        .foregroundColor(.black)
                }
            }
            .animation(Noct.quick, value: isChosen(target))
        }
        .contentShape(Rectangle())
    }

    private var sendBar: some View {
        HStack(alignment: .bottom, spacing: 8) {
            TextField("Добавить комментарий…", text: $comment, axis: .vertical)
                .lineLimit(1...4)
                .font(.system(size: 16))
                .focused($commentFocused)
                .padding(.horizontal, 16)
                .padding(.vertical, 11)
                .frame(minHeight: 44)
                .glassRect(22)
                .accessibilityIdentifier("forward-comment")
            Button {
                Task { await send() }
            } label: {
                ZStack {
                    if sending {
                        ProgressView().tint(.black)
                    } else {
                        Image(systemName: "arrow.up").font(.system(size: 17, weight: .bold))
                    }
                }
            }
            .buttonStyle(CircleButtonStyle(size: 44, tint: .white))
            .disabled(sending)
            .accessibilityLabel("Отправить")
            .accessibilityIdentifier("forward-send")
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
    }

    private func isChosen(_ target: ForwardTarget) -> Bool {
        chosen.contains { $0.id == target.id }
    }

    private func toggle(_ target: ForwardTarget) {
        Haptics.tap()
        if let index = chosen.firstIndex(where: { $0.id == target.id }) {
            chosen.remove(at: index)
        } else if chosen.count < 10 {
            chosen.append(target)
        } else {
            session.show("Можно выбрать до 10 чатов")
        }
    }

    private func send() async {
        guard !chosen.isEmpty, !sending else { return }
        sending = true
        defer { sending = false }
        do {
            let line = try await Forwarder.send(source, to: chosen, comment: comment, session: session)
            Haptics.success()
            session.show(line)
            onSent?()
            dismiss()
        } catch {
            session.report(error)
        }
    }

    private func load() async {
        guard !loaded else { return }
        var list: [ForwardTarget] = []
        if let me = session.me {
            list.append(ForwardTarget(kind: .person, chatId: me.id, identity: me.identity, subtitle: "Заметки и пересланное", saved: true))
        }
        var rows: [(Double, ForwardTarget)] = []
        if let threads = try? await session.api.social("threads") {
            for person in threads.array.map { Person($0) } where person.id != "noctgram" && person.id != session.myId {
                rows.append((person.lastTime, ForwardTarget(kind: .person, chatId: person.id, identity: person.identity, subtitle: "@" + person.handle)))
            }
        }
        if let rooms = try? await session.api.get("/api/rooms", ["action": "list"]) {
            for room in rooms["rooms"].array.map(RoomSummary.init) where !room.isSecret {
                let members = "\(Format.count(room.memberCount)) \(Format.plural(room.memberCount, "участник", "участника", "участников"))"
                rows.append((room.lastTime, ForwardTarget(kind: .room, chatId: room.id, identity: room.identity, subtitle: members)))
            }
        }
        list += rows.sorted { $0.0 > $1.0 }.map { $0.1 }
        if rows.isEmpty {
            list += session.people.filter { $0.id != session.myId }.map {
                ForwardTarget(kind: .person, chatId: $0.id, identity: $0.identity, subtitle: "@" + $0.handle)
            }
        }
        chats = list
        loaded = true
    }

    private func search() async {
        guard !term.isEmpty else {
            found = []
            return
        }
        try? await Task.sleep(nanoseconds: 300_000_000)
        guard !Task.isCancelled else { return }
        if let data = try? await session.api.social("people", ["q": term]) {
            found = data.array.map { Person($0) }.filter { $0.id != session.myId && $0.id != "noctgram" }.map {
                ForwardTarget(kind: .person, chatId: $0.id, identity: $0.identity, subtitle: "@" + $0.handle)
            }
        }
    }
}

/// «Избранное»: a bookmark on the accent circle, as in Telegram.
struct SavedAvatar: View {
    var size: CGFloat = 52

    var body: some View {
        ZStack {
            Circle().fill(LinearGradient(colors: [Color(hex: 0x6FB9F0), Color(hex: 0x4A7FD4)], startPoint: .top, endPoint: .bottom))
            Image(systemName: "bookmark.fill")
                .font(.system(size: size * 0.4, weight: .semibold))
                .foregroundColor(.white)
        }
        .frame(width: size, height: size)
        .accessibilityHidden(true)
    }
}

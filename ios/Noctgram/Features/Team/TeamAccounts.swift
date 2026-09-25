import SwiftUI

/// «Аккаунты»: find a person or a channel and restrict it, or lift the
/// restriction (moderationUsers and moderate in lib/moderation.ts).
struct TeamAccountsView: View {
    @EnvironmentObject private var session: AppSession
    @State private var query: String
    /// An account opened from elsewhere, looked up by its id.
    @State private var targetId: String?
    @State private var people: [TeamAccount] = []
    @State private var cursor: String?
    @State private var hasMore = false
    @State private var loading = true
    @State private var loadingMore = false
    @State private var error: String?
    @State private var selected: TeamAccount?
    /// The target whose card already came up by itself.
    @State private var opened: String?

    init(target: TeamTarget?) {
        _query = State(initialValue: target?.handle ?? "")
        _targetId = State(initialValue: target?.id)
    }

    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 10) {
                TeamSearchField(
                    text: Binding(get: { query }, set: { value in
                        query = value
                        targetId = nil
                    }),
                    placeholder: "Имя, @юзернейм или канал"
                )
                .padding(.bottom, 4)
                ForEach(people) { account in
                    Button {
                        selected = account
                    } label: {
                        TeamPersonRow(
                            person: account.identity,
                            subtitle: "@" + account.handle + (account.isChannel ? " · Канал" : ""),
                            status: account.status
                        )
                    }
                    .buttonStyle(PressableStyle())
                }
                if loading && people.isEmpty {
                    LoadingRow()
                } else if let error {
                    ErrorBanner(text: error) { Task { await load() } }
                } else if people.isEmpty {
                    EmptyState(icon: "person.crop.circle.badge.questionmark", text: "Аккаунты не найдены.")
                }
                if hasMore {
                    TeamMoreButton(loading: loadingMore) { Task { await load(append: true) } }
                }
            }
            .padding(16)
        }
        .background(Noct.background)
        .scrollDismissesKeyboard(.interactively)
        .refreshable { await load() }
        .navigationTitle("Аккаунты")
        .navigationBarTitleDisplayMode(.inline)
        .task(id: query + "|" + (targetId ?? "")) {
            // Typing waits a moment before it searches.
            if !query.isEmpty && targetId == nil {
                try? await Task.sleep(nanoseconds: 250_000_000)
                guard !Task.isCancelled else { return }
            }
            await load()
        }
        .sheet(item: $selected) { account in
            TeamRestrictionSheet(account: account, openOwner: openOwner) {
                await load()
            }
            .environmentObject(session)
        }
    }

    private func load(append: Bool = false) async {
        if append { loadingMore = true } else { loading = true }
        defer {
            loading = false
            loadingMore = false
        }
        var params: [String: String?] = ["q": query]
        if let targetId { params["id"] = targetId }
        if append, let cursor { params["after"] = cursor }
        do {
            let page = try await session.api.social("moderationUsers", params)
            let rows = page["people"].array.map(TeamAccount.init)
            cursor = page["nextCursor"].string
            hasMore = page["hasMore"].bool
            if append {
                let known = Set(people.map(\.id))
                people += rows.filter { !known.contains($0.id) }
            } else {
                people = rows
            }
            error = nil
            if let targetId {
                if rows.isEmpty { error = "Автор больше не существует." }
                // Opened for one account: its card comes up once, not again
                // after a decision reloads the list.
                if opened != targetId, let first = rows.first {
                    opened = targetId
                    selected = first
                }
            }
        } catch is CancellationError {
            return
        } catch {
            self.error = error.userMessage ?? "Не удалось загрузить аккаунты."
        }
    }

    /// «Открыть владельца» of a channel.
    private func openOwner(_ owner: TeamTarget) {
        selected = nil
        // The owner's card comes up once this one has gone down.
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.45) {
            query = owner.handle
            targetId = owner.id
        }
    }
}

/// Restricting one account: read only, blocking or lifting, for how long
/// and why, with its past decisions (moderation-editor).
struct TeamRestrictionSheet: View {
    @EnvironmentObject private var session: AppSession
    @Environment(\.dismiss) private var dismiss
    let account: TeamAccount
    let openOwner: (TeamTarget) -> Void
    let saved: () async -> Void
    @State private var mode: String
    @State private var duration = "1440"
    @State private var reason = ""
    @State private var history: [TeamDecision] = []
    @State private var showHistory = false
    @State private var busy = false

    private static let modes = [
        SegmentOption("read_only", "Только чтение"),
        SegmentOption("blocked", "Блокировка"),
        SegmentOption("active", "Снять ограничение"),
    ]
    private static let durations = [
        SegmentOption("60", "1 час"),
        SegmentOption("1440", "1 день"),
        SegmentOption("10080", "7 дней"),
        SegmentOption("43200", "30 дней"),
        SegmentOption("forever", "Бессрочно"),
    ]

    init(account: TeamAccount, openOwner: @escaping (TeamTarget) -> Void, saved: @escaping () async -> Void) {
        self.account = account
        self.openOwner = openOwner
        self.saved = saved
        _mode = State(initialValue: account.mode.isEmpty ? "read_only" : account.mode)
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    HStack(spacing: 12) {
                        AvatarView(person: account.identity, size: 52)
                        VStack(alignment: .leading, spacing: 3) {
                            DisplayName(person: account.identity, size: 17)
                            Text("@" + account.handle)
                                .font(.system(size: 14))
                                .foregroundColor(Noct.text48)
                        }
                        Spacer(minLength: 8)
                        TeamChip(status: account.status)
                    }
                    notes
                    if account.canRestrict {
                        form
                    }
                    if !history.isEmpty {
                        historySection
                    }
                }
                .padding(20)
            }
            .background(Noct.background)
            .scrollDismissesKeyboard(.interactively)
            .navigationTitle("Ограничение")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Закрыть") { dismiss() }
                        .disabled(busy)
                }
            }
            .task { await loadHistory() }
        }
    }

    @ViewBuilder private var notes: some View {
        if account.isChannel {
            TeamNote("Канал · " + account.name, color: Noct.text60)
            TeamNote("Решение применяется только к этому каналу. Только чтение запрещает публикацию и редактирование; блокировка также скрывает канал и его посты.")
            if !account.ownerId.isEmpty && !account.ownerHandle.isEmpty {
                Button("Открыть владельца · @" + account.ownerHandle) {
                    openOwner(TeamTarget(id: account.ownerId, handle: account.ownerHandle))
                }
                .buttonStyle(SecondaryButtonStyle())
                .disabled(busy)
            }
        } else if !account.canRestrict {
            TeamNote(account.moderator ? "Аккаунт модератора защищён от ограничений." : "Служебный аккаунт Noctgram защищён от ограничений.")
        }
        if let current = account.current {
            TeamNote(current, color: Noct.text75)
        }
    }

    private var form: some View {
        VStack(alignment: .leading, spacing: 12) {
            TeamChoice(title: "Действие", selection: $mode, options: Self.modes)
            if mode != "active" {
                TeamChoice(title: "Срок", selection: $duration, options: Self.durations)
            }
            TeamNoteField(title: "Причина решения", text: $reason, placeholder: "Укажите нарушение и основание для решения")
            TeamNote("Причину видит владелец аккаунта. Решение сохраняется в истории.")
            submitButton
        }
        .disabled(busy)
    }

    @ViewBuilder private var submitButton: some View {
        let ready = !busy && !reason.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        if mode == "blocked" {
            Button {
                Task { await submit() }
            } label: {
                Text(busy ? "Сохраняем…" : (account.isChannel ? "Заблокировать канал" : "Заблокировать аккаунт"))
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(DangerButtonStyle())
            .disabled(!ready)
        } else {
            Button {
                Task { await submit() }
            } label: {
                Text(busy ? "Сохраняем…" : (mode == "active" ? "Снять ограничение" : "Включить только чтение"))
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(PrimaryButtonStyle())
            .disabled(!ready)
        }
    }

    private var historySection: some View {
        VStack(alignment: .leading, spacing: 10) {
            Button {
                withAnimation(Noct.quick) { showHistory.toggle() }
            } label: {
                HStack {
                    Text("История решений · \(history.count)")
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundColor(.white)
                    Spacer()
                    Image(systemName: showHistory ? "chevron.up" : "chevron.down")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundColor(Noct.text48)
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(PressableStyle())
            if showHistory {
                ForEach(history) { decision in
                    TeamCard {
                        Text(decision.title)
                            .font(.system(size: 15, weight: .semibold))
                            .foregroundColor(.white)
                        if !decision.reason.isEmpty {
                            TeamNote(decision.reason, color: Noct.text75)
                        }
                        TeamNote(Format.full(decision.created) + " · " + (decision.moderatorHandle.isEmpty ? "Удалённый аккаунт" : "@" + decision.moderatorHandle))
                    }
                }
            }
        }
        .padding(.top, 6)
    }

    private func loadHistory() async {
        guard let rows = try? await session.api.social("moderationHistory", ["id": account.id]) else { return }
        history = rows.array.map(TeamDecision.init)
    }

    private func submit() async {
        guard !busy, account.canRestrict else { return }
        busy = true
        defer { busy = false }
        var decision: [String: Any] = [
            "id": account.id,
            "mode": mode,
            "reason": reason.trimmingCharacters(in: .whitespacesAndNewlines),
        ]
        // No end is null, as the site sends it.
        if duration == "forever" {
            decision["minutes"] = NSNull()
        } else {
            decision["minutes"] = Int(duration) ?? 1440
        }
        do {
            _ = try await session.api.socialPost("moderate", decision)
            Haptics.success()
            session.show("Решение сохранено")
            await saved()
            dismiss()
        } catch {
            session.report(error)
        }
    }
}

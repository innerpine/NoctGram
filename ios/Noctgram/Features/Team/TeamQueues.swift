import SwiftUI

// MARK: - Обращения

/// Appeals against restrictions: accept one to lift the restriction it
/// contests, or keep the restriction; either way the person gets the answer.
struct TeamAppealsView: View {
    @EnvironmentObject private var session: AppSession
    @State private var appeals: [TeamAppeal] = []
    @State private var notes: [String: String] = [:]
    @State private var loading = true
    @State private var busy = false
    @State private var error: String?

    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 12) {
                ForEach(appeals) { appeal in
                    card(appeal)
                }
                if loading && appeals.isEmpty {
                    LoadingRow()
                } else if let error {
                    ErrorBanner(text: error) { Task { await load() } }
                } else if appeals.isEmpty {
                    EmptyState(icon: "bubble.left.and.bubble.right", text: "Обращений пока нет.")
                }
            }
            .padding(16)
        }
        .background(Noct.background)
        .scrollDismissesKeyboard(.interactively)
        .refreshable { await load() }
        .navigationTitle("Обращения")
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
    }

    private func card(_ appeal: TeamAppeal) -> some View {
        TeamCard {
            HStack {
                Text("@" + appeal.handle)
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundColor(.white)
                Spacer(minLength: 8)
                TeamChip(status: appeal.pending
                    ? TeamStatus(title: "Ожидает решения", color: Noct.gold)
                    : TeamStatus(title: "Рассмотрено", color: Noct.text48))
            }
            TeamNote((appeal.mode == "blocked" ? "Блокировка" : "Только чтение") + " · " + appeal.reason, color: Noct.text60)
            Text(appeal.text)
                .font(.system(size: 15))
                .foregroundColor(Noct.text75)
                .fixedSize(horizontal: false, vertical: true)
            TeamNote(Format.full(appeal.created))
            if appeal.pending {
                TeamNoteField(title: "Ответ пользователю", text: note(appeal.id), limit: 1000)
                let ready = !busy && !(notes[appeal.id] ?? "").trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                FlowLayout(spacing: 8, lineSpacing: 8) {
                    Button("Принять обращение") {
                        Task { await review(appeal, decision: "accepted") }
                    }
                    .buttonStyle(PrimaryButtonStyle())
                    .disabled(!ready)
                    Button("Оставить ограничение") {
                        Task { await review(appeal, decision: "dismissed") }
                    }
                    .buttonStyle(SecondaryButtonStyle())
                    .disabled(!ready)
                }
                TeamNote("Принятие снимает оспариваемое ограничение. Если было выдано новое, оно останется в силе.")
            } else if !appeal.reviewNote.isEmpty {
                TeamNote(appeal.reviewNote, color: Noct.text60)
            }
        }
    }

    private func note(_ id: String) -> Binding<String> {
        Binding(get: { notes[id] ?? "" }, set: { notes[id] = $0 })
    }

    private func load() async {
        loading = true
        defer { loading = false }
        do {
            appeals = try await session.api.social("moderationAppeals").array.map(TeamAppeal.init)
            error = nil
        } catch is CancellationError {
            return
        } catch {
            self.error = error.userMessage ?? "Не удалось загрузить обращения."
        }
    }

    private func review(_ appeal: TeamAppeal, decision: String) async {
        guard !busy else { return }
        busy = true
        defer { busy = false }
        do {
            _ = try await session.api.socialPost("reviewAppeal", [
                "id": appeal.id,
                "decision": decision,
                "note": (notes[appeal.id] ?? "").trimmingCharacters(in: .whitespacesAndNewlines),
            ])
            Haptics.success()
            session.show("Решение сохранено")
            notes[appeal.id] = nil
            await load()
        } catch {
            session.report(error)
        }
    }
}

// MARK: - Жалобы

/// Reports on posts, comments, stories and messages: take one up, close it
/// with a comment or reopen it; remove the content or find its author.
struct TeamReportsView: View {
    @EnvironmentObject private var session: AppSession
    @EnvironmentObject private var nav: Navigator
    @State private var filter = "new"
    @State private var reports: [TeamReport] = []
    @State private var notes: [String: String] = [:]
    @State private var loading = true
    @State private var loadingMore = false
    @State private var more = false
    @State private var busy = false
    @State private var error: String?
    @State private var removing: TeamReport?

    private static let filters = [
        SegmentOption("all", "Все"),
        SegmentOption("new", "Новые"),
        SegmentOption("reviewing", "Рассматриваются"),
        SegmentOption("closed", "Закрытые"),
    ]

    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 12) {
                TeamFilterBar(options: Self.filters, selection: $filter)
                    .padding(.horizontal, -16)
                ForEach(reports) { report in
                    card(report)
                }
                if loading && reports.isEmpty {
                    LoadingRow()
                } else if let error {
                    ErrorBanner(text: error) { Task { await load() } }
                } else if reports.isEmpty {
                    EmptyState(icon: "flag", text: "В этом статусе жалоб пока нет.")
                }
                if more {
                    TeamMoreButton(loading: loadingMore) { Task { await load(append: true) } }
                }
            }
            .padding(16)
        }
        .background(Noct.background)
        .scrollDismissesKeyboard(.interactively)
        .refreshable { await load() }
        .navigationTitle("Жалобы")
        .navigationBarTitleDisplayMode(.inline)
        .task(id: filter) {
            reports = []
            await load()
        }
        .sheet(item: $removing) { report in
            TeamRemovalSheet(report: report) {
                session.show("Контент удалён. Связанные открытые жалобы закрыты.")
                await load()
            }
            .environmentObject(session)
        }
    }

    private func card(_ report: TeamReport) -> some View {
        TeamCard {
            HStack(alignment: .top) {
                Text(report.title)
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundColor(.white)
                Spacer(minLength: 8)
                TeamChip(status: report.statusChip)
            }
            TeamEvidence(text: report.text.isEmpty ? "Публикация с медиа или кодом" : report.text)
            TeamNote("Жалоба: " + report.reason, color: Noct.text75)
            TeamNote((report.reporterHandle.isEmpty ? "От удалённого аккаунта" : "От @" + report.reporterHandle) + " · " + Format.full(report.created))
            if !report.available {
                TeamNote("Контент недоступен. Сохранён текст на момент жалобы.")
            }
            FlowLayout(spacing: 8, lineSpacing: 8) {
                Button("Найти автора") {
                    nav.push(.teamSection(.accounts(TeamTarget(id: report.authorId, handle: report.handle))))
                }
                .buttonStyle(SecondaryButtonStyle())
                .disabled(busy || report.handle.isEmpty)
                if report.canOpenPost {
                    Button("Открыть пост") {
                        nav.push(.post(report.postId))
                    }
                    .buttonStyle(SecondaryButtonStyle())
                }
                if report.canRemove {
                    Button(report.removeTitle) {
                        removing = report
                    }
                    .buttonStyle(DangerButtonStyle())
                    .disabled(busy)
                }
            }
            if report.status != "closed" {
                TeamNoteField(title: "Комментарий к решению", text: note(report.id), limit: 1000, placeholder: "Обязателен при закрытии жалобы")
            }
            reviewButtons(report)
            if !report.reviewNote.isEmpty {
                TeamNote("Решение: " + report.reviewNote + (report.reviewerHandle.isEmpty ? "" : " · @" + report.reviewerHandle), color: Noct.text60)
            }
        }
    }

    @ViewBuilder private func reviewButtons(_ report: TeamReport) -> some View {
        let noted = !(notes[report.id] ?? "").trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        FlowLayout(spacing: 8, lineSpacing: 8) {
            if report.status == "new" {
                Button("Взять на рассмотрение") {
                    Task { await review(report, status: "reviewing") }
                }
                .buttonStyle(SecondaryButtonStyle())
                .disabled(busy)
            }
            if report.status != "closed" {
                Button("Закрыть жалобу") {
                    Task { await review(report, status: "closed") }
                }
                .buttonStyle(PrimaryButtonStyle())
                .disabled(busy || !noted)
            } else {
                Button("Открыть заново") {
                    Task { await review(report, status: "new") }
                }
                .buttonStyle(SecondaryButtonStyle())
                .disabled(busy)
            }
        }
    }

    private func note(_ id: String) -> Binding<String> {
        Binding(get: { notes[id] ?? "" }, set: { notes[id] = $0 })
    }

    private func load(append: Bool = false) async {
        if append { loadingMore = true } else { loading = true }
        defer {
            loading = false
            loadingMore = false
        }
        var params: [String: String?] = ["status": filter]
        if append, let last = reports.last {
            params["before"] = String(Int64(last.created))
            params["beforeId"] = last.id
        }
        do {
            let rows = try await session.api.social("moderationReports", params).array.map(TeamReport.init)
            if append {
                let known = Set(reports.map(\.id))
                reports += rows.filter { !known.contains($0.id) }
            } else {
                reports = rows
            }
            more = rows.count == 50
            error = nil
        } catch is CancellationError {
            return
        } catch {
            self.error = error.userMessage ?? "Не удалось загрузить жалобы."
        }
    }

    private func review(_ report: TeamReport, status: String) async {
        guard !busy else { return }
        busy = true
        defer { busy = false }
        do {
            _ = try await session.api.socialPost("reviewReport", [
                "id": report.id,
                "expectedStatus": report.status,
                "status": status,
                "note": (notes[report.id] ?? "").trimmingCharacters(in: .whitespacesAndNewlines),
            ])
            Haptics.success()
            session.show("Статус жалобы обновлён")
            notes[report.id] = nil
            await load()
        } catch {
            session.report(error)
        }
    }
}

/// Removal by a moderator (content-decision-form.tsx): the reason is kept
/// in the history; nothing comes back.
struct TeamRemovalSheet: View {
    @EnvironmentObject private var session: AppSession
    @Environment(\.dismiss) private var dismiss
    let report: TeamReport
    let removed: () async -> Void
    @State private var reason = ""
    @State private var busy = false

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    TeamEvidence(text: report.text.isEmpty ? "Публикация с медиа" : report.text)
                    TeamNote(report.removeNote + " Решение и причина сохранятся в истории. Восстановление не предусмотрено.")
                    TeamNoteField(title: "Причина удаления", text: $reason, placeholder: "Опиши нарушение")
                    Button {
                        Task { await remove() }
                    } label: {
                        Text(busy ? "Сохраняем…" : "Подтвердить удаление")
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(DangerButtonStyle())
                    .disabled(busy || reason.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
                .padding(20)
            }
            .background(Noct.background)
            .scrollDismissesKeyboard(.interactively)
            .navigationTitle(report.removeTitle)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Отмена") { dismiss() }
                        .disabled(busy)
                }
            }
        }
        .presentationDetents([.medium, .large])
    }

    private func remove() async {
        guard !busy else { return }
        busy = true
        defer { busy = false }
        do {
            _ = try await session.api.socialPost("removeContent", [
                "id": report.targetId,
                "targetType": report.targetType,
                "reason": reason.trimmingCharacters(in: .whitespacesAndNewlines),
            ])
            Haptics.success()
            await removed()
            dismiss()
        } catch {
            session.report(error)
        }
    }
}

// MARK: - Удаления

/// What moderators removed, newest first.
struct TeamRemovalsView: View {
    @EnvironmentObject private var session: AppSession
    @State private var removals: [TeamRemoval] = []
    @State private var loading = true
    @State private var loadingMore = false
    @State private var more = false
    @State private var error: String?

    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 12) {
                ForEach(removals) { removal in
                    TeamCard {
                        HStack(spacing: 8) {
                            Image(systemName: "checkmark.shield")
                                .font(.system(size: 14, weight: .semibold))
                                .foregroundColor(Noct.text60)
                            Text(removal.title)
                                .font(.system(size: 15, weight: .semibold))
                                .foregroundColor(.white)
                        }
                        TeamEvidence(text: removal.text.isEmpty ? "Публикация с медиа или кодом" : removal.text)
                        TeamNote("Причина: " + removal.reason, color: Noct.text75)
                        TeamNote(TeamText.account(removal.moderatorHandle) + " · " + Format.full(removal.created))
                    }
                }
                if loading && removals.isEmpty {
                    LoadingRow()
                } else if let error {
                    ErrorBanner(text: error) { Task { await load() } }
                } else if removals.isEmpty {
                    EmptyState(icon: "trash", text: "Удалений модератором пока нет.")
                }
                if more {
                    TeamMoreButton(loading: loadingMore) { Task { await load(append: true) } }
                }
            }
            .padding(16)
        }
        .background(Noct.background)
        .refreshable { await load() }
        .navigationTitle("Удаления")
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
    }

    private func load(append: Bool = false) async {
        if append { loadingMore = true } else { loading = true }
        defer {
            loading = false
            loadingMore = false
        }
        var params: [String: String?] = [:]
        if append, let last = removals.last {
            params["before"] = String(Int64(last.created))
            params["beforeId"] = last.id
        }
        do {
            let rows = try await session.api.social("moderationRemovals", params).array.map(TeamRemoval.init)
            removals = append ? removals + rows : rows
            more = rows.count == 50
            error = nil
        } catch is CancellationError {
            return
        } catch {
            self.error = error.userMessage ?? "Не удалось загрузить историю."
        }
    }
}

// MARK: - Антиспам

/// The spam filter: the anti-raid mode and advertising domains (changed by
/// administrators), and the queue of held sendings to approve or reject.
struct TeamAntispamView: View {
    @EnvironmentObject private var session: AppSession
    @EnvironmentObject private var nav: Navigator
    @State private var status = "pending"
    @State private var items: [TeamSpamItem] = []
    @State private var settings: TeamSpamSettings?
    @State private var domains = ""
    @State private var raid = false
    @State private var notes: [String: String] = [:]
    @State private var loading = true
    @State private var loadingMore = false
    @State private var hasMore = false
    @State private var busy = false
    @State private var error: String?

    private static let statuses = [
        SegmentOption("pending", "Ожидают проверки"),
        SegmentOption("approved", "Одобрены"),
        SegmentOption("rejected", "Отклонены"),
    ]

    private var admin: Bool { session.me?.canAdmin == true }

    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 12) {
                settingsCard
                TeamFilterBar(options: Self.statuses, selection: $status)
                    .padding(.horizontal, -16)
                    .padding(.top, 6)
                ForEach(items) { item in
                    card(item)
                }
                if loading && items.isEmpty {
                    LoadingRow()
                } else if let error {
                    ErrorBanner(text: error) { Task { await load() } }
                } else if items.isEmpty {
                    EmptyState(
                        icon: "shield",
                        text: status == "pending"
                            ? "Подозрительные отправки появятся здесь. Пока они не одобрены, их не видят другие пользователи."
                            : "В этом разделе нет рассмотренных отправок."
                    )
                }
                if hasMore {
                    TeamMoreButton(loading: loadingMore) { Task { await load(append: true) } }
                }
            }
            .padding(16)
        }
        .background(Noct.background)
        .scrollDismissesKeyboard(.interactively)
        .refreshable { await load(settings: true) }
        .navigationTitle("Антиспам")
        .navigationBarTitleDisplayMode(.inline)
        .task(id: status) {
            items = []
            await load(settings: settings == nil)
        }
    }

    private var settingsCard: some View {
        TeamCard {
            HStack(spacing: 12) {
                SettingsIcon(symbol: "shield.lefthalf.filled", color: IconColor.green, size: 36)
                VStack(alignment: .leading, spacing: 2) {
                    Text("Защита от спама")
                        .font(.system(size: 16, weight: .semibold))
                        .foregroundColor(.white)
                    TeamNote("Проверка рекламы и повторов в ленте, комментариях и группах.")
                }
            }
            Toggle(isOn: $raid) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Антирейд")
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundColor(.white)
                    TeamNote("На 24 часа. Первая публичная отправка новых аккаунтов — после проверки, остальные — с увеличенным интервалом.")
                }
            }
            .tint(Noct.green)
            .disabled(!admin || settings == nil || busy)
            if let settings, settings.raidOn {
                Label("Включён до " + Format.full(settings.raidUntil), systemImage: "clock")
                    .font(.system(size: 13))
                    .foregroundColor(Noct.gold)
            }
            if admin {
                VStack(alignment: .leading, spacing: 6) {
                    Text("Рекламные домены")
                        .font(.system(size: 13))
                        .foregroundColor(Noct.text60)
                    TextField("example.com — по одному в строке", text: $domains, axis: .vertical)
                        .lineLimit(3...8)
                        .font(.system(size: 14, design: .monospaced))
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .noctField()
                }
                TeamNote("Учитываются скрытые символы, похожие буквы и кодированные ссылки. Домены также проверяются в именах, юзернеймах и описаниях.")
                FlowLayout(spacing: 8, lineSpacing: 8) {
                    Button("Сохранить защиту") {
                        Task { await saveSettings() }
                    }
                    .buttonStyle(PrimaryButtonStyle())
                    .disabled(settings == nil || busy)
                    Button("Перезагрузить") {
                        Task { await load(settings: true) }
                    }
                    .buttonStyle(SecondaryButtonStyle())
                    .disabled(busy || loading)
                }
            } else {
                TeamNote("Изменить режим и список доменов может администратор.")
            }
        }
    }

    private func card(_ item: TeamSpamItem) -> some View {
        TeamCard {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(item.name)
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundColor(.white)
                    TeamNote(item.handle.isEmpty ? "Без юзернейма" : "@" + item.handle)
                }
                Spacer(minLength: 8)
                TeamChip(status: TeamStatus(title: item.kindLabel, color: Noct.lilac))
            }
            TeamNote((item.contextName.isEmpty ? "Место публикации удалено" : item.contextName) + " · " + Format.full(item.created))
            VStack(alignment: .leading, spacing: 4) {
                ForEach(item.reasons, id: \.self) { reason in
                    Label(reason, systemImage: "exclamationmark.triangle.fill")
                        .font(.system(size: 13))
                        .foregroundColor(Noct.gold)
                }
            }
            TeamEvidence(text: item.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? "Вложение без подписи" : item.text, monospaced: true)
            if item.hasMedia {
                TeamNote("Есть вложения. Они сохранятся при одобрении.")
            }
            if item.status == "pending" {
                TeamNoteField(title: "Комментарий к решению", text: note(item.id), placeholder: "Необязательно")
                FlowLayout(spacing: 8, lineSpacing: 8) {
                    Button {
                        Task { await review(item, decision: "approve") }
                    } label: {
                        Label("Одобрить", systemImage: "checkmark")
                    }
                    .buttonStyle(PrimaryButtonStyle())
                    Button {
                        Task { await review(item, decision: "reject") }
                    } label: {
                        Label("Отклонить", systemImage: "xmark")
                    }
                    .buttonStyle(SecondaryButtonStyle())
                    Button {
                        nav.push(.teamSection(.accounts(TeamTarget(id: item.actorId, handle: item.handle))))
                    } label: {
                        Label("Ограничить автора", systemImage: "exclamationmark.shield")
                    }
                    .buttonStyle(SecondaryButtonStyle())
                }
                .disabled(busy)
            } else {
                TeamNote((item.status == "approved" ? "Одобрено" : "Отклонено") + " · " + Format.full(item.reviewedAt) + (item.note.isEmpty ? "" : " · " + item.note), color: Noct.text60)
            }
        }
    }

    private func note(_ id: String) -> Binding<String> {
        Binding(get: { notes[id] ?? "" }, set: { notes[id] = $0 })
    }

    private func apply(_ value: TeamSpamSettings) {
        settings = value
        domains = value.domains.joined(separator: "\n")
        raid = value.raidOn
    }

    private func load(append: Bool = false, settings reload: Bool = false) async {
        if append { loadingMore = true } else { loading = true }
        defer {
            loading = false
            loadingMore = false
        }
        var params: [String: String?] = ["status": status]
        if append, let last = items.last {
            params["before"] = String(Int64(last.created))
            params["beforeId"] = last.id
        }
        do {
            let page = try await session.api.social("spamQueue", params)
            let rows = page["items"].array.map(TeamSpamItem.init)
            if append {
                let known = Set(items.map(\.id))
                items += rows.filter { !known.contains($0.id) }
            } else {
                items = rows
            }
            hasMore = page["hasMore"].bool
            if reload || settings == nil { apply(TeamSpamSettings(page["settings"])) }
            error = nil
        } catch is CancellationError {
            return
        } catch {
            self.error = error.userMessage ?? "Не удалось загрузить очередь."
        }
    }

    private func saveSettings() async {
        guard !busy, let settings else { return }
        busy = true
        defer { busy = false }
        let list = domains
            .components(separatedBy: CharacterSet(charactersIn: " ,;\n\t\r"))
            .filter { !$0.isEmpty }
        do {
            let answer = try await session.api.socialPost("spamSettings", [
                "domains": list,
                "raid": raid,
                "expectedUpdated": settings.updated,
            ])
            apply(TeamSpamSettings(answer))
            Haptics.success()
            session.show("Настройки защиты сохранены")
        } catch {
            session.report(error)
        }
    }

    private func review(_ item: TeamSpamItem, decision: String) async {
        guard !busy else { return }
        busy = true
        defer { busy = false }
        do {
            _ = try await session.api.socialPost("spamReview", [
                "id": item.id,
                "decision": decision,
                "note": (notes[item.id] ?? "").trimmingCharacters(in: .whitespacesAndNewlines),
            ])
            Haptics.success()
            session.show(decision == "approve" ? "Отправка одобрена" : "Отправка отклонена")
            notes[item.id] = nil
            await load()
        } catch {
            session.report(error)
        }
    }
}

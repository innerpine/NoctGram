import SwiftUI

/// «Управление» for administrators (app/administration-panel.tsx): Stars,
/// Premium, verification and the moderator role of an account, with the
/// journal of recent changes. Collectible gifts and Market lots are issued
/// on the site.
struct TeamAdministrationView: View {
    @EnvironmentObject private var session: AppSession
    @EnvironmentObject private var nav: Navigator
    @State private var sort = "recent"
    @State private var query = ""
    @State private var people: [TeamAdminPerson] = []
    @State private var events: [TeamAdminEvent] = []
    @State private var more = false
    @State private var loading = true
    @State private var loadingMore = false
    @State private var error: String?
    @State private var selected: TeamAdminPerson?

    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 10) {
                NoctSegments(options: [SegmentOption("recent", "Недавние"), SegmentOption("balance", "Самые богатые")], selection: $sort)
                TeamSearchField(text: $query, placeholder: "Имя, основной или дополнительный @юзернейм")
                    .padding(.bottom, 4)
                ForEach(people) { person in
                    Button {
                        selected = person
                    } label: {
                        TeamPersonRow(
                            person: person.identity,
                            subtitle: "@" + person.handle,
                            trailing: person.isChannel ? nil : Format.count(person.balance),
                            status: TeamStatus(title: person.role, color: person.administrator || person.moderator ? Noct.lilac : Noct.text60)
                        )
                    }
                    .buttonStyle(PressableStyle())
                }
                if loading && people.isEmpty {
                    LoadingRow()
                } else if let error {
                    ErrorBanner(text: error) { Task { await load() } }
                } else if people.isEmpty {
                    EmptyState(icon: "person.crop.circle.badge.questionmark", text: "Никого не нашли. Попробуйте другой юзернейм.")
                }
                if more {
                    TeamMoreButton(loading: loadingMore) { Task { await load(append: true) } }
                }
                SettingsGroup {
                    SettingsRow("Подарки и лоты Маркета", icon: "gift.fill", color: IconColor.pink, divider: false) {
                        nav.push(.web(title: "Кабинет команды", path: "/?page=moderation"))
                    }
                }
                .padding(.horizontal, -16)
                .padding(.top, 10)
                TeamNote("Коллекционные подарки и лоты Маркета выпускаются в кабинете на сайте.")
                    .padding(.horizontal, 4)
                journal
                    .padding(.top, 14)
            }
            .padding(16)
        }
        .background(Noct.background)
        .scrollDismissesKeyboard(.interactively)
        .refreshable { await load() }
        .navigationTitle("Управление")
        .navigationBarTitleDisplayMode(.inline)
        .task(id: sort + "|" + query) {
            if !query.isEmpty {
                try? await Task.sleep(nanoseconds: 250_000_000)
                guard !Task.isCancelled else { return }
            }
            await load()
        }
        .sheet(item: $selected) { person in
            TeamGrantSheet(person: person) {
                await load()
            }
            .environmentObject(session)
            .environmentObject(nav)
        }
    }

    private var journal: some View {
        VStack(alignment: .leading, spacing: 10) {
            Label("Последние действия", systemImage: "clock.arrow.circlepath")
                .font(.system(size: 17, weight: .semibold))
                .foregroundColor(.white)
            if events.isEmpty {
                TeamCard {
                    Text("Пока без изменений")
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundColor(.white)
                    TeamNote("Выдачи и изменения ролей появятся здесь.")
                }
            }
            ForEach(events) { event in
                TeamCard {
                    HStack(alignment: .firstTextBaseline) {
                        Text(event.title)
                            .font(.system(size: 15, weight: .semibold))
                            .foregroundColor(.white)
                        Spacer(minLength: 8)
                        Text(Format.full(event.created))
                            .font(.system(size: 12))
                            .foregroundColor(Noct.text48)
                    }
                    TeamNote(event.subtitle, color: Noct.text75)
                    if !event.reason.isEmpty {
                        TeamNote(event.reason)
                    }
                }
            }
        }
    }

    private func load(append: Bool = false) async {
        if append { loadingMore = true } else { loading = true }
        defer {
            loading = false
            loadingMore = false
        }
        var params: [String: String?] = ["sort": append ? "balance" : sort, "q": query]
        if append { params["offset"] = String(people.count) }
        do {
            let page = try await session.api.social("administration", params)
            let rows = page["people"].array.map(TeamAdminPerson.init)
            if append {
                let known = Set(people.map(\.id))
                people += rows.filter { !known.contains($0.id) }
            } else {
                people = rows
                events = page["events"].array.map(TeamAdminEvent.init)
            }
            more = page["more"].bool
            error = nil
        } catch is CancellationError {
            return
        } catch {
            self.error = error.userMessage ?? "Не удалось загрузить аккаунты."
        }
    }
}

/// One change to one account: what, how much and why; saved to the journal.
struct TeamGrantSheet: View {
    @EnvironmentObject private var session: AppSession
    @EnvironmentObject private var nav: Navigator
    @Environment(\.dismiss) private var dismiss
    let person: TeamAdminPerson
    let saved: () async -> Void
    @State private var grant: TeamGrant
    @State private var amount: String
    @State private var reason = ""
    @State private var busy = false
    /// The id of a request that did not get an answer: a retry of the same
    /// change reuses it, so the server never applies it twice.
    @State private var pending: (change: String, id: String)?

    init(person: TeamAdminPerson, saved: @escaping () async -> Void) {
        self.person = person
        self.saved = saved
        let first: TeamGrant = person.isChannel ? .verified : .stars
        _grant = State(initialValue: first)
        _amount = State(initialValue: first.defaultAmount)
    }

    private var grants: [TeamGrant] {
        person.isChannel ? [.verified] : TeamGrant.allCases
    }

    private var states: [SegmentOption] {
        grant == .verified
            ? [SegmentOption("1", "Подтвердить аккаунт"), SegmentOption("0", "Снять верификацию")]
            : [SegmentOption("1", "Назначить модератором"), SegmentOption("0", "Снять роль модератора")]
    }

    private var number: Int? {
        guard let value = Int(amount.trimmingCharacters(in: .whitespaces)) else { return nil }
        if grant.counted { return (1...grant.limit).contains(value) ? value : nil }
        return value == 0 || value == 1 ? value : nil
    }

    private var trimmedReason: String {
        reason.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    header
                    TeamChoice(
                        title: "Действие",
                        selection: Binding(get: { grant.rawValue }, set: { value in
                            guard let next = TeamGrant(rawValue: value) else { return }
                            grant = next
                            amount = next.defaultAmount
                        }),
                        options: grants.map { SegmentOption($0.rawValue, $0.title) }
                    )
                    if grant == .collectible {
                        TeamNote("Коллекционные подарки с номерами и атрибутами выпускаются в кабинете на сайте.")
                        Button {
                            dismiss()
                            nav.push(.web(title: "Кабинет команды", path: "/?page=moderation"))
                        } label: {
                            Label("Открыть кабинет на сайте", systemImage: "safari")
                                .frame(maxWidth: .infinity)
                        }
                        .buttonStyle(SecondaryButtonStyle())
                    } else {
                        amountField
                        TeamNoteField(title: "Причина", text: $reason, placeholder: grant.placeholder)
                        summary
                        HStack {
                            Label("Сохраним в журнале", systemImage: "clock.arrow.circlepath")
                                .font(.system(size: 13))
                                .foregroundColor(Noct.text48)
                            Spacer(minLength: 8)
                            Button {
                                Task { await submit() }
                            } label: {
                                Label(busy ? "Сохраняем…" : submitTitle, systemImage: "checkmark")
                            }
                            .buttonStyle(PrimaryButtonStyle())
                            .disabled(busy || number == nil || trimmedReason.isEmpty)
                        }
                    }
                }
                .padding(20)
                .disabled(busy)
            }
            .background(Noct.background)
            .scrollDismissesKeyboard(.interactively)
            .navigationTitle("Изменить аккаунт")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Закрыть") { dismiss() }
                        .disabled(busy)
                }
            }
        }
    }

    private var header: some View {
        HStack(spacing: 12) {
            AvatarView(person: person.identity, size: 52)
            VStack(alignment: .leading, spacing: 3) {
                DisplayName(person: person.identity, size: 17)
                Text("@" + person.handle)
                    .font(.system(size: 14))
                    .foregroundColor(Noct.text48)
                TeamChip(status: TeamStatus(title: person.role, color: Noct.lilac))
            }
            Spacer(minLength: 8)
            if !person.isChannel {
                VStack(alignment: .trailing, spacing: 2) {
                    HStack(spacing: 4) {
                        Image(systemName: "star.fill")
                            .font(.system(size: 12))
                        Text(Format.count(person.balance))
                            .monospacedDigit()
                    }
                    .font(.system(size: 17, weight: .semibold))
                    .foregroundColor(Noct.gold)
                    Text("баланс Stars")
                        .font(.system(size: 11))
                        .foregroundColor(Noct.text48)
                }
            }
        }
    }

    @ViewBuilder private var amountField: some View {
        if grant.counted {
            VStack(alignment: .leading, spacing: 6) {
                HStack {
                    Text(grant == .premium ? "Дней Premium" : "Количество Stars")
                        .font(.system(size: 13))
                        .foregroundColor(Noct.text60)
                    Spacer(minLength: 8)
                    if grant == .starsDebit {
                        Button("Всё") {
                            amount = String(min(max(person.balance, 0), 1_000_000))
                        }
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundColor(.white)
                    }
                }
                TextField(grant == .premium ? "от 1 до 365" : "от 1 до 1 000 000", text: Binding(
                    get: { amount },
                    set: { amount = String($0.filter(\.isNumber).prefix(7)) }
                ))
                .keyboardType(.numberPad)
                .monospacedDigit()
                .noctField()
            }
        } else {
            TeamChoice(title: "Состояние", selection: $amount, options: states)
        }
    }

    private var summary: some View {
        HStack(alignment: .top, spacing: 12) {
            SettingsIcon(symbol: grant.icon, color: grant == .starsDebit ? IconColor.red : IconColor.indigo, size: 36)
            VStack(alignment: .leading, spacing: 3) {
                Text("После подтверждения")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundColor(.white)
                TeamNote(summaryText, color: Noct.text75)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(14)
        .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(Color.white.opacity(0.04)))
    }

    private var summaryText: String {
        let value = Int(amount) ?? 0
        let handle = "@" + person.handle
        switch grant {
        case .starsDebit: return "У \(handle) спишется \(Format.count(value)) Stars. Баланс не может стать отрицательным."
        case .stars: return "\(handle) получит \(Format.count(value)) Stars."
        case .premium: return "Premium для \(handle) будет продлён на \(value) дн."
        case .verified: return (amount == "1" ? "Подтвердить " : "Снять подтверждение ") + handle + "."
        case .moderator: return (amount == "1" ? "Назначить модератором " : "Снять роль модератора у ") + handle + "."
        case .collectible: return ""
        }
    }

    private var submitTitle: String {
        switch grant {
        case .stars, .starsDebit, .premium: return grant.title
        default: return states.first { $0.key == amount }?.title ?? "Сохранить"
        }
    }

    private func submit() async {
        guard !busy, let number, !trimmedReason.isEmpty else { return }
        busy = true
        defer { busy = false }
        let change = [person.id, grant.rawValue, String(number), trimmedReason].joined(separator: "\n")
        if pending?.change != change {
            pending = (change, UUID().uuidString.lowercased())
        }
        let requestId = pending?.id ?? UUID().uuidString.lowercased()
        do {
            _ = try await session.api.socialPost("adminGrant", [
                "target": person.id,
                "kind": grant.rawValue,
                "amount": number,
                "reason": trimmedReason,
                "requestId": requestId,
            ])
            pending = nil
            Haptics.success()
            session.show("Изменение сохранено и записано в журнал.")
            await saved()
            dismiss()
        } catch {
            session.report(error)
        }
    }
}

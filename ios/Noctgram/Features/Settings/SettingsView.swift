import SwiftUI

struct SettingsView: View {
    @EnvironmentObject private var session: AppSession
    @EnvironmentObject private var nav: Navigator
    @State private var confirmSignOut = false
    @State private var editing: EditorTab?
    @State private var showServer = false
    @State private var email: String?

    var body: some View {
        List {
            if let me = session.me {
                Section {
                    Button {
                        nav.push(.profile(me.id))
                    } label: {
                        PersonRow(person: me.identity, subtitle: email.map { "@\(me.handle) · \($0)" } ?? "@" + me.handle, avatarSize: 52)
                    }
                    .listRowBackground(Noct.card)
                }
                Section("Аккаунт") {
                    row("Редактировать профиль", icon: "person.crop.circle") { editing = .profile }
                    row("Оформление профиля", icon: "paintpalette") { editing = .design }
                    row("Приватность и чёрный список", icon: "hand.raised") { editing = .privacy }
                    row("Сохранённое", icon: "bookmark") { nav.push(.saved) }
                    row("Noct Stars", icon: "star.circle") { nav.push(.wallet) }
                }
                .listRowBackground(Noct.card)
            }
            Section("Noctgram") {
                row("Каналы", icon: "megaphone") { nav.push(.web(title: "Каналы", path: "/?page=channels")) }
                row("Музыка", icon: "music.note") { nav.push(.web(title: "Музыка", path: "/?page=music")) }
                row("Noct Market", icon: "storefront") { nav.push(.web(title: "Маркет", path: "/market")) }
                row("Noct Premium", icon: "sparkles") { nav.push(.web(title: "Noct Premium", path: "/?page=premium")) }
                row("Веб-версия целиком", icon: "globe") { nav.push(.web(title: "Noctgram", path: "/")) }
            }
            .listRowBackground(Noct.card)
            Section {
                Button {
                    showServer = true
                } label: {
                    HStack {
                        Label("Сервер", systemImage: "server.rack")
                        Spacer()
                        Text(session.serverLabel).foregroundColor(Noct.text48)
                    }
                }
                .foregroundColor(.white)
                HStack {
                    Label("Версия", systemImage: "info.circle")
                    Spacer()
                    Text(appVersion).foregroundColor(Noct.text48)
                }
            }
            .listRowBackground(Noct.card)
            Section {
                Button(role: .destructive) {
                    confirmSignOut = true
                } label: {
                    Label("Выйти из аккаунта", systemImage: "rectangle.portrait.and.arrow.right")
                        .foregroundColor(Noct.red)
                }
            }
            .listRowBackground(Noct.card)
        }
        .scrollContentBackground(.hidden)
        .background(Noct.background)
        .navigationTitle("Настройки")
        .navigationBarTitleDisplayMode(.inline)
        .confirmationDialog("Выйти из Noctgram?", isPresented: $confirmSignOut, titleVisibility: .visible) {
            Button("Выйти", role: .destructive) {
                Task { await session.signOut() }
            }
            Button("Отмена", role: .cancel) {}
        }
        .sheet(item: $editing) { tab in
            if let me = session.me {
                ProfileEditorView(profile: me, initialTab: tab) { updated in
                    session.me = updated
                }
                .environmentObject(session)
            }
        }
        .sheet(isPresented: $showServer) {
            ServerSheet().environmentObject(session)
        }
        .task {
            if let data = try? await session.api.get("/api/auth/session") {
                email = AuthStatus(data).user?.email
                if email?.isEmpty == true { email = nil }
            }
        }
    }

    private var appVersion: String {
        let info = Bundle.main.infoDictionary
        let version = info?["CFBundleShortVersionString"] as? String ?? "1.0"
        let build = info?["CFBundleVersion"] as? String ?? "1"
        return "\(version) (\(build))"
    }

    private func row(_ title: String, icon: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack {
                Label(title, systemImage: icon)
                Spacer()
                Image(systemName: "chevron.right")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundColor(Noct.text48)
            }
        }
        .foregroundColor(.white)
    }
}

/// Noct Stars balance and history (app/stars-panel.tsx).
struct WalletView: View {
    @EnvironmentObject private var session: AppSession
    @State private var wallet: Wallet?
    @State private var error: String?

    var body: some View {
        ScrollView {
            VStack(spacing: 16) {
                VStack(spacing: 8) {
                    Image("StarsArt")
                        .resizable()
                        .scaledToFit()
                        .frame(height: 96)
                    Text(wallet.map { Format.count($0.balance) } ?? "—")
                        .font(.system(size: 40, weight: .bold))
                        .foregroundColor(Noct.gold)
                        .monospacedDigit()
                    Text("Noct Stars")
                        .font(.system(size: 15))
                        .foregroundColor(Noct.text60)
                    if wallet?.testMode == true {
                        Text("Тестовые звёзды — без оплаты")
                            .font(.system(size: 12))
                            .foregroundColor(Noct.text48)
                    }
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 22)
                .noctCard()

                if let wallet {
                    HStack(spacing: 10) {
                        stat("Получено", wallet.received)
                        stat("Отправлено", wallet.sent)
                    }
                    VStack(alignment: .leading, spacing: 0) {
                        Text("История")
                            .font(.system(size: 15, weight: .semibold))
                            .padding(.bottom, 8)
                        if wallet.transactions.isEmpty {
                            Text("Операций пока нет.")
                                .font(.system(size: 14))
                                .foregroundColor(Noct.text48)
                        }
                        ForEach(wallet.transactions) { item in
                            transaction(item)
                        }
                    }
                    .padding(16)
                    .noctCard()
                } else if let error {
                    ErrorBanner(text: error) { Task { await load() } }
                } else {
                    LoadingRow()
                }
            }
            .padding(12)
        }
        .background(Noct.background)
        .refreshable { await load() }
        .navigationTitle("Noct Stars")
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
    }

    private func load() async {
        do {
            wallet = Wallet(try await session.api.social("wallet"))
            error = nil
        } catch {
            self.error = error.userMessage
        }
    }

    private func stat(_ title: String, _ value: Int) -> some View {
        VStack(spacing: 4) {
            Text(Format.count(value))
                .font(.system(size: 20, weight: .semibold))
                .monospacedDigit()
            Text(title)
                .font(.system(size: 12))
                .foregroundColor(Noct.text48)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 14)
        .noctCard(radius: 14)
    }

    private func transaction(_ item: StarTransaction) -> some View {
        let incoming = item.recipient == session.myId
        let label: String = {
            switch item.kind {
            case "support": return incoming ? "Поддержка публикации" : "Поддержка автора"
            case "gift": return "Подарок"
            case "gift_upgrade": return "Улучшение подарка"
            case "gift_conversion": return "Продажа подарка"
            case "telegram_test", "admin_grant": return "Пополнение"
            case "purchase": return "Покупка звёзд"
            case "market", "market_sale": return "Маркет"
            case "grant", "welcome", "starter": return "Стартовые звёзды"
            default: return incoming ? "Зачисление" : "Списание"
            }
        }()
        return HStack(spacing: 12) {
            AvatarView(person: Identity(id: item.id, name: item.name, avatar: item.avatar, handle: ""), size: 36)
            VStack(alignment: .leading, spacing: 2) {
                Text(label).font(.system(size: 14, weight: .medium))
                Text(item.name + " · " + Format.stamp(item.created))
                    .font(.system(size: 12))
                    .foregroundColor(Noct.text48)
                    .lineLimit(1)
            }
            Spacer()
            Text((incoming ? "+" : "−") + Format.count(item.amount))
                .font(.system(size: 15, weight: .semibold))
                .foregroundColor(incoming ? Noct.green : Noct.text75)
                .monospacedDigit()
        }
        .padding(.vertical, 8)
    }
}

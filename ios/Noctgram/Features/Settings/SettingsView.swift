import SwiftUI

/// Account and app settings, in the same grouped rows as the profile tab.
struct SettingsView: View {
    @EnvironmentObject private var session: AppSession
    @EnvironmentObject private var nav: Navigator
    @State private var confirmSignOut = false
    @State private var editing: EditorTab?
    @State private var showServer = false
    @State private var email: String?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 8) {
                if let me = session.me {
                    header("Аккаунт")
                    SettingsGroup {
                        SettingsRow("Почта", icon: "envelope.fill", color: IconColor.blue, value: email ?? "—", chevron: false, action: nil)
                        SettingsRow("Юзернейм", icon: "at", color: IconColor.indigo, value: "@" + me.handle, chevron: false) {
                            session.copy("@" + me.handle, message: "Юзернейм скопирован")
                        }
                        SettingsRow("Редактировать профиль", icon: "pencil", color: IconColor.orange, divider: false) {
                            editing = .profile
                        }
                    }
                }
                header("Приложение")
                SettingsGroup {
                    SettingsRow("Сервер", icon: "server.rack", color: IconColor.gray, value: session.serverLabel) {
                        showServer = true
                    }
                    SettingsRow("Веб-версия целиком", icon: "globe", color: IconColor.teal) {
                        nav.push(.web(title: "Noctgram", path: "/"))
                    }
                    SettingsRow("Версия", icon: "info", color: IconColor.gray, value: appVersion, chevron: false, divider: false, action: nil)
                }
                SettingsGroup {
                    SettingsRow("Выйти из аккаунта", titleColor: Noct.red, chevron: false, divider: false, action: { confirmSignOut = true }) {
                        SettingsIcon(symbol: "rectangle.portrait.and.arrow.right", color: IconColor.red)
                    }
                }
                .padding(.top, 24)
            }
            .padding(.top, 8)
            .padding(.bottom, 32)
        }
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

    private func header(_ title: String) -> some View {
        Text(title)
            .font(.system(size: 13, weight: .medium))
            .foregroundColor(Noct.text48)
            .padding(.horizontal, 32)
            .padding(.top, 16)
    }

    private var appVersion: String {
        let info = Bundle.main.infoDictionary
        let version = info?["CFBundleShortVersionString"] as? String ?? "1.0"
        let build = info?["CFBundleVersion"] as? String ?? "1"
        return "\(version) (\(build))"
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

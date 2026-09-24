import CoreImage.CIFilterBuiltins
import PhotosUI
import SwiftUI

/// The «Профиль» tab, laid out like the account screen of iOS apps: the
/// avatar and name in the middle, then rounded groups of rows with coloured
/// icons. «Мой профиль» opens the full profile as on the web.
struct ProfileHubView: View {
    @EnvironmentObject private var session: AppSession
    @EnvironmentObject private var nav: Navigator
    @State private var channels: [Person] = []
    @State private var balance: Int?
    @State private var editing: EditorTab?
    @State private var showQR = false
    @State private var pickAvatar = false
    @State private var avatarItem: PhotosPickerItem?
    @State private var uploading = false
    /// Whether the name is on screen; the bar shows the name once it is not.
    @State private var nameVisible = true

    var body: some View {
        if let me = session.me {
            hub(me)
        } else {
            LoadingRow()
        }
    }

    private var titleShown: Bool {
        if #available(iOS 18.0, *) { return !nameVisible }
        return false
    }

    private func accent(_ me: Profile) -> Color {
        me.appearance.accent
    }

    private func hub(_ me: Profile) -> some View {
        ScrollViewReader { proxy in
            ScrollView {
                VStack(spacing: 24) {
                    header(me)
                        .id("top")
                    SettingsGroup {
                        SettingsRow("Изменить фотографию", titleColor: accent(me), chevron: false, divider: false, action: { pickAvatar = true }) {
                            Image(systemName: "camera")
                                .font(.system(size: 21))
                                .foregroundColor(accent(me))
                        }
                    }
                    .disabled(uploading || session.readOnly)
                    channelsGroup(me)
                    SettingsGroup {
                        SettingsRow("Мой профиль", icon: "person.fill", color: IconColor.red, divider: false) {
                            nav.push(.profile(me.id))
                        }
                    }
                    SettingsGroup {
                        SettingsRow("Кошелёк", icon: "wallet.pass.fill", color: IconColor.blue, value: balance.map { Format.count($0) }) {
                            nav.push(.wallet)
                        }
                        SettingsRow("Сохранённое", icon: "bookmark.fill", color: IconColor.blue) {
                            nav.push(.saved)
                        }
                        SettingsRow("Подарки", icon: "gift.fill", color: IconColor.pink, divider: false) {
                            nav.push(.gifts(me.id))
                        }
                    }
                    SettingsGroup {
                        SettingsRow("Оформление", icon: "paintpalette.fill", color: IconColor.purple) {
                            editing = .design
                        }
                        SettingsRow("Приватность", icon: "lock.fill", color: IconColor.gray) {
                            editing = .privacy
                        }
                        SettingsRow("Настройки", icon: "gearshape.fill", color: IconColor.gray, divider: false) {
                            nav.push(.settings)
                        }
                    }
                    SettingsGroup {
                        SettingsRow("Noct Premium", icon: "star.fill", color: IconColor.indigo) {
                            nav.push(.web(title: "Noct Premium", path: "/?page=premium"))
                        }
                        SettingsRow("Каналы", icon: "megaphone.fill", color: IconColor.orange) {
                            nav.push(.web(title: "Каналы", path: "/?page=channels"))
                        }
                        SettingsRow("Музыка", icon: "music.note", color: IconColor.pink) {
                            nav.push(.web(title: "Музыка", path: "/?page=music"))
                        }
                        SettingsRow("Noct Market", icon: "bag.fill", color: IconColor.green, divider: false) {
                            nav.push(.web(title: "Маркет", path: "/market"))
                        }
                    }
                }
                .padding(.bottom, 32)
            }
            .background(Noct.background)
            .refreshable { await reload() }
            .onChange(of: nav.rootTap) { tap in
                guard tap.tab == .profile else { return }
                withAnimation(Noct.motion) { proxy.scrollTo("top", anchor: .top) }
            }
        }
        .navigationTitle(titleShown ? me.name : "")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .navigationBarLeading) {
                Button {
                    showQR = true
                } label: {
                    Image(systemName: "qrcode")
                }
                .accessibilityLabel("QR-код профиля")
            }
            ToolbarItem(placement: .navigationBarTrailing) {
                Button("Изм.") { editing = .profile }
                    .disabled(session.readOnly)
            }
        }
        .sheet(item: $editing) { tab in
            ProfileEditorView(profile: me, initialTab: tab) { updated in
                session.me = updated
            }
            .environmentObject(session)
        }
        .sheet(isPresented: $showQR) {
            ProfileQRSheet(profile: me, link: session.api.webLink(["profile": me.id]))
                .environmentObject(session)
        }
        .photosPicker(isPresented: $pickAvatar, selection: $avatarItem, matching: .images)
        .onChange(of: avatarItem) { item in
            guard let item else { return }
            Task { await changeAvatar(item, profile: me) }
        }
        .task {
            await reload()
            #if DEBUG
            let defaults = UserDefaults.standard
            if let tab = defaults.string(forKey: "noct.debugEditor").flatMap(EditorTab.init(rawValue:)) {
                editing = tab
            }
            if defaults.string(forKey: "noct.debugSheet") == "qr" { showQR = true }
            #endif
        }
    }

    private func header(_ me: Profile) -> some View {
        VStack(spacing: 0) {
            Button {
                nav.push(.profile(me.id))
            } label: {
                ProfileAvatar(person: me.identity, size: 104, bordered: false)
                    .overlay {
                        if uploading {
                            ZStack {
                                Circle().fill(Color.black.opacity(0.45))
                                ProgressView().tint(.white)
                            }
                            .frame(width: 104, height: 104)
                        }
                    }
            }
            .buttonStyle(PressableStyle())
            .accessibilityLabel("Мой профиль")
            DisplayName(person: me.identity, size: 28, weight: .semibold, tracking: -0.8)
                .padding(.top, 14)
                .onScrollVisible { visible in
                    withAnimation(Noct.quick) { nameVisible = visible }
                }
            Text(subtitle(me))
                .font(.system(size: 17))
                .foregroundColor(Noct.text60)
                .multilineTextAlignment(.center)
                .padding(.top, 6)
        }
        .frame(maxWidth: .infinity)
        .padding(.horizontal, 24)
        .padding(.top, 4)
    }

    private func subtitle(_ me: Profile) -> String {
        var parts: [String] = []
        if !me.anonymousNumber.isEmpty { parts.append(Format.marketNumber(me.anonymousNumber)) }
        parts.append("@" + me.handle)
        return parts.joined(separator: " • ")
    }

    /// Own channels, like the accounts list in Telegram.
    private func channelsGroup(_ me: Profile) -> some View {
        SettingsGroup {
            ForEach(channels) { channel in
                SettingsRow(channel.name, action: { nav.push(.profile(channel.id)) }) {
                    AvatarView(person: channel.identity, size: 30, ring: false)
                }
            }
            SettingsRow("Создать канал", titleColor: accent(me), chevron: false, divider: false, action: {
                nav.push(.web(title: "Каналы", path: "/?page=channels"))
            }) {
                Image(systemName: "plus")
                    .font(.system(size: 22))
                    .foregroundColor(accent(me))
            }
            .disabled(session.readOnly)
        }
    }

    private func reload() async {
        await session.refreshMe()
        if let data = try? await session.api.social("myChannels") {
            channels = data["channels"].array.map { Person($0) }
        }
        if let data = try? await session.api.social("wallet") {
            balance = data["balance"].int
        }
    }

    /// Picks, uploads and saves a new photo right away, keeping every other field.
    private func changeAvatar(_ item: PhotosPickerItem, profile: Profile) async {
        uploading = true
        defer {
            uploading = false
            avatarItem = nil
        }
        do {
            guard let data = try await item.loadTransferable(type: Data.self) else { return }
            // Avatars must be static images; photos become JPEG.
            let prepared = try MediaEncoder.prepare(data, types: [.jpeg], maxPixel: 1200)
            let result = try await session.api.upload("/api/upload", data: prepared.data, filename: prepared.filename, mimeType: prepared.mimeType)
            let url = result["url"].string ?? "/api/media/" + result["id"].str
            let saved = try await session.api.socialPost("profile", ProfileEditorView.fields(of: profile, avatar: url, own: true))
            session.me = Profile(saved)
            Haptics.success()
            session.show("Фото профиля обновлено")
        } catch {
            session.report(error)
        }
    }
}

/// «Подарки» from the hub: the gifts of a profile on their own screen.
struct GiftsScreen: View {
    @EnvironmentObject private var session: AppSession
    let profileId: String
    @StateObject private var store = ProfileStore()
    @State private var showGift = false

    private var own: Bool { profileId == session.myId }

    var body: some View {
        ScrollView {
            VStack(spacing: 12) {
                if let profile = store.profile {
                    if own {
                        Button {
                            showGift = true
                        } label: {
                            Label("Подарить себе", systemImage: "gift")
                                .frame(maxWidth: .infinity)
                        }
                        .buttonStyle(SecondaryButtonStyle())
                        .disabled(session.readOnly)
                    }
                    GiftsGrid(store: store, own: own || (profile.isChannel && profile.canEditProfile))
                } else if let error = store.error {
                    ErrorBanner(text: error) { Task { await load() } }
                } else {
                    LoadingRow()
                }
            }
            .padding(12)
        }
        .background(Noct.background)
        .refreshable { await load() }
        .navigationTitle("Подарки")
        .navigationBarTitleDisplayMode(.inline)
        .sheet(isPresented: $showGift) {
            if let profile = store.profile {
                SendGiftSheet(recipient: profile.identity)
                    .environmentObject(session)
            }
        }
        .task { if store.profile == nil { await load() } }
    }

    private func load() async {
        store.tab = .gifts
        await store.load(.id(profileId), api: session.api)
    }
}

/// The profile link as a QR code, to open it from another phone.
struct ProfileQRSheet: View {
    @EnvironmentObject private var session: AppSession
    @Environment(\.dismiss) private var dismiss
    let profile: Profile
    let link: URL
    private let code: UIImage?

    init(profile: Profile, link: URL) {
        self.profile = profile
        self.link = link
        code = QRCode.image(for: link.absoluteString)
    }

    var body: some View {
        let look = profile.appearance
        NavigationStack {
            ScrollView {
                VStack(spacing: 22) {
                    VStack(spacing: 16) {
                        if let code {
                            Image(uiImage: code)
                                .interpolation(.none)
                                .resizable()
                                .scaledToFit()
                                .frame(width: 230, height: 230)
                                .overlay {
                                    AvatarView(person: profile.identity, size: 54, ring: false)
                                        .overlay(Circle().stroke(Color.white, lineWidth: 5))
                                }
                                .accessibilityLabel("QR-код профиля")
                        }
                        Text("@" + profile.handle)
                            .font(.system(size: 21, weight: .bold))
                            .foregroundColor(.black)
                            .lineLimit(1)
                            .minimumScaleFactor(0.7)
                    }
                    .padding(24)
                    .background(RoundedRectangle(cornerRadius: 34, style: .continuous).fill(Color.white))
                    .padding(.top, 16)
                    Text("Наведи камеру телефона на код, чтобы открыть профиль в Noctgram.")
                        .font(.system(size: 14))
                        .foregroundColor(Noct.text60)
                        .multilineTextAlignment(.center)
                        .padding(.horizontal, 32)
                    VStack(spacing: 10) {
                        ShareLink(item: link) {
                            Label("Поделиться", systemImage: "square.and.arrow.up")
                                .frame(maxWidth: .infinity)
                        }
                        .buttonStyle(PrimaryButtonStyle())
                        Button {
                            session.copy(link.absoluteString, message: "Ссылка на профиль скопирована")
                        } label: {
                            Label("Скопировать ссылку", systemImage: "link")
                                .frame(maxWidth: .infinity)
                        }
                        .buttonStyle(SecondaryButtonStyle())
                    }
                    .padding(.horizontal, 24)
                }
                .frame(maxWidth: .infinity)
                .padding(.bottom, 24)
            }
            .background(
                LinearGradient(
                    colors: [(look.premium ? look.theme.wash : Color(hex: 0x426B98)).opacity(0.45), .black],
                    startPoint: .top,
                    endPoint: .bottom
                )
                .ignoresSafeArea()
            )
            .navigationTitle("QR-код")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Закрыть") { dismiss() }
                }
            }
        }
    }
}

enum QRCode {
    /// Black modules on white; high error correction leaves room for the avatar.
    static func image(for text: String) -> UIImage? {
        let filter = CIFilter.qrCodeGenerator()
        filter.message = Data(text.utf8)
        filter.correctionLevel = "H"
        guard let output = filter.outputImage else { return nil }
        let scaled = output.transformed(by: CGAffineTransform(scaleX: 12, y: 12))
        guard let image = CIContext().createCGImage(scaled, from: scaled.extent) else { return nil }
        return UIImage(cgImage: image)
    }
}

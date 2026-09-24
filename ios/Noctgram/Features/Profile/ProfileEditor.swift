import PhotosUI
import SwiftUI
import UIKit
import UniformTypeIdentifiers

enum EditorTab: String, Identifiable, CaseIterable {
    case profile, design, privacy

    var id: String { rawValue }

    var title: String {
        switch self {
        case .profile: return "Профиль"
        case .design: return "Дизайн"
        case .privacy: return "Приватность"
        }
    }
}

/// «Редактировать»: profile, design and privacy tabs as in the web editor.
/// Every field goes into one POST action=profile, so a username conflict
/// cancels the whole save (PROFILE_DETAILS.md).
struct ProfileEditorView: View {
    @EnvironmentObject private var session: AppSession
    @Environment(\.dismiss) private var dismiss
    let profile: Profile
    let onSaved: (Profile) -> Void

    @State private var tab: EditorTab
    @State private var name: String
    @State private var bio: String
    @State private var avatar: String
    @State private var cover: String
    @State private var mainHandle: String
    @State private var extraHandles: [String]
    @State private var location: String
    @State private var website: String
    @State private var instagram: String
    @State private var tiktok: String
    @State private var youtube: String
    @State private var hasBirthday: Bool
    @State private var birthday: Date
    @State private var showBirthYear: Bool
    @State private var channelIds: [String]
    @State private var myChannels: [Person] = []
    @State private var channelsFailed = false

    @State private var avatarItem: PhotosPickerItem?
    @State private var coverItem: PhotosPickerItem?
    @State private var uploadingAvatar = false
    @State private var uploadingCover = false
    @State private var saving = false
    @State private var error: String?

    init(profile: Profile, initialTab: EditorTab = .profile, onSaved: @escaping (Profile) -> Void) {
        self.profile = profile
        self.onSaved = onSaved
        _tab = State(initialValue: initialTab)
        _name = State(initialValue: profile.name)
        _bio = State(initialValue: profile.bio)
        _avatar = State(initialValue: profile.avatar)
        _cover = State(initialValue: profile.cover)
        _mainHandle = State(initialValue: profile.handle)
        _extraHandles = State(initialValue: profile.extraHandles)
        _location = State(initialValue: profile.location)
        _website = State(initialValue: profile.website)
        _instagram = State(initialValue: profile.instagram)
        _tiktok = State(initialValue: profile.tiktok)
        _youtube = State(initialValue: profile.youtube)
        let date = BirthdayFormat.date(profile.birthday)
        _hasBirthday = State(initialValue: date != nil)
        _birthday = State(initialValue: date ?? Calendar.current.date(byAdding: .year, value: -20, to: Date()) ?? Date())
        _showBirthYear = State(initialValue: profile.showBirthYear)
        _channelIds = State(initialValue: profile.personalChannels.map(\.id))
    }

    private var own: Bool { profile.id == session.myId }
    private var person: Bool { !profile.isChannel }
    private var manageHandles: Bool { own || profile.channelRole == "owner" }
    private var tabs: [EditorTab] { own ? EditorTab.allCases : [.profile, .design] }

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                NoctSegments(options: tabs.map { SegmentOption($0.rawValue, $0.title) }, selection: Binding(
                    get: { tab.rawValue },
                    set: { tab = EditorTab(rawValue: $0) ?? .profile }
                ))
                .padding(.horizontal, 16)
                .padding(.vertical, 10)
                switch tab {
                case .profile:
                    profileForm
                case .design:
                    DesignEditor(profile: profile) { updated in
                        onSaved(updated)
                        dismiss()
                    }
                case .privacy:
                    PrivacyEditor()
                }
            }
            .background(Noct.elevated.ignoresSafeArea())
            .navigationTitle(profile.isChannel ? "Канал" : "Редактировать")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Отмена") { dismiss() }
                }
                if tab == .profile {
                    ToolbarItem(placement: .confirmationAction) {
                        Button {
                            Task { await save() }
                        } label: {
                            if saving {
                                ProgressView().tint(.white)
                            } else {
                                Text("Сохранить").fontWeight(.semibold)
                            }
                        }
                        .disabled(saving || uploadingAvatar || uploadingCover || name.trimmingCharacters(in: .whitespaces).isEmpty)
                    }
                }
            }
        }
        .onChange(of: avatarItem) { item in
            guard let item else { return }
            Task { await upload(item, cover: false) }
        }
        .onChange(of: coverItem) { item in
            guard let item else { return }
            Task { await upload(item, cover: true) }
        }
        .task {
            guard own, person else { return }
            do {
                let data = try await session.api.social("myChannels")
                myChannels = data["channels"].array.map { Person($0) }
            } catch {
                channelsFailed = true
            }
        }
    }

    // MARK: Profile form

    private var profileForm: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 22) {
                imagesSection
                section("Основное") {
                    field("Имя", text: $name, limit: 40)
                    VStack(alignment: .leading, spacing: 6) {
                        Text("Описание").font(.system(size: 13)).foregroundColor(Noct.text60)
                        TextField("Расскажи о себе", text: $bio, axis: .vertical)
                            .lineLimit(3...8)
                            .noctField()
                            .onChange(of: bio) { value in if value.count > 300 { bio = String(value.prefix(300)) } }
                        Text("\(bio.count)/300")
                            .font(.system(size: 11))
                            .foregroundColor(Noct.text48)
                            .frame(maxWidth: .infinity, alignment: .trailing)
                    }
                }
                if manageHandles {
                    usernamesSection
                }
                if own && person {
                    detailsSection
                    socialsSection
                    channelsSection
                }
                if let error {
                    Text(error)
                        .font(.system(size: 14))
                        .foregroundColor(Noct.red)
                }
            }
            .padding(16)
        }
        .scrollDismissesKeyboard(.interactively)
    }

    private var imagesSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            ZStack(alignment: .bottomLeading) {
                ZStack {
                    if let url = session.api.mediaURL(cover == "liquid" ? "" : cover) {
                        RemoteImage(url: url, maxPixel: 1200)
                    } else if cover == "liquid", let url = session.api.mediaURL(avatar) {
                        LiquidCover(url: url)
                    } else {
                        Noct.coverFill
                    }
                    if uploadingCover {
                        Color.black.opacity(0.4)
                        ProgressView().tint(.white)
                    }
                }
                .frame(height: 120)
                .frame(maxWidth: .infinity)
                .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))

                ZStack {
                    AvatarView(person: Identity(id: profile.id, name: name, avatar: avatar, handle: mainHandle, kind: profile.kind, appearance: profile.appearance), size: 76, ring: false)
                        .overlay(Circle().stroke(Noct.elevated, lineWidth: 4))
                    if uploadingAvatar {
                        Circle().fill(Color.black.opacity(0.45)).frame(width: 76, height: 76)
                        ProgressView().tint(.white)
                    }
                }
                .offset(x: 14, y: 38)
            }
            .padding(.bottom, 38)

            VStack(alignment: .leading, spacing: 8) {
                HStack(spacing: 8) {
                    PhotosPicker(selection: $avatarItem, matching: .images) {
                        Label("Фото профиля", systemImage: "person.crop.circle")
                    }
                    .buttonStyle(SecondaryButtonStyle())
                    if !avatar.isEmpty {
                        Button {
                            avatar = ""
                            if cover == "liquid" { cover = "" }
                        } label: {
                            Image(systemName: "trash")
                        }
                        .buttonStyle(CircleButtonStyle())
                        .accessibilityLabel("Убрать фото")
                    }
                }
                HStack(spacing: 8) {
                    PhotosPicker(selection: $coverItem, matching: .images) {
                        Label("Обложка", systemImage: "photo")
                    }
                    .buttonStyle(SecondaryButtonStyle())
                    Button {
                        cover = "liquid"
                    } label: {
                        Label("Жидкое", systemImage: "drop")
                    }
                    .buttonStyle(SecondaryButtonStyle())
                    .disabled(avatar.isEmpty || cover == "liquid")
                    if !cover.isEmpty {
                        Button {
                            cover = ""
                        } label: {
                            Image(systemName: "trash")
                        }
                        .buttonStyle(CircleButtonStyle())
                        .accessibilityLabel("Убрать обложку")
                    }
                }
                Text("«Жидкое» — живой фон из цветов аватарки.")
                    .font(.system(size: 12))
                    .foregroundColor(Noct.text48)
            }
        }
    }

    private var usernamesSection: some View {
        section("Юзернеймы") {
            VStack(alignment: .leading, spacing: 6) {
                Text("Основной").font(.system(size: 13)).foregroundColor(Noct.text60)
                HStack(spacing: 4) {
                    Text("@").foregroundColor(Noct.text48)
                    TextField("username", text: $mainHandle)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                }
                .noctField()
            }
            ForEach(extraHandles.indices, id: \.self) { index in
                HStack(spacing: 8) {
                    HStack(spacing: 4) {
                        Text("@").foregroundColor(Noct.text48)
                        TextField("дополнительный", text: Binding(
                            get: { extraHandles.indices.contains(index) ? extraHandles[index] : "" },
                            set: { value in if extraHandles.indices.contains(index) { extraHandles[index] = value } }
                        ))
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                    }
                    .noctField()
                    Button {
                        extraHandles.remove(at: index)
                    } label: {
                        Image(systemName: "minus.circle").foregroundColor(Noct.text48)
                    }
                }
            }
            if extraHandles.count < 4 {
                Button {
                    extraHandles.append("")
                } label: {
                    Label("Добавить юзернейм", systemImage: "plus")
                        .font(.system(size: 14, weight: .medium))
                        .foregroundColor(Noct.text75)
                }
            }
            Text("4–24 латинские буквы, цифры или _. Основной и до четырёх дополнительных сохраняются вместе.")
                .font(.system(size: 12))
                .foregroundColor(Noct.text48)
        }
    }

    private var detailsSection: some View {
        section("Подробнее") {
            field("Местоположение", text: $location, limit: 30, placeholder: "Город, страна")
            field("Сайт", text: $website, limit: 100, placeholder: "example.com", keyboard: .URL)
            Toggle(isOn: $hasBirthday.animation(Noct.quick)) {
                Text("Дата рождения").font(.system(size: 15))
            }
            .tint(Noct.green)
            if hasBirthday {
                DatePicker(
                    "Дата",
                    selection: $birthday,
                    in: BirthdayFormat.earliest...Date(),
                    displayedComponents: .date
                )
                .environment(\.locale, Format.russian)
                .font(.system(size: 15))
                Toggle(isOn: $showBirthYear) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Показывать год рождения").font(.system(size: 15))
                        Text("Иначе в профиле будут только день и месяц.")
                            .font(.system(size: 12))
                            .foregroundColor(Noct.text48)
                    }
                }
                .tint(Noct.green)
            }
        }
    }

    private var socialsSection: some View {
        section("Соцсети") {
            ForEach(SocialNetwork.allCases) { network in
                VStack(alignment: .leading, spacing: 6) {
                    HStack(spacing: 6) {
                        SocialIcon(network: network, size: 14)
                        Text(network.label)
                    }
                    .font(.system(size: 13))
                    .foregroundColor(Noct.text60)
                    TextField(network.placeholder, text: socialBinding(network))
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .noctField()
                }
            }
            Text("Можно вставить и ссылку на профиль — сохраним только имя.")
                .font(.system(size: 12))
                .foregroundColor(Noct.text48)
        }
    }

    private var channelsSection: some View {
        section("Каналы в профиле") {
            Text("Как в Telegram: до трёх своих каналов появятся в профиле под описанием.")
                .font(.system(size: 12))
                .foregroundColor(Noct.text48)
            ForEach(myChannels) { channel in
                let order = channelIds.firstIndex(of: channel.id)
                Button {
                    if let order {
                        channelIds.remove(at: order)
                    } else if channelIds.count < 3 {
                        channelIds.append(channel.id)
                    }
                } label: {
                    HStack(spacing: 12) {
                        AvatarView(person: channel.identity, size: 36)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(channel.name).font(.system(size: 15, weight: .medium)).foregroundColor(.white)
                            Text("@" + channel.handle).font(.system(size: 12)).foregroundColor(Noct.text48)
                        }
                        Spacer()
                        if let order {
                            Text("\(order + 1)")
                                .font(.system(size: 13, weight: .bold))
                                .foregroundColor(.black)
                                .frame(width: 24, height: 24)
                                .background(Circle().fill(Color.white))
                        } else {
                            Circle().stroke(Noct.borderStrong, lineWidth: 1.5).frame(width: 24, height: 24)
                        }
                    }
                    .padding(10)
                    .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(order != nil ? Noct.fillStrong : Noct.fill))
                }
                .buttonStyle(PressableStyle())
                .disabled(order == nil && channelIds.count >= 3)
            }
            if myChannels.isEmpty {
                Text(channelsFailed ? "Не удалось загрузить каналы" : "У тебя пока нет своих каналов")
                    .font(.system(size: 13))
                    .foregroundColor(Noct.text48)
            }
        }
    }

    private func socialBinding(_ network: SocialNetwork) -> Binding<String> {
        switch network {
        case .instagram: return $instagram
        case .tiktok: return $tiktok
        case .youtube: return $youtube
        }
    }

    private func section<Content: View>(_ title: String, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(title)
                .font(.system(size: 17, weight: .semibold))
            content()
        }
        .padding(16)
        .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(Color(hex: 0x18181A)))
        .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).stroke(Color(hex: 0x303034), lineWidth: 1))
    }

    private func field(_ label: String, text: Binding<String>, limit: Int, placeholder: String = "", keyboard: UIKeyboardType = .default) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(label).font(.system(size: 13)).foregroundColor(Noct.text60)
            TextField(placeholder.isEmpty ? label : placeholder, text: Binding(
                get: { text.wrappedValue },
                set: { text.wrappedValue = String($0.prefix(limit)) }
            ))
            .keyboardType(keyboard)
            .textInputAutocapitalization(keyboard == .URL ? .never : .sentences)
            .autocorrectionDisabled(keyboard == .URL)
            .noctField()
        }
    }

    // MARK: Actions

    private func upload(_ item: PhotosPickerItem, cover isCover: Bool) async {
        if isCover { uploadingCover = true } else { uploadingAvatar = true }
        defer {
            if isCover {
                uploadingCover = false
                coverItem = nil
            } else {
                uploadingAvatar = false
                avatarItem = nil
            }
        }
        do {
            guard let data = try await item.loadTransferable(type: Data.self) else { return }
            // Avatars must be static images; photos become JPEG.
            let prepared = try MediaEncoder.prepare(data, types: [.jpeg], maxPixel: isCover ? 2400 : 1200)
            let result = try await session.api.upload("/api/upload", data: prepared.data, filename: prepared.filename, mimeType: prepared.mimeType)
            let url = result["url"].string ?? "/api/media/" + result["id"].str
            if isCover { cover = url } else { avatar = url }
        } catch {
            self.error = error.userMessage
        }
    }

    private func save() async {
        error = nil
        let handle = mainHandle.trimmingCharacters(in: .whitespaces).lowercased().replacingOccurrences(of: "@", with: "")
        let extras = extraHandles
            .map { $0.trimmingCharacters(in: .whitespaces).lowercased().replacingOccurrences(of: "@", with: "") }
            .filter { !$0.isEmpty }
        if manageHandles {
            let pattern = "^[a-z0-9_]{4,24}$"
            for value in [handle] + extras where value.range(of: pattern, options: .regularExpression) == nil {
                error = "Юзернейм @\(value): 4–24 латинские буквы, цифры или _"
                return
            }
            if Set([handle] + extras).count != extras.count + 1 {
                error = "Юзернеймы не должны повторяться"
                return
            }
        }
        var body: [String: Any] = [
            "name": name.trimmingCharacters(in: .whitespacesAndNewlines),
            "bio": bio.trimmingCharacters(in: .whitespacesAndNewlines),
            "avatar": avatar,
            "cover": cover,
        ]
        if profile.isChannel { body["id"] = profile.id }
        if manageHandles {
            body["mainHandle"] = handle
            body["extraHandles"] = extras
        }
        if own && person {
            body["location"] = location.trimmingCharacters(in: .whitespaces)
            body["website"] = website.trimmingCharacters(in: .whitespaces)
            body["instagram"] = instagram.trimmingCharacters(in: .whitespaces)
            body["tiktok"] = tiktok.trimmingCharacters(in: .whitespaces)
            body["youtube"] = youtube.trimmingCharacters(in: .whitespaces)
            body["birthday"] = hasBirthday ? BirthdayFormat.string(birthday) : ""
            body["showBirthYear"] = showBirthYear
            body["personalChannels"] = channelIds
        }
        saving = true
        defer { saving = false }
        do {
            let data = try await session.api.socialPost("profile", body)
            Haptics.success()
            session.show("Профиль сохранён")
            onSaved(Profile(data))
            dismiss()
        } catch {
            self.error = error.userMessage
            Haptics.error()
        }
    }
}

enum BirthdayFormat {
    static var earliest: Date {
        var components = DateComponents()
        components.year = 1900
        components.month = 1
        components.day = 1
        return Calendar(identifier: .gregorian).date(from: components) ?? Date(timeIntervalSince1970: -2_208_988_800)
    }

    /// "YYYY-MM-DD" in the owner's calendar day, as the web date input sends it.
    static func string(_ date: Date) -> String {
        let parts = Calendar(identifier: .gregorian).dateComponents([.year, .month, .day], from: date)
        return String(format: "%04d-%02d-%02d", parts.year ?? 2000, parts.month ?? 1, parts.day ?? 1)
    }

    static func date(_ value: String) -> Date? {
        let parts = value.split(separator: "-").compactMap { Int($0) }
        guard parts.count == 3 else { return nil }
        var components = DateComponents()
        components.year = parts[0]
        components.month = parts[1]
        components.day = parts[2]
        components.hour = 12
        return Calendar(identifier: .gregorian).date(from: components)
    }
}

/// Premium profile design: palette, name gradient, orbiting text and Chrome Flow.
struct DesignEditor: View {
    @EnvironmentObject private var session: AppSession
    let profile: Profile
    let onSaved: (Profile) -> Void

    @State private var theme: ProfileTheme
    @State private var gradient: Bool
    @State private var ring: String
    @State private var chrome: Bool
    @State private var tempo: Double
    @State private var saving = false
    @State private var error: String?

    init(profile: Profile, onSaved: @escaping (Profile) -> Void) {
        self.profile = profile
        self.onSaved = onSaved
        _theme = State(initialValue: profile.appearance.theme)
        _gradient = State(initialValue: profile.appearance.nameGradient)
        _ring = State(initialValue: profile.appearance.ringText)
        _chrome = State(initialValue: profile.appearance.chromeFlow)
        _tempo = State(initialValue: min(26, max(3, profile.appearance.chromeTempo)))
    }

    private var unlocked: Bool {
        profile.isChannel ? profile.appearance.boostLevel >= 1 : profile.appearance.premium
    }

    private var preview: Identity {
        var look = profile.appearance
        look.premium = profile.isChannel ? false : true
        look.profileTheme = theme.rawValue
        look.nameGradient = gradient
        look.ringText = ring
        look.chromeFlow = chrome
        look.chromeTempo = tempo
        if profile.isChannel { look.boostLevel = max(1, look.boostLevel) }
        return Identity(id: profile.id, name: profile.name, avatar: profile.avatar, handle: profile.handle, kind: profile.kind, appearance: look)
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                VStack(spacing: 10) {
                    Text("ПРЕДПРОСМОТР")
                        .font(.system(size: 11, weight: .medium))
                        .tracking(0.7)
                        .foregroundColor(Noct.text48)
                    ProfileAvatar(person: preview, size: 80, bordered: false)
                    DisplayName(person: preview, size: 22)
                    Text("@" + profile.handle)
                        .font(.system(size: 13))
                        .foregroundColor(Noct.text48)
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 20)
                .background(
                    LinearGradient(colors: [theme.first.opacity(0.14), theme.second.opacity(0.05)], startPoint: .topLeading, endPoint: .bottomTrailing)
                )
                .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).stroke(Noct.border, lineWidth: 1))

                if !unlocked {
                    VStack(alignment: .leading, spacing: 10) {
                        HStack(spacing: 10) {
                            Image("PremiumArt").resizable().scaledToFit().frame(width: 34, height: 34)
                            Text(profile.isChannel ? "Оформление канала открывается с 1 уровня бустов" : "Оформление доступно с Noct Premium")
                                .font(.system(size: 15, weight: .semibold))
                        }
                        Text("Палитры, градиент имени, текст вокруг аватара и Chrome Flow.")
                            .font(.system(size: 13))
                            .foregroundColor(Noct.text60)
                    }
                    .padding(16)
                    .noctCard()
                }

                VStack(alignment: .leading, spacing: 12) {
                    Text("Цвет профиля").font(.system(size: 15, weight: .semibold))
                    LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 10), count: 3), spacing: 10) {
                        ForEach(ProfileTheme.allCases) { option in
                            Button {
                                theme = option
                            } label: {
                                VStack(spacing: 6) {
                                    Circle()
                                        .fill(option.gradient)
                                        .frame(width: 34, height: 34)
                                        .overlay(Circle().stroke(Color.white, lineWidth: theme == option ? 2 : 0).padding(-4))
                                    Text(option.label)
                                        .font(.system(size: 12))
                                        .foregroundColor(theme == option ? .white : Noct.text60)
                                }
                                .frame(maxWidth: .infinity)
                                .padding(.vertical, 10)
                                .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(theme == option ? Noct.fillStrong : Noct.fill))
                            }
                            .buttonStyle(PressableStyle())
                        }
                    }
                }
                Toggle(isOn: $gradient) {
                    Text("Градиент имени").font(.system(size: 15))
                }
                .tint(Noct.green)
                VStack(alignment: .leading, spacing: 6) {
                    Text("Текст вокруг аватара").font(.system(size: 15))
                    TextField("до 48 символов", text: Binding(get: { ring }, set: { ring = String($0.prefix(48)) }))
                        .noctField()
                }
                Toggle(isOn: $chrome) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Chrome Flow").font(.system(size: 15))
                        Text("Металлическое кольцо в цветах палитры.")
                            .font(.system(size: 12))
                            .foregroundColor(Noct.text48)
                    }
                }
                .tint(Noct.green)
                if chrome {
                    VStack(alignment: .leading, spacing: 6) {
                        Text("Темп: \(Int(tempo)) с на оборот")
                            .font(.system(size: 13))
                            .foregroundColor(Noct.text60)
                        Slider(value: $tempo, in: 3...26, step: 1).tint(.white)
                    }
                }
                if let error {
                    Text(error).font(.system(size: 14)).foregroundColor(Noct.red)
                }
                Button {
                    Task { await save() }
                } label: {
                    HStack {
                        if saving { ProgressView().tint(.black) }
                        Text("Сохранить оформление")
                    }
                    .frame(maxWidth: .infinity)
                }
                .buttonStyle(PrimaryButtonStyle())
                .disabled(!unlocked || saving)
            }
            .padding(16)
        }
    }

    private func save() async {
        saving = true
        error = nil
        defer { saving = false }
        do {
            let data = try await session.api.socialPost("appearance", [
                "id": profile.id,
                "theme": theme.rawValue,
                "nameGradient": gradient,
                "ringText": ring.trimmingCharacters(in: .whitespaces),
                "chromeFlow": chrome,
                "chromeTempo": Int(tempo),
                "avatarMotion": profile.appearance.avatarMotion,
                "poster": "",
            ])
            Haptics.success()
            session.show("Оформление сохранено")
            onSaved(Profile(data))
        } catch {
            self.error = error.userMessage
        }
    }
}

/// Messages policy, hidden 18+ media and the block list (lib/privacy.ts).
struct PrivacyEditor: View {
    @EnvironmentObject private var session: AppSession
    @State private var loaded = false
    @State private var hideAdult = false
    @State private var policy = "everyone"
    @State private var blocked: [Person] = []
    @State private var error: String?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                if !loaded {
                    LoadingRow()
                } else {
                    VStack(alignment: .leading, spacing: 10) {
                        Text("Кто может писать мне").font(.system(size: 15, weight: .semibold))
                        Picker("Сообщения", selection: $policy) {
                            Text("Все").tag("everyone")
                            Text("Мои подписки").tag("following")
                            Text("Никто").tag("nobody")
                        }
                        .pickerStyle(.segmented)
                    }
                    Toggle(isOn: $hideAdult) {
                        VStack(alignment: .leading, spacing: 2) {
                            Text("Скрывать публикации 18+").font(.system(size: 15))
                            Text("Посты с отметкой 18+ не появятся в ленте, поиске и сохранённом.")
                                .font(.system(size: 12))
                                .foregroundColor(Noct.text48)
                        }
                    }
                    .tint(Noct.green)
                    VStack(alignment: .leading, spacing: 10) {
                        Text("Чёрный список").font(.system(size: 15, weight: .semibold))
                        if blocked.isEmpty {
                            Text("Здесь пусто. Заблокировать можно из меню профиля.")
                                .font(.system(size: 13))
                                .foregroundColor(Noct.text48)
                        }
                        ForEach(blocked) { person in
                            HStack {
                                PersonRow(person: person.identity, avatarSize: 36)
                                Button("Разблокировать") {
                                    Task { await unblock(person) }
                                }
                                .font(.system(size: 13, weight: .medium))
                                .foregroundColor(.white)
                            }
                        }
                    }
                    if let error {
                        Text(error).font(.system(size: 14)).foregroundColor(Noct.red)
                    }
                }
            }
            .padding(16)
        }
        .onChange(of: policy) { _ in Task { await save() } }
        .onChange(of: hideAdult) { _ in Task { await save() } }
        .task { await load() }
    }

    private func load() async {
        do {
            let data = try await session.api.social("privacy")
            hideAdult = data["hideAdult"].bool
            policy = data["messagePolicy"].string ?? "everyone"
            blocked = data["blocked"].array.map { Person($0) }
            loaded = true
        } catch {
            self.error = error.userMessage
            loaded = true
        }
    }

    private func save() async {
        guard loaded else { return }
        do {
            _ = try await session.api.socialPost("privacy", ["hideAdult": hideAdult, "messagePolicy": policy])
            PostBus.shared.send(.created)
        } catch {
            self.error = error.userMessage
        }
    }

    private func unblock(_ person: Person) async {
        do {
            _ = try await session.api.socialPost("blockUser", ["id": person.id, "value": false])
            blocked.removeAll { $0.id == person.id }
            session.show("\(person.name) разблокирован(а)")
        } catch {
            session.report(error)
        }
    }
}

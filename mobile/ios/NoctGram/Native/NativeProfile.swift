import SwiftUI
import UIKit

@MainActor
struct NGProfileView: View {
    var userID: String? = nil
    @EnvironmentObject private var session: NativeSession
    @StateObject private var feed = NGFeedModel()
    @State private var profile: NGRecord?
    @State private var tab = "posts"
    @State private var loading = false
    @State private var error: String?
    @State private var editing = false
    @State private var following = false
    @State private var gifts: [NGRecord] = []
    @State private var catalog: [String: NGRecord] = [:]
    @State private var giftCursor = ""
    @State private var giftsLoaded = false
    @State private var giftLoading = false
    @State private var wallet: NGRecord?
    @State private var transactions: [NGRecord] = []
    @State private var walletLoading = false
    @State private var walletHasMore = false
    @State private var giftGeneration = 0
    @State private var walletGeneration = 0
    @State private var confirmSignOut = false
    @State private var signingOut = false
    @State private var profileUnavailable = false
    @State private var profileGeneration = 0

    private var targetID: String { userID ?? session.user?.id ?? "" }
    private var isOwn: Bool { targetID == session.user?.id }

    var body: some View {
        List {
            if let profile {
                header(profile)
                    .listRowSeparator(.hidden)
                    .listRowBackground(NGTheme.background)
                Picker("Раздел профиля", selection: $tab) {
                    Text("Публикации").tag("posts")
                    Text("Подарки").tag("gifts")
                    if isOwn { Text("Stars").tag("wallet") }
                }.pickerStyle(.segmented)
                    .listRowBackground(NGTheme.background)
                    .listRowSeparator(.hidden)
                if tab == "posts" { postRows }
                else if tab == "gifts" { giftRows }
                else if isOwn { walletRows }
            } else if profileUnavailable {
                NGEmptyState(title: "Профиль недоступен", message: "Аккаунт удалён или доступ к нему изменился.", systemImage: "lock")
                    .listRowBackground(NGTheme.background)
            } else if loading {
                ProgressView().frame(maxWidth: .infinity).padding(32).listRowBackground(NGTheme.background)
            }
            if let error {
                NGInlineError(message: error) { Task { await refresh() } }
                    .listRowBackground(NGTheme.background)
            }
        }
        .listStyle(.plain)
        .background(NGTheme.background)
        .navigationTitle(isOwn ? "Профиль" : profile?.string("name", default: "Профиль") ?? "Профиль")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .navigationBarTrailing) {
                if isOwn && !profileUnavailable {
                    Menu {
                        Button { editing = true } label: { Label("Редактировать профиль", systemImage: "pencil") }
                        Button(role: .destructive) { confirmSignOut = true } label: {
                            Label("Выйти из аккаунта", systemImage: "rectangle.portrait.and.arrow.right")
                        }
                    } label: {
                        Image(systemName: "gearshape").frame(width: 44, height: 44)
                    }.accessibilityLabel("Настройки профиля").disabled(signingOut)
                }
            }
        }
        .confirmationDialog("Выйти из аккаунта на этом устройстве?", isPresented: $confirmSignOut, titleVisibility: .visible) {
            Button("Выйти", role: .destructive) {
                signingOut = true
                Task { await session.signOut(); signingOut = false }
            }
            Button("Отмена", role: .cancel) { }
        }
        .task(id: targetID) { await loadProfile() }
        .task(id: targetID + ":" + tab) { await loadTab() }
        .refreshable { await refresh() }
        .sheet(isPresented: $editing) {
            if let profile {
                NGEditProfile(profile: profile) { updated in self.profile = updated }
                    .environmentObject(session)
            }
        }
    }

    private func header(_ person: NGRecord) -> some View {
        VStack(spacing: 16) {
            if !person.string("cover").isEmpty {
                NGRemoteImage(path: person.string("cover"))
                    .frame(height: 120).clipped().clipShape(RoundedRectangle(cornerRadius: 20))
            }
            NGAvatar(url: person.string("avatar"), name: person.string("name"), size: 88)
            VStack(spacing: 6) {
                HStack(spacing: 6) {
                    Text(person.string("name", default: "Пользователь")).font(.title2.bold())
                    if person.bool("verified") {
                        Image(systemName: "checkmark.seal.fill").foregroundColor(NGTheme.accent)
                            .accessibilityLabel("Подтверждённый аккаунт")
                    }
                }
                if !person.string("handle").isEmpty {
                    Text("@" + person.string("handle")).font(.subheadline).foregroundColor(NGTheme.muted)
                }
                if person.string("kind") == "channel" {
                    Label("Канал", systemImage: "megaphone.fill").font(.caption).foregroundColor(NGTheme.muted)
                }
            }
            if !person.string("bio").isEmpty {
                Text(person.string("bio")).font(.body).multilineTextAlignment(.center).textSelection(.enabled)
            }
            HStack(spacing: 0) {
                counter(person.int("postCount"), "публикаций")
                counter(person.int("followers"), "подписчиков")
                counter(person.int("following"), "подписок")
            }.padding(.vertical, 8)
            if isOwn {
                Button { editing = true } label: {
                    Label("Редактировать профиль", systemImage: "pencil")
                        .font(.subheadline.weight(.semibold)).padding(.horizontal, 20).frame(minHeight: 44)
                        .ngGlass(radius: 24)
                }.buttonStyle(.plain)
            } else {
                HStack(spacing: 12) {
                    Button { toggleFollow(person) } label: {
                        HStack {
                            if following { ProgressView() }
                            Text(person.bool("followed") ? "Вы подписаны" : "Подписаться")
                        }.font(.subheadline.weight(.semibold)).padding(.horizontal, 18).frame(minHeight: 44)
                            .ngGlass(radius: 24)
                    }.disabled(following).buttonStyle(.plain)
                    if person.string("kind", default: "person") == "person" {
                        NavigationLink(destination: NGConversationView(person: person)) {
                            Label("Написать", systemImage: "bubble.left")
                                .font(.subheadline.weight(.semibold)).padding(.horizontal, 18).frame(minHeight: 44)
                                .ngGlass(radius: 24)
                        }.buttonStyle(.plain)
                    }
                }
            }
        }.frame(maxWidth: .infinity).padding(.vertical, 12)
    }

    private func counter(_ value: Int, _ label: String) -> some View {
        VStack(spacing: 4) {
            Text(value.formatted()).font(.headline).monospacedDigit()
            Text(label).font(.caption).foregroundColor(NGTheme.muted)
        }.frame(maxWidth: .infinity)
    }

    @ViewBuilder private var postRows: some View {
        if feed.loading && feed.posts.isEmpty {
            ProgressView().listRowBackground(NGTheme.background)
        } else if feed.posts.isEmpty && feed.error == nil {
            NGEmptyState(title: "Пока нет публикаций", message: "Публикации этого профиля появятся здесь.", systemImage: "square.stack")
                .listRowBackground(NGTheme.background)
        }
        ForEach(feed.posts) { post in
            NGPostCard(post: post)
                .listRowInsets(EdgeInsets(top: 8, leading: 16, bottom: 8, trailing: 16))
                .listRowSeparator(.hidden).listRowBackground(NGTheme.background)
        }
        if let error = feed.error {
            NGInlineError(message: error) { Task { await feed.reload(userID: targetID) } }
                .listRowBackground(NGTheme.background)
        }
        if feed.hasMore {
            Button { Task { await feed.nextPage() } } label: {
                HStack { Text("Показать ещё"); if feed.loadingMore { ProgressView() } }.frame(minHeight: 44)
            }.disabled(feed.loadingMore).listRowBackground(NGTheme.background)
        }
    }

    @ViewBuilder private var giftRows: some View {
        if giftLoading && !giftsLoaded {
            ProgressView().listRowBackground(NGTheme.background)
        } else if giftsLoaded && gifts.isEmpty {
            NGEmptyState(title: "Пока нет подарков", message: "Полученные подарки появятся в этом разделе.", systemImage: "gift")
                .listRowBackground(NGTheme.background)
        }
        ForEach(gifts) { gift in
            NavigationLink(destination: NGProfileGiftDetail(gift: gift, catalogItem: catalog[gift.string("giftId")])) {
                HStack(spacing: 16) {
                    NGRemoteImage(path: ngGiftArt(gift), contentMode: .fit)
                        .frame(width: 76, height: 76)
                        .background(NGTheme.surface, in: RoundedRectangle(cornerRadius: 18))
                    VStack(alignment: .leading, spacing: 6) {
                        Text(catalog[gift.string("giftId")]?.string("name") ?? "Подарок").font(.headline)
                        if let collectible = gift.object("collectible") {
                            Text("Коллекционный · #\(collectible.int("number"))")
                                .font(.caption).foregroundColor(NGTheme.accent)
                        } else {
                            Text("Получен " + ngRelativeDate(gift.double("created")))
                                .font(.caption).foregroundColor(NGTheme.muted)
                        }
                        if gift.bool("hidden") { Label("Скрыт в профиле", systemImage: "eye.slash").font(.caption).foregroundColor(NGTheme.muted) }
                    }
                }.padding(.vertical, 6)
            }.listRowBackground(NGTheme.background)
        }
        if !giftCursor.isEmpty {
            Button { Task { await loadGifts(more: true) } } label: {
                HStack { Text("Показать ещё"); if giftLoading { ProgressView() } }.frame(minHeight: 44)
            }.disabled(giftLoading).listRowBackground(NGTheme.background)
        }
    }

    @ViewBuilder private var walletRows: some View {
        if let wallet {
            VStack(alignment: .leading, spacing: 12) {
                Label("Noct Stars", systemImage: "star.fill").foregroundColor(NGTheme.accent)
                Text(wallet.int("balance").formatted()).font(.largeTitle.bold()).monospacedDigit()
                Text("Баланс вашего аккаунта NoctGram").font(.subheadline).foregroundColor(NGTheme.muted)
            }.padding(20).frame(maxWidth: .infinity, alignment: .leading)
                .background(NGTheme.surface, in: RoundedRectangle(cornerRadius: 24))
                .listRowSeparator(.hidden).listRowBackground(NGTheme.background)
            if transactions.isEmpty {
                NGEmptyState(title: "Пока нет операций", message: "Здесь появится история Noct Stars.", systemImage: "clock")
                    .listRowBackground(NGTheme.background)
            }
            ForEach(transactions) { transaction in
                HStack(alignment: .center, spacing: 12) {
                    Image(systemName: walletIcon(transaction.string("kind")))
                        .foregroundColor(NGTheme.accent).frame(width: 44, height: 44)
                        .background(NGTheme.surface, in: RoundedRectangle(cornerRadius: 14))
                    VStack(alignment: .leading, spacing: 5) {
                        Text(walletLabel(transaction.string("kind"))).font(.subheadline.weight(.semibold))
                        if !transaction.string("name").isEmpty {
                            Text(transaction.string("name")).font(.caption).foregroundColor(NGTheme.muted)
                        }
                        Text(ngRelativeDate(transaction.double("created"))).font(.caption).foregroundColor(NGTheme.muted)
                    }
                    Spacer(minLength: 8)
                    Text((transaction.string("sender") == targetID ? "−" : "+") + transaction.int("amount").formatted())
                        .font(.subheadline.weight(.semibold)).monospacedDigit()
                        .foregroundColor(transaction.string("sender") == targetID ? .primary : NGTheme.accent)
                }.padding(.vertical, 5).listRowBackground(NGTheme.background)
            }
            if walletHasMore {
                Button { Task { await loadWallet(more: true) } } label: {
                    HStack { Text("Показать ещё"); if walletLoading { ProgressView() } }.frame(minHeight: 44)
                }.disabled(walletLoading).listRowBackground(NGTheme.background)
            }
        } else if walletLoading {
            ProgressView().listRowBackground(NGTheme.background)
        }
    }

    private func loadProfile() async {
        guard !targetID.isEmpty else { return }
        profileGeneration += 1
        let request = profileGeneration
        loading = true
        error = nil
        let requestedID = targetID
        defer { if request == profileGeneration { loading = false } }
        do {
            let result = try await NoctAPI.shared.get("/api/social", query: ["action": "profile", "id": requestedID])
            try Task.checkCancellation()
            guard request == profileGeneration, requestedID == targetID else { return }
            profileUnavailable = false
            profile = result
        } catch is CancellationError {
        } catch {
            guard request == profileGeneration, requestedID == targetID else { return }
            if ngReadAccessRevoked(error) {
                profileUnavailable = true
                profile = nil
                editing = false
                feed.clearContent()
                giftGeneration += 1
                walletGeneration += 1
                gifts = []
                giftCursor = ""
                giftsLoaded = false
                giftLoading = false
                wallet = nil
                transactions = []
                walletHasMore = false
                walletLoading = false
            }
            self.error = error.localizedDescription
        }
    }

    private func loadTab() async {
        guard !profileUnavailable, !targetID.isEmpty else { return }
        switch tab {
        case "gifts": await loadGifts()
        case "wallet": if isOwn { await loadWallet() }
        default: await feed.reload(userID: targetID)
        }
    }

    private func refresh() async {
        await loadProfile()
        await loadTab()
    }

    private func toggleFollow(_ person: NGRecord) {
        guard !following, !isOwn else { return }
        following = true
        error = nil
        Task {
            defer { following = false }
            do {
                _ = try await NoctAPI.shared.post("/api/social", body: ["action": "follow", "id": targetID, "value": !person.bool("followed")])
                await loadProfile()
            } catch { self.error = error.localizedDescription }
        }
    }

    private func loadGifts(more: Bool = false) async {
        if more && (giftLoading || giftCursor.isEmpty) { return }
        giftGeneration += 1
        let request = giftGeneration
        let requestedID = targetID
        giftLoading = true
        error = nil
        defer { if giftGeneration == request { giftLoading = false } }
        do {
            var query = ["user": requestedID]
            if more { query["before"] = giftCursor }
            let response = try await NoctAPI.shared.get("/api/gifts", query: query)
            let catalogResponse: NGRecord?
            if catalog.isEmpty { catalogResponse = try await NoctAPI.shared.get("/api/gifts", query: ["action": "catalog"]) }
            else { catalogResponse = nil }
            try Task.checkCancellation()
            guard request == giftGeneration, requestedID == targetID else { return }
            if let catalogResponse {
                catalog = Dictionary(catalogResponse.objects("catalog").map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first })
            }
            let page = response.objects("gifts")
            let existing = Set(gifts.map(\.id))
            gifts = more ? gifts + page.filter { !existing.contains($0.id) } : page
            giftCursor = response.string("next")
            giftsLoaded = true
        } catch is CancellationError {
        } catch {
            guard giftGeneration == request else { return }
            if ngReadAccessRevoked(error) {
                gifts = []
                giftCursor = ""
                giftsLoaded = false
            }
            self.error = error.localizedDescription
        }
    }

    private func loadWallet(more: Bool = false) async {
        guard isOwn else { return }
        if more && (walletLoading || !walletHasMore) { return }
        walletGeneration += 1
        let request = walletGeneration
        walletLoading = true
        error = nil
        defer { if walletGeneration == request { walletLoading = false } }
        do {
            var query = ["action": "wallet"]
            if more, let last = transactions.last {
                query["before"] = last.string("created")
                query["beforeId"] = last.id
            }
            let result = try await NoctAPI.shared.get("/api/social", query: query)
            try Task.checkCancellation()
            guard request == walletGeneration, isOwn else { return }
            let page = result.objects("transactions")
            let existing = Set(transactions.map(\.id))
            transactions = more ? transactions + page.filter { !existing.contains($0.id) } : page
            wallet = result
            walletHasMore = page.count == 50
        } catch is CancellationError {
        } catch {
            guard request == walletGeneration else { return }
            if ngReadAccessRevoked(error) {
                wallet = nil
                transactions = []
                walletHasMore = false
            }
            self.error = error.localizedDescription
        }
    }
}

private func ngGiftArt(_ gift: NGRecord) -> String {
    let asset = gift.object("collectible")?.object("model")?.string("asset")
    return "/assets/gifts/" + ((asset?.isEmpty == false ? asset : nil) ?? gift.string("giftId")) + ".webp"
}

private func walletIcon(_ kind: String) -> String {
    switch kind {
    case "gift", "gift_upgrade": return "gift.fill"
    case "purchase", "admin_grant", "telegram_test", "gift_conversion": return "plus.circle.fill"
    case "support": return "heart.fill"
    default: return "star.fill"
    }
}

private func walletLabel(_ kind: String) -> String {
    switch kind {
    case "gift": return "Подарок"
    case "gift_upgrade": return "Улучшение подарка"
    case "gift_conversion": return "Обмен подарка"
    case "purchase", "admin_grant", "telegram_test": return "Пополнение"
    case "support": return "Поддержка автора"
    case "giveaway": return "Розыгрыш"
    case "case_open": return "Открытие кейса"
    default: return "Операция Noct Stars"
    }
}

private struct NGProfileGiftDetail: View {
    let gift: NGRecord
    let catalogItem: NGRecord?

    var body: some View {
        ScrollView {
            VStack(spacing: 20) {
                NGRemoteImage(path: ngGiftArt(gift), contentMode: .fit)
                    .frame(height: 240)
                Text(catalogItem?.string("name") ?? "Подарок").font(.title.bold())
                if let collectible = gift.object("collectible") {
                    Text("Коллекционный · #\(collectible.int("number"))").foregroundColor(NGTheme.accent)
                    VStack(spacing: 14) {
                        attribute("Модель", collectible.object("model"))
                        attribute("Фон", collectible.object("backdrop"))
                        attribute("Узор", collectible.object("symbol"))
                    }.padding(20).background(NGTheme.surface, in: RoundedRectangle(cornerRadius: 22))
                }
                if !gift.string("senderName").isEmpty {
                    Label("От " + gift.string("senderName"), systemImage: "gift").font(.subheadline)
                }
                if !gift.string("message").isEmpty {
                    Text(gift.string("message")).font(.body).multilineTextAlignment(.center).textSelection(.enabled)
                }
                Text(Date(timeIntervalSince1970: gift.double("created") / 1000), style: .date)
                    .font(.caption).foregroundColor(NGTheme.muted)
            }.padding(24).frame(maxWidth: .infinity)
        }.background(NGTheme.background)
            .navigationTitle("Подарок").navigationBarTitleDisplayMode(.inline)
    }

    @ViewBuilder private func attribute(_ title: String, _ record: NGRecord?) -> some View {
        if let record {
            HStack {
                Text(title).foregroundColor(NGTheme.muted)
                Spacer()
                VStack(alignment: .trailing, spacing: 3) {
                    Text(record.string("name")).fontWeight(.medium)
                    if record.int("rarityPermille") > 0 {
                        Text(String(format: "%.1f%%", record.double("rarityPermille") / 10))
                            .font(.caption).foregroundColor(NGTheme.accent)
                    }
                }
            }.font(.subheadline)
        }
    }
}

@MainActor
private struct NGEditProfile: View {
    let profile: NGRecord
    let onSaved: (NGRecord) -> Void
    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject private var session: NativeSession
    @State private var name: String
    @State private var bio: String
    @State private var avatarData: Data?
    @State private var avatarName = "avatar.jpg"
    @State private var avatarMime = "image/jpeg"
    @State private var uploadedAvatar: String?
    @State private var picking = false
    @State private var saving = false
    @State private var error: String?

    init(profile: NGRecord, onSaved: @escaping (NGRecord) -> Void) {
        self.profile = profile
        self.onSaved = onSaved
        _name = State(initialValue: profile.string("name"))
        _bio = State(initialValue: profile.string("bio"))
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 22) {
                HStack {
                    Button("Отмена") { dismiss() }.frame(minHeight: 44).disabled(saving)
                    Spacer()
                    Text("Профиль").font(.headline)
                    Spacer()
                    Button { save() } label: {
                        Group { if saving { ProgressView() } else { Text("Готово") } }.frame(minHeight: 44)
                    }.disabled(saving || name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
                Button { picking = true } label: {
                    VStack(spacing: 12) {
                        if let avatarData, let image = UIImage(data: avatarData) {
                            Image(uiImage: image).resizable().scaledToFill().frame(width: 88, height: 88).clipShape(Circle())
                        } else { NGAvatar(url: profile.string("avatar"), name: name, size: 88) }
                        Text("Изменить фото").font(.subheadline)
                    }.frame(maxWidth: .infinity).padding(.vertical, 8)
                }.disabled(saving).buttonStyle(.plain)
                VStack(alignment: .leading, spacing: 8) {
                    Text("Имя").font(.subheadline.weight(.semibold))
                    TextField("Имя", text: $name)
                        .padding(16).background(NGTheme.surface, in: RoundedRectangle(cornerRadius: 16))
                        .onChange(of: name) { name = String($0.prefix(40)) }.disabled(saving)
                }
                VStack(alignment: .leading, spacing: 8) {
                    Text("О себе").font(.subheadline.weight(.semibold))
                    TextEditor(text: $bio).frame(height: 140).padding(10)
                        .background(NGTheme.surface, in: RoundedRectangle(cornerRadius: 16))
                        .onChange(of: bio) { bio = String($0.prefix(300)) }.disabled(saving)
                    Text("\(bio.count)/300").font(.caption).foregroundColor(NGTheme.muted)
                }
                if let error { NGInlineError(message: error) }
            }.padding(20)
        }.background(NGTheme.background.ignoresSafeArea())
            .interactiveDismissDisabled(saving)
            .sheet(isPresented: $picking) {
                NGPhotoPicker { data, fileName, mime in
                    avatarData = data
                    avatarName = fileName
                    avatarMime = mime
                    uploadedAvatar = nil
                    picking = false
                }
            }
    }

    private func save() {
        guard !saving, let ownerID = session.user?.string("id"), !ownerID.isEmpty else { return }
        saving = true
        error = nil
        Task {
            defer { saving = false }
            do {
                if let avatarData, uploadedAvatar == nil {
                    let uploaded = try await NoctAPI.shared.upload(data: avatarData, fileName: avatarName, mimeType: avatarMime, chat: false)
                    guard session.user?.string("id") == ownerID else { throw CancellationError() }
                    uploadedAvatar = "/api/media/" + uploaded.string("id")
                }
                guard session.user?.string("id") == ownerID else { throw CancellationError() }
                let updated = try await NoctAPI.shared.post("/api/social", body: [
                    "action": "profile", "actor": ownerID, "id": profile.id,
                    "name": name.trimmingCharacters(in: .whitespacesAndNewlines), "bio": bio,
                    "avatar": uploadedAvatar ?? profile.string("avatar"), "cover": profile.string("cover")
                ])
                guard session.user?.string("id") == ownerID else { throw CancellationError() }
                onSaved(updated)
                await session.refresh()
                dismiss()
            } catch { self.error = error.localizedDescription }
        }
    }
}

import SwiftUI

/// Wrapping row layout for profile details (location · site · birthday · joined).
struct FlowLayout: Layout {
    var spacing: CGFloat = 14
    var lineSpacing: CGFloat = 8

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let maxWidth = proposal.width ?? .infinity
        var x: CGFloat = 0
        var y: CGFloat = 0
        var line: CGFloat = 0
        var width: CGFloat = 0
        for view in subviews {
            let size = view.sizeThatFits(ProposedViewSize(width: maxWidth, height: nil))
            if x > 0 && x + size.width > maxWidth {
                x = 0
                y += line + lineSpacing
                line = 0
            }
            x += size.width + spacing
            width = max(width, x - spacing)
            line = max(line, size.height)
        }
        return CGSize(width: maxWidth.isFinite ? maxWidth : width, height: y + line)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var x = bounds.minX
        var y = bounds.minY
        var line: CGFloat = 0
        for view in subviews {
            let size = view.sizeThatFits(ProposedViewSize(width: bounds.width, height: nil))
            if x > bounds.minX && x + size.width > bounds.maxX {
                x = bounds.minX
                y += line + lineSpacing
                line = 0
            }
            view.place(at: CGPoint(x: x, y: y), proposal: ProposedViewSize(width: size.width, height: size.height))
            x += size.width + spacing
            line = max(line, size.height)
        }
    }
}

/// «Жидкое»: a slowly flowing field of the blurred avatar with a vignette
/// (a WebGL noise canvas on the web, app/liquid-cover.tsx).
struct LiquidCover: View {
    let url: URL?
    @State private var flow = false

    var body: some View {
        GeometryReader { geometry in
            let size = geometry.size
            ZStack {
                RemoteImage(url: url, maxPixel: 192, placeholder: Noct.coverFill)
                    .frame(width: size.width * 1.5, height: max(size.height * 3, size.width * 0.9))
                    .blur(radius: 28)
                    .scaleEffect(flow ? 1.22 : 1.02)
                    .rotationEffect(.degrees(flow ? 9 : -7))
                    .offset(x: flow ? size.width * 0.07 : -size.width * 0.07, y: flow ? -12 : 12)
                RemoteImage(url: url, maxPixel: 192, placeholder: .clear)
                    .frame(width: size.width * 1.3, height: max(size.height * 2.4, size.width * 0.8))
                    .blur(radius: 36)
                    .scaleEffect(flow ? 1.05 : 1.3)
                    .rotationEffect(.degrees(flow ? -16 : 12))
                    .offset(x: flow ? -size.width * 0.1 : size.width * 0.12)
                    .opacity(0.55)
                    .blendMode(.screen)
                RadialGradient(
                    colors: [.clear, .black.opacity(0.55)],
                    center: .center,
                    startRadius: size.width * 0.18,
                    endRadius: size.width * 0.75
                )
            }
            .frame(width: size.width, height: size.height)
            .clipped()
            .opacity(0.85)
        }
        .onAppear {
            withAnimation(.easeInOut(duration: 9).repeatForever(autoreverses: true)) { flow = true }
        }
    }
}

/// Cover: image, «Жидкое» or the empty cover with the «n.» monogram.
struct ProfileCover: View {
    @EnvironmentObject private var session: AppSession
    let profile: Profile
    var height: CGFloat = 160

    var body: some View {
        ZStack(alignment: .bottomTrailing) {
            if let url = session.api.mediaURL(profile.coverImage) {
                RemoteImage(url: url, maxPixel: 1400)
            } else if profile.isLiquidCover, let avatar = session.api.mediaURL(profile.avatar) {
                LiquidCover(url: avatar)
            } else {
                emptyCover
                Text("n.")
                    .font(.system(size: 190, weight: .medium))
                    .tracking(-18)
                    .foregroundColor(Color.white.opacity(0.05))
                    .offset(x: -16, y: 44)
                    .allowsHitTesting(false)
            }
        }
        .frame(height: height)
        .frame(maxWidth: .infinity)
        .clipped()
    }

    @ViewBuilder private var emptyCover: some View {
        if profile.isChannel && profile.appearance.hasDesign {
            LinearGradient(
                colors: [profile.appearance.theme.first.opacity(0.18), profile.appearance.theme.second.opacity(0.08)],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
            .background(Color(hex: 0x111114))
        } else {
            Noct.coverFill
        }
    }
}

enum SocialNetwork: String, CaseIterable, Identifiable {
    case instagram, tiktok, youtube

    var id: String { rawValue }

    var label: String {
        switch self {
        case .instagram: return "Instagram"
        case .tiktok: return "TikTok"
        case .youtube: return "YouTube"
        }
    }

    var placeholder: String { self == .youtube ? "@handle" : "@username" }

    func url(_ name: String) -> URL? {
        let encoded = name.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? name
        switch self {
        case .instagram: return URL(string: "https://www.instagram.com/\(encoded)/")
        case .tiktok: return URL(string: "https://www.tiktok.com/@\(encoded)")
        case .youtube: return URL(string: "https://www.youtube.com/@\(encoded)")
        }
    }
}

/// Stroke glyphs from app/social-icons.tsx (24×24 viewBox).
struct SocialGlyph: Shape {
    let network: SocialNetwork

    func path(in rect: CGRect) -> Path {
        var path = Path()
        switch network {
        case .instagram:
            path.addRoundedRect(in: CGRect(x: 2, y: 2, width: 20, height: 20), cornerSize: CGSize(width: 5, height: 5))
            path.addEllipse(in: CGRect(x: 8, y: 8, width: 8, height: 8))
            path.move(to: CGPoint(x: 17.5, y: 6.5))
            path.addLine(to: CGPoint(x: 17.51, y: 6.5))
        case .tiktok:
            path.move(to: CGPoint(x: 9, y: 12))
            path.addRelativeArc(center: CGPoint(x: 9, y: 16), radius: 4, startAngle: .degrees(270), delta: .degrees(-270))
            path.addLine(to: CGPoint(x: 13, y: 3))
            path.addRelativeArc(center: CGPoint(x: 18, y: 3), radius: 5, startAngle: .degrees(180), delta: .degrees(-90))
        case .youtube:
            path.addRoundedRect(in: CGRect(x: 2.5, y: 5.2, width: 19, height: 13.6), cornerSize: CGSize(width: 4, height: 4))
            path.move(to: CGPoint(x: 10, y: 15))
            path.addLine(to: CGPoint(x: 15, y: 12))
            path.addLine(to: CGPoint(x: 10, y: 9))
            path.closeSubpath()
        }
        let scale = min(rect.width, rect.height) / 24
        let transform = CGAffineTransform(translationX: rect.midX - 12 * scale, y: rect.midY - 12 * scale).scaledBy(x: scale, y: scale)
        return path.applying(transform)
    }
}

struct SocialIcon: View {
    let network: SocialNetwork
    var size: CGFloat = 18

    var body: some View {
        SocialGlyph(network: network)
            .stroke(style: StrokeStyle(lineWidth: size / 12, lineCap: .round, lineJoin: .round))
            .frame(width: size, height: size)
    }
}

/// Twitter-style details row plus round social buttons (app/profile-details.tsx).
struct ProfileMetaView: View {
    @Environment(\.openURL) private var openURL
    let profile: Profile

    var body: some View {
        let person = !profile.isChannel
        let site = person && (profile.website.lowercased().hasPrefix("http://") || profile.website.lowercased().hasPrefix("https://")) ? profile.website : ""
        let birthday = person ? Format.birthday(profile.birthday) : ""
        let socials = person ? SocialNetwork.allCases.filter { !value($0).isEmpty } : []
        VStack(alignment: .leading, spacing: 12) {
            FlowLayout(spacing: 14, lineSpacing: 8) {
                if person && !profile.location.isEmpty {
                    detail("mappin.and.ellipse", profile.location)
                }
                if !site.isEmpty, let url = URL(string: site) {
                    Button {
                        openURL(url)
                    } label: {
                        HStack(spacing: 5) {
                            Image(systemName: "link").font(.system(size: 12, weight: .medium))
                            Text(Format.siteLabel(site))
                                .foregroundColor(.white)
                                .lineLimit(1)
                        }
                        .font(.system(size: 13))
                        .foregroundColor(Noct.text48)
                    }
                    .buttonStyle(PressableStyle())
                }
                if !birthday.isEmpty {
                    detail("birthday.cake", birthday)
                }
                detail("calendar", Format.joined(profile.created))
            }
            if !socials.isEmpty {
                HStack(spacing: 8) {
                    ForEach(socials) { network in
                        Button {
                            if let url = network.url(value(network)) { openURL(url) }
                        } label: {
                            SocialIcon(network: network, size: 18)
                                .foregroundColor(Color.white.opacity(0.85))
                                .frame(width: 36, height: 36)
                                .background(Circle().fill(Color.white.opacity(0.06)))
                        }
                        .buttonStyle(PressableStyle())
                        .accessibilityLabel("\(network.label): @\(value(network))")
                    }
                }
            }
        }
    }

    private func value(_ network: SocialNetwork) -> String {
        switch network {
        case .instagram: return profile.instagram
        case .tiktok: return profile.tiktok
        case .youtube: return profile.youtube
        }
    }

    private func detail(_ icon: String, _ text: String) -> some View {
        HStack(spacing: 5) {
            Image(systemName: icon).font(.system(size: 12, weight: .medium))
            Text(text).lineLimit(1)
        }
        .font(.system(size: 13))
        .foregroundColor(Noct.text48)
    }
}

/// Telegram-style personal channel cards under the stats.
struct ChannelCardsView: View {
    @EnvironmentObject private var nav: Navigator
    let channels: [ChannelCard]

    var body: some View {
        VStack(spacing: 8) {
            ForEach(channels) { channel in
                Button {
                    nav.push(.profile(channel.id))
                } label: {
                    VStack(alignment: .leading, spacing: 8) {
                        HStack {
                            Text("КАНАЛ")
                                .font(.system(size: 11, weight: .medium))
                                .tracking(0.7)
                            Spacer()
                            Text("\(Format.count(channel.followers)) \(Format.plural(channel.followers, "подписчик", "подписчика", "подписчиков"))")
                                .font(.system(size: 12))
                        }
                        .foregroundColor(Noct.text48)
                        HStack(spacing: 12) {
                            AvatarView(person: channel.identity, size: 44)
                            VStack(alignment: .leading, spacing: 2) {
                                DisplayName(person: channel.identity, size: 15)
                                Text(channel.post.map { PremiumEmoji.replace($0.summary) } ?? "Пока нет публикаций")
                                    .font(.system(size: 14))
                                    .foregroundColor(Noct.text60)
                                    .lineLimit(1)
                            }
                            Spacer(minLength: 0)
                            if let post = channel.post {
                                Text(Format.ago(post.created))
                                    .font(.system(size: 12))
                                    .foregroundColor(Noct.text48)
                            }
                        }
                    }
                    .padding(.horizontal, 14)
                    .padding(.vertical, 12)
                    .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(Color.white.opacity(0.03)))
                    .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).stroke(Noct.border, lineWidth: 1))
                }
                .buttonStyle(PressableStyle())
            }
        }
    }
}

/// «Этот аккаунт подтверждён…» notice at the bottom of the profile card.
struct VerifiedNotice: View {
    let appearance: Appearance

    var body: some View {
        HStack(spacing: 10) {
            VerifiedBadge(appearance: appearance, size: 23)
            Text("Этот аккаунт подтверждён как официальный представителями NoctGram.")
                .font(.system(size: 12))
                .foregroundColor(Color(hex: 0xC9C9CE))
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(.vertical, 13)
        .frame(maxWidth: .infinity, alignment: .leading)
        .overlay(alignment: .top) { Rectangle().fill(Color.white.opacity(0.06)).frame(height: 1) }
    }
}

/// Gift art: plain gifts on a card, collectibles on their radial backdrop.
/// Gift art: the static picture, animated with its Lottie file while
/// GiftPlayback lets it play (a few at a time). `featured` marks the one
/// being looked at (a gift card or a gift in a chat).
struct GiftArt: View {
    @EnvironmentObject private var session: AppSession
    let path: String
    var collectible: Collectible?
    var animated = true
    var featured = false

    var body: some View {
        ZStack {
            if let collectible {
                RadialGradient(
                    colors: [Color(hexString: collectible.centerColor) ?? Noct.selected, Color(hexString: collectible.edgeColor) ?? Noct.card],
                    center: .center,
                    startRadius: 2,
                    endRadius: 90
                )
            } else {
                Color.white.opacity(0.03)
            }
            GiftPlayer(
                art: session.api.mediaURL(path),
                animation: animated ? GiftAnimations.animationPath(forArt: path).flatMap { session.api.mediaURL($0) } : nil,
                featured: featured
            )
            .padding(collectible == nil ? 14 : 12)
            .allowsHitTesting(false)
        }
    }
}

/// Received gifts as in Telegram: square cards with the art, the sender's
/// avatar in the corner and a glass eye over gifts hidden from the profile.
struct GiftsGrid: View {
    @EnvironmentObject private var session: AppSession
    @EnvironmentObject private var nav: Navigator
    @ObservedObject var store: ProfileStore
    let own: Bool
    @ObservedObject private var catalog = GiftCatalog.shared
    @State private var selected: ReceivedGift?

    private let columns = Array(repeating: GridItem(.flexible(), spacing: 10), count: 3)

    var body: some View {
        VStack(spacing: 14) {
            if store.gifts.isEmpty {
                if store.giftsLoading || !store.giftsLoaded {
                    LoadingRow()
                } else {
                    EmptyState(icon: "gift", text: own ? "Подарков пока нет. Они появятся здесь." : "У этого профиля пока нет подарков.")
                }
            } else {
                LazyVGrid(columns: columns, spacing: 10) {
                    ForEach(store.gifts) { gift in
                        Button {
                            selected = gift
                        } label: {
                            GiftTile(gift: gift)
                        }
                        .buttonStyle(PressableStyle())
                        .onAppear {
                            if gift.id == store.gifts.last?.id {
                                Task { await store.loadGifts(api: session.api, reset: false) }
                            }
                        }
                    }
                }
                if store.giftsLoading { LoadingRow() }
                if own {
                    Text("Нажми на подарок, чтобы продать его за звёзды или изменить настройки показа.")
                        .font(.system(size: 14))
                        .foregroundColor(Noct.text48)
                        .multilineTextAlignment(.center)
                        .padding(.horizontal, 20)
                        .padding(.top, 4)
                }
            }
        }
        .sheet(item: $selected) { gift in
            GiftDetailSheet(
                gift: gift,
                own: own,
                store: store,
                openProfile: { nav.push(.profile($0)) },
                openWallet: { nav.push(.wallet) }
            )
            .environmentObject(session)
        }
        #if DEBUG
        .onAppear { debugOpen() }
        .onChange(of: store.gifts.count) { _ in debugOpen() }
        #endif
    }

    #if DEBUG
    /// Screenshot hook (ios/Tests): `-noct.debugSheet gift` opens the first gift.
    private func debugOpen() {
        guard selected == nil, UserDefaults.standard.string(forKey: "noct.debugSheet") == "gift" else { return }
        selected = store.gifts.first { !$0.message.isEmpty } ?? store.gifts.first
    }
    #endif
}

struct GiftTile: View {
    let gift: ReceivedGift

    var body: some View {
        GiftArt(path: gift.artPath, collectible: gift.collectible)
            .aspectRatio(1, contentMode: .fit)
            .background(Noct.group)
            .clipShape(RoundedRectangle(cornerRadius: 22, style: .continuous))
            .overlay(alignment: .topLeading) {
                sender.padding(8)
            }
            .overlay {
                if gift.hidden {
                    Image(systemName: "eye.slash.fill")
                        .font(.system(size: 16, weight: .semibold))
                        .foregroundColor(.white)
                        .frame(width: 42, height: 42)
                        .background(Circle().fill(Color.black.opacity(0.55)))
                        .accessibilityLabel("Скрыт из профиля")
                }
            }
            .overlay(alignment: .bottom) {
                if let collectible = gift.collectible {
                    Text("#\(collectible.number)")
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundColor(.white)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 3)
                        .background(Capsule().fill(Color.black.opacity(0.45)))
                        .padding(.bottom, 7)
                }
            }
    }

    /// Who sent it; a gift badge when the sender is not shown.
    @ViewBuilder private var sender: some View {
        if gift.sender.isEmpty {
            Image(systemName: "gift.fill")
                .font(.system(size: 11, weight: .semibold))
                .foregroundColor(.white)
                .frame(width: 22, height: 22)
                .background(Circle().fill(IconColor.blue))
        } else {
            AvatarView(person: Identity(id: gift.sender, name: gift.senderName, avatar: gift.senderAvatar, handle: gift.senderHandle), size: 22, ring: false)
        }
    }
}

/// A received gift, laid out like a Telegram gift card: the art, what can be
/// done with it and a table with the sender, date, price and caption.
struct GiftDetailSheet: View {
    @EnvironmentObject private var session: AppSession
    @Environment(\.dismiss) private var dismiss
    let gift: ReceivedGift
    /// The viewer manages this profile's gifts (own profile or channel).
    let own: Bool
    @ObservedObject var store: ProfileStore
    let openProfile: (String) -> Void
    let openWallet: () -> Void
    @ObservedObject private var catalog = GiftCatalog.shared
    @State private var hidden: Bool
    @State private var sale: GiftSale?
    @State private var busy = false
    @State private var confirmSale = false
    @State private var giftBack = false

    init(gift: ReceivedGift, own: Bool, store: ProfileStore, openProfile: @escaping (String) -> Void, openWallet: @escaping () -> Void) {
        self.gift = gift
        self.own = own
        _store = ObservedObject(wrappedValue: store)
        self.openProfile = openProfile
        self.openWallet = openWallet
        _hidden = State(initialValue: gift.hidden)
    }

    private var mine: Bool { !gift.recipient.isEmpty && gift.recipient == session.myId }
    private var name: String { catalog.name(for: gift.giftId) ?? "Подарок" }
    private var accent: Color { session.me?.appearance.accent ?? Noct.lilac }
    private var price: Int? {
        if let sale, sale.originalPrice > 0 { return sale.originalPrice }
        return catalog.gifts.first { $0.id == gift.giftId }?.price
    }
    private var sender: Identity {
        Identity(id: gift.sender, name: gift.senderName, avatar: gift.senderAvatar, handle: gift.senderHandle)
    }

    private var title: String {
        if let collectible = gift.collectible { return "\(name) #\(collectible.number)" }
        return mine ? "Подарок вам" : name
    }

    private var summary: String {
        if let collectible = gift.collectible {
            return collectible.modelName.isEmpty ? "Коллекционный подарок" : "Коллекционный подарок · \(collectible.modelName)"
        }
        guard mine else { return "Подарок в профиле" }
        if let sale, sale.available {
            return "Можно хранить этот подарок в профиле или продать за \(stars(sale.amount))."
        }
        if let sale, !sale.reason.isEmpty { return sale.reason }
        return "Подарок хранится в твоём профиле."
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 0) {
                    GiftArt(path: gift.artPath, collectible: gift.collectible, featured: true)
                        .frame(width: 160, height: 160)
                        .clipShape(RoundedRectangle(cornerRadius: 36, style: .continuous))
                    Text(title)
                        .font(.system(size: 24, weight: .bold))
                        .multilineTextAlignment(.center)
                        .padding(.top, 14)
                    Text(summary)
                        .font(.system(size: 16))
                        .foregroundColor(Noct.text75)
                        .multilineTextAlignment(.center)
                        .padding(.top, 8)
                    if mine {
                        Button {
                            dismiss()
                            openWallet()
                        } label: {
                            HStack(spacing: 3) {
                                Text("Подробнее о звёздах")
                                Image(systemName: "chevron.right").font(.system(size: 13, weight: .semibold))
                            }
                            .font(.system(size: 16))
                            .foregroundColor(accent)
                        }
                        .buttonStyle(PressableStyle())
                        .padding(.top, 4)
                    }
                    table
                        .padding(.top, 22)
                    if own {
                        visibility
                            .padding(.top, 16)
                    }
                    Button {
                        dismiss()
                    } label: {
                        Text("OK").frame(maxWidth: .infinity)
                    }
                    .buttonStyle(PrimaryButtonStyle())
                    .padding(.top, 22)
                }
                .padding(.horizontal, 20)
                .padding(.bottom, 24)
            }
            .sheetSurface()
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button {
                        dismiss()
                    } label: {
                        Image(systemName: "xmark")
                    }
                    .accessibilityLabel("Закрыть")
                }
            }
        }
        .presentationDetents([.fraction(0.86), .large])
        .confirmationDialog("Продать подарок за \(stars(sale?.amount ?? 0))?", isPresented: $confirmSale, titleVisibility: .visible) {
            Button("Продать", role: .destructive) { Task { await sell() } }
            Button("Отмена", role: .cancel) {}
        } message: {
            Text("Подарок исчезнет из профиля, а звёзды придут на баланс. Комиссия \(sale?.feePercent ?? 15) %.")
        }
        .sheet(isPresented: $giftBack) {
            SendGiftSheet(recipient: sender)
                .environmentObject(session)
        }
        .task { await loadSale() }
    }

    // MARK: Table

    private var table: some View {
        VStack(spacing: 0) {
            if !gift.sender.isEmpty {
                row("От") {
                    ViewThatFits(in: .horizontal) {
                        HStack(spacing: 8) { senderLink; sendBack }
                        VStack(alignment: .leading, spacing: 6) { senderLink; sendBack }
                    }
                }
            }
            row("Дата") {
                Text(Format.receipt(gift.created))
            }
            if let price {
                row("Стоимость", divider: gift.collectible != nil || !gift.message.isEmpty) {
                    ViewThatFits(in: .horizontal) {
                        HStack(spacing: 8) { priceLabel(price); sellChip }
                        VStack(alignment: .leading, spacing: 6) { priceLabel(price); sellChip }
                    }
                }
            }
            if let collectible = gift.collectible {
                if !collectible.modelName.isEmpty {
                    row("Модель") { Text(collectible.modelName) }
                }
                if !collectible.backdropName.isEmpty {
                    row("Фон", divider: !gift.message.isEmpty) { Text(collectible.backdropName) }
                }
            }
            if !gift.message.isEmpty {
                Text(PremiumEmoji.replace(gift.message))
                    .font(.system(size: 16))
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 14)
            }
        }
        .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).stroke(Color.white.opacity(0.14), lineWidth: 1))
    }

    private func row<Content: View>(_ label: String, divider: Bool = true, @ViewBuilder content: () -> Content) -> some View {
        HStack(spacing: 0) {
            Text(label)
                .font(.system(size: 16))
                .foregroundColor(Noct.text75)
                .frame(width: 96, alignment: .leading)
                .padding(.horizontal, 14)
                .padding(.vertical, 14)
            Rectangle()
                .fill(Color.white.opacity(0.14))
                .frame(width: 1)
                .frame(maxHeight: .infinity)
            content()
                .font(.system(size: 16))
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, 12)
                .padding(.vertical, 10)
        }
        .fixedSize(horizontal: false, vertical: true)
        .overlay(alignment: .bottom) {
            if divider {
                Rectangle().fill(Color.white.opacity(0.14)).frame(height: 1)
            }
        }
    }

    private var senderLink: some View {
        Button {
            dismiss()
            openProfile(gift.sender)
        } label: {
            HStack(spacing: 8) {
                AvatarView(person: sender, size: 24, ring: false)
                Text(gift.senderName.isEmpty ? "@" + gift.senderHandle : gift.senderName)
                    .foregroundColor(accent)
                    .lineLimit(1)
            }
        }
        .buttonStyle(PressableStyle())
    }

    @ViewBuilder private var sendBack: some View {
        if gift.sender != session.myId && !session.readOnly {
            chip("отправить подарок") { giftBack = true }
        }
    }

    private func priceLabel(_ price: Int) -> some View {
        HStack(spacing: 4) {
            Text(Format.count(price))
            Image("StarsIcon").resizable().scaledToFit().frame(width: 17, height: 17)
        }
    }

    @ViewBuilder private var sellChip: some View {
        if mine, let sale, sale.available, !session.readOnly {
            chip("продать за \(stars(sale.amount))") { confirmSale = true }
                .disabled(busy)
        }
    }

    private func chip(_ title: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(title)
                .font(.system(size: 13, weight: .medium))
                .foregroundColor(accent)
                .lineLimit(1)
                .padding(.horizontal, 9)
                .padding(.vertical, 4)
                .background(Capsule().fill(accent.opacity(0.16)))
        }
        .buttonStyle(PressableStyle())
    }

    private var visibility: some View {
        HStack(spacing: 4) {
            Text(hidden ? "Подарок скрыт из профиля." : "Подарок виден в профиле.")
                .foregroundColor(Noct.text48)
            Button {
                Task { await toggleHidden() }
            } label: {
                HStack(spacing: 2) {
                    Text(hidden ? "Показать" : "Скрыть")
                    Image(systemName: "chevron.right").font(.system(size: 12, weight: .semibold))
                }
                .foregroundColor(accent)
            }
            .buttonStyle(PressableStyle())
            .disabled(busy)
        }
        .font(.system(size: 15))
    }

    private func stars(_ count: Int) -> String {
        "\(Format.count(count)) \(Format.plural(count, "звезду", "звезды", "звёзд"))"
    }

    // MARK: Actions

    private func loadSale() async {
        guard mine, gift.collectible == nil, sale == nil else { return }
        if let data = try? await session.api.get("/api/gifts", ["action": "convert", "id": gift.id]) {
            sale = GiftSale(data)
        }
    }

    private func toggleHidden() async {
        busy = true
        defer { busy = false }
        do {
            try await store.setGiftHidden(gift, hidden: !hidden, api: session.api)
            hidden.toggle()
            Haptics.tap()
        } catch {
            session.report(error)
        }
    }

    private func sell() async {
        guard let sale else { return }
        busy = true
        defer { busy = false }
        do {
            if let balance = try await store.sellGift(gift, expectedAmount: sale.amount, api: session.api) {
                catalog.balance = balance
            }
            Haptics.success()
            session.show("Подарок продан: +\(Format.count(sale.amount)) ⭐️")
            dismiss()
        } catch {
            session.report(error)
        }
    }
}

/// Catalog of gifts for Noct Stars, sent to a person or a channel.
struct SendGiftSheet: View {
    @EnvironmentObject private var session: AppSession
    @Environment(\.dismiss) private var dismiss
    let recipient: Identity
    @ObservedObject private var catalog = GiftCatalog.shared
    @State private var selected: GiftDefinition?
    @State private var message = ""
    @State private var sending = false
    @State private var key = UUID().uuidString

    private let columns = [GridItem(.flexible(), spacing: 10), GridItem(.flexible(), spacing: 10), GridItem(.flexible(), spacing: 10)]

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 16) {
                    HStack(spacing: 10) {
                        Image("StarsIcon").resizable().scaledToFit().frame(width: 20, height: 20)
                        Text(catalog.balance.map { "Баланс: \(Format.count($0))" } ?? "Загружаем баланс…")
                            .font(.system(size: 14, weight: .medium))
                            .foregroundColor(Noct.text75)
                        Spacer()
                    }
                    LazyVGrid(columns: columns, spacing: 10) {
                        ForEach(catalog.gifts) { gift in
                            Button {
                                selected = gift
                            } label: {
                                VStack(spacing: 4) {
                                    GiftArt(path: gift.artPath)
                                        .aspectRatio(1, contentMode: .fit)
                                        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                                    Text(gift.name)
                                        .font(.system(size: 11))
                                        .foregroundColor(Noct.text75)
                                        .lineLimit(1)
                                    HStack(spacing: 3) {
                                        Image("StarsIcon").resizable().scaledToFit().frame(width: 12, height: 12)
                                        Text("\(gift.price)")
                                            .font(.system(size: 12, weight: .semibold))
                                            .foregroundColor(Noct.gold)
                                    }
                                }
                                .padding(6)
                                .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(selected == gift ? Noct.fillHeavy : Noct.sheetRow))
                                .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).stroke(selected == gift ? Color.white.opacity(0.5) : Noct.border, lineWidth: 1))
                            }
                            .buttonStyle(PressableStyle())
                        }
                    }
                    if catalog.gifts.isEmpty { LoadingRow() }
                }
                .padding(16)
            }
            .sheetSurface()
            .glassBottomBar {
                VStack(spacing: 10) {
                    TextField("Подпись к подарку (необязательно)", text: $message, axis: .vertical)
                        .lineLimit(1...3)
                        .glassField(radius: 22)
                    Button {
                        Task { await send() }
                    } label: {
                        HStack {
                            if sending { ProgressView().tint(.black) }
                            Text(selected.map { "Подарить за \($0.price) ⭐️" } ?? "Выбери подарок")
                        }
                        .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(PrimaryButtonStyle())
                    .disabled(selected == nil || sending)
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 10)
            }
            .navigationTitle("Подарок для \(recipient.name)")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Отмена") { dismiss() }
                }
            }
        }
        .task { await GiftCatalog.shared.load(api: session.api, force: true) }
    }

    private func send() async {
        guard let gift = selected else { return }
        sending = true
        defer { sending = false }
        do {
            let data = try await session.api.post("/api/gifts", [
                "action": "send",
                "giftId": gift.id,
                "recipient": recipient.id,
                "message": String(message.prefix(240)),
                "key": key,
            ])
            catalog.balance = data["balance"].int ?? catalog.balance
            Haptics.success()
            session.show("Подарок «\(gift.name)» отправлен")
            dismiss()
        } catch {
            key = UUID().uuidString
            session.report(error)
        }
    }
}

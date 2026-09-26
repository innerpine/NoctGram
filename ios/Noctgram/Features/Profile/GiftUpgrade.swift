import SwiftUI
import UIKit

extension GiftBackdrop {
    var centerColor: Color { Color(hexString: center) ?? Noct.selected }
    var edgeColor: Color { Color(hexString: edge) ?? Noct.card }
    var patternColor: Color { Color(hexString: pattern) ?? .black }
    var textColor: Color { Color(hexString: text) ?? .white }
}

/// An upgrade that has just happened: the collectible's attributes roll out
/// of the collection, from the step the preview was on, before they settle.
struct GiftReveal: Equatable {
    let collection: GiftCollection
    let start: Int
}

// MARK: - Scene

/// A collectible as Telegram draws a unique gift: the backdrop's radial
/// gradient, the symbol scattered around the middle in the pattern colour
/// and the model on top. Tiles, chat cards and the sheet header share it.
struct CollectibleScene: View {
    @EnvironmentObject private var session: AppSession
    let look: GiftLook
    /// The model's side; 72 % of the scene's shorter side by default.
    var modelSize: CGFloat?
    /// Where the model's centre is, as a fraction of the height.
    var centerY: CGFloat = 0.5
    var animated = true
    var featured = false
    /// The attributes change every tenth of a second: they are swapped in
    /// place, without fades, and the model stays a still picture.
    var rolling = false

    var body: some View {
        GeometryReader { geometry in
            let size = geometry.size
            let side = modelSize ?? min(size.width, size.height) * 0.72
            let center = CGPoint(x: size.width / 2, y: size.height * centerY)
            ZStack {
                backdrop(size)
                GiftPattern(asset: look.symbol.asset, color: look.backdrop.patternColor, center: center, unit: side)
                model
                    .frame(width: side, height: side)
                    .position(center)
            }
        }
    }

    @ViewBuilder private func backdrop(_ size: CGSize) -> some View {
        let gradient = RadialGradient(
            colors: [look.backdrop.centerColor, look.backdrop.edgeColor],
            center: UnitPoint(x: 0.5, y: centerY),
            startRadius: 0,
            endRadius: max(size.width, size.height) * 0.72
        )
        if rolling {
            gradient
        } else {
            gradient
                .id(look.backdrop.id)
                .transition(.opacity)
        }
    }

    @ViewBuilder private var model: some View {
        let path = "/assets/gifts/\(look.model.asset).webp"
        let player = GiftPlayer(
            art: session.api.mediaURL(path),
            animation: animated && !rolling ? GiftAnimations.animationPath(forArt: path).flatMap { session.api.mediaURL($0) } : nil,
            featured: featured
        )
        .allowsHitTesting(false)
        if rolling {
            player
        } else {
            player
                .id(look.model.id)
                .transition(.opacity.combined(with: .scale(scale: 0.86)))
        }
    }
}

/// The symbol around the model, laid out as Telegram lays out a unique
/// gift's pattern: mirrored pairs in rings, larger and stronger next to the
/// model, smaller and fainter further out. It is measured in model sides,
/// so a tile shows the inner ring and the sheet header all of it.
struct GiftPattern: View {
    @EnvironmentObject private var session: AppSession
    let asset: String
    let color: Color
    let center: CGPoint
    let unit: CGFloat
    @State private var symbol: UIImage?

    private struct Spot {
        let x: CGFloat
        let y: CGFloat
        let size: CGFloat
        let opacity: Double
    }

    /// The middle column and the right half; the left half mirrors it.
    private static let spots: [Spot] = {
        let middle = [Spot(x: 0, y: -0.74, size: 0.15, opacity: 0.36)]
        let right = [
            // Next to the model.
            Spot(x: 0.50, y: -0.58, size: 0.19, opacity: 0.46),
            Spot(x: 0.78, y: -0.10, size: 0.19, opacity: 0.46),
            Spot(x: 0.64, y: 0.42, size: 0.175, opacity: 0.42),
            // The next ring.
            Spot(x: 0.96, y: -0.56, size: 0.16, opacity: 0.34),
            Spot(x: 1.10, y: 0.20, size: 0.16, opacity: 0.32),
            Spot(x: 0.98, y: 0.78, size: 0.15, opacity: 0.28),
            Spot(x: 0.36, y: 0.72, size: 0.14, opacity: 0.26),
            // Towards the edges.
            Spot(x: 1.28, y: -0.30, size: 0.13, opacity: 0.22),
            Spot(x: 1.30, y: 0.58, size: 0.13, opacity: 0.2),
            Spot(x: 1.22, y: 1.14, size: 0.125, opacity: 0.18),
            Spot(x: 0.62, y: 1.20, size: 0.125, opacity: 0.16),
        ]
        return middle + right + right.map { Spot(x: -$0.x, y: $0.y, size: $0.size, opacity: $0.opacity) }
    }()

    var body: some View {
        Canvas { context, size in
            guard let symbol else { return }
            var image = context.resolve(Image(uiImage: symbol).renderingMode(.template))
            image.shading = .color(color)
            let bounds = CGRect(origin: .zero, size: size)
            let aspect = symbol.size.height > 0 ? symbol.size.width / symbol.size.height : 1
            for spot in Self.spots {
                let side = spot.size * unit
                let width = aspect >= 1 ? side : side * aspect
                let height = aspect >= 1 ? side / aspect : side
                let rect = CGRect(
                    x: center.x + spot.x * unit - width / 2,
                    y: center.y + spot.y * unit - height / 2,
                    width: width,
                    height: height
                )
                guard rect.intersects(bounds) else { continue }
                context.opacity = spot.opacity
                context.draw(image, in: rect)
            }
        }
        .allowsHitTesting(false)
        .task(id: asset) { await load() }
    }

    /// The old symbol stays until the new one is ready, so nothing blinks.
    private func load() async {
        guard !asset.isEmpty, let url = session.api.mediaURL("/assets/gifts/\(asset).webp") else { return }
        let image = await ImagePipeline.shared.image(for: url, maxPixel: 96)
        guard !Task.isCancelled, let image else { return }
        symbol = image
    }
}

// MARK: - Upgrade

/// «Улучшить подарок» as Telegram offers it: the collectible the gift may
/// become, turning through the collection's models, backdrops and symbols
/// every three seconds, what an upgrade gives, whether the sender's name
/// and caption stay, and the price in Noct Stars (app/gift-upgrade-panel.tsx).
struct GiftUpgradeView: View {
    @EnvironmentObject private var session: AppSession
    let gift: ReceivedGift
    let collection: GiftCollection
    let balance: Int
    @ObservedObject var store: ProfileStore
    let back: () -> Void
    /// Asks the server again after a request whose outcome is unknown.
    let recheck: () async throws -> Void
    let topUp: () -> Void
    /// The collectible, the new balance and the step the preview was on.
    let upgraded: (Collectible, Int?, Int) -> Void

    @State private var step = 0
    @State private var keepOriginal = false
    @State private var busy = false
    @State private var error: String?
    /// The last request failed without an answer, so it may have gone through.
    @State private var uncertain = false

    private var accent: Color { session.me?.appearance.accent ?? Noct.lilac }
    private var look: GiftLook { collection.look(at: step) }
    private var short: Bool { !uncertain && balance < collection.price }
    private var hasOriginal: Bool { !gift.sender.isEmpty || !gift.message.isEmpty }

    var body: some View {
        ScrollView {
            VStack(spacing: 0) {
                header
                VStack(alignment: .leading, spacing: 20) {
                    feature("sparkles", "Уникальный вид", "Одна из \(collection.models.count) моделей с новым фоном и узором.")
                    feature("diamond.fill", "Редкие атрибуты", "Модель, фон и узор выпадают случайно, и у каждого своя редкость.")
                    feature("number", "Коллекционный номер", "Твой экземпляр получит собственный номер в Noctgram.")
                }
                .padding(.horizontal, 24)
                .padding(.top, 26)
                if hasOriginal {
                    keepToggle
                        .padding(.horizontal, 24)
                        .padding(.top, 26)
                }
                if let error {
                    Text(error)
                        .font(.system(size: 14))
                        .foregroundColor(Noct.red)
                        .multilineTextAlignment(.center)
                        .padding(.horizontal, 24)
                        .padding(.top, 16)
                }
                submit
                    .padding(.horizontal, 20)
                    .padding(.top, 20)
                if short {
                    HStack(spacing: 4) {
                        Text("Не хватает Noct Stars.")
                            .foregroundColor(Noct.text48)
                        Button("Пополнить", action: topUp)
                            .foregroundColor(accent)
                            .buttonStyle(PressableStyle())
                    }
                    .font(.system(size: 14))
                    .padding(.top, 12)
                }
                Text("Улучшение необратимо. Варианты вверху — примеры: модель, фон и узор выпадут случайно.")
                    .font(.system(size: 13))
                    .foregroundColor(Noct.text48)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 28)
                    .padding(.top, 16)
                Text("Оформление подарков: Telegram. Данные и ассеты: @GiftChanges.")
                    .font(.system(size: 12))
                    .foregroundColor(Noct.text25)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 28)
                    .padding(.top, 8)
            }
            .padding(.bottom, 28)
        }
        .ignoresSafeArea(edges: .top)
        .sheetSurface()
        .overlay(alignment: .topLeading) { backButton }
        .overlay(alignment: .topTrailing) { balancePill }
        .task(id: busy) { await cycle() }
        .onAppear { prefetch(from: step + 1, count: 18) }
        #if DEBUG
        .task { await debugBuy() }
        #endif
    }

    private var header: some View {
        ZStack(alignment: .bottom) {
            CollectibleScene(look: look, modelSize: 150, centerY: 0.38, animated: !busy, featured: true)
            VStack(spacing: 6) {
                Text("Улучшить подарок")
                    .font(.system(size: 22, weight: .bold))
                    .foregroundColor(.white)
                Text("Преврати подарок в уникальный коллекционный экземпляр.")
                    .font(.system(size: 15))
                    .foregroundColor(look.backdrop.textColor)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .multilineTextAlignment(.center)
            .padding(.horizontal, 36)
            .padding(.bottom, 24)
        }
        .frame(height: 330)
        .clipped()
    }

    private func feature(_ icon: String, _ title: String, _ text: String) -> some View {
        HStack(alignment: .top, spacing: 16) {
            Image(systemName: icon)
                .font(.system(size: 24, weight: .medium))
                .foregroundColor(accent)
                .frame(width: 30)
            VStack(alignment: .leading, spacing: 3) {
                Text(title)
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundColor(.white)
                Text(text)
                    .font(.system(size: 15))
                    .foregroundColor(Noct.text60)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 0)
        }
    }

    /// Telegram's round check before «Добавить имя отправителя».
    private var keepToggle: some View {
        Button {
            keepOriginal.toggle()
            Haptics.tap()
        } label: {
            HStack(spacing: 10) {
                ZStack {
                    Circle()
                        .stroke(Color.white.opacity(0.35), lineWidth: 1.5)
                    if keepOriginal {
                        Circle()
                            .fill(accent)
                        Image(systemName: "checkmark")
                            .font(.system(size: 11, weight: .bold))
                            .foregroundColor(.black)
                    }
                }
                .frame(width: 22, height: 22)
                Text("Сохранить имя отправителя и подпись")
                    .font(.system(size: 15))
                    .foregroundColor(Noct.text75)
                    .multilineTextAlignment(.leading)
            }
            .frame(maxWidth: .infinity)
            .contentShape(Rectangle())
        }
        .buttonStyle(PressableStyle())
        .disabled(busy || uncertain)
        .accessibilityAddTraits(keepOriginal ? .isSelected : [])
        .accessibilityIdentifier("gift-upgrade-keep")
    }

    private var submit: some View {
        Button {
            Task { await upgrade() }
        } label: {
            HStack(spacing: 6) {
                if busy {
                    ProgressView()
                        .tint(.black)
                    Text("Улучшаем…")
                } else if uncertain {
                    Text("Проверить улучшение")
                } else {
                    Text("Улучшить за")
                    Image("StarsIcon")
                        .resizable()
                        .scaledToFit()
                        .frame(width: 18, height: 18)
                    Text(Format.count(collection.price))
                }
            }
            .font(.system(size: 17, weight: .semibold))
            .frame(maxWidth: .infinity, minHeight: 50)
        }
        .buttonStyle(PrimaryButtonStyle())
        .disabled(busy || short)
        .accessibilityIdentifier("gift-upgrade-submit")
    }

    private var backButton: some View {
        Button(action: back) {
            Image(systemName: "chevron.left")
                .font(.system(size: 16, weight: .semibold))
        }
        .buttonStyle(CircleButtonStyle(size: 36))
        .disabled(busy)
        .padding(14)
        .accessibilityLabel("Назад к подарку")
    }

    /// The balance in the corner, as Telegram shows it over a purchase.
    private var balancePill: some View {
        HStack(spacing: 4) {
            Image("StarsIcon")
                .resizable()
                .scaledToFit()
                .frame(width: 15, height: 15)
            Text(Format.count(balance))
                .font(.system(size: 14, weight: .semibold))
                .monospacedDigit()
                .foregroundColor(.white)
        }
        .padding(.horizontal, 12)
        .frame(height: 36)
        .glassCapsule()
        .padding(14)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Баланс: \(Format.count(balance)) \(Format.plural(balance, "звезда", "звезды", "звёзд"))")
    }

    /// A new look every three seconds while nothing is being bought.
    private func cycle() async {
        guard !busy, !UIAccessibility.isReduceMotionEnabled else { return }
        while !Task.isCancelled {
            try? await Task.sleep(nanoseconds: 3_000_000_000)
            guard !Task.isCancelled else { return }
            withAnimation(.easeInOut(duration: 0.5)) { step += 1 }
            prefetch(from: step + 1, count: 18)
        }
    }

    /// Pictures of the looks to come, so neither the preview nor the reveal
    /// (which rolls through the next seventeen) waits for a download.
    private func prefetch(from start: Int, count: Int) {
        var wanted: [(URL, CGFloat)] = []
        for index in start..<(start + count) {
            let look = collection.look(at: index)
            if let url = session.api.mediaURL("/assets/gifts/\(look.model.asset).webp") { wanted.append((url, 360)) }
            if let url = session.api.mediaURL("/assets/gifts/\(look.symbol.asset).webp") { wanted.append((url, 96)) }
        }
        for (url, size) in wanted {
            Task.detached(priority: .utility) {
                _ = await ImagePipeline.shared.image(for: url, maxPixel: size)
            }
        }
    }

    private func upgrade() async {
        guard !busy else { return }
        busy = true
        error = nil
        defer { busy = false }
        if uncertain {
            // The last request may have gone through: look before offering
            // the purchase again, and never repeat it silently.
            do {
                try await recheck()
                uncertain = false
            } catch {
                self.error = error.userMessage ?? "Не удалось проверить улучшение."
            }
            return
        }
        prefetch(from: step + 1, count: 18)
        do {
            let (collectible, balance) = try await store.upgradeGift(
                gift,
                keepOriginal: hasOriginal && keepOriginal,
                expectedPrice: collection.price,
                api: session.api
            )
            upgraded(collectible, balance, step)
        } catch {
            guard let message = error.userMessage else { return }
            self.error = message
            uncertain = true
        }
    }

    #if DEBUG
    /// Screenshot hook (ios/Tests): `-noct.debugSheet upgraded` buys it.
    private func debugBuy() async {
        guard UserDefaults.standard.string(forKey: "noct.debugSheet") == "upgraded" else { return }
        try? await Task.sleep(nanoseconds: 1_500_000_000)
        guard !Task.isCancelled else { return }
        keepOriginal = hasOriginal
        await upgrade()
    }
    #endif
}

// MARK: - Collectible

/// A collectible as Telegram shows a unique gift: the scene with its name
/// and number, then the owner and the model, backdrop and symbol with how
/// rare each is. Right after an upgrade the attributes roll and settle one
/// by one — backdrop, symbol, model — and confetti falls.
struct CollectibleGiftView<Footer: View>: View {
    @EnvironmentObject private var session: AppSession
    let gift: ReceivedGift
    let collectible: Collectible
    let name: String
    let owner: Identity?
    let reveal: GiftReveal?
    let openProfile: (String) -> Void
    let close: () -> Void
    let footer: Footer

    /// 0 while everything rolls; the backdrop settles at 1, the symbol at 2
    /// and the model at 3, in 1.65 s as the web panel does it.
    @State private var phase: Int
    @State private var step: Int
    @State private var confetti = false

    init(
        gift: ReceivedGift,
        collectible: Collectible,
        name: String,
        owner: Identity?,
        reveal: GiftReveal?,
        openProfile: @escaping (String) -> Void,
        close: @escaping () -> Void,
        @ViewBuilder footer: () -> Footer
    ) {
        self.gift = gift
        self.collectible = collectible
        self.name = name
        self.owner = owner
        self.reveal = reveal
        self.openProfile = openProfile
        self.close = close
        self.footer = footer()
        let rolls = reveal != nil && !UIAccessibility.isReduceMotionEnabled
        _phase = State(initialValue: rolls ? 0 : 3)
        _step = State(initialValue: (reveal?.start ?? 0) + 1)
    }

    private var rolling: Bool { phase < 3 }
    private var accent: Color { session.me?.appearance.accent ?? Noct.lilac }

    /// What is on screen: rolling attributes until each one settles.
    private var look: GiftLook {
        guard rolling, let reveal else { return collectible.look }
        let roll = reveal.collection.look(at: step)
        return GiftLook(
            model: roll.model,
            backdrop: phase >= 1 ? collectible.look.backdrop : roll.backdrop,
            symbol: phase >= 2 ? collectible.look.symbol : roll.symbol
        )
    }

    var body: some View {
        ScrollView {
            VStack(spacing: 0) {
                header
                table
                    .padding(.horizontal, 20)
                    .padding(.top, 22)
                if reveal != nil {
                    status
                        .padding(.top, 16)
                }
                if collectible.issued {
                    Text("Выдан администрацией Noctgram")
                        .font(.system(size: 14))
                        .foregroundColor(Noct.text48)
                        .padding(.top, 14)
                }
                if collectible.keepOriginal {
                    original
                        .padding(.horizontal, 24)
                        .padding(.top, 18)
                }
                footer
                    .padding(.top, 18)
                Button {
                    if rolling {
                        withAnimation(.spring(response: 0.45, dampingFraction: 0.7)) { phase = 3 }
                    } else {
                        close()
                    }
                } label: {
                    Text(rolling ? "Пропустить" : "Готово")
                        .font(.system(size: 17, weight: .semibold))
                        .frame(maxWidth: .infinity, minHeight: 50)
                }
                .buttonStyle(PrimaryButtonStyle())
                .padding(.horizontal, 20)
                .padding(.top, 22)
                .accessibilityIdentifier("gift-collectible-done")
            }
            .padding(.bottom, 28)
        }
        .ignoresSafeArea(edges: .top)
        .sheetSurface()
        .overlay(alignment: .topLeading) { closeButton }
        .overlay {
            if confetti {
                ConfettiRain()
                    .ignoresSafeArea()
                    .allowsHitTesting(false)
            }
        }
        .task { await play() }
    }

    private var header: some View {
        ZStack(alignment: .bottom) {
            CollectibleScene(look: look, modelSize: 150, centerY: 0.38, featured: true, rolling: rolling)
            VStack(spacing: 5) {
                Text(name)
                    .font(.system(size: 24, weight: .bold))
                    .foregroundColor(.white)
                Text("Коллекционный подарок #\(Format.count(collectible.number))")
                    .font(.system(size: 15, weight: .medium))
                    .foregroundColor(look.backdrop.textColor)
            }
            .multilineTextAlignment(.center)
            .padding(.horizontal, 24)
            .padding(.bottom, 26)
        }
        .frame(height: 330)
        .clipped()
    }

    private var table: some View {
        GiftInfoTable {
            if let owner {
                GiftInfoRow("Владелец") {
                    Button {
                        openProfile(owner.id)
                    } label: {
                        HStack(spacing: 8) {
                            AvatarView(person: owner, size: 24, ring: false)
                            Text(owner.name.isEmpty ? "@" + owner.handle : owner.name)
                                .foregroundColor(accent)
                                .lineLimit(1)
                        }
                    }
                    .buttonStyle(PressableStyle())
                }
            }
            GiftInfoRow("Модель") { attribute(look.model.name, look.model.rarity, settled: phase >= 3) }
            GiftInfoRow("Фон") { attribute(look.backdrop.name, look.backdrop.rarity, settled: phase >= 1) }
            GiftInfoRow("Узор", divider: false) { attribute(look.symbol.name, look.symbol.rarity, settled: phase >= 2) }
        }
        .accessibilityHidden(rolling)
    }

    /// A value that rolls in from below while rolling and springs into
    /// place when it settles.
    private func attribute(_ value: String, _ rarity: String, settled: Bool) -> some View {
        HStack(spacing: 8) {
            Text(value)
                .foregroundColor(.white)
                .lineLimit(1)
                .id(value)
                .transition(.asymmetric(
                    insertion: .move(edge: .bottom).combined(with: .opacity),
                    removal: .move(edge: .top).combined(with: .opacity)
                ))
            RarityPill(text: rarity, color: accent)
            Spacer(minLength: 0)
        }
        .clipped()
        .animation(settled ? .spring(response: 0.4, dampingFraction: 0.62) : .linear(duration: 0.09), value: value)
    }

    private var status: some View {
        HStack(spacing: 6) {
            if rolling {
                Text("Раскрываем атрибуты…")
            } else {
                Image(systemName: "checkmark.circle.fill")
                    .foregroundColor(Noct.green)
                Text("Подарок улучшен")
            }
        }
        .font(.system(size: 15, weight: .medium))
        .foregroundColor(Noct.text75)
    }

    /// Who gave it, the caption and the date, kept at the upgrade.
    private var original: some View {
        VStack(spacing: 10) {
            if !gift.sender.isEmpty {
                Button {
                    openProfile(gift.sender)
                } label: {
                    HStack(spacing: 8) {
                        AvatarView(
                            person: Identity(id: gift.sender, name: gift.senderName, avatar: gift.senderAvatar, handle: gift.senderHandle),
                            size: 26,
                            ring: false
                        )
                        Text("от " + (gift.senderName.isEmpty ? "@" + gift.senderHandle : gift.senderName))
                            .font(.system(size: 15))
                            .foregroundColor(accent)
                    }
                }
                .buttonStyle(PressableStyle())
            }
            if !gift.message.isEmpty {
                Text(PremiumEmoji.replace(gift.message))
                    .font(.system(size: 16))
                    .multilineTextAlignment(.center)
            }
            Text(Format.receipt(gift.created))
                .font(.system(size: 14))
                .foregroundColor(Noct.text48)
        }
        .frame(maxWidth: .infinity)
    }

    private var closeButton: some View {
        Button(action: close) {
            Image(systemName: "xmark")
                .font(.system(size: 15, weight: .semibold))
        }
        .buttonStyle(CircleButtonStyle(size: 36))
        .padding(14)
        .accessibilityLabel("Закрыть")
    }

    /// Rolls every tenth of a second; «Пропустить» settles everything.
    private func play() async {
        guard reveal != nil, rolling else { return }
        let begin = Date()
        let tick = UIImpactFeedbackGenerator(style: .light)
        tick.prepare()
        while phase < 3 {
            try? await Task.sleep(nanoseconds: 100_000_000)
            guard !Task.isCancelled else { return }
            guard phase < 3 else { break }
            let elapsed = Date().timeIntervalSince(begin)
            let next = elapsed < 0.55 ? 0 : elapsed < 1.1 ? 1 : elapsed < 1.65 ? 2 : 3
            step += 1
            if next > phase {
                tick.impactOccurred()
                if next == 3 {
                    withAnimation(.spring(response: 0.45, dampingFraction: 0.7)) { phase = 3 }
                } else {
                    phase = next
                }
            }
        }
        celebrate()
    }

    private func celebrate() {
        Haptics.success()
        guard !UIAccessibility.isReduceMotionEnabled else { return }
        confetti = true
        Task {
            try? await Task.sleep(nanoseconds: 3_200_000_000)
            confetti = false
        }
    }
}

// MARK: - Parts

/// How rare an attribute is: «1,2%» on a tinted pill, as in Telegram.
struct RarityPill: View {
    let text: String
    let color: Color

    var body: some View {
        Text(text)
            .font(.system(size: 12, weight: .semibold))
            .foregroundColor(color)
            .padding(.horizontal, 6)
            .padding(.vertical, 2)
            .background(RoundedRectangle(cornerRadius: 6, style: .continuous).fill(color.opacity(0.16)))
            .fixedSize()
    }
}

/// A gift's table as Telegram draws it: a rounded border, labels on the
/// left and hairlines between the columns and the rows.
struct GiftInfoTable<Content: View>: View {
    @ViewBuilder var content: Content

    var body: some View {
        VStack(spacing: 0) {
            content
        }
        .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).stroke(Color.white.opacity(0.14), lineWidth: 1))
    }
}

struct GiftInfoRow<Content: View>: View {
    let label: String
    var divider = true
    let content: Content

    init(_ label: String, divider: Bool = true, @ViewBuilder content: () -> Content) {
        self.label = label
        self.divider = divider
        self.content = content()
    }

    var body: some View {
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
            content
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
}

/// Confetti over a gift that has just been upgraded: bits of colour tumble
/// down from above the sheet, swaying and flipping, for a couple of seconds.
struct ConfettiRain: View {
    private struct Bit {
        let x: CGFloat
        let top: CGFloat
        let speed: Double
        let sway: Double
        let swayRate: Double
        let turn: Double
        let flip: Double
        let width: CGFloat
        let height: CGFloat
        let color: Color
        let delay: Double
    }

    private static let colors: [Color] = [
        Color(hex: 0xFF6B6B), Color(hex: 0xFFD166), Color(hex: 0x06D6A0), Color(hex: 0x4CC9F0),
        Color(hex: 0xB388FF), Color(hex: 0xFF8FAB), Color(hex: 0xFFFFFF),
    ]

    @State private var begin = Date()
    @State private var bits: [Bit] = (0..<90).map { _ in
        Bit(
            x: CGFloat.random(in: 0...1),
            top: CGFloat.random(in: -160 ... -12),
            speed: Double.random(in: 160...360),
            sway: Double.random(in: 10...36),
            swayRate: Double.random(in: 2...5),
            turn: Double.random(in: -7...7),
            flip: Double.random(in: 4...10),
            width: CGFloat.random(in: 6...9),
            height: CGFloat.random(in: 10...14),
            color: ConfettiRain.colors.randomElement() ?? .white,
            delay: Double.random(in: 0...0.45)
        )
    }

    var body: some View {
        TimelineView(.animation) { timeline in
            Canvas { context, size in
                let time = timeline.date.timeIntervalSince(begin)
                for bit in bits {
                    let t = time - bit.delay
                    guard t > 0 else { continue }
                    let y = bit.top + CGFloat(bit.speed * t + 260 * t * t)
                    guard y < size.height + 20 else { continue }
                    let x = bit.x * size.width + CGFloat(sin(t * bit.swayRate) * bit.sway)
                    var piece = context
                    piece.opacity = min(1, max(0, (2.8 - t) / 0.6))
                    piece.translateBy(x: x, y: y)
                    piece.rotate(by: .radians(bit.turn * t))
                    piece.scaleBy(x: CGFloat(cos(bit.flip * t)), y: 1)
                    piece.fill(
                        Path(roundedRect: CGRect(x: -bit.width / 2, y: -bit.height / 2, width: bit.width, height: bit.height), cornerRadius: 1.5),
                        with: .color(bit.color)
                    )
                }
            }
        }
    }
}

import SwiftUI
import UIKit

/// A sticker or custom emoji: its still picture, played as Lottie while the
/// sticker pool lets it (six at once, only on screen and after scrolling
/// settles; never with Reduce Motion).
struct StickerImage: View {
    @EnvironmentObject private var session: AppSession
    let sticker: Sticker
    var animated = true

    var body: some View {
        if !sticker.available {
            Text(sticker.emoji.isEmpty ? "🚫" : sticker.emoji)
                .font(.system(size: 40))
                .opacity(0.7)
                .grayscale(1)
        } else if sticker.animated {
            // Without a poster the player draws the first frame; a still
            // one never gets a turn to play.
            // Touches go to the message or the panel around it (holding a
            // message, choosing a sticker), not to the player's UIKit view.
            GiftPlayer(
                art: sticker.poster.flatMap { session.api.mediaURL($0) },
                animation: session.api.mediaURL(sticker.src),
                pool: animated ? .stickers : .stickerStills
            )
            .allowsHitTesting(false)
        } else {
            RemoteImage(url: session.api.mediaURL(sticker.poster ?? sticker.src), maxPixel: 360, contentMode: .fit, placeholder: .clear)
                .allowsHitTesting(false)
        }
    }
}

extension GiftPlayback {
    /// Players that only show the first frame (never allowed to play).
    static let stickerStills = GiftPlayback(limit: 0)
}

/// A sticker message: no bubble, as in Telegram; the time on a dark pill.
/// A tap opens its pack. An unavailable one shows its emoji greyed out and
/// «Стикер недоступен».
struct StickerMessageView: View {
    @ObservedObject private var store = StickerStore.shared
    let ref: String
    var onOpenPack: ((Sticker) -> Void)?

    static let side: CGFloat = 180

    var body: some View {
        let sticker = store.sticker(ref)
        let _ = store.revision
        Group {
            if let sticker, sticker.available {
                StickerImage(sticker: sticker)
                    .frame(width: Self.side, height: Self.side)
                    .contentShape(Rectangle())
                    .onTapGesture { onOpenPack?(sticker) }
                    .accessibilityLabel("Стикер \(sticker.emoji)")
            } else if sticker != nil || store.isMissing(ref) {
                VStack(spacing: 6) {
                    Text(sticker.map { $0.emoji.isEmpty ? "🚫" : $0.emoji } ?? "🚫")
                        .font(.system(size: 64))
                        .grayscale(1)
                        .opacity(0.7)
                    Text("Стикер недоступен")
                        .font(.system(size: 12, weight: .medium))
                        .foregroundColor(Noct.text60)
                }
                .frame(width: Self.side, height: Self.side)
                .accessibilityElement(children: .combine)
            } else {
                ProgressView()
                    .tint(Noct.text48)
                    .frame(width: Self.side, height: Self.side)
            }
        }
    }
}

/// A pack opened from a sticker message or the panel: its stickers, and
/// for a pack of people «Добавить» or «Убрать из панели».
struct StickerPackSheet: View {
    @EnvironmentObject private var session: AppSession
    @Environment(\.dismiss) private var dismiss
    @ObservedObject private var store = StickerStore.shared
    /// A built-in id or «u:<id>» (action=pack&name=).
    let name: String
    /// Sends a sticker when the pack was opened from a chat.
    var send: ((Sticker) -> Void)?
    @State private var pack: StickerPack?
    @State private var error: String?

    private let columns = Array(repeating: GridItem(.flexible(), spacing: 8), count: 4)

    var body: some View {
        NavigationStack {
            ScrollView {
                if let pack {
                    Text(summary(pack))
                        .font(.system(size: 13))
                        .foregroundColor(Noct.text48)
                        .frame(maxWidth: .infinity)
                        .padding(.top, 4)
                    LazyVGrid(columns: columns, spacing: 8) {
                        ForEach(pack.stickers) { sticker in
                            Button {
                                guard let send, sticker.available, !pack.isEmoji else { return }
                                send(sticker)
                                dismiss()
                            } label: {
                                StickerImage(sticker: sticker)
                                    .aspectRatio(1, contentMode: .fit)
                                    .padding(4)
                                    .contentShape(Rectangle())
                            }
                            .buttonStyle(PressableStyle())
                            .accessibilityLabel("Стикер \(sticker.emoji)")
                        }
                    }
                    .padding(12)
                } else if let error {
                    EmptyState(icon: "face.dashed", text: error)
                } else {
                    LoadingRow()
                }
            }
            .sheetSurface()
            .navigationTitle(pack?.title ?? "Набор")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Закрыть") { dismiss() }
                }
            }
            .safeAreaInset(edge: .bottom) {
                if let pack, !pack.builtin && !pack.own {
                    let added = store.installed.contains { $0.ref == pack.ref }
                    Button(added ? "Убрать из панели" : "Добавить \(pack.stickers.count) \(Format.plural(pack.stickers.count, pack.isEmoji ? "эмодзи" : "стикер", pack.isEmoji ? "эмодзи" : "стикера", pack.isEmoji ? "эмодзи" : "стикеров"))") {
                        Task { await store.setInstalled(pack, !added, session: session) }
                    }
                    .buttonStyle(PrimaryButtonStyle())
                    .padding(.horizontal, 16)
                    .padding(.bottom, 8)
                }
            }
            .task { await load() }
        }
        .presentationDetents([.medium, .large])
    }

    private func summary(_ pack: StickerPack) -> String {
        let count = "\(pack.stickers.count) " + (pack.isEmoji ? "эмодзи" : Format.plural(pack.stickers.count, "стикер", "стикера", "стикеров"))
        return pack.builtin ? count + " · встроенный набор" : count
    }

    private func load() async {
        if let known = (store.builtin + store.installed).first(where: { $0.name == name || $0.ref == name }) {
            pack = known
            return
        }
        do {
            pack = StickerPack(try await session.api.get("/api/stickers", ["action": "pack", "name": name]))
        } catch {
            self.error = error.userMessage ?? "Набор удалён или недоступен"
        }
    }
}

// MARK: - Custom emoji in text

/// Still pictures of premium and custom emoji sized for a line of text, so
/// they sit inline in a Text (SwiftUI draws an inline image at its size).
@MainActor
final class EmojiImages: ObservableObject {
    static let shared = EmojiImages()
    @Published private(set) var revision = 0
    private var images: [String: UIImage] = [:]
    private var loading: Set<String> = []

    func image(_ token: String, side: CGFloat, session: AppSession) -> UIImage? {
        let key = token + "#" + String(Int(side))
        if let image = images[key] { return image }
        guard !loading.contains(key), let sticker = StickerStore.shared.emoji(token), sticker.available else { return nil }
        loading.insert(key)
        let api = session.api
        Task {
            var picture: UIImage?
            if let poster = sticker.poster, let url = api.mediaURL(poster) {
                picture = await ImagePipeline.shared.image(for: url, maxPixel: side * 3)
            } else if let url = api.mediaURL(sticker.src) {
                picture = await LottieStill.image(for: url)
            }
            loading.remove(key)
            guard let picture else { return }
            images[key] = Self.fit(picture, side: side)
            revision += 1
        }
        return nil
    }

    private static func fit(_ image: UIImage, side: CGFloat) -> UIImage {
        let format = UIGraphicsImageRendererFormat.default()
        format.opaque = false
        return UIGraphicsImageRenderer(size: CGSize(width: side, height: side), format: format).image { _ in
            let scale = min(side / max(image.size.width, 1), side / max(image.size.height, 1))
            let size = CGSize(width: image.size.width * scale, height: image.size.height * scale)
            image.draw(in: CGRect(x: (side - size.width) / 2, y: (side - size.height) / 2, width: size.width, height: size.height))
        }
    }
}

@MainActor
enum EmojiText {
    /// Message text with links, where premium and custom emoji are inline
    /// pictures (their plain emoji until the picture has loaded).
    static func text(_ value: String, fontSize: CGFloat, session: AppSession) -> Text {
        let parts = EmojiTokens.parts(value)
        guard parts.contains(where: { if case .token = $0 { return true } else { return false } }) else {
            return Text(RichText.attributed(value, baseURL: session.api.baseURL))
        }
        let side = (fontSize * 1.35).rounded()
        return parts.reduce(Text("")) { result, part in
            switch part {
            case .text(let run):
                return result + Text(RichText.attributed(run, baseURL: session.api.baseURL))
            case .token(let token):
                if let image = EmojiImages.shared.image(token, side: side, session: session) {
                    return result + Text(Image(uiImage: image)).baselineOffset(-fontSize * 0.28)
                }
                return result + Text(EmojiTokens.fallback(token))
            }
        }
    }
}

/// A message of one to six emoji without a bubble, as in Telegram: large
/// Unicode emoji, and premium or custom emoji playing as Lottie.
struct BigEmojiView: View {
    @ObservedObject private var store = StickerStore.shared
    let text: String

    private var count: Int { max(1, EmojiTokens.largeCount(text)) }
    /// 64, 54 or 48 as on the web (app/chat-emoji.css).
    private var size: CGFloat { count == 1 ? 64 : (count <= 3 ? 54 : 48) }

    var body: some View {
        let _ = store.revision
        HStack(spacing: 2) {
            ForEach(Array(items.enumerated()), id: \.offset) { _, item in
                switch item {
                case .text(let emoji):
                    Text(emoji).font(.system(size: size))
                case .token(let token):
                    if let sticker = store.emoji(token), sticker.available {
                        StickerImage(sticker: sticker)
                            .frame(width: size * 1.3, height: size * 1.3)
                    } else {
                        Text(EmojiTokens.fallback(token)).font(.system(size: size))
                    }
                }
            }
        }
        .contentShape(Rectangle())
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(EmojiTokens.fallback(text))
    }

    /// One item per emoji.
    private var items: [EmojiTokens.Part] {
        EmojiTokens.parts(text).flatMap { part -> [EmojiTokens.Part] in
            switch part {
            case .token: return [part]
            case .text(let value): return value.filter { !$0.isWhitespace }.map { .text(String($0)) }
            }
        }
    }
}

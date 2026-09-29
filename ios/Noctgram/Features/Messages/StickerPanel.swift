import SwiftUI
import UIKit

/// Unicode emoji by category with Russian names for search, the same set
/// the web picker shows (emoji-picker-react, emojis-ru), in
/// Resources/emoji-ru.json. Emoji newer than the system draws are left out.
final class EmojiCatalog: @unchecked Sendable {
    struct Category: Identifiable {
        let id: String
        let title: String
        let icon: String
        let emoji: [(String, String)]
    }

    static let shared = EmojiCatalog()
    private(set) lazy var categories: [Category] = load()

    private static var supported: Double {
        if #available(iOS 18.4, *) { return 16 }
        if #available(iOS 17.4, *) { return 15.1 }
        if #available(iOS 16.4, *) { return 15 }
        return 14
    }

    private func load() -> [Category] {
        guard let url = Bundle.main.url(forResource: "emoji-ru", withExtension: "json"),
              let data = try? Data(contentsOf: url), let json = JSON.parse(data) else { return [] }
        let limit = Self.supported
        return json.array.map { category in
            Category(
                id: category["id"].str,
                title: category["title"].str,
                icon: category["icon"].str,
                emoji: category["emoji"].array.compactMap { item in
                    let row = item.array
                    guard row.count >= 2, (row.count < 3 || (row[2].double ?? 0) <= limit) else { return nil }
                    return (row[0].str, row[1].str)
                }
            )
        }
    }

    func search(_ query: String) -> [String] {
        let words = query.lowercased().split(separator: " ").map(String.init)
        guard !words.isEmpty else { return [] }
        return categories.flatMap { $0.emoji }.filter { item in
            words.allSatisfy { item.1.contains($0) }
        }.map { $0.0 }
    }
}

/// The sticker and emoji panel in place of the keyboard, as in Telegram for
/// iOS: packs along the top, search, sections of stickers (favourites,
/// recent, packs) or emoji (recent, categories, premium sets), and the
/// «Стикеры | Эмодзи» switch on glass at the bottom.
struct StickerPanel: View {
    @EnvironmentObject private var session: AppSession
    @ObservedObject private var store = StickerStore.shared
    @Binding var text: String
    let height: CGFloat
    let sendSticker: (Sticker) -> Void
    @State private var tab = StickerPanel.savedTab
    @State private var query = ""
    @State private var openPack: PackRequest?
    @State private var recentEmoji = (UserDefaults.standard.array(forKey: "noct.recentEmoji") as? [String]) ?? []

    struct PackRequest: Identifiable {
        let name: String
        var id: String { name }
    }

    private static var savedTab: String {
        UserDefaults.standard.string(forKey: "noct.panelTab") ?? "stickers"
    }

    var body: some View {
        VStack(spacing: 0) {
            if tab == "stickers" {
                StickersPage(query: $query, send: send, openPack: { openPack = PackRequest(name: $0) })
            } else {
                EmojiPage(query: $query, recent: recentEmoji, insert: insert, insertToken: insertToken)
            }
            bottomBar
        }
        .frame(height: height)
        .frame(maxWidth: .infinity)
        .background {
            ZStack {
                Rectangle().fill(.ultraThinMaterial)
                Color(hex: 0x0E0E11).opacity(0.78)
            }
            .ignoresSafeArea(edges: .bottom)
            .overlay(alignment: .top) {
                Rectangle().fill(Color.white.opacity(0.08)).frame(height: 0.5)
            }
        }
        .task { await store.load(api: session.api, me: session.myId ?? "") }
        .sheet(item: $openPack) { request in
            StickerPackSheet(name: request.name, send: send)
                .environmentObject(session)
        }
        .onChange(of: tab) { value in
            query = ""
            UserDefaults.standard.set(value, forKey: "noct.panelTab")
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("sticker-panel")
    }

    private var bottomBar: some View {
        ZStack {
            HStack(spacing: 2) {
                segment("stickers", "Стикеры")
                segment("emoji", "Эмодзи")
            }
            .padding(3)
            .glassCapsule()
            HStack {
                Spacer()
                if tab == "emoji" {
                    Button(action: backspace) {
                        Image(systemName: "delete.left")
                            .font(.system(size: 17, weight: .medium))
                    }
                    .buttonStyle(CircleButtonStyle(size: 38))
                    .accessibilityLabel("Удалить")
                    .accessibilityIdentifier("panel-backspace")
                }
            }
            .padding(.horizontal, 14)
        }
        .padding(.top, 6)
        .padding(.bottom, 6)
    }

    private func segment(_ key: String, _ title: String) -> some View {
        Button {
            guard tab != key else { return }
            Haptics.tap()
            withAnimation(Noct.quick) { tab = key }
        } label: {
            Text(title)
                .font(.system(size: 14, weight: .semibold))
                .foregroundColor(tab == key ? .white : Noct.text60)
                .padding(.horizontal, 16)
                .frame(height: 32)
                .background {
                    if tab == key { Capsule().fill(Color.white.opacity(0.16)) }
                }
                .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier("panel-tab-" + key)
        .accessibilityAddTraits(tab == key ? .isSelected : [])
    }

    private func send(_ sticker: Sticker) {
        guard sticker.available else {
            session.show("Стикер недоступен")
            return
        }
        store.noteSent(sticker)
        sendSticker(sticker)
    }

    private func insert(_ emoji: String) {
        text += emoji
        recentEmoji.removeAll { $0 == emoji }
        recentEmoji.insert(emoji, at: 0)
        if recentEmoji.count > 32 { recentEmoji = Array(recentEmoji.prefix(32)) }
        UserDefaults.standard.set(recentEmoji, forKey: "noct.recentEmoji")
    }

    /// Premium emoji go into the text as their token, as on the web.
    private func insertToken(_ sticker: Sticker) {
        guard store.premium else {
            session.show("Эмодзи из наборов доступны с Noct Premium")
            return
        }
        text += sticker.token
    }

    /// Takes back the last emoji, or the whole token before the end.
    private func backspace() {
        guard !text.isEmpty else { return }
        if text.hasSuffix(":"), let pattern = EmojiTokens.pattern {
            let ns = text as NSString
            if let last = pattern.matches(in: text, range: NSRange(location: 0, length: ns.length)).last,
               last.range.location + last.range.length == ns.length {
                text = ns.substring(to: last.range.location)
                return
            }
        }
        text.removeLast()
    }
}

/// A small square button of the pack bar.
private struct PackTab: View {
    let selected: Bool
    let label: AnyView
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            label
                .frame(width: 30, height: 30)
                .frame(width: 40, height: 40)
                .background {
                    if selected { RoundedRectangle(cornerRadius: 11, style: .continuous).fill(Color.white.opacity(0.12)) }
                }
                .contentShape(Rectangle())
        }
        .buttonStyle(PressableStyle())
    }
}

/// Uppercase grey title of a section, as in Telegram.
private struct PanelHeader: View {
    let title: String
    var locked = false

    var body: some View {
        HStack(spacing: 5) {
            Text(title.uppercased())
                .font(.system(size: 12, weight: .semibold))
                .foregroundColor(Noct.text48)
                .lineLimit(1)
            if locked {
                Image(systemName: "lock.fill")
                    .font(.system(size: 10, weight: .semibold))
                    .foregroundColor(Noct.text48)
            }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 14)
        .padding(.top, 12)
        .padding(.bottom, 6)
    }
}

private struct PanelSearch: View {
    @Binding var query: String
    let prompt: String

    var body: some View {
        HStack(spacing: 7) {
            Image(systemName: "magnifyingglass")
                .font(.system(size: 14, weight: .medium))
                .foregroundColor(Noct.text48)
            TextField(prompt, text: $query)
                .font(.system(size: 15))
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .submitLabel(.search)
                .accessibilityIdentifier("panel-search")
            if !query.isEmpty {
                Button {
                    query = ""
                } label: {
                    Image(systemName: "xmark.circle.fill").foregroundColor(Noct.text48)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Очистить")
            }
        }
        .padding(.horizontal, 12)
        .frame(height: 36)
        .background(RoundedRectangle(cornerRadius: 11, style: .continuous).fill(Color.white.opacity(0.08)))
        .padding(.horizontal, 12)
        .padding(.vertical, 6)
    }
}

// MARK: - Stickers

private struct StickersPage: View {
    @ObservedObject private var store = StickerStore.shared
    @EnvironmentObject private var session: AppSession
    @Binding var query: String
    let send: (Sticker) -> Void
    let openPack: (String) -> Void
    @State private var current = "favorites"

    private let columns = Array(repeating: GridItem(.flexible(), spacing: 4), count: 5)

    private var term: String { query.trimmingCharacters(in: .whitespaces).lowercased() }

    private struct PanelSection: Identifiable {
        let id: String
        let title: String
        let stickers: [Sticker]
        var pack: StickerPack?
    }

    private var sections: [PanelSection] {
        let _ = store.revision
        var list: [PanelSection] = []
        if term.isEmpty {
            if !store.favorites.isEmpty { list.append(PanelSection(id: "favorites", title: "Избранные стикеры", stickers: store.favorites)) }
            let recent = store.recentStickers
            if !recent.isEmpty { list.append(PanelSection(id: "recent", title: "Недавние", stickers: recent)) }
        }
        for pack in store.stickerPacks {
            let stickers = term.isEmpty || pack.title.lowercased().contains(term)
                ? pack.stickers
                : pack.stickers.filter { $0.emoji.contains(term) }
            if !stickers.isEmpty { list.append(PanelSection(id: pack.ref, title: pack.title, stickers: stickers, pack: pack)) }
        }
        return list
    }

    var body: some View {
        ScrollViewReader { proxy in
            VStack(spacing: 0) {
                if term.isEmpty { packBar(proxy) }
                PanelSearch(query: $query, prompt: "Поиск стикеров")
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 0) {
                        let list = sections
                        ForEach(list) { section in
                            VStack(alignment: .leading, spacing: 0) {
                                if let pack = section.pack, !pack.builtin {
                                    Button { openPack(pack.name) } label: { PanelHeader(title: section.title) }
                                        .buttonStyle(PressableStyle())
                                } else {
                                    PanelHeader(title: section.title)
                                }
                                LazyVGrid(columns: columns, spacing: 4) {
                                    ForEach(section.stickers) { sticker in
                                        cell(sticker)
                                    }
                                }
                                .padding(.horizontal, 8)
                            }
                            .id(section.id)
                        }
                        if list.isEmpty {
                            Text(store.loaded ? (term.isEmpty ? "Стикеров пока нет" : "Стикеров с «\(query)» не нашлось") : "Загружаем стикеры…")
                                .font(.system(size: 14))
                                .foregroundColor(Noct.text48)
                                .frame(maxWidth: .infinity)
                                .padding(.top, 40)
                        }
                    }
                    .padding(.bottom, 8)
                }
                .scrollDismissesKeyboard(.immediately)
            }
        }
    }

    private func packBar(_ proxy: ScrollViewProxy) -> some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 2) {
                if !store.favorites.isEmpty {
                    PackTab(selected: current == "favorites", label: AnyView(Image(systemName: "bookmark.fill").font(.system(size: 17)).foregroundColor(Noct.text60))) {
                        jump("favorites", proxy)
                    }
                    .accessibilityLabel("Избранные")
                }
                if !store.recentStickers.isEmpty {
                    PackTab(selected: current == "recent", label: AnyView(Image(systemName: "clock").font(.system(size: 17)).foregroundColor(Noct.text60))) {
                        jump("recent", proxy)
                    }
                    .accessibilityLabel("Недавние")
                }
                ForEach(store.stickerPacks) { pack in
                    PackTab(selected: current == pack.ref, label: AnyView(packIcon(pack))) {
                        jump(pack.ref, proxy)
                    }
                    .accessibilityLabel(pack.title)
                }
            }
            .padding(.horizontal, 8)
        }
        .frame(height: 44)
    }

    @ViewBuilder private func packIcon(_ pack: StickerPack) -> some View {
        if let first = pack.stickers.first {
            StickerImage(sticker: first, animated: false)
        } else {
            Image(systemName: "square.grid.2x2").foregroundColor(Noct.text60)
        }
    }

    private func jump(_ id: String, _ proxy: ScrollViewProxy) {
        Haptics.tap()
        current = id
        withAnimation(Noct.quick) { proxy.scrollTo(id, anchor: .top) }
    }

    private func cell(_ sticker: Sticker) -> some View {
        Button {
            send(sticker)
        } label: {
            StickerImage(sticker: sticker)
                .aspectRatio(1, contentMode: .fit)
                .padding(5)
                .contentShape(Rectangle())
        }
        .buttonStyle(StickerPressStyle())
        .accessibilityLabel("Стикер \(sticker.emoji)")
        .accessibilityIdentifier("sticker-" + sticker.ref)
        .contextMenu {
            let favorite = store.isFavorite(sticker.ref)
            Button {
                Task { await store.setFavorite(sticker, !favorite, session: session) }
            } label: {
                Label(favorite ? "Убрать из избранного" : "В избранное", systemImage: favorite ? "bookmark.slash" : "bookmark")
            }
            if !sticker.packRef.isEmpty {
                Button {
                    openPack(sticker.packName)
                } label: {
                    Label("Открыть набор", systemImage: "square.grid.2x2")
                }
            }
        }
    }
}

/// Stickers grow a little under the finger.
private struct StickerPressStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed ? 0.88 : 1)
            .animation(.spring(response: 0.22, dampingFraction: 0.7), value: configuration.isPressed)
    }
}

// MARK: - Emoji

private struct EmojiPage: View {
    @ObservedObject private var store = StickerStore.shared
    @Binding var query: String
    let recent: [String]
    let insert: (String) -> Void
    let insertToken: (Sticker) -> Void
    @State private var current = "recent"

    private let columns = Array(repeating: GridItem(.flexible(), spacing: 0), count: 8)
    private var term: String { query.trimmingCharacters(in: .whitespaces) }
    private var catalog: [EmojiCatalog.Category] { EmojiCatalog.shared.categories }

    var body: some View {
        ScrollViewReader { proxy in
            VStack(spacing: 0) {
                if term.isEmpty { categoryBar(proxy) }
                PanelSearch(query: $query, prompt: "Поиск эмодзи")
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 0) {
                        if !term.isEmpty {
                            let found = EmojiCatalog.shared.search(term)
                            grid(found)
                            if found.isEmpty {
                                Text("Эмодзи не нашлось")
                                    .font(.system(size: 14))
                                    .foregroundColor(Noct.text48)
                                    .frame(maxWidth: .infinity)
                                    .padding(.top, 40)
                            }
                        } else {
                            if !recent.isEmpty {
                                VStack(alignment: .leading, spacing: 0) {
                                    PanelHeader(title: "Недавние")
                                    grid(recent)
                                }
                                .id("recent")
                            }
                            ForEach(store.emojiPacks) { pack in
                                VStack(alignment: .leading, spacing: 0) {
                                    PanelHeader(title: pack.title, locked: !store.premium)
                                    if pack.id == store.emojiPacks.first?.id && !store.premium {
                                        Text("Эмодзи из наборов доступны с Noct Premium")
                                            .font(.system(size: 13))
                                            .foregroundColor(Noct.text60)
                                            .padding(.horizontal, 14)
                                            .padding(.bottom, 6)
                                    }
                                    premiumGrid(pack)
                                }
                                .id(pack.ref)
                            }
                            ForEach(catalog) { category in
                                VStack(alignment: .leading, spacing: 0) {
                                    PanelHeader(title: category.title)
                                    grid(category.emoji.map { $0.0 })
                                }
                                .id(category.id)
                            }
                        }
                    }
                    .padding(.bottom, 8)
                }
                .scrollDismissesKeyboard(.immediately)
            }
        }
    }

    private func categoryBar(_ proxy: ScrollViewProxy) -> some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 2) {
                if !recent.isEmpty {
                    PackTab(selected: current == "recent", label: AnyView(Image(systemName: "clock").font(.system(size: 17)).foregroundColor(Noct.text60))) {
                        jump("recent", proxy)
                    }
                    .accessibilityLabel("Недавние")
                }
                ForEach(store.emojiPacks) { pack in
                    PackTab(selected: current == pack.ref, label: AnyView(
                        ZStack(alignment: .bottomTrailing) {
                            if let first = pack.stickers.first { StickerImage(sticker: first, animated: false) }
                            if !store.premium {
                                Image(systemName: "lock.fill")
                                    .font(.system(size: 8, weight: .bold))
                                    .foregroundColor(.white)
                                    .padding(2)
                                    .background(Circle().fill(Color.black.opacity(0.6)))
                            }
                        }
                    )) {
                        jump(pack.ref, proxy)
                    }
                    .accessibilityLabel(pack.title)
                }
                ForEach(catalog) { category in
                    PackTab(selected: current == category.id, label: AnyView(Image(systemName: category.icon).font(.system(size: 17)).foregroundColor(Noct.text60))) {
                        jump(category.id, proxy)
                    }
                    .accessibilityLabel(category.title)
                }
            }
            .padding(.horizontal, 8)
        }
        .frame(height: 44)
    }

    private func jump(_ id: String, _ proxy: ScrollViewProxy) {
        Haptics.tap()
        current = id
        withAnimation(Noct.quick) { proxy.scrollTo(id, anchor: .top) }
    }

    private func grid(_ emoji: [String]) -> some View {
        LazyVGrid(columns: columns, spacing: 0) {
            ForEach(Array(emoji.enumerated()), id: \.offset) { _, value in
                Button {
                    insert(value)
                } label: {
                    Text(value)
                        .font(.system(size: 30))
                        .frame(maxWidth: .infinity, minHeight: 44)
                        .contentShape(Rectangle())
                }
                .buttonStyle(StickerPressStyle())
                .accessibilityIdentifier("emoji-" + value)
            }
        }
        .padding(.horizontal, 6)
    }

    private func premiumGrid(_ pack: StickerPack) -> some View {
        LazyVGrid(columns: columns, spacing: 0) {
            ForEach(pack.stickers) { sticker in
                Button {
                    insertToken(sticker)
                } label: {
                    StickerImage(sticker: sticker)
                        .frame(width: 32, height: 32)
                        .frame(maxWidth: .infinity, minHeight: 44)
                        .opacity(store.premium ? 1 : 0.55)
                        .contentShape(Rectangle())
                }
                .buttonStyle(StickerPressStyle())
                .accessibilityLabel("Эмодзи \(sticker.emoji)")
                .accessibilityIdentifier("premium-emoji-" + sticker.token)
            }
        }
        .padding(.horizontal, 6)
    }
}

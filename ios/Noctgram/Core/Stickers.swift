import Foundation

/// A sticker or a custom emoji (lib/sticker-types.ts StickerInfo). Built-in
/// ones are Lottie files in /assets/stickers with a WebP poster; uploaded
/// ones are PNG, WebP or gzipped TGS in /api/media.
struct Sticker: Identifiable, Hashable {
    let ref: String
    let packRef: String
    let emoji: String
    let format: String
    let src: String
    let width: Int
    let height: Int
    let available: Bool
    /// :noct_<name>: or :ce_<id>: for emoji-pack items.
    let token: String

    var id: String { ref }

    init(_ j: JSON) {
        ref = j["ref"].str
        packRef = j["packRef"].str
        emoji = j["emoji"].str
        format = j["format"].string ?? "webp"
        src = j["src"].str
        width = j["w"].int ?? 512
        height = j["h"].int ?? 512
        available = j["available"].bool && !j["src"].str.isEmpty
        token = j["token"].str
    }

    init(ref: String, packRef: String, emoji: String, format: String, src: String, token: String) {
        self.ref = ref
        self.packRef = packRef
        self.emoji = emoji
        self.format = format
        self.src = src
        width = 512
        height = 512
        available = !src.isEmpty
        self.token = token
    }

    /// Plays as Lottie (plain JSON, or gzipped TGS).
    var animated: Bool { available && (format == "lottie" || format == "tgs") }

    /// The still picture: a built-in Lottie's poster (render-sticker-posters),
    /// the image itself for PNG and WebP, the preview of an original premium
    /// emoji. Uploaded TGS stickers have none.
    var poster: String? {
        guard available else { return nil }
        if format == "webp" || format == "png" { return src }
        if src.hasPrefix("/assets/emoji/"), src.hasSuffix(".json") {
            return String(src.dropLast(".json".count)) + ".preview.webp"
        }
        if src.hasPrefix("/assets/stickers/tgs/"), src.hasSuffix(".json") {
            return "/assets/stickers/posters/" + String(src.dropFirst("/assets/stickers/tgs/".count).dropLast(".json".count)) + ".webp"
        }
        if src.hasPrefix("/assets/stickers/"), let dot = src.lastIndex(of: ".") {
            return String(src[..<dot]) + ".webp"
        }
        return nil
    }

    /// A built-in pack is opened by its id, a user pack by «u:<id>».
    var packName: String {
        packRef.hasPrefix("b:") ? String(packRef.dropFirst(2)) : packRef
    }
}

/// A pack (lib/sticker-types.ts StickerPackInfo).
struct StickerPack: Identifiable, Hashable {
    let ref: String
    let id: String
    let shortName: String
    let title: String
    /// «stickers» or «emoji».
    let type: String
    let builtin: Bool
    let own: Bool
    var installed: Bool
    let removed: Bool
    let stickers: [Sticker]

    init(_ j: JSON) {
        ref = j["ref"].str
        id = j["id"].str
        shortName = j["shortName"].str
        title = j["title"].str
        type = j["type"].string ?? "stickers"
        builtin = j["builtin"].bool
        own = j["own"].bool
        installed = j["installed"].bool
        removed = j["removed"].bool
        stickers = j["stickers"].array.map { Sticker($0) }
    }

    init(ref: String, title: String, stickers: [Sticker]) {
        self.ref = ref
        id = ref
        shortName = ref
        self.title = title
        type = "emoji"
        builtin = true
        own = false
        installed = true
        removed = false
        self.stickers = stickers
    }

    var isEmoji: Bool { type == "emoji" }
    /// The name `action=pack` takes.
    var name: String { builtin ? id : ref }
}

/// Premium emoji tokens in text (lib/premium-emoji.ts): :noct_<name>: for
/// the NoctGram sets, :ce_<sticker id>: for emoji from packs made by people.
enum EmojiTokens {
    /// The original nine, with their Telegram ids and packs.
    static let legacy: [(name: String, id: String, fallback: String, pack: String)] = [
        ("smile", "5372954454653933911", "😀", "RestrictedEmoji"),
        ("laugh", "5370953476635368811", "😂", "RestrictedEmoji"),
        ("skull", "5370971163310693562", "💀", "RestrictedEmoji"),
        ("eyes", "5399988331729664856", "👀", "CreepyEmoji"),
        ("heart", "5328014489554002336", "❤️", "CreepyEmoji"),
        ("archive", "5346288231073723227", "🗃", "CreepyEmoji"),
        ("fire", "5424972470023104089", "🔥", "NewsEmoji"),
        ("star", "5438496463044752972", "⭐️", "NewsEmoji"),
        ("moon", "5449569374065152798", "🌛", "NewsEmoji"),
    ]
    /// The Telegram Web set of the built-in catalog, for text where only
    /// plain emoji fit (lists, quotes) before the catalog has loaded.
    static let catalogFallbacks: [String: String] = [
        "star_gold": "⭐", "star_shine": "🌟", "sparkles": "✨", "diamond": "💎", "key": "🔑",
        "stop": "✋", "letter": "💌", "mailbox": "📬", "cake": "🍰", "gift": "🎁", "party": "🎉",
        "pirate": "🏴‍☠️", "dino": "🦖", "chart": "📊", "folder": "📁", "duck": "🐥",
    ]
    static let customFallback = "✨"

    static let pattern = try? NSRegularExpression(pattern: ":noct_[a-z0-9_]+:|:ce_[0-9a-f-]{36}:")
    private static let custom = try? NSRegularExpression(pattern: "^:ce_([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}):$")

    enum Part: Hashable {
        case text(String)
        case token(String)
    }

    static func contains(_ text: String) -> Bool {
        parts(text).contains {
            if case .token = $0 { return true }
            return false
        }
    }

    /// Text and tokens in order; unknown :noct_ names stay text.
    static func parts(_ text: String) -> [Part] {
        guard let pattern, text.contains(":noct_") || text.contains(":ce_") else { return [.text(text)] }
        let ns = text as NSString
        var parts: [Part] = []
        var cursor = 0
        var pending = ""
        for match in pattern.matches(in: text, range: NSRange(location: 0, length: ns.length)) {
            pending += ns.substring(with: NSRange(location: cursor, length: match.range.location - cursor))
            let token = ns.substring(with: match.range)
            if isKnown(token) {
                if !pending.isEmpty { parts.append(.text(pending)) }
                pending = ""
                parts.append(.token(token))
            } else {
                pending += token
            }
            cursor = match.range.location + match.range.length
        }
        pending += ns.substring(from: cursor)
        if !pending.isEmpty { parts.append(.text(pending)) }
        return parts
    }

    static func name(_ token: String) -> String? {
        guard token.hasPrefix(":noct_"), token.hasSuffix(":") else { return nil }
        return String(token.dropFirst(6).dropLast())
    }

    /// The sticker id of a custom emoji token.
    static func customId(_ token: String) -> String? {
        guard let custom, let match = custom.firstMatch(in: token, range: NSRange(location: 0, length: (token as NSString).length)) else { return nil }
        return (token as NSString).substring(with: match.range(at: 1))
    }

    /// A token the server accepts: the original nine, the catalog sets
    /// (known once loaded, or by the Telegram Web names) and custom emoji.
    static func isKnown(_ token: String) -> Bool {
        if customId(token) != nil { return true }
        guard let name = name(token) else { return false }
        return legacy.contains { $0.name == name } || catalogFallbacks[name] != nil || catalogNames.contains(name)
    }

    /// Names of catalog emoji the server listed (action=builtin).
    nonisolated(unsafe) static var catalogNames: Set<String> = []
    nonisolated(unsafe) static var catalogEmoji: [String: String] = [:]

    /// Plain text for lists and quotes: known tokens become their emoji.
    static func fallback(_ text: String) -> String {
        parts(text).map { part in
            switch part {
            case .text(let value): return value
            case .token(let token):
                if customId(token) != nil { return customFallback }
                let name = name(token) ?? ""
                return legacy.first { $0.name == name }?.fallback ?? catalogEmoji[name] ?? catalogFallbacks[name] ?? token
            }
        }.joined()
    }

    /// A message of only emoji is shown large: 1–6 emoji, tokens and
    /// Unicode alike (lib/chat-emoji.ts largeEmojiCount); 0 otherwise.
    static func largeCount(_ text: String) -> Int {
        var count = 0
        for part in parts(text) {
            switch part {
            case .token:
                count += 1
            case .text(let value):
                for character in value where !character.isWhitespace {
                    guard isEmoji(character) else { return 0 }
                    count += 1
                }
            }
            if count > 6 { return 0 }
        }
        return count
    }

    static func isEmoji(_ character: Character) -> Bool {
        guard let first = character.unicodeScalars.first else { return false }
        return first.properties.isEmojiPresentation || (first.properties.isEmoji && character.unicodeScalars.count > 1)
    }

    /// The legacy emoji as a sticker-like item: Lottie with a preview.
    static func legacySticker(_ item: (name: String, id: String, fallback: String, pack: String)) -> Sticker {
        Sticker(ref: "noct:" + item.name, packRef: "noct:" + item.pack, emoji: item.fallback, format: "lottie",
                src: "/assets/emoji/\(item.id).json", token: ":noct_\(item.name):")
    }
}

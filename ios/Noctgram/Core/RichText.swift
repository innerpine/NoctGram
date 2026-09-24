import Foundation

/// In-app link scheme produced for @mentions, #tags and Noctgram profile links.
enum AppLink {
    static let scheme = "noctgram-app"

    static func handle(_ handle: String) -> URL? {
        URL(string: "\(scheme)://handle/\(handle.lowercased())")
    }

    static func tag(_ tag: String) -> URL? {
        var components = URLComponents()
        components.scheme = scheme
        components.host = "tag"
        components.queryItems = [URLQueryItem(name: "q", value: tag)]
        return components.url
    }

    static func profile(_ id: String) -> URL? {
        var components = URLComponents()
        components.scheme = scheme
        components.host = "profile"
        components.queryItems = [URLQueryItem(name: "id", value: id)]
        return components.url
    }
}

/// Premium emoji tokens (:noct_fire:) shown as their regular emoji fallback.
enum PremiumEmoji {
    static let fallbacks: [String: String] = [
        "smile": "😀", "laugh": "😂", "skull": "💀", "eyes": "👀", "heart": "❤️",
        "archive": "🗃", "fire": "🔥", "star": "⭐️", "moon": "🌛",
    ]
    private static let token = try? NSRegularExpression(pattern: ":noct_([a-z0-9_]+):")

    static func replace(_ text: String) -> String {
        guard text.contains(":noct_"), let token else { return text }
        let ns = text as NSString
        var result = ""
        var cursor = 0
        for match in token.matches(in: text, range: NSRange(location: 0, length: ns.length)) {
            result += ns.substring(with: NSRange(location: cursor, length: match.range.location - cursor))
            let name = ns.substring(with: match.range(at: 1))
            result += fallbacks[name] ?? "✨"
            cursor = match.range.location + match.range.length
        }
        result += ns.substring(from: cursor)
        return result
    }
}

/// Mentions, links and hashtags as tappable runs (lib/profile-links.ts mentionParts).
enum RichText {
    private static let pattern = try? NSRegularExpression(
        pattern: #"https?://[^\s<>"\p{Cc}]+|(?<![\w/])/\?(?:profile|handle|group|invite|room)=[^\s<>"\p{Cc}]+|[\w.+-]+@[\w.-]+\.[a-z]{2,}|(?<![\p{L}\p{N}_/@.+-])@[a-z0-9_]{4,24}(?![\p{L}\p{N}_])|(?<![\p{L}\p{N}_&])#[\p{L}\p{N}_]{1,64}"#,
        options: [.caseInsensitive]
    )
    private static let trailing = CharacterSet(charactersIn: ".,!?:;…»”")

    static func attributed(_ text: String, baseURL: URL?) -> AttributedString {
        let source = PremiumEmoji.replace(text)
        guard let pattern else { return AttributedString(source) }
        let ns = source as NSString
        var result = AttributedString()
        var cursor = 0
        for match in pattern.matches(in: source, range: NSRange(location: 0, length: ns.length)) {
            guard match.range.location >= cursor else { continue }
            var value = ns.substring(with: match.range)
            var link: URL?
            if value.hasPrefix("@") {
                link = AppLink.handle(String(value.dropFirst()))
            } else if value.hasPrefix("#") {
                link = AppLink.tag(value)
            } else if value.lowercased().hasPrefix("http") || value.hasPrefix("/?") {
                value = trimmed(value)
                if value.hasPrefix("/?") {
                    link = internalLink(value, baseURL: baseURL)
                } else if let url = URL(string: value), url.user == nil, url.password == nil {
                    link = internalLink(value, baseURL: baseURL) ?? url
                }
            }
            guard let link, !value.isEmpty else { continue }
            if match.range.location > cursor {
                result += AttributedString(ns.substring(with: NSRange(location: cursor, length: match.range.location - cursor)))
            }
            // Links take the white tint, set apart from the 75 % body text.
            var run = AttributedString(value)
            run.link = link
            result += run
            cursor = match.range.location + (value as NSString).length
        }
        if cursor < ns.length { result += AttributedString(ns.substring(from: cursor)) }
        return result
    }

    /// Sentence punctuation and unbalanced closing brackets stay outside a URL.
    private static func trimmed(_ raw: String) -> String {
        var value = raw
        while let last = value.unicodeScalars.last, trailing.contains(last) { value.removeLast() }
        for (open, close) in [("(", ")"), ("[", "]"), ("{", "}")] {
            while value.hasSuffix(close),
                  value.components(separatedBy: close).count > value.components(separatedBy: open).count {
                value.removeLast()
            }
        }
        return value
    }

    /// `/?profile=…` and `/?handle=…` links (also absolute ones to the same server) open in the app.
    private static func internalLink(_ value: String, baseURL: URL?) -> URL? {
        guard let baseURL, let url = URL(string: value, relativeTo: baseURL)?.absoluteURL,
              url.host == baseURL.host, url.path == "/" || url.path.isEmpty,
              let items = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems else { return nil }
        if let handle = items.first(where: { $0.name == "handle" })?.value { return AppLink.handle(handle) }
        if let id = items.first(where: { $0.name == "profile" })?.value { return AppLink.profile(id) }
        return nil
    }
}

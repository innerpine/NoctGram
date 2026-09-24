import Foundation

/// Russian formatting matching the web client (post-card.tsx, profile-details.tsx).
enum Format {
    static let russian = Locale(identifier: "ru_RU")

    private static func formatter(_ template: String) -> DateFormatter {
        let formatter = DateFormatter()
        formatter.locale = russian
        formatter.setLocalizedDateFormatFromTemplate(template)
        return formatter
    }

    private static let dayMonthTime = formatter("d MMM HH:mm")
    private static let dayMonthYear = formatter("d MMMM y")
    private static let dayMonth = formatter("d MMMM")
    private static let time = formatter("HH:mm")
    private static let shortDay = formatter("d MMM")
    private static let fullDate = formatter("dd.MM.y HH:mm")

    private static let numbers: NumberFormatter = {
        let formatter = NumberFormatter()
        formatter.locale = russian
        formatter.numberStyle = .decimal
        formatter.groupingSeparator = "\u{00A0}"
        return formatter
    }()

    static func date(_ ms: Double) -> Date {
        Date(timeIntervalSince1970: ms / 1000)
    }

    static var nowMs: Double {
        Date().timeIntervalSince1970 * 1000
    }

    /// «сейчас», «5 мин», «3 ч», «2 д» (compact Stamp).
    static func ago(_ ms: Double) -> String {
        let minutes = max(0, Int((nowMs - ms) / 60000))
        if minutes < 1 { return "сейчас" }
        if minutes < 60 { return "\(minutes) мин" }
        if minutes < 1440 { return "\(minutes / 60) ч" }
        if minutes < 1440 * 7 { return "\(minutes / 1440) д" }
        return shortDay.string(from: date(ms))
    }

    static func stamp(_ ms: Double) -> String {
        dayMonthTime.string(from: date(ms))
    }

    static func full(_ ms: Double) -> String {
        fullDate.string(from: date(ms))
    }

    static func clock(_ ms: Double) -> String {
        time.string(from: date(ms))
    }

    /// Thread list: time today, otherwise the day.
    static func threadTime(_ ms: Double) -> String {
        guard ms > 0 else { return "" }
        let value = date(ms)
        return Calendar.current.isDateInToday(value) ? time.string(from: value) : shortDay.string(from: value)
    }

    /// Chat day separators.
    static func day(_ ms: Double) -> String {
        let value = date(ms)
        if Calendar.current.isDateInToday(value) { return "Сегодня" }
        if Calendar.current.isDateInYesterday(value) { return "Вчера" }
        return dayMonth.string(from: value)
    }

    static func count(_ value: Int) -> String {
        numbers.string(from: NSNumber(value: value)) ?? String(value)
    }

    static func plural(_ value: Int, _ one: String, _ few: String, _ many: String) -> String {
        let mod10 = abs(value) % 10, mod100 = abs(value) % 100
        if mod10 == 1 && mod100 != 11 { return one }
        if (2...4).contains(mod10) && !(12...14).contains(mod100) { return few }
        return many
    }

    static func joined(_ ms: Double) -> String {
        "В Noctgram с " + dayMonthYear.string(from: date(ms))
    }

    /// Online means active within the last two minutes, as on the web.
    static func isOnline(_ lastSeen: Double) -> Bool {
        lastSeen > 0 && nowMs - lastSeen < 120_000
    }

    static func presence(_ lastSeen: Double) -> String {
        if isOnline(lastSeen) { return "В сети" }
        return "Был(а) " + dayMonthTime.string(from: date(lastSeen))
    }

    /// «12 мая 1998 (27 лет)», or «12 мая» when the year is hidden.
    static func birthday(_ value: String) -> String {
        let parts = value.split(separator: "-").compactMap { Int($0) }
        let year: Int?, month: Int, day: Int
        if parts.count == 3 {
            year = parts[0]; month = parts[1]; day = parts[2]
        } else if parts.count == 2 {
            year = nil; month = parts[0]; day = parts[1]
        } else {
            return ""
        }
        var components = DateComponents()
        components.year = 2000
        components.month = month
        components.day = day
        guard let reference = Calendar(identifier: .gregorian).date(from: components) else { return "" }
        let label = dayMonth.string(from: reference)
        guard let year else { return label }
        let now = Calendar.current.dateComponents([.year, .month, .day], from: Date())
        var age = (now.year ?? year) - year
        if let m = now.month, let d = now.day, m < month || (m == month && d < day) { age -= 1 }
        age = max(0, age)
        return "\(label) \(year) (\(age) \(plural(age, "год", "года", "лет")))"
    }

    /// +888 XXXX XXXX (lib/market-policy.ts).
    static func marketNumber(_ number: String) -> String {
        guard number.count > 4 else { return "+888 " + number }
        let split = number.index(number.startIndex, offsetBy: 4)
        return "+888 \(number[..<split]) \(number[split...])"
    }

    static func fileSize(_ bytes: Int) -> String {
        if bytes < 1024 { return "\(bytes) Б" }
        if bytes < 1024 * 1024 { return "\(Int((Double(bytes) / 1024).rounded(.up))) КБ" }
        return String(format: "%.1f МБ", Double(bytes) / 1024 / 1024).replacingOccurrences(of: ".", with: ",")
    }

    /// Website label without scheme, «www.» and trailing slash, at most 32 characters.
    static func siteLabel(_ site: String) -> String {
        var label = site
        for prefix in ["https://", "http://"] where label.lowercased().hasPrefix(prefix) {
            label = String(label.dropFirst(prefix.count))
        }
        if label.lowercased().hasPrefix("www.") { label = String(label.dropFirst(4)) }
        if label.hasSuffix("/") { label.removeLast() }
        return label.count > 32 ? String(label.prefix(31)) + "…" : label
    }

    static func initials(_ name: String) -> String {
        let words = name.split(whereSeparator: { $0.isWhitespace })
        if words.count > 1, let first = words.first?.first, let last = words.last?.first {
            return String([first, last]).uppercased()
        }
        return String(name.prefix(2)).uppercased()
    }
}

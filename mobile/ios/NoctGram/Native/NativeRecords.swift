import Foundation

/// A small boundary around the existing JSON API. Missing/nullable fields never crash a screen.
struct NGRecord: Identifiable {
    let raw: [String: Any]
    private let fallbackID: String

    init(_ raw: [String: Any]) {
        self.raw = raw
        self.fallbackID = UUID().uuidString
    }

    init(raw: [String: Any]) { self.init(raw) }

    /// Changes with each decoded server snapshot, even when selected fields are unchanged.
    var snapshotID: String { fallbackID }

    var id: String {
        let value = string("id")
        return value.isEmpty ? fallbackID : value
    }

    func string(_ key: String, default fallback: String = "") -> String {
        if let value = raw[key] as? String { return value }
        if let value = raw[key] as? NSNumber { return value.stringValue }
        return fallback
    }

    func int(_ key: String) -> Int {
        let text = string(key)
        if let exact = Int(text) { return exact }
        guard let value = Double(text), value.isFinite,
              value >= Double(Int.min), value < Double(Int.max) else { return 0 }
        return Int(value)
    }

    func double(_ key: String) -> Double {
        guard let value = Double(string(key)), value.isFinite else { return 0 }
        return value
    }

    func bool(_ key: String) -> Bool {
        if let value = raw[key] as? NSNumber { return value.doubleValue.isFinite && value.doubleValue != 0 }
        return ["true", "1", "yes"].contains(string(key).trimmingCharacters(in: .whitespacesAndNewlines).lowercased())
    }

    func object(_ key: String) -> NGRecord? {
        guard let value = raw[key] as? [String: Any] else { return nil }
        return NGRecord(value)
    }

    func objects(_ key: String) -> [NGRecord] {
        guard let values = raw[key] as? [Any] else { return [] }
        return values.compactMap { value in
            guard let raw = value as? [String: Any] else { return nil }
            return NGRecord(raw)
        }
    }

    func strings(_ key: String) -> [String] {
        (raw[key] as? [Any] ?? []).compactMap { $0 as? String }
    }
}

struct NoctAPIError: LocalizedError {
    let status: Int
    let code: String
    let message: String
    let retryAfter: TimeInterval?

    init(status: Int = 0, code: String, message: String, retryAfter: TimeInterval? = nil) {
        self.status = status
        self.code = code
        self.message = message
        self.retryAfter = retryAfter
    }

    var errorDescription: String? { message }
    var isUnauthorized: Bool { status == 401 }
    var requiresOnboarding: Bool { status == 409 && code == "ONBOARDING_REQUIRED" }
}

extension Notification.Name {
    static let noctSessionExpired = Notification.Name("noctSessionExpired")
}

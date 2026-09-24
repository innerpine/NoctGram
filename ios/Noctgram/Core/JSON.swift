import Foundation

/// A tolerant JSON value. The Noctgram API returns SQLite rows, so booleans
/// arrive as 0/1 and optional columns as null; models read every field
/// through these accessors instead of failing on an unexpected type.
enum JSON: Decodable, Equatable {
    case null
    case bool(Bool)
    case number(Double)
    case string(String)
    case array([JSON])
    case object([String: JSON])

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if container.decodeNil() {
            self = .null
        } else if let value = try? container.decode(Bool.self) {
            self = .bool(value)
        } else if let value = try? container.decode(Double.self) {
            self = .number(value)
        } else if let value = try? container.decode(String.self) {
            self = .string(value)
        } else if let value = try? container.decode([JSON].self) {
            self = .array(value)
        } else if let value = try? container.decode([String: JSON].self) {
            self = .object(value)
        } else {
            self = .null
        }
    }

    static func parse(_ data: Data) -> JSON? {
        try? JSONDecoder().decode(JSON.self, from: data)
    }

    subscript(key: String) -> JSON {
        if case .object(let object) = self { return object[key] ?? .null }
        return .null
    }

    subscript(index: Int) -> JSON {
        if case .array(let array) = self, array.indices.contains(index) { return array[index] }
        return .null
    }

    var isNull: Bool {
        if case .null = self { return true }
        return false
    }

    var string: String? {
        switch self {
        case .string(let value): return value
        case .number(let value):
            if value.isFinite, value.rounded() == value, abs(value) < 1e15 { return String(Int64(value)) }
            return String(value)
        case .bool(let value): return value ? "true" : "false"
        default: return nil
        }
    }

    /// The string value, or "" for null and non-scalar values.
    var str: String { string ?? "" }

    var double: Double? {
        switch self {
        case .number(let value): return value.isFinite ? value : nil
        case .string(let value): return Double(value.trimmingCharacters(in: .whitespaces))
        case .bool(let value): return value ? 1 : 0
        default: return nil
        }
    }

    var int: Int? {
        guard let value = double, abs(value) < 9e15 else { return nil }
        return Int(value)
    }

    var bool: Bool {
        switch self {
        case .bool(let value): return value
        case .number(let value): return value != 0
        case .string(let value): return value == "1" || value.lowercased() == "true"
        default: return false
        }
    }

    var array: [JSON] {
        if case .array(let value) = self { return value }
        return []
    }

    var object: [String: JSON]? {
        if case .object(let value) = self { return value }
        return nil
    }

    /// Some columns hold a JSON document serialised into a string (for
    /// example `profileBackground` or a comment's `reactionData`).
    var nestedJSON: JSON {
        if case .string(let value) = self, let data = value.data(using: .utf8), let parsed = JSON.parse(data) {
            return parsed
        }
        return self
    }
}

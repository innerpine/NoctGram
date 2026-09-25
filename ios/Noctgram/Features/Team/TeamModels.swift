import SwiftUI

/// Sections of «Кабинет команды» (app/moderation-panel.tsx); «Управление»
/// is for administrators only.
enum TeamSection: Hashable {
    case antispam
    case accounts(TeamTarget?)
    case appeals
    case reports
    case removals
    case administration

    var title: String {
        switch self {
        case .antispam: return "Антиспам"
        case .accounts: return "Аккаунты"
        case .appeals: return "Обращения"
        case .reports: return "Жалобы"
        case .removals: return "Удаления"
        case .administration: return "Управление"
        }
    }
}

/// An account opened from a report, the spam queue or a channel.
struct TeamTarget: Hashable {
    var id: String
    var handle: String
}

/// A chip beside a row: what the account or the report is now.
struct TeamStatus: Hashable {
    var title: String
    var color: Color
}

/// An account in «Аккаунты» (moderationUsers in lib/moderation.ts).
struct TeamAccount: Identifiable, Hashable {
    var id: String
    var name: String
    var avatar: String
    var handle: String
    var kind: String
    var ownerId: String
    var ownerHandle: String
    var appearance: Appearance
    /// "read_only", "blocked", or empty while the account is free.
    var mode: String
    var reason: String
    /// 0 when the restriction has no end.
    var expiresAt: Double
    var moderator: Bool
    var canRestrict: Bool

    init(_ j: JSON) {
        id = j["id"].str
        name = j["name"].str
        avatar = j["avatar"].str
        handle = j["handle"].str
        kind = j["kind"].string ?? "person"
        ownerId = j["ownerId"].str
        ownerHandle = j["ownerHandle"].str
        appearance = Appearance(j)
        mode = j["mode"].str
        reason = j["reason"].str
        expiresAt = j["expiresAt"].double ?? 0
        moderator = j["moderator"].bool
        canRestrict = j["canRestrict"].bool
    }

    var isChannel: Bool { kind == "channel" }

    var identity: Identity {
        Identity(id: id, name: name, avatar: avatar, handle: handle, kind: kind, appearance: appearance)
    }

    var status: TeamStatus {
        if moderator { return TeamStatus(title: "Модератор", color: Noct.lilac) }
        if id == "noctgram" { return TeamStatus(title: "Служебный", color: Noct.lilac) }
        switch mode {
        case "blocked": return TeamStatus(title: "Заблокирован", color: Noct.red)
        case "read_only": return TeamStatus(title: "Только чтение", color: Noct.gold)
        default: return TeamStatus(title: "Активен", color: Noct.green)
        }
    }

    /// «Сейчас: блокировка до 01.10.26 18:00. Спам.»
    var current: String? {
        guard !mode.isEmpty else { return nil }
        let what = mode == "blocked" ? "блокировка" : "только чтение"
        let until = expiresAt > 0 ? " до " + Format.full(expiresAt) : ", бессрочно"
        return "Сейчас: " + what + until + ". " + reason
    }
}

/// A past decision about an account (moderationHistory).
struct TeamDecision: Identifiable, Hashable {
    var id: String
    var mode: String
    var reason: String
    var moderatorHandle: String
    var created: Double

    init(_ j: JSON) {
        id = j["id"].str
        mode = j["mode"].str
        reason = j["reason"].str
        moderatorHandle = j["moderatorHandle"].str
        created = j["created"].double ?? 0
    }

    var title: String {
        switch mode {
        case "active": return "Ограничение снято"
        case "blocked": return "Блокировка"
        default: return "Только чтение"
        }
    }
}

/// An appeal against a restriction (moderationAppeals).
struct TeamAppeal: Identifiable, Hashable {
    var id: String
    var handle: String
    var text: String
    var reason: String
    var mode: String
    var status: String
    var reviewNote: String
    var created: Double

    init(_ j: JSON) {
        id = j["id"].str
        handle = j["handle"].str
        text = j["text"].str
        reason = j["reason"].str
        mode = j["mode"].str
        status = j["status"].str
        reviewNote = j["reviewNote"].str
        created = j["created"].double ?? 0
    }

    var pending: Bool { status == "pending" }
}

/// A report on content (moderationReports in lib/content-moderation.ts).
struct TeamReport: Identifiable, Hashable {
    var id: String
    var targetType: String
    var targetId: String
    var postId: String
    var authorId: String
    var kind: String
    var handle: String
    var reporterHandle: String
    var reviewerHandle: String
    var text: String
    var reason: String
    var status: String
    var reviewNote: String
    var created: Double
    var available: Bool

    init(_ j: JSON) {
        id = j["id"].str
        targetType = j["targetType"].str
        targetId = j["targetId"].str
        postId = j["postId"].str
        authorId = j["authorId"].str
        kind = j["kind"].str
        handle = j["handle"].str
        reporterHandle = j["reporterHandle"].str
        reviewerHandle = j["reviewerHandle"].str
        text = j["text"].str
        reason = j["reason"].str
        status = j["status"].str
        reviewNote = j["reviewNote"].str
        created = j["created"].double ?? 0
        available = j["available"].bool
    }

    var title: String {
        let what: String
        switch targetType {
        case "story": what = "История"
        case "message": what = "Личное сообщение"
        case "comment": what = "Комментарий"
        default: what = kind == "channel" ? "Пост канала" : "Пост"
        }
        return TeamText.account(handle) + " · " + what
    }

    var statusChip: TeamStatus {
        switch status {
        case "new": return TeamStatus(title: "Новая", color: Noct.gold)
        case "reviewing": return TeamStatus(title: "Рассматривается", color: Noct.lilac)
        default: return TeamStatus(title: "Закрыта", color: Noct.text48)
        }
    }

    var canOpenPost: Bool { available && targetType != "message" && targetType != "story" }
    var canRemove: Bool { available && targetType != "message" }

    var removeTitle: String {
        switch targetType {
        case "post": return "Удалить пост"
        case "story": return "Удалить историю"
        default: return "Удалить комментарий"
        }
    }

    /// What removal does to it (content-decision-form.tsx).
    var removeNote: String {
        switch targetType {
        case "post": return "Пост, его комментарии и вложения станут недоступны."
        case "story": return "История и её вложение станут недоступны."
        default: return "Комментарий будет удалён из обсуждения."
        }
    }
}

/// Content a moderator removed (moderationRemovals).
struct TeamRemoval: Identifiable, Hashable {
    var id: String
    var targetType: String
    var handle: String
    var moderatorHandle: String
    var text: String
    var reason: String
    var created: Double

    init(_ j: JSON) {
        id = j["id"].str
        targetType = j["targetType"].str
        handle = j["handle"].str
        moderatorHandle = j["moderatorHandle"].str
        text = j["text"].str
        reason = j["reason"].str
        created = j["created"].double ?? 0
    }

    var title: String {
        let what: String
        switch targetType {
        case "post": what = "Пост"
        case "story": what = "История"
        default: what = "Комментарий"
        }
        return what + " · " + TeamText.account(handle) + (targetType == "story" ? " · удалена" : " · удалён")
    }
}

/// A sending held by the spam filter (spamQueue in lib/antispam-moderation.ts).
struct TeamSpamItem: Identifiable, Hashable {
    var id: String
    var kind: String
    var actorId: String
    var name: String
    var handle: String
    var contextName: String
    var text: String
    var reasons: [String]
    var hasMedia: Bool
    var status: String
    var note: String
    var created: Double
    var reviewedAt: Double

    init(_ j: JSON) {
        id = j["id"].str
        kind = j["kind"].str
        actorId = j["actorId"].str
        name = j["name"].str
        handle = j["handle"].str
        contextName = j["contextName"].str
        text = j["text"].str
        reasons = j["reasons"].array.compactMap(\.string)
        let media = j["payload"]["media"].str
        hasMedia = !media.isEmpty && media != "[]"
        status = j["status"].str
        note = j["note"].str
        created = j["created"].double ?? 0
        reviewedAt = j["reviewedAt"].double ?? 0
    }

    var kindLabel: String {
        switch kind {
        case "post": return "Лента"
        case "comment": return "Комментарий"
        default: return "Группа"
        }
    }
}

/// Spam protection settings shared by the team.
struct TeamSpamSettings: Hashable {
    var domains: [String]
    var raidUntil: Double
    var updated: Int

    init(_ j: JSON) {
        domains = j["domains"].array.compactMap(\.string)
        raidUntil = j["raidUntil"].double ?? 0
        updated = Int(j["updated"].double ?? 0)
    }

    var raidOn: Bool { raidUntil > Format.nowMs }
}

/// An account in «Управление» (administration in lib/administration.ts).
struct TeamAdminPerson: Identifiable, Hashable {
    var id: String
    var name: String
    var avatar: String
    var handle: String
    var kind: String
    var appearance: Appearance
    var moderator: Bool
    var administrator: Bool
    var balance: Int

    init(_ j: JSON) {
        id = j["id"].str
        name = j["name"].str
        avatar = j["avatar"].str
        handle = j["handle"].str
        kind = j["kind"].string ?? "person"
        appearance = Appearance(j)
        moderator = j["moderator"].bool
        administrator = j["administrator"].bool
        balance = j["balance"].int ?? 0
    }

    var isChannel: Bool { kind == "channel" }

    var identity: Identity {
        Identity(id: id, name: name, avatar: avatar, handle: handle, kind: kind, appearance: appearance)
    }

    var role: String {
        if administrator { return "Администратор" }
        if moderator { return "Модератор" }
        return isChannel ? "Канал" : "Пользователь"
    }
}

/// A line of the administration journal.
struct TeamAdminEvent: Identifiable, Hashable {
    var id: String
    var action: String
    var amount: Int
    var reason: String
    var actorName: String
    var name: String
    var handle: String
    var created: Double

    init(_ j: JSON) {
        id = j["id"].str
        action = j["action"].str
        amount = j["amount"].int ?? 0
        reason = j["reason"].str
        actorName = j["actorName"].str
        name = j["name"].str
        handle = j["handle"].str
        created = j["created"].double ?? 0
    }

    var title: String {
        let label = TeamGrant(rawValue: action)?.title ?? (action == "marketIssue" ? "Выпуск лотов Маркета" : "Изменение аккаунта")
        let count = Format.count(amount)
        switch action {
        case "stars": return label + " +" + count
        case "starsDebit": return label + " −" + count
        case "premium": return label + " +\(amount) дн."
        case "marketIssue", "collectible": return label + " · \(amount) шт."
        default: return label + (amount != 0 ? " · включено" : " · снято")
        }
    }

    var subtitle: String {
        if action == "marketIssue" { return actorName }
        return actorName + " → " + (handle.isEmpty ? name : "@" + handle)
    }
}

/// What an administrator can change (adminGrant).
enum TeamGrant: String, CaseIterable, Identifiable {
    case stars, starsDebit, premium, collectible, verified, moderator

    var id: String { rawValue }

    var title: String {
        switch self {
        case .stars: return "Выдать Stars"
        case .starsDebit: return "Отнять Stars"
        case .premium: return "Выдать Premium"
        case .collectible: return "Выдать подарки"
        case .verified: return "Верификация"
        case .moderator: return "Роль модератора"
        }
    }

    var icon: String {
        switch self {
        case .stars: return "star.fill"
        case .starsDebit: return "minus.circle.fill"
        case .premium: return "sparkles"
        case .collectible: return "gift.fill"
        case .verified: return "checkmark.seal.fill"
        case .moderator: return "checkmark.shield.fill"
        }
    }

    /// An amount of Stars or days; the others are on or off.
    var counted: Bool { self == .stars || self == .starsDebit || self == .premium }

    var defaultAmount: String {
        switch self {
        case .stars, .starsDebit: return "1000"
        case .premium: return "30"
        default: return "1"
        }
    }

    var limit: Int { self == .premium ? 365 : 1_000_000 }

    var placeholder: String {
        switch self {
        case .starsDebit: return "Например, возврат ошибочного начисления"
        case .stars, .premium, .collectible: return "Например, награда за помощь в тестировании"
        case .verified: return "Например, подтверждён официальный аккаунт автора"
        case .moderator: return "Например, назначение в команду модерации"
        }
    }
}

enum TeamText {
    static func account(_ handle: String) -> String {
        handle.isEmpty ? "Удалённый аккаунт" : "@" + handle
    }
}

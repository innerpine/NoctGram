import Foundation

// Models mirror lib/client.ts. Each is built from the tolerant JSON value so a
// missing or differently typed column never breaks a whole screen.

/// Premium and channel-boost cosmetics shared by people, posts and comments.
struct Appearance: Hashable {
    var verified = false
    var premium = false
    var boostLevel = 0
    var profileTheme = "iris"
    var nameGradient = false
    var ringText = ""
    var chromeFlow = false
    var chromeTempo: Double = 11
    var avatarMotion = ""

    init() {}

    init(_ j: JSON) {
        verified = j["verified"].bool
        premium = j["premium"].bool
        boostLevel = j["boostLevel"].int ?? 0
        profileTheme = j["profileTheme"].string ?? "iris"
        nameGradient = j["nameGradient"].bool
        ringText = j["ringText"].str
        chromeFlow = j["chromeFlow"].bool
        chromeTempo = j["chromeTempo"].double ?? 11
        avatarMotion = j["avatarMotion"].str
    }

    /// Profile design is unlocked by Premium or by a boosted channel.
    var hasDesign: Bool { premium || boostLevel > 0 }
}

/// What avatar and name views need to draw somebody.
struct Identity: Hashable {
    var id: String
    var name: String
    var avatar: String
    var handle: String
    var kind: String = "person"
    var appearance = Appearance()

    var isChannel: Bool { kind == "channel" }
}

struct Person: Identifiable, Hashable {
    var id: String
    var name: String
    var avatar: String
    var handle: String
    var kind: String
    var ownerId: String
    var followed: Bool
    var lastSeen: Double
    var appearance: Appearance
    // Direct message thread fields (action=threads).
    var lastText: String
    var lastTime: Double
    var unread: Int
    var archivedAt: Double

    init(_ j: JSON) {
        id = j["id"].str
        name = j["name"].str
        avatar = j["avatar"].str
        handle = j["handle"].str
        kind = j["kind"].string ?? "person"
        ownerId = j["ownerId"].str
        followed = j["followed"].bool
        lastSeen = j["lastSeen"].double ?? 0
        appearance = Appearance(j)
        lastText = j["lastText"].str
        lastTime = j["lastTime"].double ?? 0
        unread = j["unread"].int ?? 0
        archivedAt = j["archivedAt"].double ?? 0
    }

    init(identity: Identity) {
        id = identity.id
        name = identity.name
        avatar = identity.avatar
        handle = identity.handle
        kind = identity.kind
        ownerId = ""
        followed = false
        lastSeen = 0
        appearance = identity.appearance
        lastText = ""
        lastTime = 0
        unread = 0
        archivedAt = 0
    }

    var identity: Identity {
        Identity(id: id, name: name, avatar: avatar, handle: handle, kind: kind, appearance: appearance)
    }

    var isChannel: Bool { kind == "channel" }
}

/// Premium profile surface: `profile_appearance.background` (lib/profile-background.ts).
struct ProfileBackground: Hashable {
    var mode = "none"
    var first = "#9775cf"
    var second = "#426b98"
    var intensity = 30

    init() {}

    init(_ raw: JSON) {
        let j = raw.nestedJSON
        guard j.object != nil else { return }
        let modes = ["none", "theme", "cover", "custom"]
        let mode = j["mode"].str
        if modes.contains(mode) { self.mode = mode }
        if j["first"].str.hasPrefix("#") { first = j["first"].str }
        if j["second"].str.hasPrefix("#") { second = j["second"].str }
        if let value = j["intensity"].int { intensity = min(40, max(15, value)) }
    }
}

struct Restriction: Hashable {
    var mode: String
    var reason: String
    var expiresAt: Double?
    var created: Double

    init?(_ j: JSON) {
        guard j.object != nil else { return nil }
        mode = j["mode"].str
        reason = j["reason"].str
        expiresAt = j["expiresAt"].double
        created = j["created"].double ?? 0
    }

    var isBlocked: Bool { mode == "blocked" }
    var isReadOnly: Bool { mode == "read_only" }
}

/// Latest post of a channel card: first 200 characters and the media kind.
struct ChannelPreview: Hashable {
    var id: String
    var text: String
    var media: String
    var poll: Bool
    var code: Bool
    var created: Double

    init?(_ j: JSON) {
        guard j.object != nil else { return nil }
        id = j["id"].str
        text = j["text"].str
        media = j["media"].str
        poll = j["poll"].bool
        code = j["code"].bool
        created = j["created"].double ?? 0
    }

    var summary: String {
        if !text.isEmpty { return text }
        switch media {
        case "photo": return "Фото"
        case "video": return "Видео"
        case "file": return "Файл"
        default: return poll ? "Опрос" : code ? "Код" : "Публикация"
        }
    }
}

/// A Telegram-style personal channel card shown under the profile stats.
struct ChannelCard: Identifiable, Hashable {
    var id: String
    var name: String
    var avatar: String
    var handle: String
    var followers: Int
    var appearance: Appearance
    var post: ChannelPreview?

    init(_ j: JSON) {
        id = j["id"].str
        name = j["name"].str
        avatar = j["avatar"].str
        handle = j["handle"].str
        followers = j["followers"].int ?? 0
        appearance = Appearance(j)
        post = ChannelPreview(j["post"].nestedJSON)
    }

    var identity: Identity {
        Identity(id: id, name: name, avatar: avatar, handle: handle, kind: "channel", appearance: appearance)
    }
}

struct Profile: Identifiable, Hashable {
    var id: String
    var name: String
    var avatar: String
    var cover: String
    var bio: String
    var handle: String
    var handles: [String]
    var kind: String
    var ownerId: String
    var created: Double
    var followers: Int
    var following: Int
    var postCount: Int
    var followed: Bool
    var lastSeen: Double
    var appearance: Appearance
    var background: ProfileBackground
    var pinnedPostId: String
    var anonymousNumber: String
    var location: String
    var website: String
    var instagram: String
    var tiktok: String
    var youtube: String
    /// "YYYY-MM-DD", or "MM-DD" when the owner hides the year from others.
    var birthday: String
    var showBirthYear: Bool
    var personalChannels: [ChannelCard]
    var channelRole: String
    var canPublish: Bool
    var canEditProfile: Bool
    var canManagePosts: Bool
    var canManageMembers: Bool
    var blocked: Bool
    var restriction: Restriction?
    var canModerate: Bool
    var canAdmin: Bool
    var onboardingComplete: Bool

    init(_ j: JSON) {
        id = j["id"].str
        name = j["name"].str
        avatar = j["avatar"].str
        cover = j["cover"].str
        bio = j["bio"].str
        handle = j["handle"].str
        handles = j["handles"].array.compactMap(\.string)
        kind = j["kind"].string ?? "person"
        ownerId = j["ownerId"].str
        created = j["created"].double ?? 0
        followers = j["followers"].int ?? 0
        following = j["following"].int ?? 0
        postCount = j["postCount"].int ?? 0
        followed = j["followed"].bool
        lastSeen = j["lastSeen"].double ?? 0
        appearance = Appearance(j)
        background = ProfileBackground(j["profileBackground"])
        pinnedPostId = j["pinnedPostId"].str
        anonymousNumber = j["anonymousNumber"].str
        location = j["location"].str
        website = j["website"].str
        instagram = j["instagram"].str
        tiktok = j["tiktok"].str
        youtube = j["youtube"].str
        birthday = j["birthday"].str
        showBirthYear = j["showBirthYear"].isNull ? true : j["showBirthYear"].bool
        personalChannels = j["personalChannels"].array.map(ChannelCard.init)
        channelRole = j["channelRole"].str
        canPublish = j["canPublish"].bool
        canEditProfile = j["canEditProfile"].bool
        canManagePosts = j["canManagePosts"].bool
        canManageMembers = j["canManageMembers"].bool
        blocked = j["blocked"].bool
        restriction = Restriction(j["restriction"])
        canModerate = j["canModerate"].bool
        canAdmin = j["canAdmin"].bool
        onboardingComplete = j["onboardingComplete"].isNull ? true : j["onboardingComplete"].bool
    }

    var isChannel: Bool { kind == "channel" }
    var extraHandles: [String] { handles.filter { $0 != handle } }

    var identity: Identity {
        Identity(id: id, name: name, avatar: avatar, handle: handle, kind: kind, appearance: appearance)
    }

    /// 'liquid' is the «Жидкое» banner drawn from the avatar (lib/profile-cover.ts).
    var isLiquidCover: Bool { cover == "liquid" }
    var coverImage: String { isLiquidCover ? "" : cover }
}

struct MediaItem: Identifiable, Hashable {
    var id: String
    var type: String
    var name: String

    init(_ j: JSON) {
        id = j["id"].str
        type = j["type"].str
        name = j["name"].str
    }

    var isImage: Bool { type.hasPrefix("image/") }
    var isVideo: Bool { type.hasPrefix("video/") }
    var path: String { "/api/media/" + id }
}

struct Post: Identifiable, Hashable {
    var id: String
    var userId: String
    var name: String
    var avatar: String
    var handle: String
    var kind: String
    var ownerId: String
    var appearance: Appearance
    var text: String
    var media: [MediaItem]
    var poll: [String]
    /// Vote counts by option index.
    var votes: [Int: Int]
    var voted: Int?
    var code: String
    var codeLang: String
    var adult: Bool
    var created: Double
    var likes: Int
    var comments: Int
    var views: Int
    var stars: Int
    var mySupport: Int
    var liked: Bool
    var saved: Bool
    var pinned: Bool
    var canManagePosts: Bool
    var giveawayId: String

    init(_ j: JSON) {
        id = j["id"].str
        userId = j["userId"].str
        name = j["name"].str
        avatar = j["avatar"].str
        handle = j["handle"].str
        kind = j["kind"].string ?? "person"
        ownerId = j["ownerId"].str
        appearance = Appearance(j)
        text = j["text"].str
        media = j["media"].nestedJSON.array.map(MediaItem.init)
        poll = j["poll"].nestedJSON.array.compactMap(\.string)
        var counts: [Int: Int] = [:]
        for vote in j["votes"].array {
            if let option = vote["option"].int { counts[option] = vote["count"].int ?? 0 }
        }
        votes = counts
        voted = j["voted"].int
        code = j["code"].str
        codeLang = j["codeLang"].string ?? "text"
        adult = j["adult"].bool
        created = j["created"].double ?? 0
        likes = j["likes"].int ?? 0
        comments = j["comments"].int ?? 0
        views = j["views"].int ?? 0
        stars = j["stars"].int ?? 0
        mySupport = j["mySupport"].int ?? 0
        liked = j["liked"].bool
        saved = j["saved"].bool
        pinned = j["pinned"].bool
        canManagePosts = j["canManagePosts"].bool
        giveawayId = j["giveawayId"].str
    }

    var isChannel: Bool { kind == "channel" }
    var totalVotes: Int { votes.values.reduce(0, +) }

    var author: Identity {
        Identity(id: userId, name: name, avatar: avatar, handle: handle, kind: kind, appearance: appearance)
    }

    func isMine(_ me: String?) -> Bool {
        guard let me else { return false }
        return userId == me || ownerId == me
    }
}

struct Comment: Identifiable, Hashable {
    var id: String
    var postId: String
    var userId: String
    var name: String
    var avatar: String
    var handle: String
    var text: String
    var created: Double
    var appearance: Appearance

    init(_ j: JSON) {
        id = j["id"].str
        postId = j["postId"].str
        userId = j["userId"].str
        name = j["name"].str
        avatar = j["avatar"].str
        handle = j["handle"].str
        text = j["text"].str
        created = j["created"].double ?? 0
        appearance = Appearance(j)
    }

    var author: Identity {
        Identity(id: userId, name: name, avatar: avatar, handle: handle, appearance: appearance)
    }
}

struct ChatAttachment: Identifiable, Hashable {
    var id: String
    var name: String
    var type: String
    var size: Int
    var kind: String

    init(_ j: JSON) {
        id = j["id"].str
        name = j["name"].str
        type = j["type"].str
        size = j["size"].int ?? 0
        kind = j["kind"].string ?? (j["type"].str.hasPrefix("image/") ? "image" : j["type"].str.hasPrefix("video/") ? "video" : "file")
    }

    var path: String { "/api/media/" + id }
    var isImage: Bool { kind == "image" }
    var isVideo: Bool { kind == "video" }
}

struct Reaction: Hashable {
    var emoji: String
    var count: Int
    var own: Bool
}

struct ReplyPreview: Hashable {
    var id: String
    var sender: String
    var name: String
    var text: String
    var unavailable: Bool
}

struct ChatGift: Hashable {
    var id: String
    var giftId: String
    var price: Int
    var message: String
    var collectible: Collectible?
}

struct ChatMessage: Identifiable, Hashable {
    var id: String
    var sender: String
    var recipient: String
    var text: String
    var created: Double
    var read: Bool
    var attachments: [ChatAttachment]
    var editedAt: Double
    var pinnedAt: Double
    var forwardedName: String
    var reply: ReplyPreview?
    var gift: ChatGift?
    var reactions: [Reaction]
    /// Local optimistic state while the message is being sent.
    var pending = false
    var failed = false

    init(_ j: JSON) {
        id = j["id"].str
        sender = j["sender"].str
        recipient = j["recipient"].str
        text = j["text"].str
        created = j["created"].double ?? 0
        read = j["read"].bool
        attachments = j["attachments"].nestedJSON.array.map(ChatAttachment.init)
        editedAt = j["editedAt"].double ?? 0
        pinnedAt = j["pinnedAt"].double ?? 0
        forwardedName = j["forwardedName"].str
        let reply = j["reply"]
        self.reply = reply.object == nil ? nil : ReplyPreview(
            id: reply["id"].str, sender: reply["sender"].str, name: reply["name"].str,
            text: reply["text"].str, unavailable: reply["unavailable"].bool)
        let gift = j["gift"]
        self.gift = gift.object == nil ? nil : ChatGift(
            id: gift["id"].str, giftId: gift["giftId"].str, price: gift["price"].int ?? 0,
            message: gift["message"].str, collectible: Collectible(gift["collectible"]))
        reactions = j["reactions"].array.map {
            Reaction(emoji: $0["emoji"].str, count: $0["count"].int ?? 0, own: $0["own"].bool)
        }
    }

    init(localId: String, sender: String, recipient: String, text: String, attachments: [ChatAttachment], reply: ReplyPreview?) {
        id = localId
        self.sender = sender
        self.recipient = recipient
        self.text = text
        created = Date().timeIntervalSince1970 * 1000
        read = false
        self.attachments = attachments
        editedAt = 0
        pinnedAt = 0
        forwardedName = ""
        self.reply = reply
        gift = nil
        reactions = []
        pending = true
    }
}

/// A collectible gift: model art on a radial backdrop (lib/gift-collectibles.ts).
struct Collectible: Hashable {
    var family: String
    var number: Int
    var modelName: String
    var modelAsset: String
    var backdropName: String
    var centerColor: String
    var edgeColor: String
    var textColor: String
    var symbolAsset: String

    init?(_ raw: JSON) {
        let j = raw.nestedJSON
        guard j.object != nil, !j["family"].str.isEmpty else { return nil }
        family = j["family"].str
        number = j["number"].int ?? 0
        modelName = j["model"]["name"].str
        modelAsset = j["model"]["asset"].str
        backdropName = j["backdrop"]["name"].str
        centerColor = j["backdrop"]["centerColor"].string ?? "#3b3b46"
        edgeColor = j["backdrop"]["edgeColor"].string ?? "#1d1d24"
        textColor = j["backdrop"]["textColor"].string ?? "#ffffff"
        symbolAsset = j["symbol"]["asset"].str
    }
}

struct ReceivedGift: Identifiable, Hashable {
    var id: String
    var giftId: String
    var sender: String
    var senderName: String
    var senderAvatar: String
    var senderHandle: String
    var message: String
    var hidden: Bool
    var created: Double
    var collectible: Collectible?

    init(_ j: JSON) {
        id = j["id"].str
        giftId = j["giftId"].str
        sender = j["sender"].str
        senderName = j["senderName"].str
        senderAvatar = j["senderAvatar"].str
        senderHandle = j["senderHandle"].str
        message = j["message"].str
        hidden = j["hidden"].bool
        created = j["created"].double ?? 0
        collectible = Collectible(j["collectible"])
    }

    /// Static art in public/assets/gifts.
    var artPath: String {
        if let collectible, !collectible.modelAsset.isEmpty { return "/assets/gifts/\(collectible.modelAsset).webp" }
        return "/assets/gifts/\(giftId).webp"
    }
}

struct NoctNotification: Identifiable, Hashable {
    var id: String
    var actorId: String
    var kind: String
    var targetId: String
    var created: Double
    var read: Bool
    var name: String
    var avatar: String
    var handle: String
    var appearance: Appearance
    var postId: String
    var postText: String
    var postImage: String
    var commentText: String
    var others: Int
    var amount: Int
    var lotTitle: String
    var giftRecipient: String

    init(_ j: JSON) {
        id = j["id"].str
        actorId = j["actorId"].str
        kind = j["kind"].str
        targetId = j["targetId"].str
        created = j["created"].double ?? 0
        read = j["read"].bool
        name = j["name"].str
        avatar = j["avatar"].str
        handle = j["handle"].str
        appearance = Appearance(j)
        postId = j["postId"].str
        postText = j["postText"].str
        postImage = j["postImage"].str
        commentText = j["commentText"].str
        others = j["others"].int ?? 0
        amount = j["amount"].int ?? 0
        lotTitle = j["lotTitle"].str
        giftRecipient = j["giftRecipient"].str
    }

    var actor: Identity {
        Identity(id: actorId, name: name, avatar: avatar, handle: handle, appearance: appearance)
    }
}

struct StarTransaction: Identifiable, Hashable {
    var id: String
    var sender: String
    var recipient: String
    var amount: Int
    var kind: String
    var created: Double
    var name: String
    var avatar: String
    var postText: String

    init(_ j: JSON) {
        id = j["id"].str
        sender = j["sender"].str
        recipient = j["recipient"].str
        amount = j["amount"].int ?? 0
        kind = j["kind"].str
        created = j["created"].double ?? 0
        name = j["name"].str
        avatar = j["avatar"].str
        postText = j["postText"].str
    }
}

struct Wallet: Hashable {
    var balance: Int
    var received: Int
    var sent: Int
    var testMode: Bool
    var transactions: [StarTransaction]

    init(_ j: JSON) {
        balance = j["balance"].int ?? 0
        received = j["received"].int ?? 0
        sent = j["sent"].int ?? 0
        testMode = j["testMode"].bool
        transactions = j["transactions"].array.map(StarTransaction.init)
    }
}

/// GET /api/auth/session
struct AuthStatus {
    struct User {
        var id: String
        var name: String
        var handle: String
        var avatar: String
        var onboardingComplete: Bool
        var email: String
    }

    var emailEnabled: Bool
    var sitesEnabled: Bool
    var user: User?
    var challengeEmail: String?
    var resendAt: Double

    init(_ j: JSON) {
        emailEnabled = j["emailEnabled"].bool
        sitesEnabled = j["sitesEnabled"].bool
        let u = j["user"]
        user = u.object == nil ? nil : User(
            id: u["id"].str, name: u["name"].str, handle: u["handle"].str, avatar: u["avatar"].str,
            onboardingComplete: u["onboardingComplete"].bool, email: u["email"].str)
        challengeEmail = j["challenge"]["email"].string
        resendAt = j["challenge"]["resendAt"].double ?? 0
    }
}

struct Topic: Hashable, Identifiable {
    var tag: String
    var count: Int
    var id: String { tag }
}

import XCTest
@testable import Noctgram

/// Decoding of real API responses (Tests/Fixtures, captured from a local
/// NoctGram server with sample accounts) and the formatting shared with the web.
final class CoreTests: XCTestCase {
    private func responses() throws -> JSON {
        let url: URL
        if let path = ProcessInfo.processInfo.environment["NOCT_FIXTURES"] {
            url = URL(fileURLWithPath: path)
        } else {
            url = try XCTUnwrap(Bundle(for: CoreTests.self).url(forResource: "fixtures", withExtension: "json"))
        }
        return try XCTUnwrap(JSON.parse(Data(contentsOf: url)))["responses"]
    }

    func testTolerantScalars() throws {
        let json = try XCTUnwrap(JSON.parse(Data(#"{"one":1,"two":"2","yes":true,"none":null,"text":"x","half":1.5}"#.utf8)))
        XCTAssertTrue(json["one"].bool)
        XCTAssertEqual(json["two"].int, 2)
        XCTAssertTrue(json["yes"].bool)
        XCTAssertTrue(json["none"].isNull)
        XCTAssertFalse(json["missing"].bool)
        XCTAssertEqual(json["one"].string, "1")
        XCTAssertEqual(json["half"].double, 1.5)
        XCTAssertEqual(json["text"].str, "x")
        XCTAssertEqual(json["none"].str, "")
        XCTAssertEqual(JSON.string(#"{"a":2}"#).nestedJSON["a"].int, 2)
    }

    func testOwnProfileHasEverythingTheWebShows() throws {
        let profile = Profile(try responses()["profileAlice"])
        XCTAssertEqual(profile.name, "Алиса Ночная")
        XCTAssertEqual(profile.handle, "alice_night")
        XCTAssertEqual(profile.extraHandles, ["alice_writes", "moonchild"])
        XCTAssertTrue(profile.appearance.premium)
        XCTAssertTrue(profile.appearance.nameGradient)
        XCTAssertTrue(profile.appearance.chromeFlow)
        XCTAssertEqual(profile.appearance.ringText, "ночь · музыка · звёзды")
        XCTAssertEqual(profile.appearance.profileTheme, "iris")
        XCTAssertEqual(profile.background.mode, "none")
        XCTAssertEqual(profile.location, "Санкт-Петербург")
        XCTAssertEqual(profile.website, "https://noctgram.com")
        XCTAssertEqual(profile.instagram, "alice.night")
        XCTAssertEqual(profile.tiktok, "alicenight")
        XCTAssertEqual(profile.youtube, "alicenight")
        XCTAssertEqual(profile.birthday, "1999-03-14")
        XCTAssertTrue(profile.showBirthYear)
        XCTAssertEqual(profile.followers, 2)
        XCTAssertEqual(profile.following, 1)
        XCTAssertEqual(profile.postCount, 4)
        XCTAssertFalse(profile.isChannel)
        XCTAssertFalse(profile.pinnedPostId.isEmpty)
        XCTAssertTrue(profile.coverImage.hasPrefix("/api/media/"))
        XCTAssertEqual(profile.personalChannels.count, 1)
        let channel = try XCTUnwrap(profile.personalChannels.first)
        XCTAssertEqual(channel.handle, "night_city")
        XCTAssertEqual(channel.followers, 2)
        XCTAssertTrue(channel.post?.summary.hasPrefix("Новый выпуск") ?? false)
    }

    func testChannelAndLiquidCoverProfiles() throws {
        let channel = Profile(try responses()["profileChannel"])
        XCTAssertTrue(channel.isChannel)
        XCTAssertEqual(channel.channelRole, "owner")
        XCTAssertTrue(channel.canPublish)
        XCTAssertTrue(channel.canEditProfile)
        let bob = Profile(try responses()["profileBob"])
        XCTAssertTrue(bob.isLiquidCover)
        XCTAssertEqual(bob.coverImage, "")
        XCTAssertTrue(bob.followed)
        XCTAssertGreaterThan(bob.lastSeen, 0)
    }

    func testFeedPosts() throws {
        let posts = try responses()["feed"].array.map { Post($0) }
        XCTAssertFalse(posts.isEmpty)
        let photos = try XCTUnwrap(posts.first { $0.media.count == 2 })
        XCTAssertTrue(photos.media.allSatisfy(\.isImage))
        XCTAssertTrue(photos.pinned)
        XCTAssertEqual(photos.likes, 2)
        XCTAssertEqual(photos.comments, 2)
        let poll = try XCTUnwrap(posts.first { !$0.poll.isEmpty })
        XCTAssertEqual(poll.poll.count, 4)
        XCTAssertEqual(poll.totalVotes, 2)
        let code = try XCTUnwrap(posts.first { !$0.code.isEmpty })
        XCTAssertEqual(code.codeLang, "swift")
        XCTAssertTrue(code.isMine("local_alice"))
        XCTAssertTrue(posts.contains { $0.isChannel })
    }

    func testCommentsMessagesAndGifts() throws {
        let comments = try responses()["comments"].array.map { Comment($0) }
        XCTAssertEqual(comments.count, 2)
        let messages = try responses()["messagesBob"].array.map { ChatMessage($0) }
        XCTAssertGreaterThanOrEqual(messages.count, 3)
        let gift = try XCTUnwrap(messages.compactMap(\.gift).first)
        XCTAssertEqual(gift.giftId, "toy_bear")
        XCTAssertEqual(gift.price, 25)
        XCTAssertEqual(gift.message, "Для самой ночной 🧸")
        let gifts = try responses()["gifts"]["gifts"].array.map { ReceivedGift($0) }
        XCTAssertEqual(gifts.count, 2)
        XCTAssertTrue(gifts.contains { $0.artPath == "/assets/gifts/toy_bear.webp" })
        let catalog = try responses()["giftCatalog"]["catalog"].array.map { GiftDefinition($0) }
        XCTAssertTrue(catalog.contains { $0.id == "toy_bear" && $0.name == "Мишка" && $0.price == 25 })
        XCTAssertTrue(gifts.allSatisfy { $0.recipient == "local_alice" })
        let quote = try XCTUnwrap(JSON.parse(Data(#"{"id":"g","available":true,"reason":null,"originalPrice":25,"amount":21,"fee":4,"feePercent":15,"convertedAt":null}"#.utf8)))
        let sale = GiftSale(quote)
        XCTAssertTrue(sale.available)
        XCTAssertEqual(sale.originalPrice, 25)
        XCTAssertEqual(sale.amount, 21)
        XCTAssertEqual(sale.feePercent, 15)
        XCTAssertEqual(sale.reason, "")
    }

    func testThreadsNotificationsWallet() throws {
        let threads = try responses()["threads"].array.map { Person($0) }
        XCTAssertEqual(threads.map(\.handle), ["carol_sky", "bob_night"])
        XCTAssertEqual(threads.map(\.unread), [2, 3])
        let notices = try responses()["notifications"].array.map { NoctNotification($0) }
        XCTAssertTrue(Set(notices.map(\.kind)).isSuperset(of: ["message", "gift", "like", "comment", "follow"]))
        XCTAssertTrue(notices.contains { $0.kind == "comment" && !$0.commentText.isEmpty && !$0.postImage.isEmpty })
        let wallet = Wallet(try responses()["wallet"])
        XCTAssertEqual(wallet.balance, 10_000)
        XCTAssertTrue(wallet.testMode)
        let status = AuthStatus(try responses()["session"])
        XCTAssertEqual(status.user?.id, "local_alice")
        XCTAssertTrue(status.user?.onboardingComplete ?? false)
    }

    func testRussianFormatting() {
        XCTAssertEqual(Format.plural(1, "подписчик", "подписчика", "подписчиков"), "подписчик")
        XCTAssertEqual(Format.plural(3, "подписчик", "подписчика", "подписчиков"), "подписчика")
        XCTAssertEqual(Format.plural(11, "подписчик", "подписчика", "подписчиков"), "подписчиков")
        XCTAssertEqual(Format.plural(21, "подписчик", "подписчика", "подписчиков"), "подписчик")
        XCTAssertEqual(Format.plural(112, "подписчик", "подписчика", "подписчиков"), "подписчиков")
        XCTAssertEqual(Format.marketNumber("12345678"), "+888 1234 5678")
        XCTAssertEqual(Format.siteLabel("https://www.example.com/"), "example.com")
        XCTAssertEqual(Format.initials("Алиса Ночная"), "АН")
        XCTAssertEqual(Format.birthday("03-14"), "14 марта")
        XCTAssertTrue(Format.birthday("1999-03-14").hasPrefix("14 марта 1999 ("))
        XCTAssertEqual(Format.birthday("bad"), "")
        XCTAssertEqual(Format.fileSize(512), "512 Б")
        XCTAssertNotNil(Format.receipt(1790235131598).range(of: #"^\d{2}\.\d{2}\.\d{2} в \d{2}:\d{2}$"#, options: .regularExpression))
    }

    func testLinksMentionsAndTags() throws {
        let text = RichText.attributed("Привет @alice_night и #ночь: https://example.com/a. Почта me@site.ru", baseURL: URL(string: "https://noctgram.com"))
        let links = text.runs.compactMap(\.link)
        XCTAssertEqual(links, [AppLink.handle("alice_night"), AppLink.tag("#ночь"), URL(string: "https://example.com/a")].compactMap { $0 })
        let profile = RichText.attributed("https://noctgram.com/?handle=bob_night", baseURL: URL(string: "https://noctgram.com"))
        XCTAssertEqual(profile.runs.compactMap(\.link), [AppLink.handle("bob_night")].compactMap { $0 })
        XCTAssertEqual(PremiumEmoji.replace("Горит :noct_fire: и :noct_moon:"), "Горит 🔥 и 🌛")
        XCTAssertTrue(Emoji.isOnly("🔥", limit: 3))
        XCTAssertTrue(Emoji.isOnly("❤️ 👍", limit: 3))
        XCTAssertFalse(Emoji.isOnly("ок", limit: 3))
        XCTAssertFalse(Emoji.isOnly("1", limit: 3))
        XCTAssertFalse(Emoji.isOnly("🔥🔥🔥🔥", limit: 3))
    }

    func testOneReactionPerPerson() {
        let start = [Reaction(emoji: "👍", count: 2, own: true), Reaction(emoji: "🔥", count: 1, own: false)]
        let fire = Reaction.applying("🔥", to: start)
        XCTAssertEqual(fire, [Reaction(emoji: "👍", count: 1, own: false), Reaction(emoji: "🔥", count: 2, own: true)])
        XCTAssertEqual(Reaction.applying(nil, to: fire), [Reaction(emoji: "👍", count: 1, own: false), Reaction(emoji: "🔥", count: 1, own: false)])
        XCTAssertEqual(Reaction.applying("❤️", to: []), [Reaction(emoji: "❤️", count: 1, own: true)])
        XCTAssertEqual(Reaction.applying(nil, to: [Reaction(emoji: "😢", count: 1, own: true)]), [])
    }
}

#if DEBUG
import Foundation
import UIKit

/// The real signed-in tabs use a private transport in UI tests. No fixture is compiled into Release.
enum NativeSocialUITestFixture {
    static var isEnabled: Bool { ProcessInfo.processInfo.arguments.contains("--ui-test-social") }

    @MainActor static func makeSession() -> NativeSession? {
        guard isEnabled else { return nil }
        seedImages()
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [NativeSocialUITestProtocol.self]
        let api = NoctAPI(configuration: configuration, keychainService: "NoctGram.SocialUITests." + UUID().uuidString)
        // Start with the regular loading phase: restore, bootstrap and scene lifecycle are exercised.
        return NativeSession(api: api)
    }

    @MainActor private static func seedImages() {
        for (name, size) in [("portrait", CGSize(width: 480, height: 960)),
                             ("landscape", CGSize(width: 1200, height: 300))] {
            let format = UIGraphicsImageRendererFormat()
            format.scale = 1
            let image = UIGraphicsImageRenderer(size: size, format: format).image { context in
                UIColor(red: 0.13, green: 0.10, blue: 0.20, alpha: 1).setFill()
                context.fill(CGRect(origin: .zero, size: size))
                UIColor(red: 0.64, green: 0.51, blue: 0.80, alpha: 1).setFill()
                context.fill(CGRect(x: size.width * 0.12, y: size.height * 0.16,
                                    width: size.width * 0.76, height: size.height * 0.34))
                UIColor(red: 0.28, green: 0.38, blue: 0.45, alpha: 1).setFill()
                context.fill(CGRect(x: 0, y: size.height * 0.66, width: size.width, height: size.height * 0.34))
                let title = name == "portrait" ? "NOCT\nPORTRAIT" : "NOCT LANDSCAPE"
                (title as NSString).draw(at: CGPoint(x: 30, y: size.height * 0.77), withAttributes: [
                    .font: UIFont.systemFont(ofSize: 32, weight: .semibold), .foregroundColor: UIColor.white
                ])
            }
            NGImageCache.shared.setObject(image, forKey: "https://noctgram.com/ui-test/\(name).png" as NSString,
                                         cost: Int(size.width * size.height) * 4)
        }
    }
}

private final class NativeSocialUITestProtocol: URLProtocol, @unchecked Sendable {
    private static let now = Date().timeIntervalSince1970 * 1000
    private static let user: [String: Any] = [
        "id": "fixture-owner", "name": "Марк", "handle": "mark", "avatar": "", "onboardingComplete": true,
        "stars": 650, "premium": false
    ]
    private static let friend: [String: Any] = [
        "id": "fixture-friend", "name": "Алина", "handle": "alina", "avatar": "", "lastText": "Привет! Чаты работают.",
        "lastTime": now, "unread": 1
    ]
    private static let room: [String: Any] = [
        "id": "fixture-room", "name": "Noctgram | Общение", "kind": "group", "avatar": "", "joined": true,
        "memberCount": 3, "updatedAt": now - 1000, "lastMessage": ["text": "Добро пожаловать в общий чат!", "created": now - 1000]
    ]

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func stopLoading() {}

    override func startLoading() {
        let path = request.url?.path ?? ""
        let action = URLComponents(url: request.url!, resolvingAgainstBaseURL: false)?.queryItems?
            .first(where: { $0.name == "action" })?.value ?? ""
        switch (request.httpMethod ?? "GET", path, action) {
        case ("GET", "/api/auth/session", _):
            reply(["emailEnabled": true, "user": Self.user, "challenge": NSNull()])
        case ("GET", "/api/social", "bootstrap"):
            reply(["me": Self.user, "posts": Self.posts, "people": [Self.friend]])
        case ("GET", "/api/social", "feed"):
            reply(Self.posts)
        case ("GET", "/api/social", "threads"):
            reply([Self.friend])
        case ("GET", "/api/rooms", "list"):
            reply(["rooms": [Self.room]])
        case ("GET", "/api/social", "messages"):
            reply([["id": "fixture-dm-message", "sender": "fixture-friend", "recipient": "fixture-owner",
                    "text": "Привет! Чаты работают.", "created": Self.now, "read": true, "attachments": [], "reactions": []]])
        case ("GET", "/api/social", "messageAccess"):
            reply(["allowed": true])
        case ("GET", "/api/rooms", "room"):
            var detail = Self.room
            detail["me"] = "fixture-owner"
            detail["canSend"] = true
            detail["nextCursor"] = NSNull()
            detail["members"] = [["userId": "fixture-owner", "name": "Марк", "role": "owner"]]
            detail["messages"] = [["id": "fixture-room-message", "sender": "fixture-friend", "senderName": "Алина",
                                   "text": "Добро пожаловать в общий чат!", "created": Self.now, "attachments": [], "reactions": []]]
            reply(detail)
        case ("GET", "/api/social", "people"), ("GET", "/api/social", "notifications"):
            reply([])
        case ("GET", "/api/rooms", "search"):
            reply(["rooms": []])
        case ("POST", "/api/rooms", _):
            reply(["ok": true]) // Read markers are consumed by this private transport only.
        default:
            reply(["error": "Непредусмотренный запрос UI-теста: \(path) \(action)", "code": "UITEST_UNEXPECTED_REQUEST"], status: 400)
        }
    }

    private static var posts: [[String: Any]] {
        [
            ["id": "fixture-portrait", "userId": "fixture-friend", "name": "Алина · Ночные истории и фотографии",
             "handle": "alina_noctgram_photography", "avatar": "", "created": now, "text": "Вертикальный кадр из сегодняшней прогулки.",
             "likes": 12, "comments": 3, "liked": false, "saved": false,
             "media": [["id": "fixture-portrait-image", "type": "image/png", "kind": "image", "name": "Портрет.png",
                        "url": "https://noctgram.com/ui-test/portrait.png", "width": 480, "height": 960]]],
            ["id": "fixture-landscape", "userId": "fixture-friend", "name": "Алина", "handle": "alina", "avatar": "",
             "created": now - 60000, "text": "Панорама города.", "likes": 7, "comments": 2,
             "media": [["id": "fixture-landscape-image", "type": "image/png", "kind": "image", "name": "Панорама.png",
                        "url": "https://noctgram.com/ui-test/landscape.png", "width": 1200, "height": 300]]]
        ]
    }

    private func reply(_ object: Any, status: Int = 200) {
        guard let url = request.url,
              let response = HTTPURLResponse(url: url, statusCode: status, httpVersion: "HTTP/1.1",
                                             headerFields: ["Content-Type": "application/json"]),
              let data = try? JSONSerialization.data(withJSONObject: object) else {
            client?.urlProtocol(self, didFailWithError: URLError(.badServerResponse))
            return
        }
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: data)
        client?.urlProtocolDidFinishLoading(self)
    }
}
#endif

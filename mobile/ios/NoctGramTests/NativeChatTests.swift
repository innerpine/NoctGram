import XCTest
import Foundation
@testable import NoctGram

private final class NativeChatProtocol: URLProtocol, @unchecked Sendable {
    private static let lock = NSLock()
    private static var handler: ((NativeChatProtocol) -> Void)?
    private static var requests: [URLRequest] = []

    static func install(_ handler: @escaping (NativeChatProtocol) -> Void) {
        lock.lock(); self.handler = handler; requests = []; lock.unlock()
    }
    static func captured() -> [URLRequest] {
        lock.lock(); defer { lock.unlock() }; return requests
    }
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        Self.lock.lock(); Self.requests.append(request); let callback = Self.handler; Self.lock.unlock()
        callback?(self)
    }
    override func stopLoading() {}
    var action: String {
        URLComponents(url: request.url!, resolvingAgainstBaseURL: false)?.queryItems?.first(where: { $0.name == "action" })?.value ?? ""
    }
    func reply(_ json: String, status: Int = 200) {
        let response = HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: "HTTP/1.1", headerFields: ["Content-Type": "application/json"])!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Data(json.utf8))
        client?.urlProtocolDidFinishLoading(self)
    }
}

final class NativeChatTests: XCTestCase {
    private let room = #"{"id":"group","name":"Общение","kind":"group","me":"alice","canSend":true,"nextCursor":null,"members":[],"messages":[{"id":"group-message","roomId":"group","sender":"bob","text":"Привет из группы","created":1000}]}"#
    private let direct = #"[{"id":"direct-message","sender":"bob","recipient":"alice","text":"Привет","created":1000,"attachments":[],"reactions":[]}]"#

    @MainActor private func api() -> NoctAPI {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [NativeChatProtocol.self]
        let api = NoctAPI(configuration: configuration, keychainService: "NativeChatTests." + UUID().uuidString)
        addTeardownBlock { await MainActor.run { api.clearSession() } }
        return api
    }

    @MainActor func testDirectHistoryLoadsEvenWhenPermissionServiceFails() async {
        let client = api(), direct = self.direct
        NativeChatProtocol.install { mock in
            if mock.action == "messages" { mock.reply(direct) }
            else { mock.reply(#"{"error":"Проверка прав временно недоступна"}"#, status: 503) }
        }
        let model = NGConversationModel(target: NGRecord(["id": "bob"]), isRoom: false, api: client)
        model.active = true
        await model.refresh(owner: "alice")
        XCTAssertFalse(model.loading)
        XCTAssertEqual(model.messages.map(\.id), ["direct-message"])
        XCTAssertFalse(model.canSend)
        XCTAssertNotNil(model.error)
        NativeChatProtocol.install { mock in
            mock.reply(mock.action == "messages" ? direct : #"{"allowed":true,"blockedByMe":false}"#)
        }
        await model.refresh(owner: "alice")
        XCTAssertTrue(model.canSend)
        XCTAssertNil(model.error)
    }

    @MainActor func testGroupHistorySurvivesReadReceiptFailureAndRetries() async {
        let client = api(), room = self.room
        NativeChatProtocol.install { mock in
            if mock.request.httpMethod == "POST" { mock.reply(#"{"error":"Временно недоступно"}"#, status: 503) }
            else { mock.reply(room) }
        }
        let model = NGConversationModel(target: NGRecord(["id": "group", "kind": "group"]), isRoom: true, api: client)
        model.active = true
        await model.refresh(owner: "alice")
        XCTAssertFalse(model.loading)
        XCTAssertEqual(model.messages.map(\.id), ["group-message"])
        XCTAssertTrue(model.canSend)
        NativeChatProtocol.install { $0.reply($0.request.httpMethod == "POST" ? #"{"ok":true}"# : room) }
        await model.refresh(owner: "alice")
        XCTAssertNil(model.error)
        XCTAssertEqual(NativeChatProtocol.captured().filter { $0.httpMethod == "POST" }.count, 1)
    }

    @MainActor func testMismatchedRoomAccountEndsSpinnerWithoutShowingHistory() async {
        let client = api(), room = self.room.replacingOccurrences(of: #""me":"alice""#, with: #""me":"other""#)
        NativeChatProtocol.install { $0.reply(room) }
        let model = NGConversationModel(target: NGRecord(["id": "group", "kind": "group"]), isRoom: true, api: client)
        model.active = true
        await model.refresh(owner: "alice")
        XCTAssertFalse(model.loading)
        XCTAssertTrue(model.messages.isEmpty)
        XCTAssertFalse(model.canSend)
        XCTAssertNotNil(model.error)
        XCTAssertEqual(NativeChatProtocol.captured().count, 1)
    }

    @MainActor func testRevokedGroupAccessClearsPreviouslyLoadedHistory() async {
        let client = api(), room = self.room
        NativeChatProtocol.install { $0.reply($0.request.httpMethod == "POST" ? #"{"error":"Чат больше недоступен"}"# : room, status: $0.request.httpMethod == "POST" ? 403 : 200) }
        let model = NGConversationModel(target: NGRecord(["id": "group", "kind": "group"]), isRoom: true, api: client)
        model.active = true
        await model.refresh(owner: "alice")
        XCTAssertFalse(model.loading)
        XCTAssertTrue(model.messages.isEmpty)
        XCTAssertNil(model.detail)
        XCTAssertFalse(model.canSend)
        XCTAssertNotNil(model.error)
    }

    @MainActor func testMalformedHistoryIsAnErrorInsteadOfAnEmptyChat() async {
        let client = api()
        NativeChatProtocol.install { $0.reply($0.action == "messages" ? #"{"unexpected":[]}"# : #"{"allowed":true}"#) }
        let model = NGConversationModel(target: NGRecord(["id": "bob"]), isRoom: false, api: client)
        model.active = true
        await model.refresh(owner: "alice")
        XCTAssertFalse(model.loading)
        XCTAssertTrue(model.messages.isEmpty)
        XCTAssertFalse(model.canSend)
        XCTAssertNotNil(model.error)
    }

    @MainActor func testGroupOutageDoesNotHideAvailableDirectChats() async {
        let client = api()
        NativeChatProtocol.install { mock in
            if mock.action == "threads" { mock.reply(#"[{"id":"bob","name":"Боб","lastText":"Привет","lastTime":1000}]"#) }
            else { mock.reply(#"{"error":"Группы временно недоступны"}"#, status: 503) }
        }
        let model = NGChatsModel(api: client)
        await model.refresh(owner: "alice", archived: false)
        XCTAssertFalse(model.loading)
        XCTAssertEqual(model.items.map(\.id), ["person:bob"])
        XCTAssertNotNil(model.error)
    }

    @MainActor func testAuthenticationFailureDoesNotExposePartialChatList() async {
        let client = api()
        NativeChatProtocol.install { mock in
            if mock.action == "threads" { mock.reply(#"[{"id":"bob","name":"Боб"}]"#) }
            else { mock.reply(#"{"error":"Войдите снова"}"#, status: 401) }
        }
        let model = NGChatsModel(api: client)
        await model.refresh(owner: "alice", archived: false)
        XCTAssertFalse(model.loading)
        XCTAssertTrue(model.items.isEmpty)
        XCTAssertNotNil(model.error)
    }

    @MainActor func testHiddenAndSecretConversationsDoNotRequestContent() async {
        let client = api()
        NativeChatProtocol.install { $0.reply(#"[]"#) }
        let hidden = NGConversationModel(target: NGRecord(["id": "bob"]), isRoom: false, api: client)
        await hidden.refresh(owner: "alice")
        let secret = NGConversationModel(target: NGRecord(["id": "secret", "kind": "secret"]), isRoom: true, api: client)
        secret.active = true
        await secret.refresh(owner: "alice")
        XCTAssertTrue(NativeChatProtocol.captured().isEmpty)
        XCTAssertTrue(secret.messages.isEmpty)
        XCTAssertFalse(secret.canSend)
    }
}

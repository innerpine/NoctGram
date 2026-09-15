import XCTest
import Foundation
@testable import NoctGram

private final class NativeMockProtocol: URLProtocol, @unchecked Sendable {
    private static let lock = NSLock()
    private static var handler: ((NativeMockProtocol) -> Void)?
    private static var requests: [URLRequest] = []

    static func install(_ handler: @escaping (NativeMockProtocol) -> Void) {
        lock.lock(); self.handler = handler; requests = []; lock.unlock()
    }
    static func captured() -> [URLRequest] {
        lock.lock(); defer { lock.unlock() }; return requests
    }
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        Self.lock.lock()
        Self.requests.append(request)
        let callback = Self.handler
        Self.lock.unlock()
        if let callback = callback { callback(self) }
        else { client?.urlProtocol(self, didFailWithError: URLError(.badServerResponse)) }
    }
    override func stopLoading() {}

    func reply(_ json: String = "{}", status: Int = 200, headers: [String: String] = [:]) {
        bytes(Data(json.utf8), status: status, headers: headers)
    }
    func bytes(_ data: Data, status: Int = 200, headers: [String: String] = [:]) {
        var all = ["Content-Type": "application/json"]
        headers.forEach { all[$0.key] = $0.value }
        let response = HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: "HTTP/1.1", headerFields: all)!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        if !data.isEmpty { client?.urlProtocol(self, didLoad: data) }
        client?.urlProtocolDidFinishLoading(self)
    }
    func redirect(to url: URL) {
        let response = HTTPURLResponse(url: request.url!, statusCode: 302, httpVersion: "HTTP/1.1", headerFields: ["Location": url.absoluteString])!
        client?.urlProtocol(self, wasRedirectedTo: URLRequest(url: url), redirectResponse: response)
    }
    static func body(_ request: URLRequest) -> Data {
        if let data = request.httpBody { return data }
        guard let stream = request.httpBodyStream else { return Data() }
        stream.open(); defer { stream.close() }
        var result = Data(), buffer = [UInt8](repeating: 0, count: 4096)
        while true {
            let count = stream.read(&buffer, maxLength: buffer.count)
            if count <= 0 { break }
            result.append(buffer, count: count)
        }
        return result
    }
}

final class NativeAPITests: XCTestCase {
    private let syntheticToken = String(repeating: "a", count: 64)

    @MainActor private func client(service: String = "NoctGramTests." + UUID().uuidString) -> NoctAPI {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [NativeMockProtocol.self]
        let api = NoctAPI(configuration: configuration, keychainService: service)
        addTeardownBlock { await MainActor.run { api.clearSession() } }
        return api
    }

    private func cookie(_ name: String = "noct_session") -> String {
        "\(name)=\(syntheticToken); Path=/; Max-Age=3600; Secure; HttpOnly; SameSite=Lax"
    }

    @MainActor func testBootstrapAndArrayResponsesMatchExistingAPI() async throws {
        let api = client()
        NativeMockProtocol.install { mock in
            if mock.request.url?.query?.contains("bootstrap") == true {
                mock.reply(#"{"me":{"id":"alice"},"posts":[{"id":"p1"}],"people":[]}"#)
            } else { mock.reply(#"[{"id":"p2"},{"id":"p3"}]"#) }
        }
        let boot = try await api.get("/api/social", query: ["action": "bootstrap"])
        XCTAssertEqual(boot.object("me")?.id, "alice")
        XCTAssertEqual(boot.objects("posts").map(\.id), ["p1"])
        let feed = try await api.get("/api/social", query: ["action": "feed"])
        XCTAssertEqual(feed.objects("items").map(\.id), ["p2", "p3"])
        let request = try XCTUnwrap(NativeMockProtocol.captured().first)
        XCTAssertEqual(request.url?.host, "noctgram.com")
        XCTAssertEqual(request.value(forHTTPHeaderField: "Origin"), "https://noctgram.com")
        XCTAssertEqual(request.cachePolicy, .reloadIgnoringLocalCacheData)
    }

    @MainActor func testOTPChallengeSessionAndKeychainRestoreArePrivate() async throws {
        let service = "NoctGramTests." + UUID().uuidString
        let api = client(service: service)
        let challengeCookie = cookie("noct_email_challenge"), sessionCookie = cookie()
        NativeMockProtocol.install { mock in
            if mock.request.url?.path == "/api/auth/start" {
                mock.reply(#"{"expiresAt":1,"resendAt":1}"#, headers: ["Set-Cookie": challengeCookie])
            } else { mock.reply(#"{"redirectTo":"/"}"#, headers: ["Set-Cookie": sessionCookie]) }
        }
        _ = try await api.post("/api/auth/start", body: ["email": "synthetic@example.test"])
        XCTAssertFalse(api.hasSession)
        _ = try await api.post("/api/auth/verify", body: ["code": "123456"])
        XCTAssertTrue(api.hasSession)
        XCTAssertTrue(NativeMockProtocol.captured().last?.value(forHTTPHeaderField: "Cookie")?.contains("noct_email_challenge=") == true)
        let restored = client(service: service)
        XCTAssertTrue(restored.hasSession)
        NativeMockProtocol.install { $0.reply(#"{"user":{"id":"alice"}}"#) }
        _ = try await restored.get("/api/auth/session")
        XCTAssertTrue(NativeMockProtocol.captured().last?.value(forHTTPHeaderField: "Cookie")?.contains("noct_session=") == true)
        XCTAssertFalse((HTTPCookieStorage.shared.cookies ?? []).contains { $0.name == "noct_session" && $0.value == syntheticToken })
        restored.clearSession()
        XCTAssertFalse(client(service: service).hasSession)
    }

    @MainActor func testProtected401ClearsSessionAndNotifiesButOTPFailureDoesNot() async throws {
        let api = client(), sessionCookie = cookie()
        NativeMockProtocol.install { $0.reply(headers: ["Set-Cookie": sessionCookie]) }
        _ = try await api.post("/api/auth/verify", body: ["code": "123456"])
        var notifications = 0
        let observer = NotificationCenter.default.addObserver(forName: .noctSessionExpired, object: api, queue: nil) { _ in notifications += 1 }
        defer { NotificationCenter.default.removeObserver(observer) }
        NativeMockProtocol.install { $0.reply(#"{"error":"Неверный код","code":"BAD_CODE"}"#, status: 401) }
        do { _ = try await api.post("/api/auth/verify", body: ["code": "000000"]); XCTFail("Expected 401") }
        catch let error as NoctAPIError { XCTAssertEqual(error.status, 401) }
        XCTAssertTrue(api.hasSession)
        XCTAssertEqual(notifications, 0)
        do { _ = try await api.get("/api/social"); XCTFail("Expected 401") }
        catch let error as NoctAPIError { XCTAssertTrue(error.isUnauthorized) }
        XCTAssertFalse(api.hasSession)
        XCTAssertEqual(notifications, 1)
    }

    @MainActor func testOnboardingAndRateLimitKeepTypedErrorsWithoutLoggingOut() async throws {
        let api = client(), sessionCookie = cookie()
        NativeMockProtocol.install { $0.reply(headers: ["Set-Cookie": sessionCookie]) }
        _ = try await api.post("/api/auth/verify", body: ["code": "123456"])
        NativeMockProtocol.install { $0.reply(#"{"error":"Завершите профиль","code":"ONBOARDING_REQUIRED"}"#, status: 409) }
        do { _ = try await api.get("/api/social"); XCTFail("Expected onboarding") }
        catch let error as NoctAPIError { XCTAssertTrue(error.requiresOnboarding); XCTAssertEqual(error.message, "Завершите профиль") }
        XCTAssertTrue(api.hasSession)
        NativeMockProtocol.install { $0.reply(#"{"error":"Подождите","retryAfter":10}"#, status: 429, headers: ["Retry-After": "30"]) }
        do { _ = try await api.get("/api/social"); XCTFail("Expected rate limit") }
        catch let error as NoctAPIError { XCTAssertEqual(error.retryAfter, 30) }
    }

    @MainActor func testAuthenticatedAbsoluteMediaAndStreamingLimit() async throws {
        let api = client(), sessionCookie = cookie()
        NativeMockProtocol.install { $0.reply(headers: ["Set-Cookie": sessionCookie]) }
        _ = try await api.post("/api/auth/verify", body: ["code": "123456"])
        NativeMockProtocol.install { $0.bytes(Data([1, 2, 3]), headers: ["Content-Type": "image/jpeg"]) }
        let data = try await api.download("https://noctgram.com/api/media/file-id?download=1", maxBytes: 3)
        XCTAssertEqual(data, Data([1, 2, 3]))
        XCTAssertEqual(NativeMockProtocol.captured().last?.url?.query, "download=1")
        XCTAssertTrue(NativeMockProtocol.captured().last?.value(forHTTPHeaderField: "Cookie")?.contains("noct_session=") == true)
        NativeMockProtocol.install { $0.bytes(Data(repeating: 7, count: 12), headers: ["Content-Type": "image/jpeg"]) }
        do { _ = try await api.download("/api/media/file-id", maxBytes: 4); XCTFail("Expected limit") }
        catch let error as NoctAPIError { XCTAssertEqual(error.code, "RESPONSE_TOO_LARGE") }
    }

    @MainActor func testCrossOriginURLsAndRedirectsCannotReceiveCredentials() async throws {
        let api = client()
        NativeMockProtocol.install { $0.reply() }
        for path in ["https://evil.test/api/social", "//evil.test/api/social", "/api/../login"] {
            do { _ = try await api.get(path); XCTFail("Unsafe URL accepted") }
            catch let error as NoctAPIError { XCTAssertEqual(error.code, "UNSAFE_URL") }
        }
        do { _ = try await api.download("https://noctgram.com.evil.test/api/media/a"); XCTFail("Unsafe URL accepted") }
        catch let error as NoctAPIError { XCTAssertEqual(error.code, "UNSAFE_URL") }
        XCTAssertTrue(NativeMockProtocol.captured().isEmpty)
        NativeMockProtocol.install { $0.redirect(to: URL(string: "https://evil.test/collect")!) }
        do { _ = try await api.get("/api/social"); XCTFail("Redirect accepted") }
        catch let error as NoctAPIError { XCTAssertEqual(error.code, "UNSAFE_REDIRECT") }
        XCTAssertEqual(NativeMockProtocol.captured().count, 1)
        XCTAssertEqual(NativeMockProtocol.captured().first?.url?.host, "noctgram.com")
    }

    @MainActor func testMultipartContainsPeerAndCannotInjectHeaders() async throws {
        let api = client()
        NativeMockProtocol.install { $0.reply(#"{"id":"upload-1"}"#) }
        _ = try await api.upload(data: Data([1, 2, 3]), fileName: "../bad\"\r\nX-Injected: yes.png", mimeType: "image/png", chat: true, peer: "bob")
        let request = try XCTUnwrap(NativeMockProtocol.captured().last)
        XCTAssertEqual(request.url?.path, "/api/chat-upload")
        let body = String(decoding: NativeMockProtocol.body(request), as: UTF8.self)
        XCTAssertTrue(body.contains("name=\"peer\"\r\n\r\nbob\r\n"))
        XCTAssertFalse(body.contains("\r\nX-Injected:"))
        XCTAssertFalse(body.contains("filename=\"../"))
        XCTAssertTrue(request.value(forHTTPHeaderField: "Content-Type")?.hasPrefix("multipart/form-data; boundary=") == true)
        do { _ = try await api.upload(data: Data([1]), fileName: "a.png", mimeType: "image/png\r\nInjected:1", chat: false); XCTFail("Invalid MIME accepted") }
        catch let error as NoctAPIError { XCTAssertEqual(error.code, "INVALID_MIME_TYPE") }
        do { _ = try await api.upload(data: Data([1]), fileName: "a.png", mimeType: "image/png", chat: true); XCTFail("Missing peer accepted") }
        catch let error as NoctAPIError { XCTAssertEqual(error.code, "CHAT_PEER_REQUIRED") }
        XCTAssertEqual(NativeMockProtocol.captured().count, 1)
    }

    @MainActor func testLogoutCancelsInFlightRequestAndCannotRestoreOldCookies() async throws {
        let api = client(), sessionCookie = cookie()
        let began = expectation(description: "request began")
        NativeMockProtocol.install { _ in began.fulfill() }
        let oldRequest = Task { try await api.post("/api/auth/verify", body: ["code": "123456"]) }
        await fulfillment(of: [began], timeout: 2)
        api.clearSession()
        do { _ = try await oldRequest.value; XCTFail("Cancelled request completed") }
        catch is CancellationError {}
        XCTAssertFalse(api.hasSession)
        NativeMockProtocol.install { mock in
            XCTAssertNil(mock.request.value(forHTTPHeaderField: "Cookie"))
            mock.reply(#"{"user":null}"#)
        }
        _ = try await api.get("/api/auth/session")
        XCTAssertFalse(api.hasSession)
        // A new, explicitly completed login still works after cancelling the old transport.
        NativeMockProtocol.install { $0.reply(headers: ["Set-Cookie": sessionCookie]) }
        _ = try await api.post("/api/auth/verify", body: ["code": "654321"])
        XCTAssertTrue(api.hasSession)
    }

    @MainActor func testHTMLSuccessAndHTMLFailureDoNotExposeRawServerContent() async throws {
        let api = client()
        NativeMockProtocol.install { $0.reply("<html>private diagnostic</html>", headers: ["Content-Type": "text/html"]) }
        do { _ = try await api.get("/api/social"); XCTFail("HTML parsed") }
        catch let error as NoctAPIError { XCTAssertEqual(error.code, "INVALID_RESPONSE"); XCTAssertFalse(error.message.contains("private diagnostic")) }
        NativeMockProtocol.install { $0.reply("<html>private diagnostic</html>", status: 502, headers: ["Content-Type": "text/html"]) }
        do { _ = try await api.get("/api/social"); XCTFail("502 accepted") }
        catch let error as NoctAPIError { XCTAssertEqual(error.status, 502); XCTAssertFalse(error.message.contains("private diagnostic")) }
    }
}

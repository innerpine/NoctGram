import XCTest
import UIKit
@testable import NoctGram

private final class NativeSessionProtocol: URLProtocol {
    static var payload = "{}"
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        let response = HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: "HTTP/1.1", headerFields: ["Content-Type": "application/json"])!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Data(Self.payload.utf8))
        client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {}
}

final class NativeSessionTests: XCTestCase {
    @MainActor private func model() -> (NativeSession, NoctAPI) {
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [NativeSessionProtocol.self]
        let api = NoctAPI(configuration: config, keychainService: "NativeSessionTests." + UUID().uuidString)
        addTeardownBlock { await MainActor.run { api.clearSession(); NGImageCache.shared.removeAllObjects(); NGTemporaryMedia.removeAll() } }
        return (NativeSession(api: api), api)
    }

    @MainActor func testRevokedSessionClearsPrivateMediaEvenWithHTTP200() async throws {
        let (session, api) = model()
        session.user = NGRecord(["id": "previous-account"])
        session.phase = .signedIn
        NGImageCache.shared.setObject(UIImage(), forKey: "private-photo")
        let file = try NGTemporaryMedia.save(Data([1, 2, 3]), extension: "bin")
        NativeSessionProtocol.payload = #"{"emailEnabled":true,"user":null,"challenge":null}"#
        await session.refresh()
        XCTAssertNil(session.user)
        XCTAssertTrue(session.phase == .signedOut)
        XCTAssertFalse(api.hasSession)
        XCTAssertNil(NGImageCache.shared.object(forKey: "private-photo"))
        XCTAssertFalse(FileManager.default.fileExists(atPath: file.path))
    }

    @MainActor func testSignedOutEmailChallengeIsRetained() async {
        let (session, _) = model()
        NativeSessionProtocol.payload = #"{"emailEnabled":true,"user":null,"challenge":{"email":"sample@example.test","expiresAt":9999999999999}}"#
        await session.refresh()
        XCTAssertTrue(session.phase == .signedOut)
        XCTAssertEqual(session.challenge?.string("email"), "sample@example.test")
    }
}

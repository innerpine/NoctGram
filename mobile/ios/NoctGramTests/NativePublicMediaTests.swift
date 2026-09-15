import XCTest
import Foundation
@testable import NoctGram

private final class PublicMediaMockProtocol: URLProtocol, @unchecked Sendable {
    private static let lock = NSLock()
    private static var handler: ((PublicMediaMockProtocol) -> Void)?
    private static var requests: [URLRequest] = []

    static func install(_ handler: @escaping (PublicMediaMockProtocol) -> Void) {
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
        callback?(self)
    }
    override func stopLoading() {}

    func reply(_ chunks: [Data], length: Int? = nil) {
        var headers = ["Content-Type": "image/png"]
        if let length = length { headers["Content-Length"] = String(length) }
        let response = HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: "HTTP/1.1", headerFields: headers)!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        for chunk in chunks { client?.urlProtocol(self, didLoad: chunk) }
        client?.urlProtocolDidFinishLoading(self)
    }
    func redirect(to url: URL) {
        let response = HTTPURLResponse(url: request.url!, statusCode: 302, httpVersion: "HTTP/1.1",
                                       headerFields: ["Location": url.absoluteString])!
        client?.urlProtocol(self, wasRedirectedTo: URLRequest(url: url), redirectResponse: response)
    }
}

final class NativePublicMediaTests: XCTestCase {
    private let imageURL = URL(string: "https://avatars.example.test/avatar.png")!
    private func configuration() -> URLSessionConfiguration {
        let result = URLSessionConfiguration.ephemeral
        result.protocolClasses = [PublicMediaMockProtocol.self]
        // Only the protocol hook may cross into the anonymous session.
        result.httpAdditionalHeaders = ["Cookie": "synthetic=secret", "Authorization": "Bearer synthetic"]
        return result
    }

    func testExactByteLimitSucceedsWithoutInheritedCredentials() async throws {
        PublicMediaMockProtocol.install { $0.reply([Data([1, 2]), Data([3, 4, 5])]) }
        let data = try await NativePublicMedia.download(imageURL, maxBytes: 5, configuration: configuration())
        XCTAssertEqual(data, Data([1, 2, 3, 4, 5]))
        let request = try XCTUnwrap(PublicMediaMockProtocol.captured().first)
        XCTAssertNil(request.value(forHTTPHeaderField: "Cookie"))
        XCTAssertNil(request.value(forHTTPHeaderField: "Authorization"))
        XCTAssertFalse(request.httpShouldHandleCookies)
        XCTAssertEqual(request.cachePolicy, .reloadIgnoringLocalCacheData)
    }

    func testChunkedBodyCannotExceedLimitWithoutContentLength() async throws {
        PublicMediaMockProtocol.install { $0.reply([Data([1, 2, 3]), Data([4, 5, 6])]) }
        do {
            _ = try await NativePublicMedia.download(imageURL, maxBytes: 5, configuration: configuration())
            XCTFail("A response larger than the streaming limit must be cancelled.")
        } catch let error as NoctAPIError {
            XCTAssertEqual(error.code, "MEDIA_TOO_LARGE")
            XCTAssertEqual(error.status, 413)
        }
    }

    func testDeclaredOversizeIsRejectedBeforeWaitingForBody() async throws {
        PublicMediaMockProtocol.install { $0.reply([], length: 100) }
        do {
            _ = try await NativePublicMedia.download(imageURL, maxBytes: 5, configuration: configuration())
            XCTFail("Content-Length over the limit must be rejected.")
        } catch let error as NoctAPIError { XCTAssertEqual(error.code, "MEDIA_TOO_LARGE") }
    }

    func testInsecureRedirectCannotStartAnotherRequest() async throws {
        PublicMediaMockProtocol.install { $0.redirect(to: URL(string: "http://avatars.example.test/plain.png")!) }
        do {
            _ = try await NativePublicMedia.download(imageURL, configuration: configuration())
            XCTFail("HTTPS media must not follow a plaintext redirect.")
        } catch let error as NoctAPIError { XCTAssertEqual(error.code, "UNSAFE_MEDIA_REDIRECT") }
        XCTAssertEqual(PublicMediaMockProtocol.captured().count, 1)
    }
}

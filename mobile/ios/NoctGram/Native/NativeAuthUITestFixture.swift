#if DEBUG
import Foundation

/// UI tests exercise the actual auth views with a private transport that cannot reach the network.
enum NativeAuthUITestFixture {
    static var isEnabled: Bool {
        let arguments = ProcessInfo.processInfo.arguments
        return arguments.contains("--ui-test-login") || arguments.contains("--ui-test-onboarding")
    }

    @MainActor static func makeSession() -> NativeSession? {
        guard isEnabled else { return nil }
        NativeAuthUITestProtocol.reset()
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [NativeAuthUITestProtocol.self]
        let api = NoctAPI(configuration: configuration, keychainService: "NoctGram.AuthUITests." + UUID().uuidString)
        let session = NativeSession(api: api)
        session.phase = ProcessInfo.processInfo.arguments.contains("--ui-test-onboarding") ? .onboarding : .signedOut
        return session
    }
}

private final class NativeAuthUITestProtocol: URLProtocol, @unchecked Sendable {
    private static let lock = NSLock()
    private static var counts: [String: Int] = [:]

    static func reset() {
        lock.lock(); defer { lock.unlock() }
        counts = [:]
    }

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func stopLoading() {}

    override func startLoading() {
        let path = request.url?.path ?? ""
        Self.lock.lock()
        let count = Self.counts[path, default: 0] + 1
        Self.counts[path] = count
        Self.lock.unlock()

        switch (request.httpMethod ?? "GET", path) {
        case ("POST", "/api/auth/start") where count == 1:
            reply(["expiresAt": Date().addingTimeInterval(600).timeIntervalSince1970 * 1000,
                   "resendAt": Date().addingTimeInterval(-1).timeIntervalSince1970 * 1000])
        case ("POST", "/api/auth/start"):
            reply(["error": "Проверка повторной отправки: \(count)", "code": "UITEST_RESEND"], status: 400)
        case ("POST", "/api/auth/verify"):
            reply(["error": "Проверка нажатия входа: \(count)", "code": "UITEST_VERIFY"], status: 400)
        case ("POST", "/api/auth/onboarding"):
            reply(["error": "Проверка регистрации: \(count)", "code": "UITEST_ONBOARDING"], status: 400)
        case ("POST", "/api/auth/logout"):
            reply([:])
        default:
            // Every unexpected request fails locally; never fall through to a live server.
            reply(["error": "Непредусмотренный запрос UI-теста", "code": "UITEST_UNEXPECTED_REQUEST"], status: 400)
        }
    }

    private func reply(_ object: [String: Any], status: Int = 200) {
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

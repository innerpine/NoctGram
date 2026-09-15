import Foundation
import Security

@MainActor
final class NoctAPI {
    static let shared = NoctAPI()
    private static let origin = URL(string: "https://noctgram.com")!
    private static let jsonLimit = 8 * 1024 * 1024
    private let keychain: NativeSessionKeychain
    private let protocolClasses: [AnyClass]?
    private var session: URLSession!
    private var transport: NativeHTTPTransport!
    private var cookieStorage: HTTPCookieStorage!
    private var generation = UUID()
    private var lastStoredCookies: Data?
    private(set) var sessionStorageError: NoctAPIError?

    /// Tests inject URLProtocol into an otherwise fresh, private ephemeral configuration.
    init(configuration: URLSessionConfiguration = .ephemeral,
         keychainService: String = (Bundle.main.bundleIdentifier ?? "com.noctgram.ios") + ".native-session") {
        self.protocolClasses = configuration.protocolClasses
        self.keychain = NativeSessionKeychain(service: keychainService)
        makeSession()
        restoreSession()
    }

    deinit { session?.invalidateAndCancel() }

    var hasSession: Bool {
        (cookieStorage.cookies ?? []).contains { $0.name == "noct_session" && savedCookie($0) != nil }
    }

    func get(_ path: String, query: [String: String] = [:]) async throws -> NGRecord {
        try await json(path, method: "GET", query: query)
    }

    func post(_ path: String, body: [String: Any]) async throws -> NGRecord {
        try await json(path, method: "POST", body: body)
    }

    func delete(_ path: String, body: [String: Any]) async throws -> NGRecord {
        try await json(path, method: "DELETE", body: body)
    }

    func upload(data: Data, fileName: String, mimeType: String, chat: Bool, peer: String? = nil) async throws -> NGRecord {
        guard !data.isEmpty, data.count <= 25 * 1024 * 1024 else {
            throw NoctAPIError(status: 413, code: "UPLOAD_SIZE", message: "Выберите файл размером до 25 МБ.")
        }
        if chat && (peer == nil || peer!.isEmpty) {
            throw NoctAPIError(status: 400, code: "CHAT_PEER_REQUIRED", message: "Для вложения нужен собеседник.")
        }
        guard mimeType.range(of: "^[A-Za-z0-9!#$&^_.+-]+/[A-Za-z0-9!#$&^_.+-]+$", options: .regularExpression) != nil else {
            throw NoctAPIError(status: 400, code: "INVALID_MIME_TYPE", message: "Не удалось определить формат файла.")
        }
        let boundary = "NoctGram-" + UUID().uuidString
        var name = (fileName.replacingOccurrences(of: "\\", with: "/") as NSString).lastPathComponent
        name = name.components(separatedBy: .controlCharacters).joined().replacingOccurrences(of: "\"", with: "_")
        name = String(name.prefix(180))
        if name.isEmpty { name = "attachment" }
        var body = Data()
        func append(_ text: String) { body.append(Data(text.utf8)) }
        append("--\(boundary)\r\nContent-Disposition: form-data; name=\"file\"; filename=\"\(name)\"\r\nContent-Type: \(mimeType)\r\n\r\n")
        body.append(data)
        append("\r\n")
        if chat, let peer = peer {
            guard peer.utf8.count <= 200 else {
                throw NoctAPIError(status: 400, code: "INVALID_PEER", message: "Некорректный собеседник.")
            }
            append("--\(boundary)\r\nContent-Disposition: form-data; name=\"peer\"\r\n\r\n\(peer)\r\n")
        }
        append("--\(boundary)--\r\n")
        let path = chat ? "/api/chat-upload" : "/api/upload"
        var request = try makeRequest(path, method: "POST")
        request.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
        request.httpBody = body
        let (bytes, response) = try await send(request, maxBytes: Self.jsonLimit)
        return try record(bytes, response: response)
    }

    /// Authenticated media stays in memory. The caller owns any temporary file it chooses to create.
    func download(_ path: String, maxBytes: Int = 25 * 1024 * 1024) async throws -> Data {
        guard maxBytes > 0 else {
            throw NoctAPIError(code: "INVALID_LIMIT", message: "Некорректный лимит загрузки.")
        }
        var endpoint = path
        if !path.hasPrefix("/") {
            guard let url = URL(string: path), NativeHTTPTransport.permits(url), url.fragment == nil,
                  let parts = URLComponents(url: url, resolvingAgainstBaseURL: false) else {
                throw NoctAPIError(code: "UNSAFE_URL", message: "Запрос за пределы NoctGram запрещён.")
            }
            endpoint = parts.percentEncodedPath + (parts.percentEncodedQuery.map { "?" + $0 } ?? "")
        }
        var request = try makeRequest(endpoint, method: "GET")
        request.setValue("*/*", forHTTPHeaderField: "Accept")
        return try await send(request, maxBytes: maxBytes).0
    }

    func clearSession() {
        generation = UUID()
        session.invalidateAndCancel()
        lastStoredCookies = nil
        do { try keychain.remove(); sessionStorageError = nil }
        catch { sessionStorageError = Self.storageError }
        // Late callbacks belong to the old cookie jar and cannot resurrect a signed-out account.
        makeSession()
    }

    func persistSession() {
        let cookies = (cookieStorage.cookies ?? []).compactMap(savedCookie).sorted { $0.name < $1.name }
        do {
            let encoder = JSONEncoder()
            encoder.outputFormatting = [.sortedKeys]
            let data = try encoder.encode(cookies)
            if cookies.isEmpty {
                if lastStoredCookies != nil { try keychain.remove() }
                lastStoredCookies = nil
            } else if data != lastStoredCookies {
                try keychain.save(data)
                lastStoredCookies = data
            }
            sessionStorageError = nil
        } catch {
            sessionStorageError = Self.storageError
        }
    }

    private static var storageError: NoctAPIError {
        NoctAPIError(code: "SESSION_STORAGE", message: "Не удалось сохранить вход в защищённом хранилище. Разблокируйте iPhone и повторите вход.")
    }

    private func makeSession() {
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = protocolClasses
        config.urlCache = nil
        config.urlCredentialStorage = nil
        config.requestCachePolicy = .reloadIgnoringLocalCacheData
        config.httpShouldSetCookies = true
        config.httpCookieAcceptPolicy = .always
        config.timeoutIntervalForRequest = 30
        config.timeoutIntervalForResource = 120
        config.waitsForConnectivity = false
        // Apple's ephemeral configuration supplies its own memory-only jar, never .shared.
        cookieStorage = config.httpCookieStorage!
        transport = NativeHTTPTransport()
        let queue = OperationQueue()
        queue.name = "NoctGram.native.network"
        queue.maxConcurrentOperationCount = 1
        session = URLSession(configuration: config, delegate: transport, delegateQueue: queue)
    }

    private func restoreSession() {
        do {
            guard let data = try keychain.read() else { return }
            let saved = try JSONDecoder().decode([NativeSavedCookie].self, from: data)
            lastStoredCookies = data
            for value in saved where value.valid {
                if let cookie = HTTPCookie(properties: [
                    .name: value.name, .value: value.value, .domain: "noctgram.com", .path: "/",
                    .secure: "TRUE", .expires: Date(timeIntervalSince1970: value.expiresAt),
                    HTTPCookiePropertyKey("HttpOnly"): "TRUE"
                ]) { cookieStorage.setCookie(cookie) }
            }
            persistSession()
        } catch {
            sessionStorageError = Self.storageError
        }
    }

    private func savedCookie(_ cookie: HTTPCookie) -> NativeSavedCookie? {
        guard cookie.domain.trimmingCharacters(in: CharacterSet(charactersIn: ".")).lowercased() == "noctgram.com",
              cookie.path == "/", cookie.isSecure, let expires = cookie.expiresDate else { return nil }
        let value = NativeSavedCookie(name: cookie.name, value: cookie.value, expiresAt: expires.timeIntervalSince1970)
        return value.valid ? value : nil
    }

    private func captureCookies(_ response: HTTPURLResponse) {
        guard let url = response.url, NativeHTTPTransport.permits(url) else { return }
        let headers = response.allHeaderFields.reduce(into: [String: String]()) { result, item in
            if let name = item.key as? String { result[name] = String(describing: item.value) }
        }
        for cookie in HTTPCookie.cookies(withResponseHeaderFields: headers, for: url)
        where ["noct_session", "noct_email_challenge"].contains(cookie.name) {
            if cookie.value.isEmpty || (cookie.expiresDate ?? .distantPast) <= Date() {
                for old in cookieStorage.cookies ?? [] where old.name == cookie.name { cookieStorage.deleteCookie(old) }
            } else if savedCookie(cookie) != nil {
                cookieStorage.setCookie(cookie)
            }
        }
    }

    private func makeRequest(_ path: String, method: String, query: [String: String] = [:]) throws -> URLRequest {
        guard path.hasPrefix("/api/"), !path.contains("\\"), path.rangeOfCharacter(from: .controlCharacters) == nil,
              let url = URL(string: path, relativeTo: Self.origin)?.absoluteURL,
              NativeHTTPTransport.permits(url), url.fragment == nil,
              url.standardized.path.hasPrefix("/api/"),
              var parts = URLComponents(url: url, resolvingAgainstBaseURL: false) else {
            throw NoctAPIError(code: "UNSAFE_URL", message: "Запрос за пределы NoctGram запрещён.")
        }
        var items = parts.queryItems ?? []
        for key in query.keys.sorted() {
            items.removeAll { $0.name == key }
            items.append(URLQueryItem(name: key, value: query[key]))
        }
        parts.queryItems = items.isEmpty ? nil : items
        guard let destination = parts.url else {
            throw NoctAPIError(code: "INVALID_URL", message: "Некорректный адрес запроса.")
        }
        var request = URLRequest(url: destination, cachePolicy: .reloadIgnoringLocalCacheData)
        request.httpMethod = method
        request.setValue("https://noctgram.com", forHTTPHeaderField: "Origin")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue("no-store", forHTTPHeaderField: "Cache-Control")
        return request
    }

    private func json(_ path: String, method: String, query: [String: String] = [:], body: [String: Any]? = nil) async throws -> NGRecord {
        var request = try makeRequest(path, method: method, query: query)
        if let body = body {
            guard JSONSerialization.isValidJSONObject(body) else {
                throw NoctAPIError(code: "INVALID_BODY", message: "Не удалось подготовить запрос.")
            }
            request.httpBody = try JSONSerialization.data(withJSONObject: body)
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }
        let (data, response) = try await send(request, maxBytes: Self.jsonLimit)
        return try record(data, response: response)
    }

    private func send(_ request: URLRequest, maxBytes: Int) async throws -> (Data, HTTPURLResponse) {
        let started = generation
        var authenticatedRequest = request
        if let url = request.url {
            let fields = HTTPCookie.requestHeaderFields(with: cookieStorage.cookies(for: url) ?? [])
            for (name, value) in fields { authenticatedRequest.setValue(value, forHTTPHeaderField: name) }
        }
        do {
            let (data, response) = try await transport.send(authenticatedRequest, session: session, maxBytes: maxBytes)
            guard generation == started else { throw CancellationError() }
            captureCookies(response)
            if !(200...299).contains(response.statusCode) {
                let error = Self.apiError(data, response: response)
                let path = request.url?.path ?? ""
                if error.status == 401 && !["/api/auth/start", "/api/auth/verify"].contains(path) {
                    clearSession()
                    NotificationCenter.default.post(name: .noctSessionExpired, object: self)
                } else {
                    persistSession()
                }
                throw error
            }
            persistSession()
            if let error = sessionStorageError { throw error }
            return (data, response)
        } catch let error as NoctAPIError {
            throw error
        } catch {
            if generation != started || Task.isCancelled || (error as? URLError)?.code == .cancelled { throw CancellationError() }
            if (error as? URLError)?.code == .timedOut {
                throw NoctAPIError(code: "TIMEOUT", message: "Сервер не ответил вовремя. Повторите запрос.")
            }
            throw NoctAPIError(code: "NETWORK", message: "Не удалось подключиться к NoctGram. Проверьте интернет.")
        }
    }

    private func record(_ data: Data, response: HTTPURLResponse) throws -> NGRecord {
        if response.statusCode == 204 && data.isEmpty { return NGRecord([:]) }
        let mime = response.mimeType?.lowercased() ?? ""
        guard mime == "application/json" || mime.hasSuffix("+json"),
              let value = try? JSONSerialization.jsonObject(with: data) else {
            throw NoctAPIError(status: response.statusCode, code: "INVALID_RESPONSE", message: "Сервер вернул неожиданный ответ. Попробуйте позже.")
        }
        if let object = value as? [String: Any] { return NGRecord(object) }
        if let array = value as? [Any] { return NGRecord(["items": array]) }
        throw NoctAPIError(status: response.statusCode, code: "INVALID_RESPONSE", message: "Не удалось прочитать ответ NoctGram.")
    }

    private static func apiError(_ data: Data, response: HTTPURLResponse) -> NoctAPIError {
        let value = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] ?? [:]
        let record = NGRecord(value)
        let fallback = response.statusCode == 401 ? "Войдите в NoctGram, чтобы продолжить."
            : response.statusCode == 429 ? "Слишком много запросов. Подождите немного."
            : response.statusCode >= 500 ? "Сервер временно недоступен. Попробуйте позже."
            : "Не удалось выполнить запрос."
        let message = record.string("error", default: fallback)
        let code = record.string("code", default: "HTTP_\(response.statusCode)")
        let retry = Double(response.value(forHTTPHeaderField: "Retry-After") ?? "") ?? (record.double("retryAfter") > 0 ? record.double("retryAfter") : nil)
        return NoctAPIError(status: response.statusCode, code: String(code.prefix(100)), message: String(message.prefix(700)), retryAfter: retry)
    }
}

private struct NativeSavedCookie: Codable {
    let name: String
    let value: String
    let expiresAt: TimeInterval
    var valid: Bool {
        ["noct_session", "noct_email_challenge"].contains(name)
            && value.range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil
            && expiresAt.isFinite && expiresAt > Date().timeIntervalSince1970
    }
}

private struct NativeSessionKeychain {
    let service: String
    private var query: [String: Any] {
        [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service,
         kSecAttrAccount as String: "noctgram-native-cookie-session", kSecAttrSynchronizable as String: false]
    }
    func read() throws -> Data? {
        var request = query
        request[kSecReturnData as String] = true
        request[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?
        let status = SecItemCopyMatching(request as CFDictionary, &result)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess, let data = result as? Data else {
            throw KeychainFailure(status: status == errSecSuccess ? errSecDecode : status)
        }
        return data
    }
    func save(_ data: Data) throws {
        let values: [String: Any] = [kSecValueData as String: data,
                                    kSecAttrAccessible as String: kSecAttrAccessibleWhenUnlockedThisDeviceOnly]
        var status = SecItemUpdate(query as CFDictionary, values as CFDictionary)
        if status == errSecItemNotFound {
            var item = query
            values.forEach { item[$0.key] = $0.value }
            status = SecItemAdd(item as CFDictionary, nil)
        }
        guard status == errSecSuccess else { throw KeychainFailure(status: status) }
    }
    func remove() throws {
        let status = SecItemDelete(query as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else { throw KeychainFailure(status: status) }
    }
    private struct KeychainFailure: Error {
        init(status: OSStatus) {
            #if DEBUG
            // Numeric status only: never log the query, account, cookie or stored data.
            NSLog("NoctGram Keychain failure (OSStatus %d)", status)
            #endif
        }
    }
}

/// Bounded streaming prevents a huge/error response from being buffered before applying the limit.
final class NativeHTTPTransport: NSObject, URLSessionDataDelegate, @unchecked Sendable {
    private final class Pending {
        let continuation: CheckedContinuation<(Data, HTTPURLResponse), Error>
        let maxBytes: Int
        var response: HTTPURLResponse?
        var data = Data()
        init(_ continuation: CheckedContinuation<(Data, HTTPURLResponse), Error>, maxBytes: Int) {
            self.continuation = continuation
            self.maxBytes = maxBytes
        }
    }
    private let lock = NSLock()
    private var pending: [Int: Pending] = [:]

    static func permits(_ url: URL?) -> Bool {
        guard let url = url else { return false }
        return url.scheme?.lowercased() == "https" && url.host?.lowercased() == "noctgram.com"
            && (url.port == nil || url.port == 443) && url.user == nil && url.password == nil
    }

    func send(_ request: URLRequest, session: URLSession, maxBytes: Int) async throws -> (Data, HTTPURLResponse) {
        let cancellation = NativeTaskCancellation()
        return try await withTaskCancellationHandler(operation: {
            try await withCheckedThrowingContinuation { continuation in
                let task = session.dataTask(with: request)
                lock.lock()
                pending[task.taskIdentifier] = Pending(continuation, maxBytes: maxBytes)
                lock.unlock()
                cancellation.install(task)
                task.resume()
            }
        }, onCancel: { cancellation.cancel() })
    }

    private func finish(_ task: URLSessionTask, _ result: Result<(Data, HTTPURLResponse), Error>) {
        lock.lock()
        let item = pending.removeValue(forKey: task.taskIdentifier)
        lock.unlock()
        item?.continuation.resume(with: result)
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive response: URLResponse,
                    completionHandler: @escaping (URLSession.ResponseDisposition) -> Void) {
        guard let http = response as? HTTPURLResponse, Self.permits(http.url) else {
            finish(dataTask, .failure(NoctAPIError(code: "UNSAFE_RESPONSE", message: "Не удалось проверить источник ответа.")))
            completionHandler(.cancel)
            return
        }
        lock.lock()
        let item = pending[dataTask.taskIdentifier]
        let tooLarge = item.map { response.expectedContentLength > Int64($0.maxBytes) } ?? false
        item?.response = http
        lock.unlock()
        if tooLarge {
            finish(dataTask, .failure(Self.tooLarge))
            completionHandler(.cancel)
        } else { completionHandler(item == nil ? .cancel : .allow) }
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
        lock.lock()
        let item = pending[dataTask.taskIdentifier]
        let tooLarge = item.map { data.count > $0.maxBytes || $0.data.count > $0.maxBytes - data.count } ?? false
        if !tooLarge { item?.data.append(data) }
        lock.unlock()
        if tooLarge {
            finish(dataTask, .failure(Self.tooLarge))
            dataTask.cancel()
        }
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        if let error = error { finish(task, .failure(error)); return }
        lock.lock()
        let item = pending[task.taskIdentifier]
        let response = item?.response
        let data = item?.data
        lock.unlock()
        if let response = response, let data = data { finish(task, .success((data, response))) }
        else { finish(task, .failure(NoctAPIError(code: "INVALID_RESPONSE", message: "Сервер не вернул ответ."))) }
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
        guard Self.permits(request.url) else {
            finish(task, .failure(NoctAPIError(status: response.statusCode, code: "UNSAFE_REDIRECT", message: "Переход за пределы NoctGram запрещён.")))
            completionHandler(nil)
            task.cancel()
            return
        }
        completionHandler(request)
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, willCacheResponse proposedResponse: CachedURLResponse,
                    completionHandler: @escaping (CachedURLResponse?) -> Void) { completionHandler(nil) }

    private static var tooLarge: NoctAPIError {
        NoctAPIError(status: 413, code: "RESPONSE_TOO_LARGE", message: "Файл или ответ сервера превышает допустимый размер.")
    }
}

private final class NativeTaskCancellation: @unchecked Sendable {
    private let lock = NSLock()
    private var task: URLSessionTask?
    private var cancelled = false
    func install(_ task: URLSessionTask) {
        lock.lock()
        self.task = task
        let stop = cancelled
        lock.unlock()
        if stop { task.cancel() }
    }
    func cancel() {
        lock.lock()
        cancelled = true
        let current = task
        lock.unlock()
        current?.cancel()
    }
}

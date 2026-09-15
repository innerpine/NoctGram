import Foundation

/// Anonymous media has its own ephemeral transport: never cookies, credentials or a disk cache.
enum NativePublicMedia {
    static func download(_ url: URL, maxBytes: Int = 10 * 1024 * 1024,
                         configuration injected: URLSessionConfiguration? = nil) async throws -> Data {
        guard PublicMediaTransport.permits(url), maxBytes > 0, maxBytes <= 10 * 1024 * 1024 else {
            throw NoctAPIError(code: "UNSAFE_MEDIA_URL", message: "Не удалось проверить адрес изображения.")
        }
        try Task.checkCancellation()
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = injected?.protocolClasses
        configuration.httpCookieStorage = nil
        configuration.httpShouldSetCookies = false
        configuration.urlCredentialStorage = nil
        configuration.urlCache = nil
        configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
        configuration.timeoutIntervalForRequest = 20
        configuration.timeoutIntervalForResource = 40
        let transport = PublicMediaTransport(maxBytes: maxBytes)
        let session = URLSession(configuration: configuration, delegate: transport, delegateQueue: nil)
        defer { session.invalidateAndCancel() }
        do {
            let data = try await transport.send(PublicMediaTransport.request(url), session: session)
            try Task.checkCancellation()
            return data
        } catch {
            if Task.isCancelled || (error as? URLError)?.code == .cancelled { throw CancellationError() }
            throw error
        }
    }
}

private final class PublicMediaTransport: NSObject, URLSessionDataDelegate, @unchecked Sendable {
    private let lock = NSLock()
    private let maxBytes: Int
    private var continuation: CheckedContinuation<Data, Error>?
    private var data = Data()
    private var receivedResponse = false
    private var redirects = 0

    init(maxBytes: Int) { self.maxBytes = maxBytes }

    static func permits(_ url: URL?) -> Bool {
        guard let url = url else { return false }
        return url.scheme?.lowercased() == "https" && !(url.host ?? "").isEmpty
            && url.user == nil && url.password == nil
    }

    static func request(_ url: URL) -> URLRequest {
        var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 20)
        request.httpShouldHandleCookies = false
        request.setValue("image/*", forHTTPHeaderField: "Accept")
        request.setValue("no-store", forHTTPHeaderField: "Cache-Control")
        return request
    }

    func send(_ request: URLRequest, session: URLSession) async throws -> Data {
        let cancellation = PublicMediaCancellation()
        return try await withTaskCancellationHandler(operation: {
            try await withCheckedThrowingContinuation { continuation in
                let task = session.dataTask(with: request)
                lock.lock()
                self.continuation = continuation
                lock.unlock()
                cancellation.install(task)
                task.resume()
            }
        }, onCancel: { cancellation.cancel() })
    }

    private func finish(_ result: Result<Data, Error>) {
        lock.lock()
        let waiting = continuation
        continuation = nil
        data = Data()
        lock.unlock()
        waiting?.resume(with: result)
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive response: URLResponse,
                    completionHandler: @escaping (URLSession.ResponseDisposition) -> Void) {
        guard let http = response as? HTTPURLResponse, Self.permits(http.url), http.statusCode == 200 else {
            finish(.failure(NoctAPIError(code: "INVALID_MEDIA_RESPONSE", message: "Не удалось загрузить изображение.")))
            completionHandler(.cancel)
            return
        }
        guard response.expectedContentLength <= Int64(maxBytes) else {
            finish(.failure(Self.tooLarge))
            completionHandler(.cancel)
            return
        }
        lock.lock()
        receivedResponse = true
        let active = continuation != nil
        lock.unlock()
        completionHandler(active ? .allow : .cancel)
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive chunk: Data) {
        lock.lock()
        let active = continuation != nil
        let tooLarge = chunk.count > maxBytes || data.count > maxBytes - chunk.count
        if active && !tooLarge { data.append(chunk) }
        lock.unlock()
        if active && tooLarge {
            finish(.failure(Self.tooLarge))
            dataTask.cancel()
        }
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        if let error = error { finish(.failure(error)); return }
        lock.lock()
        let result = data
        let hasResponse = receivedResponse
        lock.unlock()
        if hasResponse { finish(.success(result)) }
        else { finish(.failure(NoctAPIError(code: "INVALID_MEDIA_RESPONSE", message: "Сервер не вернул изображение."))) }
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
        lock.lock()
        redirects += 1
        let withinLimit = redirects <= 5
        lock.unlock()
        guard withinLimit, let url = request.url, Self.permits(url) else {
            finish(.failure(NoctAPIError(code: "UNSAFE_MEDIA_REDIRECT", message: "Небезопасный переход при загрузке изображения.")))
            completionHandler(nil)
            task.cancel()
            return
        }
        // Rebuild rather than forward redirect headers, including any cookies or authorization.
        completionHandler(Self.request(url))
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didReceive challenge: URLAuthenticationChallenge,
                    completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void) {
        if challenge.protectionSpace.authenticationMethod == NSURLAuthenticationMethodServerTrust {
            completionHandler(.performDefaultHandling, nil)
        } else { completionHandler(.cancelAuthenticationChallenge, nil) }
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, willCacheResponse proposedResponse: CachedURLResponse,
                    completionHandler: @escaping (CachedURLResponse?) -> Void) { completionHandler(nil) }

    private static var tooLarge: NoctAPIError {
        NoctAPIError(status: 413, code: "MEDIA_TOO_LARGE", message: "Изображение превышает допустимый размер.")
    }
}

private final class PublicMediaCancellation: @unchecked Sendable {
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

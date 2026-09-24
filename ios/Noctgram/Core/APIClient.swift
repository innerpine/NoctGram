import Foundation

struct APIError: LocalizedError, Equatable {
    let status: Int
    let message: String
    let code: String?

    var errorDescription: String? { message }

    static let network = APIError(status: 0, message: "Нет соединения с Noctgram. Проверь интернет и попробуй ещё раз.", code: "NETWORK")
}

extension Notification.Name {
    /// The server no longer accepts this session (401).
    static let noctUnauthorized = Notification.Name("noct.unauthorized")
    /// The account exists but the first profile setup is unfinished (428).
    static let noctOnboardingRequired = Notification.Name("noct.onboardingRequired")
}

/// Talks to the same API as the web app. Authentication is the `noct_session`
/// HttpOnly cookie, kept by the shared cookie storage between launches.
/// POST requests carry `Origin`, which the server compares with its own origin.
final class APIClient: @unchecked Sendable {
    let baseURL: URL
    let session: URLSession

    init(baseURL: URL) {
        self.baseURL = baseURL
        let configuration = URLSessionConfiguration.default
        configuration.httpCookieStorage = HTTPCookieStorage.shared
        configuration.httpCookieAcceptPolicy = .always
        configuration.httpShouldSetCookies = true
        configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
        configuration.urlCache = nil
        configuration.timeoutIntervalForRequest = 30
        configuration.timeoutIntervalForResource = 180
        configuration.httpAdditionalHeaders = ["Accept-Language": "ru-RU,ru;q=0.9"]
        session = URLSession(configuration: configuration)
    }

    /// scheme://host[:port], exactly as `new URL(req.url).origin` on the server.
    var origin: String {
        let scheme = baseURL.scheme ?? "https"
        let host = baseURL.host ?? ""
        if let port = baseURL.port { return "\(scheme)://\(host):\(port)" }
        return "\(scheme)://\(host)"
    }

    func url(_ path: String, query: [String: String?] = [:]) -> URL {
        var components = URLComponents(url: baseURL, resolvingAgainstBaseURL: false) ?? URLComponents()
        components.path = path
        let items = query.compactMap { key, value in value.map { URLQueryItem(name: key, value: $0) } }
        components.queryItems = items.isEmpty ? nil : items.sorted { $0.name < $1.name }
        return components.url ?? baseURL
    }

    /// Avatars, covers and media are stored as "/api/media/<id>" or absolute URLs.
    func mediaURL(_ value: String?) -> URL? {
        guard let value, !value.isEmpty, value != "liquid" else { return nil }
        if value.hasPrefix("http://") || value.hasPrefix("https://") { return URL(string: value) }
        guard value.hasPrefix("/") else { return nil }
        return URL(string: value, relativeTo: baseURL)?.absoluteURL
    }

    /// A shareable web link for a post or profile.
    func webLink(_ query: [String: String]) -> URL {
        url("/", query: query.mapValues { Optional($0) })
    }

    // MARK: Requests

    func get(_ path: String, _ query: [String: String?] = [:]) async throws -> JSON {
        var request = URLRequest(url: url(path, query: query))
        request.httpMethod = "GET"
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        return try await perform(request)
    }

    func post(_ path: String, _ body: [String: Any]) async throws -> JSON {
        var request = URLRequest(url: url(path))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue(origin, forHTTPHeaderField: "Origin")
        request.httpBody = try JSONSerialization.data(withJSONObject: body, options: [])
        return try await perform(request)
    }

    /// One-file multipart upload (`/api/upload`, `/api/chat-upload`).
    func upload(_ path: String, data: Data, filename: String, mimeType: String, fields: [String: String] = [:]) async throws -> JSON {
        let boundary = "NoctgramBoundary\(UUID().uuidString.replacingOccurrences(of: "-", with: ""))"
        var body = Data()
        for (name, value) in fields {
            body.appendString("--\(boundary)\r\n")
            body.appendString("Content-Disposition: form-data; name=\"\(name)\"\r\n\r\n")
            body.appendString("\(value)\r\n")
        }
        let safeName = filename.replacingOccurrences(of: "\"", with: "")
        body.appendString("--\(boundary)\r\n")
        body.appendString("Content-Disposition: form-data; name=\"file\"; filename=\"\(safeName)\"\r\n")
        body.appendString("Content-Type: \(mimeType)\r\n\r\n")
        body.append(data)
        body.appendString("\r\n--\(boundary)--\r\n")

        var request = URLRequest(url: url(path))
        request.httpMethod = "POST"
        request.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue(origin, forHTTPHeaderField: "Origin")
        request.timeoutInterval = 180
        request.httpBody = body
        return try await perform(request)
    }

    // MARK: Social API shortcuts (app/api/social/route.ts)

    func social(_ action: String, _ query: [String: String?] = [:]) async throws -> JSON {
        var all = query
        all["action"] = action
        return try await get("/api/social", all)
    }

    func socialPost(_ action: String, _ body: [String: Any] = [:]) async throws -> JSON {
        var all = body
        all["action"] = action
        return try await post("/api/social", all)
    }

    private func perform(_ request: URLRequest) async throws -> JSON {
        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await session.data(for: request)
        } catch let error as URLError where error.code == .cancelled {
            throw CancellationError()
        } catch is CancellationError {
            throw CancellationError()
        } catch {
            throw APIError.network
        }
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        let json = JSON.parse(data) ?? .null
        if (200..<300).contains(status) {
            if json.isNull, !data.isEmpty {
                throw APIError(status: status, message: "Сервер вернул некорректный ответ. Попробуй ещё раз.", code: nil)
            }
            return json
        }
        let code = json["code"].string
        let message = json["error"].string ?? Self.fallback(status)
        if status == 401 {
            NotificationCenter.default.post(name: .noctUnauthorized, object: nil)
        } else if status == 428 || code == "ONBOARDING_REQUIRED" {
            NotificationCenter.default.post(name: .noctOnboardingRequired, object: nil)
        }
        throw APIError(status: status, message: message, code: code)
    }

    private static func fallback(_ status: Int) -> String {
        switch status {
        case 401: return "Войди в Noctgram, чтобы продолжить."
        case 403: return "Недостаточно прав для этого действия."
        case 404: return "Не найдено."
        case 413: return "Файл слишком большой. Максимум 25 МБ."
        case 429: return "Слишком много запросов. Подожди немного."
        case 500...599: return "Сервер временно недоступен. Попробуй позже."
        default: return "Не удалось выполнить запрос."
        }
    }
}

extension Data {
    mutating func appendString(_ string: String) {
        append(Data(string.utf8))
    }
}

extension Error {
    /// Text for the user; cancellations are silent.
    var userMessage: String? {
        if self is CancellationError { return nil }
        if let error = self as? APIError { return error.message }
        return localizedDescription
    }
}

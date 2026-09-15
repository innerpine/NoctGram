import UIKit
import WebKit
import SafariServices

final class WebViewController: UIViewController {
    private static let home = URL(string: "https://noctgram.com/")!
    private static let music = URL(string: "https://noctgram.com/music/services")!
    private let accent = UIColor(red: 0.78, green: 0.68, blue: 0.91, alpha: 1)
    private var webView: WKWebView!
    private let progress = UIProgressView(progressViewStyle: .bar)
    private let errorPanel = UIView()
    private let errorMessage = UILabel()
    private let spinner = UIActivityIndicatorView(style: .large)
    private let authBar = UIStackView()
    private let authLabel = UILabel()
    private let noticeLabel = UILabel()
    private var observations: [NSKeyValueObservation] = []
    private var noticeWork: DispatchWorkItem?
    private var retryURL = WebViewController.home
    private var activeOAuth: MusicOAuth?
    private var downloads: [ObjectIdentifier: WKDownload] = [:]
    private var downloadFiles: [ObjectIdentifier: URL] = [:]
    private var shareQueue: [URL] = []

    private enum MusicOAuth: String {
        case spotify, soundcloud

        var title: String { self == .spotify ? "Spotify" : "SoundCloud" }
        var entryHost: String { self == .spotify ? "accounts.spotify.com" : "secure.soundcloud.com" }
        var hosts: Set<String> {
            self == .spotify ? ["accounts.spotify.com"] : ["secure.soundcloud.com", "soundcloud.com"]
        }

        static func beginning(at url: URL) -> MusicOAuth? {
            guard WebViewController.isHTTPS(url), url.path == "/authorize",
                  let provider = [Self.spotify, .soundcloud].first(where: { $0.entryHost == url.host?.lowercased() }),
                  let items = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems else { return nil }
            func value(_ name: String) -> String? {
                let matches = items.filter { $0.name == name }
                return matches.count == 1 ? matches[0].value : nil
            }
            // Match the existing server-issued PKCE flow. No tokens or cookies cross into Safari.
            guard value("redirect_uri") == "https://noctgram.com/api/music/services/\(provider.rawValue)/callback",
                  value("response_type") == "code", value("code_challenge_method") == "S256",
                  value("state")?.range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil,
                  value("code_challenge")?.range(of: "^[A-Za-z0-9_-]{43}$", options: .regularExpression) != nil else { return nil }
            return provider
        }
    }

    override var preferredStatusBarStyle: UIStatusBarStyle { .lightContent }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .black
        overrideUserInterfaceStyle = .dark
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .default()
        configuration.allowsInlineMediaPlayback = true
        configuration.allowsAirPlayForMediaPlayback = true
        configuration.allowsPictureInPictureMediaPlayback = true
        configuration.applicationNameForUserAgent = "NoctGram-iOS"
        webView = WKWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.allowsBackForwardNavigationGestures = true
        webView.isOpaque = false
        webView.backgroundColor = .black
        webView.scrollView.backgroundColor = .black
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        configureLayout()
        observations = [
            webView.observe(\.estimatedProgress, options: [.new]) { [weak self] webView, _ in
                let value = Float(webView.estimatedProgress)
                DispatchQueue.main.async { self?.progress.setProgress(value, animated: true) }
            },
            webView.observe(\.isLoading, options: [.new]) { [weak self] webView, _ in
                let loading = webView.isLoading
                DispatchQueue.main.async {
                    self?.progress.isHidden = !loading
                    if !loading { self?.spinner.stopAnimating() }
                }
            }
        ]
        spinner.startAnimating()
        webView.load(URLRequest(url: Self.home))
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        presentNextDownload()
    }

    private func configureLayout() {
        authBar.axis = .horizontal
        authBar.alignment = .center
        authBar.spacing = 12
        authBar.isLayoutMarginsRelativeArrangement = true
        authBar.directionalLayoutMargins = NSDirectionalEdgeInsets(top: 4, leading: 16, bottom: 4, trailing: 8)
        authBar.backgroundColor = UIColor(white: 0.07, alpha: 1)
        authBar.isHidden = true
        authLabel.font = .preferredFont(forTextStyle: .subheadline)
        authLabel.adjustsFontForContentSizeCategory = true
        authLabel.numberOfLines = 2
        let closeAuth = UIButton(type: .system)
        closeAuth.setImage(UIImage(systemName: "xmark"), for: .normal)
        closeAuth.tintColor = accent
        closeAuth.accessibilityLabel = "Отменить подключение музыки"
        closeAuth.addTarget(self, action: #selector(closeMusicLogin), for: .touchUpInside)
        closeAuth.widthAnchor.constraint(equalToConstant: 44).isActive = true
        closeAuth.heightAnchor.constraint(greaterThanOrEqualToConstant: 44).isActive = true
        authBar.addArrangedSubview(authLabel)
        authBar.addArrangedSubview(closeAuth)
        let content = UIStackView(arrangedSubviews: [authBar, webView])
        content.axis = .vertical
        content.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(content)
        let safe = view.safeAreaLayoutGuide
        NSLayoutConstraint.activate([
            content.topAnchor.constraint(equalTo: safe.topAnchor),
            content.leadingAnchor.constraint(equalTo: safe.leadingAnchor),
            content.trailingAnchor.constraint(equalTo: safe.trailingAnchor),
            content.bottomAnchor.constraint(equalTo: safe.bottomAnchor)
        ])
        progress.progressTintColor = accent
        progress.trackTintColor = .clear
        progress.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(progress)
        NSLayoutConstraint.activate([
            progress.topAnchor.constraint(equalTo: webView.topAnchor),
            progress.leadingAnchor.constraint(equalTo: webView.leadingAnchor),
            progress.trailingAnchor.constraint(equalTo: webView.trailingAnchor)
        ])
        spinner.color = accent
        spinner.hidesWhenStopped = true
        spinner.accessibilityLabel = "Загрузка NoctGram"
        spinner.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(spinner)
        NSLayoutConstraint.activate([
            spinner.centerXAnchor.constraint(equalTo: webView.centerXAnchor),
            spinner.centerYAnchor.constraint(equalTo: webView.centerYAnchor)
        ])
        configureErrorPanel()
        noticeLabel.backgroundColor = UIColor(white: 0.14, alpha: 0.98)
        noticeLabel.textColor = .white
        noticeLabel.font = .preferredFont(forTextStyle: .subheadline)
        noticeLabel.adjustsFontForContentSizeCategory = true
        noticeLabel.textAlignment = .center
        noticeLabel.numberOfLines = 0
        noticeLabel.layer.cornerRadius = 14
        noticeLabel.clipsToBounds = true
        noticeLabel.isHidden = true
        noticeLabel.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(noticeLabel)
        NSLayoutConstraint.activate([
            noticeLabel.topAnchor.constraint(equalTo: safe.topAnchor, constant: 12),
            noticeLabel.centerXAnchor.constraint(equalTo: safe.centerXAnchor),
            noticeLabel.widthAnchor.constraint(lessThanOrEqualTo: safe.widthAnchor, constant: -32),
            noticeLabel.widthAnchor.constraint(lessThanOrEqualToConstant: 420),
            noticeLabel.heightAnchor.constraint(greaterThanOrEqualToConstant: 48)
        ])
    }

    private func configureErrorPanel() {
        errorPanel.backgroundColor = .black
        errorPanel.translatesAutoresizingMaskIntoConstraints = false
        errorPanel.isHidden = true
        view.addSubview(errorPanel)
        NSLayoutConstraint.activate([
            errorPanel.topAnchor.constraint(equalTo: webView.topAnchor),
            errorPanel.leadingAnchor.constraint(equalTo: webView.leadingAnchor),
            errorPanel.trailingAnchor.constraint(equalTo: webView.trailingAnchor),
            errorPanel.bottomAnchor.constraint(equalTo: webView.bottomAnchor)
        ])
        let icon = UIImageView(image: UIImage(systemName: "wifi.exclamationmark"))
        icon.tintColor = accent
        icon.contentMode = .scaleAspectFit
        icon.heightAnchor.constraint(equalToConstant: 44).isActive = true
        icon.isAccessibilityElement = false
        let title = UILabel()
        title.text = "Не удалось открыть NoctGram"
        title.font = .preferredFont(forTextStyle: .title2)
        title.adjustsFontForContentSizeCategory = true
        title.textAlignment = .center
        title.numberOfLines = 0
        errorMessage.textColor = .secondaryLabel
        errorMessage.font = .preferredFont(forTextStyle: .body)
        errorMessage.adjustsFontForContentSizeCategory = true
        errorMessage.textAlignment = .center
        errorMessage.numberOfLines = 0
        var style = UIButton.Configuration.filled()
        style.title = "Повторить"
        style.baseBackgroundColor = accent
        style.baseForegroundColor = .black
        style.cornerStyle = .capsule
        style.contentInsets = NSDirectionalEdgeInsets(top: 14, leading: 28, bottom: 14, trailing: 28)
        let retry = UIButton(configuration: style)
        retry.addTarget(self, action: #selector(retryLoading), for: .touchUpInside)
        let home = UIButton(type: .system)
        home.setTitle("На главную", for: .normal)
        home.tintColor = accent
        home.heightAnchor.constraint(greaterThanOrEqualToConstant: 44).isActive = true
        home.addTarget(self, action: #selector(goHome), for: .touchUpInside)
        let stack = UIStackView(arrangedSubviews: [icon, title, errorMessage, retry, home])
        stack.axis = .vertical
        stack.spacing = 18
        stack.translatesAutoresizingMaskIntoConstraints = false
        errorPanel.addSubview(stack)
        NSLayoutConstraint.activate([
            stack.centerXAnchor.constraint(equalTo: errorPanel.centerXAnchor),
            stack.centerYAnchor.constraint(equalTo: errorPanel.centerYAnchor),
            stack.widthAnchor.constraint(lessThanOrEqualToConstant: 360),
            stack.leadingAnchor.constraint(greaterThanOrEqualTo: errorPanel.leadingAnchor, constant: 28),
            stack.trailingAnchor.constraint(lessThanOrEqualTo: errorPanel.trailingAnchor, constant: -28)
        ])
    }

    @objc private func retryLoading() {
        errorPanel.isHidden = true
        spinner.startAnimating()
        // Reopen with GET; never replay an interrupted POST such as a purchase.
        webView.load(URLRequest(url: retryURL))
    }

    @objc private func goHome() {
        activeOAuth = nil
        authBar.isHidden = true
        retryURL = Self.home
        retryLoading()
    }

    @objc private func closeMusicLogin() {
        activeOAuth = nil
        authBar.isHidden = true
        retryURL = Self.music
        retryLoading()
    }

    private func showError(_ message: String) {
        spinner.stopAnimating()
        progress.isHidden = true
        errorMessage.text = message
        errorPanel.isHidden = false
        UIAccessibility.post(notification: .screenChanged, argument: errorMessage)
    }

    private func showNotice(_ message: String) {
        noticeWork?.cancel()
        noticeLabel.text = "  \(message)  "
        noticeLabel.isHidden = false
        UIAccessibility.post(notification: .announcement, argument: message)
        let work = DispatchWorkItem { [weak self] in self?.noticeLabel.isHidden = true }
        noticeWork = work
        DispatchQueue.main.asyncAfter(deadline: .now() + 5, execute: work)
    }

    private static func isHTTPS(_ url: URL) -> Bool {
        url.scheme?.lowercased() == "https" && url.user == nil && url.password == nil && (url.port == nil || url.port == 443)
    }

    private static func isTrusted(_ url: URL?) -> Bool {
        guard let url = url else { return false }
        return isHTTPS(url) && url.host?.lowercased() == "noctgram.com"
    }

    private static func isTrusted(_ origin: WKSecurityOrigin) -> Bool {
        origin.protocol.lowercased() == "https" && origin.host.lowercased() == "noctgram.com" && [0, 443].contains(origin.port)
    }

    private static func isTrustedBlob(_ url: URL) -> Bool {
        guard url.scheme?.lowercased() == "blob" else { return false }
        return isTrusted(URL(string: String(url.absoluteString.dropFirst(5))))
    }

    private func allowedOAuth(_ url: URL) -> Bool {
        guard let provider = activeOAuth else { return false }
        return Self.isHTTPS(url) && provider.hosts.contains(url.host?.lowercased() ?? "")
    }

    private func accept(_ action: WKNavigationAction, decision: (WKNavigationActionPolicy) -> Void) {
        if let url = action.request.url { retryURL = url }
        if action.targetFrame == nil {
            decision(.cancel)
            webView.load(action.request)
        } else {
            decision(.allow)
        }
    }

    private func openExternal(_ url: URL) {
        guard url.user == nil && url.password == nil, let scheme = url.scheme?.lowercased() else { return }
        if ["https", "http"].contains(scheme), let host = url.host, !host.isEmpty {
            if host.lowercased() == "t.me" || host.lowercased() == "telegram.me" {
                openSystem(url)
            } else if presentedViewController == nil {
                let browser = SFSafariViewController(url: url)
                browser.delegate = self
                browser.preferredBarTintColor = .black
                browser.preferredControlTintColor = accent
                present(browser, animated: true)
            }
        } else if ["tg", "mailto", "tel"].contains(scheme) {
            openSystem(url)
        } else {
            showNotice("Этот тип ссылки не поддерживается.")
        }
    }

    private func openSystem(_ url: URL) {
        UIApplication.shared.open(url, options: [:]) { [weak self] opened in
            if !opened { self?.showNotice("Не удалось открыть ссылку. Проверьте, установлено ли нужное приложение.") }
        }
    }
}

extension WebViewController: WKNavigationDelegate {
    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = action.request.url else { decisionHandler(.cancel); return }
        let mainFrame = action.targetFrame?.isMainFrame != false
        let trustedSource = Self.isTrusted(action.sourceFrame.securityOrigin)
        if action.shouldPerformDownload {
            decisionHandler(trustedSource && (Self.isTrusted(url) || Self.isTrustedBlob(url)) ? .download : .cancel)
            return
        }
        // Embedded players may use HTTPS frames, but receive no native bridge or device permissions.
        if !mainFrame {
            decisionHandler(Self.isHTTPS(url) || url.absoluteString == "about:blank" || Self.isTrustedBlob(url) ? .allow : .cancel)
            return
        }
        if Self.isTrusted(url) {
            accept(action, decision: decisionHandler)
            return
        }
        if action.sourceFrame.isMainFrame && trustedSource, let provider = MusicOAuth.beginning(at: url) {
            activeOAuth = provider
            authLabel.text = "\(provider.title) · \(provider.entryHost)"
            authBar.isHidden = false
            accept(action, decision: decisionHandler)
            return
        }
        if allowedOAuth(url) {
            authLabel.text = "\(activeOAuth!.title) · \(url.host ?? "")"
            accept(action, decision: decisionHandler)
            return
        }
        if trustedSource && Self.isTrustedBlob(url) {
            accept(action, decision: decisionHandler)
            return
        }
        decisionHandler(.cancel)
        guard action.sourceFrame.isMainFrame || action.navigationType == .linkActivated else { return }
        if activeOAuth != nil && action.navigationType != .linkActivated {
            showNotice("Этот способ входа требует другого браузера. Попробуйте вход по email на странице сервиса.")
            return
        }
        guard trustedSource || action.navigationType == .linkActivated else { return }
        openExternal(url)
    }

    func webView(_ webView: WKWebView, decidePolicyFor response: WKNavigationResponse, decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void) {
        if let http = response.response as? HTTPURLResponse, http.statusCode >= 500, response.isForMainFrame {
            decisionHandler(.cancel)
            showError("Сервер временно недоступен. Попробуйте ещё раз чуть позже.")
            return
        }
        let disposition = (response.response as? HTTPURLResponse)?.value(forHTTPHeaderField: "Content-Disposition")?.lowercased() ?? ""
        if !response.canShowMIMEType || disposition.hasPrefix("attachment") {
            decisionHandler(Self.isTrusted(response.response.url) ? .download : .cancel)
        } else {
            decisionHandler(.allow)
        }
    }

    func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
        errorPanel.isHidden = true
        progress.setProgress(0, animated: false)
        progress.isHidden = false
    }

    func webView(_ webView: WKWebView, didCommit navigation: WKNavigation!) {
        if Self.isTrusted(webView.url) {
            activeOAuth = nil
            authBar.isHidden = true
        }
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        spinner.stopAnimating()
        progress.isHidden = true
        presentNextDownload()
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) { navigationFailed(error) }
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) { navigationFailed(error) }

    private func navigationFailed(_ error: Error) {
        let failure = error as NSError
        if failure.domain == NSURLErrorDomain && failure.code == NSURLErrorCancelled { return }
        showError("Проверьте подключение к интернету и попробуйте снова.")
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        showError("Страница была остановлена системой. Нажмите «Повторить», чтобы открыть её снова.")
    }

    func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) { track(download) }
    func webView(_ webView: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) { track(download) }
}

extension WebViewController: WKUIDelegate {
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        guard action.targetFrame == nil, let url = action.request.url else { return nil }
        if Self.isTrusted(url) || allowedOAuth(url) { webView.load(action.request) }
        else if Self.isTrusted(action.sourceFrame.securityOrigin) { openExternal(url) }
        return nil
    }

    func webView(_ webView: WKWebView, requestMediaCapturePermissionFor origin: WKSecurityOrigin, initiatedByFrame frame: WKFrameInfo, type: WKMediaCaptureType, decisionHandler: @escaping (WKPermissionDecision) -> Void) {
        let trusted = Self.isTrusted(origin) && Self.isTrusted(frame.securityOrigin) && Self.isTrusted(webView.url)
        decisionHandler(trusted ? .prompt : .deny)
    }

    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
        guard presentedViewController == nil, view.window != nil else { completionHandler(); return }
        let alert = UIAlertController(title: frame.securityOrigin.host, message: String(message.prefix(2000)), preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "Хорошо", style: .default) { [weak self] _ in
            completionHandler()
            self?.presentNextDownloadSoon()
        })
        present(alert, animated: true)
    }

    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
        guard presentedViewController == nil, view.window != nil else { completionHandler(false); return }
        let alert = UIAlertController(title: frame.securityOrigin.host, message: String(message.prefix(2000)), preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "Отмена", style: .cancel) { [weak self] _ in completionHandler(false); self?.presentNextDownloadSoon() })
        alert.addAction(UIAlertAction(title: "Продолжить", style: .default) { [weak self] _ in completionHandler(true); self?.presentNextDownloadSoon() })
        present(alert, animated: true)
    }

    func webView(_ webView: WKWebView, runJavaScriptTextInputPanelWithPrompt prompt: String, defaultText: String?, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (String?) -> Void) {
        guard presentedViewController == nil, view.window != nil else { completionHandler(nil); return }
        let alert = UIAlertController(title: frame.securityOrigin.host, message: String(prompt.prefix(2000)), preferredStyle: .alert)
        alert.addTextField { $0.text = defaultText }
        alert.addAction(UIAlertAction(title: "Отмена", style: .cancel) { [weak self] _ in completionHandler(nil); self?.presentNextDownloadSoon() })
        alert.addAction(UIAlertAction(title: "Готово", style: .default) { [weak self, weak alert] _ in
            completionHandler(alert?.textFields?.first?.text)
            self?.presentNextDownloadSoon()
        })
        present(alert, animated: true)
    }
}

extension WebViewController: WKDownloadDelegate {
    private func track(_ download: WKDownload) {
        downloads[ObjectIdentifier(download)] = download
        download.delegate = self
        showNotice("Загружаем файл…")
    }

    func download(_ download: WKDownload, decideDestinationUsing response: URLResponse, suggestedFilename: String, completionHandler: @escaping (URL?) -> Void) {
        if let http = response as? HTTPURLResponse, !(200...299).contains(http.statusCode) {
            completionHandler(nil)
            return
        }
        if let url = response.url, !Self.isTrusted(url) && !Self.isTrustedBlob(url) {
            completionHandler(nil)
            return
        }
        var name = suggestedFilename.replacingOccurrences(of: "\\", with: "/")
        name = (name as NSString).lastPathComponent.components(separatedBy: .controlCharacters).joined()
        name = name.trimmingCharacters(in: .whitespacesAndNewlines)
        while name.utf8.count > 180 { name.removeLast() }
        if name.isEmpty || name.hasPrefix(".") { name = "NoctGram-файл" }
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("NoctGramDownloads", isDirectory: true)
            .appendingPathComponent(UUID().uuidString, isDirectory: true)
        do {
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true, attributes: [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication])
            let file = directory.appendingPathComponent(name)
            downloadFiles[ObjectIdentifier(download)] = file
            completionHandler(file)
        } catch {
            completionHandler(nil)
        }
    }

    func download(_ download: WKDownload, willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest, decisionHandler: @escaping (WKDownload.RedirectPolicy) -> Void) {
        // Attachments are served by NoctGram; do not carry a private download to another origin.
        decisionHandler(Self.isTrusted(request.url) ? .allow : .cancel)
    }

    func downloadDidFinish(_ download: WKDownload) {
        let key = ObjectIdentifier(download)
        downloads.removeValue(forKey: key)
        guard let file = downloadFiles.removeValue(forKey: key) else { return }
        shareQueue.append(file)
        presentNextDownload()
    }

    func download(_ download: WKDownload, didFailWithError error: Error, resumeData: Data?) {
        let key = ObjectIdentifier(download)
        downloads.removeValue(forKey: key)
        if let file = downloadFiles.removeValue(forKey: key) { removeTemporaryDownload(file) }
        showNotice("Не удалось скачать файл. Попробуйте ещё раз.")
    }

    private func presentNextDownload() {
        guard viewIfLoaded?.window != nil, presentedViewController == nil, !shareQueue.isEmpty else { return }
        let file = shareQueue.removeFirst()
        let sheet = UIActivityViewController(activityItems: [file], applicationActivities: nil)
        sheet.popoverPresentationController?.sourceView = view
        sheet.popoverPresentationController?.sourceRect = CGRect(x: view.bounds.midX, y: view.bounds.maxY - view.safeAreaInsets.bottom, width: 1, height: 1)
        sheet.completionWithItemsHandler = { [weak self] _, _, _, _ in
            self?.removeTemporaryDownload(file)
            self?.presentNextDownloadSoon()
        }
        noticeWork?.cancel()
        noticeLabel.isHidden = true
        present(sheet, animated: true)
    }

    private func presentNextDownloadSoon() {
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { [weak self] in self?.presentNextDownload() }
    }

    private func removeTemporaryDownload(_ file: URL) {
        // Only URLs created above enter this queue; each download has its own UUID directory.
        try? FileManager.default.removeItem(at: file.deletingLastPathComponent())
    }
}

extension WebViewController: SFSafariViewControllerDelegate {
    func safariViewControllerDidFinish(_ controller: SFSafariViewController) { presentNextDownloadSoon() }
}

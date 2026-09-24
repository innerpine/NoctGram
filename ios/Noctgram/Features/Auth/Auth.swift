import PhotosUI
import SwiftUI
import UIKit
import UniformTypeIdentifiers
import WebKit

/// Email code login (app/auth-screen.tsx): one step per screen — the address,
/// then six digits from the letter. The server sets the noct_session cookie.
struct LoginView: View {
    @EnvironmentObject private var session: AppSession
    @State private var email = ""
    @State private var code = ""
    @State private var step = Step.email
    @State private var busy = false
    @State private var error: String?
    @State private var resendAt: Date?
    @State private var emailEnabled = true
    @State private var showServer = false
    @State private var showWebLogin = false
    @State private var now = Date()
    @FocusState private var focus: Field?

    private enum Step { case email, code }
    private enum Field { case email, code }
    private let timer = Timer.publish(every: 1, on: .main, in: .common).autoconnect()

    var body: some View {
        ScrollView {
            VStack(spacing: 0) {
                Spacer(minLength: 60)
                Image("Logo")
                    .resizable()
                    .scaledToFit()
                    .frame(width: 78, height: 78)
                Text("noctgram")
                    .font(.system(size: 34, weight: .semibold))
                    .tracking(-1.2)
                    .padding(.top, 10)
                Text(step == .email ? "Место для тех, кто на своей волне." : "Код отправлен на \(email)")
                    .font(.system(size: 15))
                    .foregroundColor(Noct.text60)
                    .multilineTextAlignment(.center)
                    .padding(.top, 8)
                    .padding(.horizontal, 24)

                Group {
                    if step == .email { emailStep } else { codeStep }
                }
                .padding(.top, 32)
                .transition(.asymmetric(insertion: .move(edge: .trailing).combined(with: .opacity), removal: .opacity))

                if let error {
                    Text(error)
                        .font(.system(size: 14))
                        .foregroundColor(Noct.red)
                        .multilineTextAlignment(.center)
                        .padding(.top, 14)
                        .padding(.horizontal, 12)
                }

                VStack(spacing: 12) {
                    Button {
                        showWebLogin = true
                    } label: {
                        Label("Войти через сайт", systemImage: "globe")
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(SecondaryButtonStyle())
                    Button {
                        showServer = true
                    } label: {
                        Text("Сервер: \(session.serverLabel) · изменить")
                            .font(.system(size: 13))
                            .foregroundColor(Noct.text48)
                    }
                }
                .padding(.top, 40)
                Spacer(minLength: 30)
            }
            .padding(.horizontal, 24)
            .frame(maxWidth: 460)
            .frame(maxWidth: .infinity)
        }
        .scrollDismissesKeyboard(.interactively)
        .background(Noct.background.ignoresSafeArea())
        .animation(Noct.motion, value: step)
        .onReceive(timer) { now = $0 }
        .sheet(isPresented: $showServer) {
            ServerSheet().environmentObject(session)
        }
        .sheet(isPresented: $showWebLogin) {
            WebLoginView().environmentObject(session)
        }
        .task { await loadStatus() }
    }

    private var emailStep: some View {
        VStack(spacing: 14) {
            TextField("Электронная почта", text: $email)
                .keyboardType(.emailAddress)
                .textContentType(.emailAddress)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .font(.system(size: 17))
                .focused($focus, equals: .email)
                .submitLabel(.continue)
                .onSubmit { Task { await start() } }
                .noctField()
            Button {
                Task { await start() }
            } label: {
                HStack {
                    if busy { ProgressView().tint(.black) }
                    Text("Получить код")
                }
                .frame(maxWidth: .infinity)
            }
            .buttonStyle(PrimaryButtonStyle())
            .disabled(busy || !email.contains("@") || !emailEnabled)
            if !emailEnabled {
                Text("На этом сервере вход по почте ещё не подключён. Используй вход через сайт.")
                    .font(.system(size: 13))
                    .foregroundColor(Noct.text48)
                    .multilineTextAlignment(.center)
            }
        }
    }

    private var codeStep: some View {
        VStack(spacing: 18) {
            ZStack {
                TextField("", text: Binding(
                    get: { code },
                    set: { value in
                        code = String(value.filter(\.isNumber).prefix(6))
                        if code.count == 6 { Task { await verify() } }
                    }
                ))
                .keyboardType(.numberPad)
                .textContentType(.oneTimeCode)
                .focused($focus, equals: .code)
                .foregroundColor(.clear)
                .tint(.clear)
                .accentColor(.clear)
                HStack(spacing: 8) {
                    ForEach(0..<6, id: \.self) { index in
                        let characters = Array(code)
                        Text(index < characters.count ? String(characters[index]) : "")
                            .font(.system(size: 24, weight: .semibold, design: .rounded))
                            .frame(width: 46, height: 56)
                            .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Color(hex: 0x111113)))
                            .overlay(
                                RoundedRectangle(cornerRadius: 12, style: .continuous)
                                    .stroke(index == characters.count && focus == .code ? Color.white.opacity(0.6) : Noct.borderStrong, lineWidth: 1)
                            )
                    }
                }
                .allowsHitTesting(false)
            }
            .contentShape(Rectangle())
            .onTapGesture { focus = .code }

            Button {
                Task { await verify() }
            } label: {
                HStack {
                    if busy { ProgressView().tint(.black) }
                    Text("Войти")
                }
                .frame(maxWidth: .infinity)
            }
            .buttonStyle(PrimaryButtonStyle())
            .disabled(busy || code.count != 6)

            HStack(spacing: 16) {
                Button("Изменить почту") {
                    code = ""
                    error = nil
                    step = .email
                    focus = .email
                }
                if let resendAt, resendAt > now {
                    Text("Повторно через \(Int(resendAt.timeIntervalSince(now)) + 1) с")
                        .foregroundColor(Noct.text48)
                } else {
                    Button("Отправить ещё раз") { Task { await start() } }
                        .disabled(busy)
                }
            }
            .font(.system(size: 14, weight: .medium))
            .foregroundColor(Noct.text75)
        }
        .onAppear { focus = .code }
    }

    private func loadStatus() async {
        guard let data = try? await session.api.get("/api/auth/session") else { return }
        let status = AuthStatus(data)
        emailEnabled = status.emailEnabled
        if status.user != nil {
            await session.signedIn()
        } else if let pending = status.challengeEmail {
            email = pending
            resendAt = Date(timeIntervalSince1970: status.resendAt / 1000)
            step = .code
        } else {
            focus = .email
        }
    }

    private func start() async {
        let address = email.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !busy, address.contains("@") else { return }
        busy = true
        error = nil
        defer { busy = false }
        do {
            let data = try await session.api.post("/api/auth/start", ["email": address])
            email = address
            code = ""
            resendAt = Date(timeIntervalSince1970: (data["resendAt"].double ?? Format.nowMs + 60000) / 1000)
            step = .code
            focus = .code
        } catch let failure as APIError where failure.code == "EMAIL_NOT_CONFIGURED" {
            emailEnabled = false
            error = failure.message
        } catch {
            self.error = error.userMessage
        }
    }

    private func verify() async {
        guard !busy, code.count == 6 else { return }
        busy = true
        error = nil
        defer { busy = false }
        do {
            _ = try await session.api.post("/api/auth/verify", ["code": code])
            Haptics.success()
            await session.signedIn()
        } catch let failure as APIError {
            code = ""
            error = failure.message
            Haptics.error()
            if failure.code == "CODE_EXPIRED" { step = .email }
        } catch {
            self.error = error.userMessage
        }
    }
}

/// First profile setup (/welcome): name, username and an optional avatar.
struct OnboardingView: View {
    @EnvironmentObject private var session: AppSession
    @State private var name = ""
    @State private var handle = ""
    @State private var avatar = ""
    @State private var preview: UIImage?
    @State private var item: PhotosPickerItem?
    @State private var uploading = false
    @State private var busy = false
    @State private var error: String?

    private var validHandle: Bool {
        handle.range(of: "^[a-z0-9_]{4,24}$", options: .regularExpression) != nil
    }

    var body: some View {
        ScrollView {
            VStack(spacing: 18) {
                Text("Добро пожаловать")
                    .font(.system(size: 28, weight: .semibold))
                    .tracking(-0.8)
                    .padding(.top, 50)
                Text("Как тебя будут видеть в Noctgram")
                    .font(.system(size: 15))
                    .foregroundColor(Noct.text60)
                PhotosPicker(selection: $item, matching: .images) {
                    ZStack {
                        Circle().fill(Noct.avatarFill)
                        if let preview {
                            Image(uiImage: preview).resizable().scaledToFill()
                        } else {
                            Image(systemName: "camera")
                                .font(.system(size: 26, weight: .light))
                                .foregroundColor(Noct.text60)
                        }
                        if uploading {
                            Color.black.opacity(0.45)
                            ProgressView().tint(.white)
                        }
                    }
                    .frame(width: 104, height: 104)
                    .clipShape(Circle())
                    .overlay(Circle().stroke(Noct.borderStrong, lineWidth: 1))
                }
                Text("Аватарку можно пропустить")
                    .font(.system(size: 12))
                    .foregroundColor(Noct.text48)
                VStack(alignment: .leading, spacing: 6) {
                    Text("Имя").font(.system(size: 13)).foregroundColor(Noct.text60)
                    TextField("Как тебя зовут", text: Binding(get: { name }, set: { name = String($0.prefix(40)) }))
                        .noctField()
                }
                VStack(alignment: .leading, spacing: 6) {
                    Text("Юзернейм").font(.system(size: 13)).foregroundColor(Noct.text60)
                    HStack(spacing: 4) {
                        Text("@").foregroundColor(Noct.text48)
                        TextField("username", text: Binding(
                            get: { handle },
                            set: { handle = String($0.lowercased().replacingOccurrences(of: "@", with: "").prefix(24)) }
                        ))
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                    }
                    .noctField()
                    Text("4–24 латинские буквы, цифры или _")
                        .font(.system(size: 12))
                        .foregroundColor(validHandle || handle.isEmpty ? Noct.text48 : Noct.red)
                }
                if let error {
                    Text(error).font(.system(size: 14)).foregroundColor(Noct.red).multilineTextAlignment(.center)
                }
                Button {
                    Task { await finish() }
                } label: {
                    HStack {
                        if busy { ProgressView().tint(.black) }
                        Text("Продолжить")
                    }
                    .frame(maxWidth: .infinity)
                }
                .buttonStyle(PrimaryButtonStyle())
                .disabled(busy || uploading || name.trimmingCharacters(in: .whitespaces).isEmpty || !validHandle)
                Button("Выйти") { Task { await session.signOut() } }
                    .font(.system(size: 14))
                    .foregroundColor(Noct.text48)
                    .padding(.top, 8)
            }
            .padding(.horizontal, 24)
            .frame(maxWidth: 460)
            .frame(maxWidth: .infinity)
        }
        .scrollDismissesKeyboard(.interactively)
        .background(Noct.background.ignoresSafeArea())
        .onChange(of: item) { value in
            guard let value else { return }
            Task { await upload(value) }
        }
    }

    private func upload(_ item: PhotosPickerItem) async {
        uploading = true
        defer {
            uploading = false
            self.item = nil
        }
        do {
            guard let data = try await item.loadTransferable(type: Data.self) else { return }
            // New accounts may upload one image up to 5 MB.
            let prepared = try MediaEncoder.prepare(data, types: [.jpeg], maxPixel: 900)
            let result = try await session.api.upload("/api/upload", data: prepared.data, filename: prepared.filename, mimeType: prepared.mimeType)
            avatar = result["url"].string ?? "/api/media/" + result["id"].str
            preview = prepared.preview
        } catch {
            self.error = error.userMessage
        }
    }

    private func finish() async {
        busy = true
        error = nil
        defer { busy = false }
        do {
            _ = try await session.api.post("/api/auth/onboarding", [
                "name": name.trimmingCharacters(in: .whitespacesAndNewlines),
                "handle": handle,
                "avatar": avatar,
            ])
            Haptics.success()
            await session.start()
        } catch {
            self.error = error.userMessage
        }
    }
}

struct ServerSheet: View {
    @EnvironmentObject private var session: AppSession
    @Environment(\.dismiss) private var dismiss
    @State private var text = ""
    @State private var error: String?

    var body: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: 14) {
                Text("Адрес сервера Noctgram. Для своего сервера или локальной разработки укажи его адрес, например http://192.168.0.10:3000.")
                    .font(.system(size: 14))
                    .foregroundColor(Noct.text60)
                TextField("noctgram.com", text: $text)
                    .keyboardType(.URL)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .noctField()
                if let error {
                    Text(error).font(.system(size: 13)).foregroundColor(Noct.red)
                }
                Button("По умолчанию: noctgram.com") {
                    text = AppSession.defaultServer.absoluteString
                }
                .font(.system(size: 14))
                .foregroundColor(Noct.text75)
                Spacer()
            }
            .padding(20)
            .background(Noct.elevated.ignoresSafeArea())
            .navigationTitle("Сервер")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Отмена") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Сохранить") {
                        guard session.setServer(text) else {
                            error = "Проверь адрес: например, noctgram.com"
                            return
                        }
                        dismiss()
                        Task { await session.start() }
                    }
                    .fontWeight(.semibold)
                }
            }
        }
        .presentationDetents([.medium])
        .onAppear { text = session.api.baseURL.absoluteString }
    }
}

// MARK: - Web session bridge

/// Copies session cookies between URLSession and WKWebView, so a login in
/// either place signs in both.
@MainActor
enum CookieBridge {
    static func toWebView(for url: URL) async {
        let store = WKWebsiteDataStore.default().httpCookieStore
        for cookie in HTTPCookieStorage.shared.cookies(for: url) ?? [] {
            await store.setCookie(cookie)
        }
    }

    static func fromWebView(host: String) async -> Int {
        let store = WKWebsiteDataStore.default().httpCookieStore
        let cookies = await store.allCookies()
        var copied = 0
        for cookie in cookies where host == cookie.domain.trimmingCharacters(in: CharacterSet(charactersIn: ".")) || host.hasSuffix(cookie.domain) {
            HTTPCookieStorage.shared.setCookie(cookie)
            copied += 1
        }
        return copied
    }
}

/// Login through the web page for servers without email codes
/// (Sites or Cloudflare Access): cookies are copied back to the app.
struct WebLoginView: View {
    @EnvironmentObject private var session: AppSession
    @Environment(\.dismiss) private var dismiss
    @State private var checking = false

    var body: some View {
        NavigationStack {
            WebView(url: session.api.url("/login")) { _ in
                Task { await check(silent: true) }
            }
            .ignoresSafeArea(edges: .bottom)
            .navigationTitle("Вход через сайт")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Отмена") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button {
                        Task { await check(silent: false) }
                    } label: {
                        if checking { ProgressView().tint(.white) } else { Text("Готово").fontWeight(.semibold) }
                    }
                }
            }
        }
    }

    private func check(silent: Bool) async {
        guard !checking else { return }
        checking = true
        defer { checking = false }
        _ = await CookieBridge.fromWebView(host: session.api.baseURL.host ?? "")
        guard let data = try? await session.api.get("/api/auth/session"), AuthStatus(data).user != nil else {
            if !silent { session.show("Сначала войди на странице") }
            return
        }
        dismiss()
        await session.signedIn()
    }
}

struct WebView: UIViewRepresentable {
    let url: URL
    var onNavigation: (URL?) -> Void = { _ in }

    func makeCoordinator() -> Coordinator {
        Coordinator(onNavigation: onNavigation)
    }

    func makeUIView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .default()
        configuration.allowsInlineMediaPlayback = true
        let view = WKWebView(frame: .zero, configuration: configuration)
        view.navigationDelegate = context.coordinator
        view.isOpaque = false
        view.backgroundColor = .black
        view.scrollView.backgroundColor = .black
        view.allowsBackForwardNavigationGestures = true
        let target = url
        Task {
            await CookieBridge.toWebView(for: target)
            view.load(URLRequest(url: target))
        }
        return view
    }

    func updateUIView(_ view: WKWebView, context: Context) {}

    final class Coordinator: NSObject, WKNavigationDelegate {
        let onNavigation: (URL?) -> Void

        init(onNavigation: @escaping (URL?) -> Void) {
            self.onNavigation = onNavigation
        }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            onNavigation(webView.url)
        }
    }
}

/// Sections that are not native yet (music, market, Premium…) in the web app,
/// signed in with the same session.
struct WebScreen: View {
    @EnvironmentObject private var session: AppSession
    let title: String
    let path: String

    var body: some View {
        WebView(url: URL(string: path, relativeTo: session.api.baseURL)?.absoluteURL ?? session.api.baseURL)
            .ignoresSafeArea(edges: .bottom)
            .background(Color.black)
            .navigationTitle(title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar(.hidden, for: .tabBar)
    }
}

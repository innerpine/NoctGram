import PhotosUI
import SwiftUI
import UIKit
import UniformTypeIdentifiers
import WebKit

/// Sign-in and sign-up laid out as Telegram's, in Noctgram's black and glass:
/// a welcome with the logo and a few pages about the app, then one question
/// per screen — the email, then the six digits from the letter — with the
/// main button at the bottom, over the keyboard. The server sets the
/// noct_session cookie (app/auth-screen.tsx); a new address gets an account
/// and goes on to its profile (OnboardingView).
struct LoginView: View {
    @EnvironmentObject private var session: AppSession
    @State private var step = Step.welcome
    /// Steps slide in from the right going on, from the left going back.
    @State private var forward = true
    @State private var page = 0
    @State private var email = ""
    @State private var code = ""
    @State private var busy = false
    @State private var error: String?
    @State private var resendAt: Date?
    @State private var emailEnabled = true
    @State private var showServer = false
    @State private var showWebLogin = false
    @State private var now = Date()
    /// Bumped by a wrong code, which shakes the cells.
    @State private var shakes = 0
    @FocusState private var focus: Field?

    private enum Step: Int { case welcome, email, code }
    private enum Field { case email, code }
    private let timer = Timer.publish(every: 1, on: .main, in: .common).autoconnect()

    /// The welcome's pages, as Telegram's intro turns through what it does.
    private static let pages: [(title: String, text: String)] = [
        ("Noctgram", "Место для тех, кто на своей волне. Без шума и лишнего."),
        ("Лента", "Публикации друзей и каналов, обсуждения и ответы в комментариях."),
        ("Сообщения", "Личные чаты и группы с реакциями, ответами и темами."),
        ("Подарки", "Анимированные подарки и Noct Stars для самых близких."),
    ]

    private var emailValid: Bool {
        let address = email.trimmingCharacters(in: .whitespacesAndNewlines)
        return address.contains("@") && address.count >= 5
    }

    var body: some View {
        #if DEBUG
        if UserDefaults.standard.string(forKey: "noct.debugLogin") == "profile" {
            // Screenshot hook (ios/Tests): the profile of a new account.
            OnboardingView()
        } else {
            flow
        }
        #else
        flow
        #endif
    }

    private var flow: some View {
        ZStack {
            AuthBackground(bright: step == .welcome)
            Group {
                switch step {
                case .welcome: welcome
                case .email: emailStep
                case .code: codeStep
                }
            }
            .transition(.asymmetric(
                insertion: .move(edge: forward ? .trailing : .leading).combined(with: .opacity),
                removal: .move(edge: forward ? .leading : .trailing).combined(with: .opacity)
            ))
        }
        .onReceive(timer) { now = $0 }
        .sheet(isPresented: $showServer) {
            ServerSheet().environmentObject(session)
        }
        .sheet(isPresented: $showWebLogin) {
            WebLoginView().environmentObject(session)
        }
        .task { await loadStatus() }
    }

    // MARK: Welcome

    private var welcome: some View {
        VStack(spacing: 0) {
            Spacer(minLength: 24)
            AuthLogo()
            TabView(selection: $page) {
                ForEach(Self.pages.indices, id: \.self) { index in
                    VStack(spacing: 10) {
                        Text(Self.pages[index].title)
                            .font(.system(size: index == 0 ? 34 : 26, weight: .bold))
                            .tracking(index == 0 ? -1 : -0.5)
                        Text(Self.pages[index].text)
                            .font(.system(size: 16))
                            .foregroundColor(Noct.text60)
                            .multilineTextAlignment(.center)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    .padding(.horizontal, 36)
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
                    .tag(index)
                }
            }
            .tabViewStyle(.page(indexDisplayMode: .never))
            .frame(height: 124)
            .padding(.top, 26)
            PageDots(count: Self.pages.count, current: page)
            Spacer(minLength: 24)
            AuthButton(title: "Начать", busy: false, enabled: true) { go(.email) }
                .accessibilityIdentifier("login-start")
            HStack(spacing: 6) {
                Button("Войти через сайт") { showWebLogin = true }
                Text("·")
                Button("Сервер: \(session.serverLabel)") { showServer = true }
            }
            .font(.system(size: 13))
            .foregroundColor(Noct.text48)
            .buttonStyle(PressableStyle())
            .lineLimit(1)
            .padding(.horizontal, 24)
            .padding(.bottom, 14)
        }
    }

    // MARK: Email

    private var emailStep: some View {
        ScrollView {
            VStack(spacing: 0) {
                AuthIcon(symbol: "envelope.fill")
                AuthTitle(
                    title: "Твоя почта",
                    text: Text("Пришлём на неё код для входа. Если аккаунта ещё нет, создадим новый.")
                )
                HStack(spacing: 12) {
                    Image(systemName: "at")
                        .font(.system(size: 17, weight: .medium))
                        .foregroundColor(Noct.text48)
                    // A verbatim prompt: as a string key the address would
                    // turn into a blue Markdown link.
                    TextField("Почта", text: $email, prompt: Text(verbatim: "name@example.com"))
                        .keyboardType(.emailAddress)
                        .textContentType(.emailAddress)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .font(.system(size: 18))
                        .focused($focus, equals: .email)
                        .submitLabel(.continue)
                        .onSubmit { Task { await start() } }
                        .accessibilityIdentifier("login-email")
                }
                .padding(.horizontal, 18)
                .frame(height: 56)
                .glassRect(18)
                .padding(.top, 30)
                if let error {
                    AuthError(text: error)
                }
                if !emailEnabled {
                    VStack(spacing: 12) {
                        Text("На этом сервере вход по почте ещё не подключён.")
                            .font(.system(size: 14))
                            .foregroundColor(Noct.text48)
                            .multilineTextAlignment(.center)
                        Button {
                            showWebLogin = true
                        } label: {
                            Label("Войти через сайт", systemImage: "globe")
                        }
                        .buttonStyle(SecondaryButtonStyle())
                    }
                    .padding(.top, 18)
                }
            }
            .padding(.horizontal, 24)
            .padding(.top, 48)
        }
        .scrollDismissesKeyboard(.interactively)
        .overlay(alignment: .topLeading) {
            AuthBackBar(disabled: busy) { go(.welcome) }
        }
        .safeAreaInset(edge: .bottom) {
            AuthButton(title: "Продолжить", busy: busy, enabled: emailValid && emailEnabled) {
                Task { await start() }
            }
            .accessibilityIdentifier("login-continue")
        }
        .onAppear { focusSoon(.email) }
    }

    // MARK: Code

    private var codeStep: some View {
        ScrollView {
            VStack(spacing: 0) {
                AuthIcon(symbol: "envelope.open.fill")
                AuthTitle(
                    title: "Введи код",
                    text: Text("Отправили письмо с кодом на \(Text(email).foregroundColor(.white).fontWeight(.medium))")
                )
                ZStack {
                    TextField("", text: Binding(
                        get: { code },
                        set: { value in
                            code = String(value.filter(\.isNumber).prefix(6))
                            if !code.isEmpty { error = nil }
                            if code.count == 6 { Task { await verify() } }
                        }
                    ))
                    .keyboardType(.numberPad)
                    .textContentType(.oneTimeCode)
                    .focused($focus, equals: .code)
                    .foregroundColor(.clear)
                    .tint(.clear)
                    .accentColor(.clear)
                    .accessibilityIdentifier("login-code")
                    CodeCells(code: code, active: focus == .code, failed: error != nil, shakes: shakes)
                        .allowsHitTesting(false)
                }
                .contentShape(Rectangle())
                .onTapGesture { focus = .code }
                .padding(.top, 30)
                if let error {
                    AuthError(text: error)
                }
                resend
                    .padding(.top, 24)
                if busy {
                    ProgressView()
                        .tint(.white)
                        .padding(.top, 18)
                }
            }
            .padding(.horizontal, 24)
            .padding(.top, 48)
        }
        .scrollDismissesKeyboard(.interactively)
        .overlay(alignment: .topLeading) {
            AuthBackBar(disabled: busy) {
                code = ""
                go(.email)
            }
        }
        .onAppear { focusSoon(.code) }
    }

    @ViewBuilder private var resend: some View {
        if let resendAt, resendAt > now {
            Text("Новый код можно запросить через \(clock(resendAt.timeIntervalSince(now)))")
                .font(.system(size: 15))
                .foregroundColor(Noct.text48)
                .monospacedDigit()
        } else {
            Button("Отправить код ещё раз") { Task { await start() } }
                .font(.system(size: 15, weight: .medium))
                .foregroundColor(AuthBackground.accent)
                .buttonStyle(PressableStyle())
                .disabled(busy)
        }
    }

    private func clock(_ seconds: TimeInterval) -> String {
        let total = max(0, Int(seconds.rounded(.up)))
        return String(format: "%d:%02d", total / 60, total % 60)
    }

    // MARK: Actions

    private func go(_ next: Step, keepError: Bool = false) {
        guard next != step else { return }
        forward = next.rawValue > step.rawValue
        if !keepError { error = nil }
        focus = nil
        // The leaving step takes the new direction before it slides away.
        DispatchQueue.main.async {
            withAnimation(Noct.motion) { step = next }
        }
    }

    /// The keyboard comes up once the step has slid in, as in Telegram.
    private func focusSoon(_ field: Field) {
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) { focus = field }
    }

    private func loadStatus() async {
        #if DEBUG
        // Screenshot hooks (ios/Tests): `-noct.debugLogin email|code`.
        switch UserDefaults.standard.string(forKey: "noct.debugLogin") {
        case "email":
            step = .email
            return
        case "code":
            email = "alice@noctgram.com"
            resendAt = Date().addingTimeInterval(42)
            step = .code
            return
        default:
            break
        }
        #endif
        guard let data = try? await session.api.get("/api/auth/session") else { return }
        let status = AuthStatus(data)
        emailEnabled = status.emailEnabled
        if status.user != nil {
            await session.signedIn()
        } else if let pending = status.challengeEmail {
            // A letter is on its way: straight to the code.
            email = pending
            resendAt = Date(timeIntervalSince1970: status.resendAt / 1000)
            step = .code
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
            if step == .code {
                session.show("Отправили новый код")
            } else {
                go(.code)
            }
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
            shakes += 1
            Haptics.error()
            if failure.code == "CODE_EXPIRED" { go(.email, keepError: true) }
        } catch {
            self.error = error.userMessage
        }
    }
}

/// The profile of a new account (/welcome), as Telegram asks for it: the
/// photo in a circle, the name and the username in one group, the button at
/// the bottom. The photo can wait.
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
    @FocusState private var focus: Field?

    private enum Field { case name, handle }

    private var validHandle: Bool {
        handle.range(of: "^[a-z0-9_]{4,24}$", options: .regularExpression) != nil
    }

    private var ready: Bool {
        !uploading && !name.trimmingCharacters(in: .whitespaces).isEmpty && validHandle
    }

    var body: some View {
        ZStack {
            AuthBackground(bright: false)
            VStack(spacing: 0) {
                HStack {
                    Spacer()
                    Button("Выйти") { Task { await session.signOut() } }
                        .font(.system(size: 15, weight: .medium))
                        .foregroundColor(Noct.text60)
                        .buttonStyle(PressableStyle())
                        .disabled(busy)
                }
                .padding(.horizontal, 20)
                .padding(.top, 12)
                ScrollView {
                    VStack(spacing: 0) {
                        photo
                            .padding(.top, 16)
                        AuthTitle(
                            title: "Твой профиль",
                            text: Text("Имя и фото увидят все. Юзернейм — короткая ссылка на тебя в Noctgram.")
                        )
                        fields
                            .padding(.top, 28)
                        Text(validHandle || handle.isEmpty ? "Юзернейм: 4–24 латинские буквы, цифры или _" : "Только латинские буквы, цифры и _, от 4 до 24 знаков")
                            .font(.system(size: 13))
                            .foregroundColor(validHandle || handle.isEmpty ? Noct.text48 : Noct.red)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(.horizontal, 16)
                            .padding(.top, 10)
                        if let error {
                            AuthError(text: error)
                        }
                    }
                    .padding(.horizontal, 24)
                }
                .scrollDismissesKeyboard(.interactively)
            }
        }
        .safeAreaInset(edge: .bottom) {
            AuthButton(title: "Продолжить", busy: busy, enabled: ready) {
                Task { await finish() }
            }
        }
        .onChange(of: item) { value in
            guard let value else { return }
            Task { await upload(value) }
        }
    }

    private var photo: some View {
        PhotosPicker(selection: $item, matching: .images) {
            ZStack {
                Circle().fill(Color.white.opacity(0.05))
                if let preview {
                    Image(uiImage: preview).resizable().scaledToFill()
                } else {
                    Image(systemName: "camera.fill")
                        .font(.system(size: 30))
                        .foregroundColor(AuthBackground.accent)
                }
                if uploading {
                    Color.black.opacity(0.45)
                    ProgressView().tint(.white)
                }
            }
            .frame(width: 112, height: 112)
            .clipShape(Circle())
            .glassCircle(interactive: true)
            .overlay(alignment: .bottomTrailing) {
                if preview == nil {
                    Image(systemName: "plus")
                        .font(.system(size: 14, weight: .bold))
                        .foregroundColor(.black)
                        .frame(width: 32, height: 32)
                        .background(Circle().fill(Color.white))
                        .overlay(Circle().stroke(Color.black, lineWidth: 3))
                }
            }
        }
        .buttonStyle(PressableStyle())
        .accessibilityLabel(preview == nil ? "Добавить фото" : "Сменить фото")
    }

    /// The name and the username in one glass group, as Telegram's first
    /// and last name.
    private var fields: some View {
        VStack(spacing: 0) {
            TextField("Имя", text: Binding(get: { name }, set: { name = String($0.prefix(40)) }))
                .font(.system(size: 17))
                .textContentType(.name)
                .submitLabel(.next)
                .focused($focus, equals: .name)
                .onSubmit { focus = .handle }
                .padding(.horizontal, 16)
                .frame(height: 54)
            Rectangle()
                .fill(Noct.borderStrong)
                .frame(height: 0.5)
                .padding(.leading, 16)
            HStack(spacing: 2) {
                Text("@")
                    .foregroundColor(Noct.text48)
                TextField("юзернейм", text: Binding(
                    get: { handle },
                    set: { handle = String($0.lowercased().replacingOccurrences(of: "@", with: "").prefix(24)) }
                ))
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .submitLabel(.done)
                .focused($focus, equals: .handle)
                .onSubmit { if ready { Task { await finish() } } }
            }
            .font(.system(size: 17))
            .padding(.horizontal, 16)
            .frame(height: 54)
        }
        .glassRect(18)
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
        guard ready, !busy else { return }
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

// MARK: - Parts of the sign-in screens

/// Black with a faint lilac glow from the top; brighter on the welcome.
private struct AuthBackground: View {
    let bright: Bool

    static let accent = Color(hex: 0xB9A2EA)

    var body: some View {
        ZStack {
            Color.black
            RadialGradient(
                colors: [Color(hex: 0x7A56C4).opacity(bright ? 0.34 : 0.2), .clear],
                center: UnitPoint(x: 0.5, y: 0),
                startRadius: 0,
                endRadius: 480
            )
            .animation(.easeInOut(duration: 0.5), value: bright)
        }
        .ignoresSafeArea()
        .allowsHitTesting(false)
    }
}

/// The logo on a glow that breathes, floating a little, as Telegram's intro
/// shows its plane.
private struct AuthLogo: View {
    @State private var breathe = false
    @State private var shown = false

    var body: some View {
        ZStack {
            Circle()
                .fill(RadialGradient(
                    colors: [Color(hex: 0x9C7BE0).opacity(0.6), .clear],
                    center: .center,
                    startRadius: 0,
                    endRadius: 120
                ))
                .frame(width: 240, height: 240)
                .scaleEffect(breathe ? 1.08 : 0.92)
                .opacity(breathe ? 0.95 : 0.6)
            Image("Logo")
                .resizable()
                .scaledToFit()
                .frame(width: 112, height: 112)
                .offset(y: breathe ? -4 : 4)
        }
        .frame(height: 200)
        .scaleEffect(shown ? 1 : 0.8)
        .opacity(shown ? 1 : 0)
        .onAppear {
            withAnimation(.spring(response: 0.6, dampingFraction: 0.7)) { shown = true }
            guard !UIAccessibility.isReduceMotionEnabled else { return }
            withAnimation(.easeInOut(duration: 3.2).repeatForever(autoreverses: true)) { breathe = true }
        }
        .accessibilityHidden(true)
    }
}

/// The picture over a step: a symbol on glass over a soft glow.
private struct AuthIcon: View {
    let symbol: String
    @State private var shown = false

    var body: some View {
        Image(systemName: symbol)
            .font(.system(size: 34, weight: .medium))
            .foregroundColor(.white)
            .frame(width: 92, height: 92)
            .glassCircle()
            .background(
                Circle()
                    .fill(Color(hex: 0x9C7BE0).opacity(0.35))
                    .frame(width: 150, height: 150)
                    .blur(radius: 30)
            )
            .scaleEffect(shown ? 1 : 0.7)
            .opacity(shown ? 1 : 0)
            .padding(.top, 28)
            .onAppear {
                withAnimation(.spring(response: 0.5, dampingFraction: 0.65).delay(0.1)) { shown = true }
            }
            .accessibilityHidden(true)
    }
}

private struct AuthTitle: View {
    let title: String
    let text: Text

    var body: some View {
        VStack(spacing: 10) {
            Text(title)
                .font(.system(size: 28, weight: .bold))
                .tracking(-0.6)
                .multilineTextAlignment(.center)
            text
                .font(.system(size: 16))
                .foregroundColor(Noct.text60)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(.top, 26)
    }
}

private struct AuthError: View {
    let text: String

    var body: some View {
        Text(text)
            .font(.system(size: 14))
            .foregroundColor(Noct.red)
            .multilineTextAlignment(.center)
            .fixedSize(horizontal: false, vertical: true)
            .padding(.top, 14)
    }
}

/// The main button of a step, across the bottom, over the keyboard.
private struct AuthButton: View {
    let title: String
    let busy: Bool
    let enabled: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 8) {
                if busy {
                    ProgressView().tint(.black)
                }
                Text(title)
            }
            .font(.system(size: 17, weight: .semibold))
            .frame(maxWidth: .infinity, minHeight: 52)
        }
        .buttonStyle(PrimaryButtonStyle())
        .disabled(busy || !enabled)
        .padding(.horizontal, 24)
        .padding(.top, 8)
        .padding(.bottom, 12)
    }
}

private struct AuthBackBar: View {
    let disabled: Bool
    let action: () -> Void

    var body: some View {
        HStack {
            Button(action: action) {
                Image(systemName: "chevron.left")
                    .font(.system(size: 17, weight: .semibold))
            }
            .buttonStyle(CircleButtonStyle(size: 40))
            .disabled(disabled)
            .accessibilityLabel("Назад")
            Spacer()
        }
        .padding(.horizontal, 16)
        .padding(.top, 8)
    }
}

/// Page dots under the welcome's pages; the current one is wider.
private struct PageDots: View {
    let count: Int
    let current: Int

    var body: some View {
        HStack(spacing: 6) {
            ForEach(0..<count, id: \.self) { index in
                Capsule()
                    .fill(Color.white.opacity(index == current ? 0.9 : 0.25))
                    .frame(width: index == current ? 18 : 6, height: 6)
            }
        }
        .animation(Noct.quick, value: current)
        .accessibilityHidden(true)
    }
}

/// Six cells for the digits from the letter: the next one is lit, and a
/// wrong code shakes them and turns them red until the next digit.
private struct CodeCells: View {
    let code: String
    let active: Bool
    let failed: Bool
    let shakes: Int

    var body: some View {
        let digits = Array(code)
        HStack(spacing: 8) {
            ForEach(0..<6, id: \.self) { index in
                let filled = index < digits.count
                Text(filled ? String(digits[index]) : "")
                    .font(.system(size: 26, weight: .semibold, design: .rounded))
                    .foregroundColor(.white)
                    .frame(maxWidth: 52)
                    .frame(height: 60)
                    .glassRect(14)
                    .overlay(
                        RoundedRectangle(cornerRadius: 14, style: .continuous)
                            .stroke(stroke(index, count: digits.count), lineWidth: 1.5)
                    )
                    .scaleEffect(filled ? 1 : 0.96)
                    .animation(.spring(response: 0.25, dampingFraction: 0.6), value: filled)
            }
        }
        .modifier(Shake(amount: CGFloat(shakes)))
        .animation(.linear(duration: 0.4), value: shakes)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Код: \(code.count) из 6 цифр")
    }

    private func stroke(_ index: Int, count: Int) -> Color {
        if failed { return Noct.red.opacity(0.85) }
        return active && index == min(count, 5) ? AuthBackground.accent : .clear
    }
}

/// A horizontal shake, one for each whole step of `amount`.
private struct Shake: GeometryEffect {
    var amount: CGFloat
    var animatableData: CGFloat {
        get { amount }
        set { amount = newValue }
    }

    func effectValue(size: CGSize) -> ProjectionTransform {
        ProjectionTransform(CGAffineTransform(translationX: 10 * sin(amount * .pi * 4), y: 0))
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
            .sheetSurface()
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

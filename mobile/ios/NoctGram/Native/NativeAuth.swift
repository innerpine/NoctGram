import SwiftUI

struct NGSignInView: View {
    @EnvironmentObject private var session: NativeSession
    @State private var email = ""
    @State private var code = ""
    @State private var awaitingCode = false
    @State private var resendAt = Date.distantPast
    @State private var busy = false
    @State private var error: String?
    @FocusState private var focusedField: String?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 28) {
                HStack {
                    Image(systemName: "moon.fill").font(.title2).foregroundColor(NGTheme.accent)
                    Text("NoctGram").font(.title2.bold())
                }.padding(.top, 36)
                VStack(alignment: .leading, spacing: 12) {
                    Text(awaitingCode ? "Проверь почту" : "Твоя ночь.\nТвои люди.")
                        .font(.system(.largeTitle, design: .rounded).bold())
                        .accessibilityAddTraits(.isHeader)
                    Text(awaitingCode ? "Отправили код на \(email). Введи шесть цифр из письма." : "Разговоры, мысли и моменты — всё, что хочется сохранить рядом.")
                        .font(.body).foregroundColor(NGTheme.muted)
                }
                VStack(alignment: .leading, spacing: 16) {
                    if awaitingCode {
                        Text("Код из письма").font(.subheadline.weight(.semibold))
                        TextField("000000", text: $code)
                            .font(.title2.monospacedDigit())
                            .keyboardType(.numberPad).textContentType(.oneTimeCode)
                            .focused($focusedField, equals: "code")
                            .padding(18).background(NGTheme.surface, in: RoundedRectangle(cornerRadius: 18))
                            .accessibilityIdentifier("login.code")
                            .onChange(of: code) { value in
                                code = String(value.filter { $0.isASCII && $0.isNumber }.prefix(6))
                            }
                    } else {
                        Text("Электронная почта").font(.subheadline.weight(.semibold))
                        TextField("you@example.com", text: $email)
                            .textContentType(.emailAddress).keyboardType(.emailAddress)
                            .textInputAutocapitalization(.never).autocorrectionDisabled(true)
                            .focused($focusedField, equals: "email")
                            .submitLabel(.continue).onSubmit { submit() }
                            .padding(18).background(NGTheme.surface, in: RoundedRectangle(cornerRadius: 18))
                            .accessibilityIdentifier("login.email")
                    }
                    if let error {
                        Label(error, systemImage: "exclamationmark.circle")
                            .font(.subheadline).foregroundColor(.orange)
                            .fixedSize(horizontal: false, vertical: true)
                            .accessibilityIdentifier("login.error")
                    }
                    if !session.emailEnabled {
                        Text("Вход по почте сейчас недоступен. Попробуй позже.").foregroundColor(NGTheme.muted)
                    }
                    Button(action: submit) {
                        HStack {
                            Spacer()
                            if busy { ProgressView().tint(.black) }
                            Text(awaitingCode ? "Войти" : "Получить код")
                            Spacer()
                        }
                    }
                    .buttonStyle(NGPrimaryButtonStyle())
                    .disabled(busy || !session.emailEnabled || (awaitingCode ? code.count != 6 : !validEmail))
                    .accessibilityIdentifier("login.submit")
                    if awaitingCode {
                        TimelineView(.periodic(from: .now, by: 1)) { context in
                            let remaining = max(0, Int(resendAt.timeIntervalSince(context.date).rounded(.up)))
                            Button(remaining > 0 ? "Отправить снова через \(remaining) с" : "Отправить код снова") {
                                sendCode()
                            }
                            .frame(maxWidth: .infinity, minHeight: 44)
                            .disabled(busy || remaining > 0)
                        }
                        Button("Изменить почту") {
                            awaitingCode = false
                            code = ""
                            error = nil
                        }.frame(maxWidth: .infinity, minHeight: 44).disabled(busy)
                    }
                }
                Text("Используй почту своего аккаунта NoctGram. Если аккаунта ещё нет, создадим его после подтверждения.")
                    .font(.footnote).foregroundColor(NGTheme.muted)
                    .fixedSize(horizontal: false, vertical: true)
            }.frame(maxWidth: 440).padding(28).frame(maxWidth: .infinity)
        }
        .background(NGTheme.background)
        .onAppear {
            if let challenge = session.challenge, challenge.double("expiresAt") > Date().timeIntervalSince1970 * 1000 {
                email = challenge.string("email")
                resendAt = Date(timeIntervalSince1970: challenge.double("resendAt") / 1000)
                awaitingCode = true
            }
        }
    }

    private var validEmail: Bool {
        let parts = email.trimmingCharacters(in: .whitespacesAndNewlines).split(separator: "@")
        return parts.count == 2 && parts[1].contains(".") && email.count <= 254
    }
    private func submit() {
        guard !busy else { return }
        if !awaitingCode { sendCode(); return }
        busy = true
        error = nil
        focusedField = nil
        Task {
            defer { busy = false }
            do {
                _ = try await NoctAPI.shared.post("/api/auth/verify", body: ["code": code])
                await session.refresh()
            } catch { self.error = error.localizedDescription }
        }
    }
    private func sendCode() {
        guard validEmail, !busy else { return }
        busy = true
        error = nil
        Task {
            defer { busy = false }
            do {
                email = email.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
                let result = try await NoctAPI.shared.post("/api/auth/start", body: ["email": email])
                resendAt = Date(timeIntervalSince1970: result.double("resendAt") / 1000)
                awaitingCode = true
                code = ""
                focusedField = "code"
            } catch { self.error = error.localizedDescription }
        }
    }
}

struct NGOnboardingView: View {
    @EnvironmentObject private var session: NativeSession
    @State private var name = ""
    @State private var handle = ""
    @State private var busy = false
    @State private var error: String?
    var body: some View {
        NavigationView {
            Form {
                Section(header: Text("Как тебя представить?"), footer: Text("Юзернейм: 4–24 латинские буквы, цифры или знак _.")) {
                    TextField("Имя", text: $name).textContentType(.nickname)
                        .onChange(of: name) { name = String($0.prefix(40)) }
                    TextField("username", text: $handle)
                        .textInputAutocapitalization(.never).autocorrectionDisabled(true)
                        .onChange(of: handle) { handle = String($0.lowercased().prefix(24)) }
                }
                if let error { Section { Text(error).foregroundColor(.orange) } }
                Section {
                    Button {
                        busy = true
                        error = nil
                        Task {
                            defer { busy = false }
                            do {
                                _ = try await NoctAPI.shared.post("/api/auth/onboarding", body: ["name": name.trimmingCharacters(in: .whitespacesAndNewlines), "handle": handle])
                                await session.refresh()
                            } catch { self.error = error.localizedDescription }
                        }
                    } label: {
                        HStack { Text("Начать общение"); Spacer(); if busy { ProgressView() } }
                    }.disabled(busy || name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || handle.range(of: "^[a-z0-9_]{4,24}$", options: .regularExpression) == nil)
                }
            }
            .navigationTitle("Твой профиль")
            .toolbar { ToolbarItem(placement: .navigationBarLeading) { Button("Выйти") { Task { await session.signOut() } } } }
        }.navigationViewStyle(.stack)
    }
}
